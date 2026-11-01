import { app, shell } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import type { UpdateStatus } from '../../shared/models';
import {
  compareAppVersions,
  isTrustedUpdateUrl,
  updateFeedBase,
  updateManifestFrom,
  type UpdateManifest,
} from '../../shared/updates';

interface UpdateSettings {
  autoUpdate: boolean;
  updateFeedUrl: string;
  updateMode: 'all' | 'critical';
  updateChannel: 'stable' | 'beta' | 'dev';
}

interface UpdateManagerOptions {
  getSettings: () => UpdateSettings;
  onStatus: (status: UpdateStatus) => void;
  userDataPath: string;
  fetchImpl?: typeof fetch;
}

const STARTUP_CHECK_DELAY_MS = 5000;
const CHECK_TIMEOUT_MS = 25000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function updateChannelFor(value: unknown): 'stable' | 'beta' | 'dev' | 'linux' {
  if (process.platform === 'linux') return 'linux';
  if (value === 'dev') return 'dev';
  if (value === 'beta') return 'beta';
  return 'stable';
}

function emptyStatus(): UpdateStatus {
  return {
    state: 'disabled',
    currentVersion: app.getVersion(),
    availableVersion: '',
    progress: 0,
    message: '',
    releaseNotes: '',
  };
}

export class UpdateManager {
  private readonly getSettings: () => UpdateSettings;
  private readonly onStatus: (status: UpdateStatus) => void;
  private readonly userDataPath: string;
  private readonly fetchImpl: typeof fetch;
  private status: UpdateStatus = emptyStatus();
  private manifest: UpdateManifest | null = null;
  private installerPath = '';
  private checking = false;
  private downloading = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private lastFeedUrl = '';
  private lastChannel = '';

  constructor(options: UpdateManagerOptions) {
    this.getSettings = options.getSettings;
    this.onStatus = options.onStatus;
    this.userDataPath = options.userDataPath;
    this.fetchImpl = options.fetchImpl || ((input, init) => fetch(input, init));
  }

  start() {
    const settings = this.getSettings();
    this.lastFeedUrl = updateFeedBase(settings.updateFeedUrl);
    this.lastChannel = updateChannelFor(settings.updateChannel);
    if (!this.lastFeedUrl) {
      this.setStatus({ state: 'disabled', message: 'No update server configured.' });
      return;
    }
    if (!settings.autoUpdate) {
      this.setStatus({ state: 'idle', message: 'Automatic update checks are disabled.' });
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.check(false, true);
    }, STARTUP_CHECK_DELAY_MS);
    this.startupTimer.unref?.();
  }

  shutdown() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.startupTimer = null;
    this.settingsTimer = null;
    this.abortController?.abort();
    this.abortController = null;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  refreshSettings() {
    const settings = this.getSettings();
    const feedUrl = updateFeedBase(settings.updateFeedUrl);
    const channel = updateChannelFor(settings.updateChannel);
    if (!settings.autoUpdate) {
      if (this.startupTimer) clearTimeout(this.startupTimer);
      if (this.settingsTimer) clearTimeout(this.settingsTimer);
      this.startupTimer = null;
      this.settingsTimer = null;
      if (
        this.status.state !== 'downloading' &&
        this.status.state !== 'downloaded' &&
        this.status.state !== 'checking'
      ) {
        this.setStatus({ state: 'idle', message: 'Automatic update checks are disabled.' });
      }
      return;
    }
    if (!feedUrl) {
      if (this.status.state !== 'downloading' && this.status.state !== 'downloaded') {
        this.lastFeedUrl = '';
        this.setStatus({ state: 'disabled', message: 'No update server configured.' });
      }
      return;
    }
    if (feedUrl === this.lastFeedUrl && channel === this.lastChannel) {
      if (!settings.autoUpdate && this.status.state === 'checking') {
        this.setStatus({ state: 'idle', message: 'Automatic update checks are disabled.' });
      }
      return;
    }
    this.lastFeedUrl = feedUrl;
    this.lastChannel = channel;
    this.manifest = null;
    this.installerPath = '';
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    if (settings.autoUpdate) {
      this.settingsTimer = setTimeout(() => {
        this.settingsTimer = null;
        void this.check(false);
      }, 600);
      this.settingsTimer.unref?.();
    } else {
      this.setStatus({
        state: 'idle',
        message: 'Automatic update checks are disabled.',
        availableVersion: '',
        progress: 0,
        releaseNotes: '',
      });
    }
  }

  async check(manual = true, autoInstall = false): Promise<UpdateStatus> {
    if (this.checking || this.downloading) return this.status;
    const settings = this.getSettings();
    const feedUrl = updateFeedBase(settings.updateFeedUrl);
    if (!feedUrl) {
      this.setStatus({
        state: 'disabled',
        message: 'Set an update server URL to check for updates.',
      });
      return this.status;
    }
    if (!isTrustedUpdateUrl(feedUrl)) {
      this.setStatus({
        state: 'error',
        message: 'Update server URL must use HTTPS. HTTP is allowed only for localhost.',
      });
      return this.status;
    }

    this.checking = true;
    this.setStatus({
      state: 'checking',
      progress: 0,
      message: manual ? 'Checking for updates...' : 'Checking for updates on startup...',
      availableVersion: '',
      releaseNotes: '',
    });
    const controller = new AbortController();
    this.abortController = controller;
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    try {
      const query = new URLSearchParams({
        platform: process.platform,
        arch: process.arch,
        current: app.getVersion(),
        channel: updateChannelFor(settings.updateChannel),
      });
      const response = await this.fetchImpl(`${feedUrl}/api/update/latest?${query.toString()}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 204 || response.status === 404) {
        this.setStatus({
          state: 'up-to-date',
          message: `WAVR ${app.getVersion()} is up to date.`,
          progress: 100,
        });
        return this.status;
      }
      if (!response.ok) throw new Error(`Update server responded with ${response.status}.`);
      const payload = await response.json();
      const manifest = updateManifestFrom(payload);
      if (!manifest) throw new Error('The update server returned an invalid manifest.');
      this.manifest = manifest;
      if (compareAppVersions(manifest.version, app.getVersion()) <= 0) {
        this.setStatus({
          state: 'up-to-date',
          availableVersion: manifest.version,
          message: `WAVR ${app.getVersion()} is up to date.`,
          progress: 100,
          releaseNotes: manifest.notes,
        });
        return this.status;
      }
      this.setStatus({
        state: 'available',
        availableVersion: manifest.version,
        message: manifest.critical
          ? `Critical update WAVR ${manifest.version} is available.`
          : `WAVR ${manifest.version} is available.`,
        progress: 0,
        releaseNotes: manifest.notes,
      });
      const allowedByPolicy = settings.updateMode !== 'critical' || manifest.critical;
      if (settings.autoUpdate && allowedByPolicy) {
        const downloaded = await this.download();
        if (autoInstall && !manual && downloaded.state === 'downloaded') {
          this.setStatus({
            state: 'downloaded',
            progress: 100,
            message: `WAVR ${manifest.version} downloaded. Restarting to install...`,
          });
          setTimeout(() => {
            void this.install();
          }, 1200);
        }
      }
      return this.status;
    } catch (error: any) {
      const message = error?.name === 'AbortError'
        ? 'The update server did not respond in time.'
        : error?.message || 'Could not check for updates.';
      this.setStatus({ state: 'error', message });
      return this.status;
    } finally {
      clearTimeout(timeout);
      if (this.abortController === controller) this.abortController = null;
      this.checking = false;
    }
  }

  async download(): Promise<UpdateStatus> {
    if (this.downloading) return this.status;
    const manifest = this.manifest;
    if (!manifest) {
      this.setStatus({ state: 'error', message: 'No update is available to download.' });
      return this.status;
    }
    if (!isTrustedUpdateUrl(manifest.url)) {
      this.setStatus({ state: 'error', message: 'The update download URL is not trusted.' });
      return this.status;
    }

    this.downloading = true;
    this.setStatus({
      state: 'downloading',
      availableVersion: manifest.version,
      progress: 0,
      message: `Downloading WAVR ${manifest.version}...`,
    });
    const controller = new AbortController();
    this.abortController = controller;
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const directory = path.join(this.userDataPath, 'updates');
    const filename = path.basename(new URL(manifest.url).pathname) || `WAVR-${manifest.version}.exe`;
    const destination = path.join(directory, filename);
    const partial = `${destination}.part`;

    try {
      fs.mkdirSync(directory, { recursive: true });
      const response = await this.fetchImpl(manifest.url, {
        headers: { accept: 'application/octet-stream' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Update download failed with ${response.status}.`);
      }
      const total = Number(response.headers.get('content-length')) || manifest.size;
      const hash = crypto.createHash('sha512');
      const output = fs.createWriteStream(partial);
      let received = 0;
      let lastProgress = 0;
      try {
        for await (const chunk of Readable.fromWeb(response.body as any)) {
          const buffer = Buffer.from(chunk);
          received += buffer.length;
          hash.update(buffer);
          if (!output.write(buffer)) {
            await new Promise<void>((resolve) => output.once('drain', resolve));
          }
          const now = Date.now();
          if (now - lastProgress > 300) {
            lastProgress = now;
            this.setStatus({
              progress: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
            });
          }
        }
        await new Promise<void>((resolve, reject) => {
          output.end((error?: Error | null) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        output.destroy();
        throw error;
      }

      const digest = hash.digest('base64');
      if (digest !== manifest.sha512) {
        fs.rmSync(partial, { force: true });
        throw new Error('The downloaded update failed integrity verification.');
      }
      if (received !== manifest.size) {
        fs.rmSync(partial, { force: true });
        throw new Error('The downloaded update size did not match the manifest.');
      }
      fs.rmSync(destination, { force: true });
      fs.renameSync(partial, destination);
      this.installerPath = destination;
      this.setStatus({
        state: 'downloaded',
        availableVersion: manifest.version,
        progress: 100,
        message: `WAVR ${manifest.version} is ready to install.`,
        releaseNotes: manifest.notes,
      });
      return this.status;
    } catch (error: any) {
      fs.rmSync(partial, { force: true });
      const message = error?.name === 'AbortError'
        ? 'The update download timed out.'
        : error?.message || 'Could not download the update.';
      this.setStatus({ state: 'error', message });
      return this.status;
    } finally {
      clearTimeout(timeout);
      if (this.abortController === controller) this.abortController = null;
      this.downloading = false;
    }
  }

  async install(): Promise<boolean> {
    if (!this.installerPath || !fs.existsSync(this.installerPath)) {
      this.setStatus({ state: 'error', message: 'No downloaded update is ready to install.' });
      return false;
    }
    try {
      if (process.platform === 'win32') {
        const helperPath = path.join(this.userDataPath, 'updates', 'apply-update.vbs');
        const appPath = app.getPath('exe');
        const vbsPath = (value: string) => value.replace(/"/g, '""');
        const script = [
          'Set shell = CreateObject("WScript.Shell")',
          'Set fso = CreateObject("Scripting.FileSystemObject")',
          'WScript.Sleep 2000',
          `installer = "${vbsPath(this.installerPath)}"`,
          `appPath = "${vbsPath(appPath)}"`,
          'shell.Run """" & installer & """ /S --updated", 0, True',
          'WScript.Sleep 3000',
          'shell.Run """" & appPath & """", 1, False',
          'On Error Resume Next',
          'fso.DeleteFile WScript.ScriptFullName, True',
        ].join('\r\n');
        fs.mkdirSync(path.dirname(helperPath), { recursive: true });
        fs.writeFileSync(helperPath, script, 'utf8');
        try {
          fs.rmSync(path.join(this.userDataPath, 'updates', 'apply-update.cmd'), { force: true });
        } catch {
          /* The previous helper may still be in use. */
        }
        const child = spawn('wscript.exe', ['//B', '//NoLogo', helperPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        setTimeout(() => app.quit(), 250);
        return true;
      }
      const error = await shell.openPath(this.installerPath);
      if (error) throw new Error(error);
      return true;
    } catch (error: any) {
      this.setStatus({
        state: 'error',
        message: error?.message || 'Could not launch the update installer.',
      });
      return false;
    }
  }

  private setStatus(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }
}
