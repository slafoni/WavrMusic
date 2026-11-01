import fs from 'fs';
import http from 'http';
import path from 'path';
import { safeStorage, shell } from 'electron';
import type {
  AppSettings,
  ScrobbleProvider,
  ScrobbleStatus,
  ScrobbleTrack,
} from '../../shared/models';
import {
  SCROBBLE_PROVIDERS,
  isScrobbleEligible,
  normalizeScrobbleTrack,
} from '../../shared/scrobble';
import {
  LASTFM_API_KEY,
  LASTFM_API_SECRET,
  LASTFM_CALLBACK_PATH,
  LASTFM_CALLBACK_PORT,
  LASTFM_CALLBACK_URL,
} from '../../shared/constants';
import { buildScrobbleRequest, scrobbleTrackParams } from './scrobbleApi';

const AUTH_POLL_MS = 2500;
const AUTH_TIMEOUT_MS = 120000;
const REQUEST_TIMEOUT_MS = 14000;

interface StoredSession {
  key: string;
  username: string;
}

type Sessions = Partial<Record<ScrobbleProvider, StoredSession>>;

interface QueueEntry {
  provider: ScrobbleProvider;
  track: ScrobbleTrack;
  timestamp: number;
  attempts: number;
}

interface Credentials {
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
  username: string;
}

export type ScrobbleSettings = Pick<
  AppSettings,
  | 'lastFmApiKey'
  | 'lastFmApiSecret'
  | 'libreFmApiKey'
  | 'libreFmApiSecret'
  | 'scrobbleEnabled'
  | 'scrobbleProvider'
>;

interface ScrobbleManagerOptions {
  getSettings: () => ScrobbleSettings;
  sessionsPath: string;
  queuePath: string;
  onStatus?: (status: ScrobbleStatus) => void;
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
}

class ScrobbleApiError extends Error {
  code: number | null;
  retryable: boolean;

  constructor(message: string, code: number | null = null, retryable = false) {
    super(message);
    this.name = 'ScrobbleApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

function providerFor(value: unknown): ScrobbleProvider {
  return value === 'librefm' ? 'librefm' : 'lastfm';
}

function retryableCode(code: number): boolean {
  return code === 8 || code === 9 || code === 11 || code === 16 || code === 29;
}

function queueKey(entry: QueueEntry): string {
  return [
    entry.provider,
    entry.track.artist,
    entry.track.title,
    entry.track.album || '',
    entry.timestamp,
  ].join('|');
}

export class ScrobbleManager {
  private readonly getSettings: () => ScrobbleSettings;
  private readonly sessionsPath: string;
  private readonly queuePath: string;
  private readonly onStatus?: (status: ScrobbleStatus) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly openExternal: (url: string) => Promise<void>;
  private sessions: Sessions = {};
  private queue: QueueEntry[] = [];
  private connecting: ScrobbleProvider | null = null;
  private error = '';
  private flushing = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private recent = new Map<string, number>();
  private lastNowPlaying = { key: '', at: 0 };
  private authCallbackServer: http.Server | null = null;

  constructor(options: ScrobbleManagerOptions) {
    this.getSettings = options.getSettings;
    this.sessionsPath = options.sessionsPath;
    this.queuePath = options.queuePath;
    this.onStatus = options.onStatus;
    this.fetchImpl = options.fetchImpl || ((input, init) => fetch(input, init));
    this.openExternal = options.openExternal || ((url) => shell.openExternal(url));
    this.sessions = this.loadSessions();
    this.queue = this.loadQueue();
  }

  start() {
    if (this.retryTimer) return;
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      void this.flush();
    }, 4000);
    this.retryTimer = setInterval(() => void this.flush(), 5 * 60 * 1000);
    this.retryTimer.unref?.();
    this.bootTimer.unref?.();
  }

  shutdown() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.retryTimer = null;
    this.bootTimer = null;
    this.stopAuthCallbackServer();
  }

  private startAuthCallbackServer(): Promise<string> {
    this.stopAuthCallbackServer();
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        this.handleAuthCallback(request, response);
      });
      server.once('error', reject);
      server.listen(LASTFM_CALLBACK_PORT, '127.0.0.1', () => {
        server.off('error', reject);
        this.authCallbackServer = server;
        resolve(LASTFM_CALLBACK_URL);
      });
    });
  }

  private stopAuthCallbackServer() {
    const server = this.authCallbackServer;
    this.authCallbackServer = null;
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
    }
  }

  private handleAuthCallback(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url || '/', LASTFM_CALLBACK_URL);
    if (url.pathname !== LASTFM_CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
      return;
    }
    const token = String(url.searchParams.get('token') || '').trim();
    if (!/^[a-zA-Z0-9]+$/.test(token)) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Missing Last.fm token.');
      return;
    }
    const deepLink = `wavr://lastfm/callback?token=${encodeURIComponent(token)}`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>WAVR · Last.fm</title></head>
<body style="font-family:system-ui,sans-serif;background:#121212;color:#f4f4f4;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:420px;text-align:center;padding:24px">
<h1 style="font-size:22px">Last.fm connected</h1>
<p style="color:#b8b8c0;line-height:1.6">WAVR is finishing your sign-in. You can close this tab and return to WAVR.</p>
<p><a href="${deepLink}" style="color:#c8d879">Open WAVR</a></p>
</div>
<script>setTimeout(function(){location.href=${JSON.stringify(deepLink)}},350)</script>
</body></html>`);
  }

  status(): ScrobbleStatus {
    const settings = this.getSettings();
    const provider = providerFor(settings.scrobbleProvider);
    const credentials = this.credentials(provider, settings);
    return {
      enabled: !!settings.scrobbleEnabled,
      provider,
      connected: this.isConnected(credentials),
      username: credentials.username,
      pending: this.queue.filter((entry) => entry.provider === provider).length,
      connecting: this.connecting === provider,
      error: this.error,
    };
  }

  refresh() {
    this.emit();
  }

  async connect(provider: ScrobbleProvider): Promise<ScrobbleStatus> {
    if (this.connecting) throw new Error('An account connection is already in progress.');
    const settings = this.getSettings();
    const credentials = this.credentials(provider, settings);
    if (!credentials.apiKey || !credentials.apiSecret) {
      throw new Error('Add the API key and shared secret first.');
    }
    this.connecting = provider;
    this.error = '';
    this.lastNowPlaying = { key: '', at: 0 };
    this.emit();
    try {
      let callbackUrl = '';
      if (provider === 'lastfm') {
        try {
          callbackUrl = await this.startAuthCallbackServer();
        } catch {
          /* Fall back to token polling if the local callback port is unavailable. */
        }
      }
      const tokenResponse = await this.call(
        provider,
        'auth.getToken',
        {},
        credentials,
        false,
      );
      const token = String(tokenResponse?.token || '').trim();
      if (!token) throw new Error('The service did not return an authentication token.');
      const config = SCROBBLE_PROVIDERS[provider];
      const authUrl = new URL(config.authUrl);
      authUrl.searchParams.set('api_key', credentials.apiKey);
      authUrl.searchParams.set('token', token);
      if (callbackUrl) authUrl.searchParams.set('cb', callbackUrl);
      await this.openExternal(authUrl.toString());

      const startedAt = Date.now();
      while (Date.now() - startedAt < AUTH_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_MS));
        try {
          const response = await this.call(
            provider,
            'auth.getSession',
            { token },
            credentials,
            false,
          );
          const sessionKey = String(response?.session?.key || '').trim();
          const username = String(response?.session?.name || '').trim();
          if (!sessionKey) throw new Error('The service did not return a session key.');
          this.sessions[provider] = { key: sessionKey, username };
          this.saveSessions();
          this.error = '';
          return this.status();
        } catch (error: any) {
          if (error instanceof ScrobbleApiError && error.code === 14) continue;
          throw error;
        }
      }
      throw new Error('Authorization timed out. Try connecting again.');
    } catch (error: any) {
      this.error = error?.message || 'Could not connect the scrobbling account.';
      throw error;
    } finally {
      this.stopAuthCallbackServer();
      this.connecting = null;
      this.emit();
    }
  }

  disconnect(provider?: ScrobbleProvider): ScrobbleStatus {
    const selected = provider || providerFor(this.getSettings().scrobbleProvider);
    delete this.sessions[selected];
    this.saveSessions();
    this.error = '';
    this.lastNowPlaying = { key: '', at: 0 };
    this.emit();
    return this.status();
  }

  async nowPlaying(track: ScrobbleTrack): Promise<void> {
    const settings = this.getSettings();
    if (!settings.scrobbleEnabled) return;
    const provider = providerFor(settings.scrobbleProvider);
    const credentials = this.credentials(provider, settings);
    if (!this.isConnected(credentials)) return;
    const normalized = normalizeScrobbleTrack(track);
    if (!isScrobbleEligible(normalized)) return;
    const key = `${provider}|${normalized.artist}|${normalized.title}|${normalized.album || ''}`;
    const now = Date.now();
    if (this.lastNowPlaying.key === key && now - this.lastNowPlaying.at < 120000) return;
    this.lastNowPlaying = { key, at: now };
    try {
      await this.call(
        provider,
        'track.updateNowPlaying',
        scrobbleTrackParams(normalized),
        credentials,
        true,
      );
      this.error = '';
    } catch (error: any) {
      this.handleApiFailure(provider, error);
      this.error = error?.message || 'Could not update the now-playing track.';
      this.emit();
    }
  }

  async submit(track: ScrobbleTrack): Promise<void> {
    const settings = this.getSettings();
    if (!settings.scrobbleEnabled) return;
    const provider = providerFor(settings.scrobbleProvider);
    const credentials = this.credentials(provider, settings);
    if (!this.isConnected(credentials)) return;
    const normalized = normalizeScrobbleTrack(track);
    if (!isScrobbleEligible(normalized)) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const requested = Math.round(Number(normalized.timestamp) || nowSeconds);
    const timestamp = requested > 0 && requested <= nowSeconds + 60 ? requested : nowSeconds;
    const entry: QueueEntry = { provider, track: normalized, timestamp, attempts: 0 };
    const key = queueKey(entry);
    if (this.recent.has(key)) return;
    this.recent.set(key, Date.now());
    this.pruneRecent();
    try {
      await this.sendScrobble(entry, credentials);
      this.error = '';
      this.emit();
    } catch (error: any) {
      this.handleApiFailure(provider, error);
      if (!(error instanceof ScrobbleApiError) || error.retryable) {
        this.enqueue(entry);
        this.error = error?.message || 'The scrobble was queued for retry.';
      } else {
        this.error = error?.message || 'The scrobble was rejected.';
      }
      this.emit();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    if (!this.getSettings().scrobbleEnabled) return;
    this.flushing = true;
    let changed = false;
    try {
      for (let index = 0; index < this.queue.length; ) {
        const entry = this.queue[index];
        const settings = this.getSettings();
        const credentials = this.credentials(entry.provider, settings);
        if (!this.isConnected(credentials)) break;
        try {
          await this.sendScrobble(entry, credentials);
          this.queue.splice(index, 1);
          changed = true;
          this.error = '';
        } catch (error: any) {
          entry.attempts += 1;
          changed = true;
          this.handleApiFailure(entry.provider, error);
          if (!(error instanceof ScrobbleApiError) || error.retryable) {
            this.error = error?.message || 'Scrobbles are waiting to retry.';
            break;
          }
          this.error = error?.message || 'A queued scrobble was rejected.';
          this.queue.splice(index, 1);
        }
      }
    } finally {
      this.flushing = false;
      if (changed) {
        this.saveQueue();
        this.emit();
      }
    }
  }

  private enqueue(entry: QueueEntry) {
    if (!this.queue.some((candidate) => queueKey(candidate) === queueKey(entry))) {
      this.queue.push(entry);
      this.saveQueue();
    }
  }

  private async sendScrobble(entry: QueueEntry, credentials: Credentials) {
    await this.call(
      entry.provider,
      'track.scrobble',
      scrobbleTrackParams(entry.track, entry.timestamp),
      credentials,
      true,
    );
  }

  private handleApiFailure(provider: ScrobbleProvider, error: unknown) {
    if (error instanceof ScrobbleApiError && error.code === 9) {
      delete this.sessions[provider];
      this.saveSessions();
    }
  }

  private credentials(
    provider: ScrobbleProvider,
    settings: ScrobbleSettings = this.getSettings(),
  ): Credentials {
    const session = this.sessions[provider];
    if (provider === 'librefm') {
      return {
        apiKey: String(settings.libreFmApiKey || '').trim(),
        apiSecret: String(settings.libreFmApiSecret || '').trim(),
        sessionKey: session?.key || '',
        username: session?.username || '',
      };
    }
    return {
      apiKey: LASTFM_API_KEY,
      apiSecret: LASTFM_API_SECRET,
      sessionKey: session?.key || '',
      username: session?.username || '',
    };
  }

  private isConnected(credentials: Credentials): boolean {
    return !!(
      credentials.apiKey &&
      credentials.apiSecret &&
      credentials.sessionKey
    );
  }

  private async call(
    provider: ScrobbleProvider,
    method: string,
    extra: Record<string, string | number | undefined>,
    credentials: Credentials,
    useSession: boolean,
  ): Promise<any> {
    const config = SCROBBLE_PROVIDERS[provider];
    const params = buildScrobbleRequest(
      method,
      credentials.apiKey,
      credentials.apiSecret,
      useSession ? credentials.sessionKey : '',
      extra,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'WAVR desktop scrobbler',
        },
        body: new URLSearchParams(params),
        signal: controller.signal,
      });
    } catch (error: any) {
      const message = error?.name === 'AbortError'
        ? `${config.label} did not respond in time.`
        : error?.message || `${config.label} could not be reached.`;
      throw new ScrobbleApiError(message, null, true);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok || payload?.error) {
      const code = Number(payload?.error) || null;
      const message = String(
        payload?.message ||
        (response.status === 429
          ? `${config.label} rate limit reached.`
          : `${config.label} request failed (${response.status}).`),
      );
      throw new ScrobbleApiError(
        message,
        code,
        response.status === 429 || response.status >= 500 || (code !== null && retryableCode(code)),
      );
    }
    if (!payload) {
      throw new ScrobbleApiError(`${config.label} returned an invalid response.`, null, true);
    }
    return payload;
  }

  private emit() {
    this.onStatus?.(this.status());
  }

  private pruneRecent() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [key, at] of this.recent) {
      if (at < cutoff) this.recent.delete(key);
    }
  }

  private loadSessions(): Sessions {
    try {
      const raw = fs.readFileSync(this.sessionsPath, 'utf8').trim();
      if (!raw) return {};
      let json = raw;
      if (raw.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) return {};
        json = safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
      }
      const parsed = JSON.parse(json);
      const sessions: Sessions = {};
      for (const provider of ['lastfm', 'librefm'] as const) {
        const entry = parsed?.[provider];
        if (entry && typeof entry.key === 'string' && entry.key) {
          sessions[provider] = {
            key: entry.key,
            username: String(entry.username || ''),
          };
        }
      }
      return sessions;
    } catch {
      return {};
    }
  }

  private saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this.sessionsPath), { recursive: true });
      const json = JSON.stringify(this.sessions);
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(json).toString('base64');
        fs.writeFileSync(this.sessionsPath, `enc:${encrypted}`, 'utf8');
      } else {
        fs.writeFileSync(this.sessionsPath, json, 'utf8');
      }
    } catch (error) {
      console.warn('Failed to persist scrobbling sessions:', error);
    }
  }

  private loadQueue(): QueueEntry[] {
    try {
      const raw = fs.readFileSync(this.queuePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && entry.track)
        .map((entry) => ({
          provider: providerFor(entry.provider),
          track: normalizeScrobbleTrack(entry.track),
          timestamp: Math.round(Number(entry.timestamp) || 0),
          attempts: Math.max(0, Math.round(Number(entry.attempts) || 0)),
        }))
        .filter((entry) => entry.timestamp > 0 && isScrobbleEligible(entry.track));
    } catch {
      return [];
    }
  }

  private saveQueue() {
    try {
      fs.mkdirSync(path.dirname(this.queuePath), { recursive: true });
      fs.writeFileSync(this.queuePath, JSON.stringify(this.queue, null, 2), 'utf8');
    } catch (error) {
      console.warn('Failed to persist the scrobble queue:', error);
    }
  }

}
