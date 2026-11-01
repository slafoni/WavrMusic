import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../shared/models';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
}));

import { ScrobbleManager } from '../../src/main/scrobble';

interface FetchCall {
  url: string;
  body: URLSearchParams;
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    themeMode: 'dark',
    dynamicTheme: 'auto',
    accentColor: '#C8D879',
    themeIntensity: 45,
    density: 'comfortable',
    reducedMotion: false,
    defaultVolume: 0.85,
    restoreQueue: true,
    discordRPC: false,
    discordClientId: '',
    showLyricsBanner: true,
    streamFormat: 'raw',
    streamBitrate: 0,
    equalizerEnabled: false,
    equalizerPreset: 'flat',
    equalizerBands: Array(10).fill(0),
    equalizerQ: 1.05,
    audioEngine: 'wasapi-shared',
    audioDeviceId: '',
    dspEnabled: false,
    replayGain: 'off',
    normalizeVolume: false,
    crossfadeSeconds: 0,
    channelMode: 'auto',
    resampleQuality: 'auto',
    lyricaInstanceMode: 'official',
    lyricaInstanceUrl: '',
    lyricsTranslation: false,
    lyricsRomanization: false,
    lyricsLanguage: 'en',
    lastFmApiKey: 'api-key',
    lastFmApiSecret: 'secret',
    libreFmApiKey: '',
    libreFmApiSecret: '',
    scrobbleEnabled: true,
    scrobbleProvider: 'lastfm',
    profileImage: '',
    servers: [],
    ...overrides,
  };
}

function response(ok: boolean, status: number, payload: unknown) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe('ScrobbleManager submission', () => {
  let directory = '';
  let sessionsPath = '';
  let queuePath = '';
  let currentSettings: AppSettings;
  let calls: FetchCall[];

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wavr-scrobble-'));
    sessionsPath = path.join(directory, 'scrobble-sessions.json');
    queuePath = path.join(directory, 'scrobble-queue.json');
    fs.writeFileSync(
      sessionsPath,
      JSON.stringify({ lastfm: { key: 'session-key', username: 'qa' } }),
      'utf8',
    );
    currentSettings = settings();
    calls = [];
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function manager(fetchImpl: typeof fetch) {
    return new ScrobbleManager({
      getSettings: () => currentSettings,
      sessionsPath,
      queuePath,
      fetchImpl,
      openExternal: async () => undefined,
    });
  }

  it('submits a signed track.scrobble request', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body || ''));
      calls.push({ url: String(input), body });
      return response(true, 200, { scrobbles: { '@attr': { accepted: 1 } } });
    }) as unknown as typeof fetch;
    const scrobbler = manager(fetcher);

    expect(scrobbler.status().connected).toBe(true);
    await scrobbler.submit({
      artist: 'Artist',
      title: 'Song',
      album: 'Album',
      duration: 200,
      timestamp: 1700000000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ws.audioscrobbler.com/2.0/');
    expect(calls[0].body.get('method')).toBe('track.scrobble');
    expect(calls[0].body.get('sk')).toBe('session-key');
    expect(calls[0].body.get('artist')).toBe('Artist');
    expect(calls[0].body.get('track')).toBe('Song');
    expect(calls[0].body.get('timestamp')).toBe('1700000000');
    expect(calls[0].body.get('api_sig')).toMatch(/^[a-f0-9]{32}$/);
    expect(scrobbler.status().pending).toBe(0);
  });

  it('queues retryable failures and flushes them later', async () => {
    const failing = vi.fn(async () => response(false, 503, { error: 16, message: 'Try later' }));
    const scrobbler = manager(failing as unknown as typeof fetch);

    await scrobbler.submit({
      artist: 'Artist',
      title: 'Song',
      timestamp: 1700000000,
    });

    expect(scrobbler.status().pending).toBe(1);
    expect(JSON.parse(fs.readFileSync(queuePath, 'utf8'))).toHaveLength(1);

    const succeeding = vi.fn(async () => response(true, 200, { scrobbles: {} }));
    const retrying = new ScrobbleManager({
      getSettings: () => currentSettings,
      sessionsPath,
      queuePath,
      fetchImpl: succeeding as unknown as typeof fetch,
      openExternal: async () => undefined,
    });
    await retrying.flush();

    expect(retrying.status().pending).toBe(0);
    expect(JSON.parse(fs.readFileSync(queuePath, 'utf8'))).toEqual([]);
  });

  it('does not submit while scrobbling is disabled', async () => {
    currentSettings = settings({ scrobbleEnabled: false });
    const fetcher = vi.fn(async () => response(true, 200, {}));
    const scrobbler = manager(fetcher as unknown as typeof fetch);

    await scrobbler.submit({
      artist: 'Artist',
      title: 'Song',
      timestamp: 1700000000,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(scrobbler.status().pending).toBe(0);
  });
});
