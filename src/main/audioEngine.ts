import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface EngineReadyInfo {
  version: string;
  platform: string;
  arch: string;
}

export interface AudioEngineInfo {
  available: boolean;
  platform: string;
  version?: string;
  path?: string;
  reason?: string;
  output?: unknown;
}

const COMMANDS = new Set([
  'pause',
  'resume',
  'seek',
  'volume',
  'configure',
  'prepareNext',
  'cancelNext',
  'stop',
  'status',
]);

export class AudioEngineManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private starting: Promise<void> | null = null;
  private readyInfo: EngineReadyInfo | null = null;
  private lastOutput: unknown = null;

  constructor(private broadcast: (event: unknown) => void) {}

  getInfo(): AudioEngineInfo {
    const executable = this.resolveExecutable();
    if (!executable) {
      return {
        available: false,
        platform: process.platform,
        reason:
          process.platform === 'win32' || process.platform === 'linux'
            ? 'The WavrPulse executable is missing. Run npm run build:native.'
            : 'WavrPulse is only available on Windows and Linux.',
      };
    }
    return {
      available: true,
      platform: process.platform,
      version: this.readyInfo?.version,
      path: executable,
      output: this.lastOutput || undefined,
    };
  }

  async play(payload: any): Promise<any> {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid audio engine play request.');
    }
    const url = String(payload.url || '');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid audio stream URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('The audio engine only accepts HTTP or HTTPS streams.');
    }
    const trackId = String(payload.trackId || '').slice(0, 512);
    if (!trackId) throw new Error('Missing track ID.');
    const queueIndex = Number.isInteger(payload.queueIndex) ? payload.queueIndex : -1;
    const position = Number.isFinite(payload.position) ? Math.max(0, payload.position) : 0;
    const autoplay = payload.autoplay !== false;
    if (!payload.config || typeof payload.config !== 'object') {
      throw new Error('Missing audio engine configuration.');
    }
    return this.request('play', {
      url: parsed.toString(),
      trackId,
      queueIndex,
      position,
      autoplay,
      config: payload.config,
    });
  }

  async devices(): Promise<any> {
    const response = await this.request('devices', {}, 30000);
    return response;
  }

  async command(name: string, payload: any = {}): Promise<any> {
    if (!COMMANDS.has(name)) throw new Error(`Unknown audio engine command: ${name}`);
    if (name === 'prepareNext') {
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid next-track request.');
      }
      let parsed: URL;
      try {
        parsed = new URL(String(payload.url || ''));
      } catch {
        throw new Error('Invalid next-track URL.');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('The audio engine only accepts HTTP or HTTPS streams.');
      }
      if (!String(payload.trackId || '')) throw new Error('Missing next track ID.');
      return this.request(name, {
        url: parsed.toString(),
        trackId: String(payload.trackId).slice(0, 512),
        queueIndex: Number.isInteger(payload.queueIndex) ? payload.queueIndex : -1,
      });
    }
    return this.request(name, payload || {});
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.write(
        JSON.stringify({ id: this.nextId++, command: 'shutdown', payload: null }) + '\n',
      );
    } catch {
      /* ignore during shutdown */
    }
    this.child = null;
    this.readyInfo = null;
    try {
      child.kill();
    } catch {
      /* ignore during shutdown */
    }
  }

  private resolveExecutable(): string | null {
    const override = process.env['WAVR_PULSE_ENGINE'];
    const names = ['WavrPulse.exe', 'wavr-pulse.exe', 'wavr-pulse', 'WavrPulse'];
    const directories = [
      app.isPackaged ? path.join(process.resourcesPath, 'bin') : null,
      path.join(app.getAppPath(), 'native', 'bin'),
      path.join(app.getAppPath(), 'native', 'audio-engine', 'target', 'release'),
      path.join(app.getAppPath(), 'native', 'audio-engine', 'target', 'debug'),
    ].filter((entry): entry is string => !!entry);
    const candidates = [
      override,
      ...directories.flatMap((directory) => names.map((name) => path.join(directory, name))),
    ].filter((entry): entry is string => !!entry);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  private ensureStarted(): Promise<void> {
    if (this.child && this.readyInfo) return Promise.resolve();
    if (this.starting) return this.starting;
    const executable = this.resolveExecutable();
    if (!executable) {
      return Promise.reject(new Error(this.getInfo().reason || 'WavrPulse is unavailable.'));
    }
    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          this.child?.kill();
        } catch {
          /* ignore */
        }
        this.child = null;
        this.readyInfo = null;
        this.starting = null;
        reject(new Error('WavrPulse did not start in time.'));
      }, 10000);

      let child: ChildProcessWithoutNullStreams;
      try {
        const binaryDirectory = path.dirname(executable);
        const environment = { ...process.env };
        if (process.platform === 'linux') {
          environment['LD_LIBRARY_PATH'] = [
            binaryDirectory,
            environment['LD_LIBRARY_PATH'],
          ]
            .filter(Boolean)
            .join(path.delimiter);
        }
        child = spawn(executable, [], {
          cwd: binaryDirectory,
          env: environment,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: any) {
        clearTimeout(timer);
        settled = true;
        this.starting = null;
        reject(error);
        return;
      }
      this.child = child;

      const reader = readline.createInterface({ input: child.stdout });
      reader.on('line', (line) => {
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event?.event === 'ready') {
          this.readyInfo = {
            version: String(event.version || ''),
            platform: String(event.platform || process.platform),
            arch: String(event.arch || process.arch),
          };
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.starting = null;
            resolve();
          }
          this.broadcast(event);
          return;
        }
        if (event?.event === 'response' && Number.isInteger(event.id)) {
          const pending = this.pending.get(event.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(event.id);
            if (event.ok) pending.resolve(event.data ?? null);
            else pending.reject(new Error(event.error || 'WavrPulse rejected the request.'));
          }
          return;
        }
        if (event?.event === 'output') this.lastOutput = event;
        this.broadcast(event);
      });

      child.stderr.on('data', (chunk) => {
        const message = chunk.toString().trim();
        if (message && !app.isPackaged) console.warn('[audio-engine]', message);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          this.starting = null;
          reject(error);
        }
        this.failPending(error);
        this.broadcast({ event: 'engineExit', message: error.message });
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        const wasReady = !!this.readyInfo;
        this.child = null;
        this.readyInfo = null;
        this.starting = null;
        this.failPending(new Error('WavrPulse stopped.'));
        if (wasReady || !settled) {
          this.broadcast({
            event: 'engineExit',
            message: `WavrPulse stopped${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ''}.`,
          });
        }
        if (!settled) {
          settled = true;
          reject(new Error('WavrPulse exited before it was ready.'));
        }
      });
    });
    return this.starting;
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async request(command: string, payload: any, timeoutMs = 20000): Promise<any> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new Error('WavrPulse is not running.');
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WavrPulse did not answer ${command}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ id, command, ...payload }) + '\n';
      child.stdin.write(line, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
}
