import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  Menu,
  globalShortcut,
  powerMonitor,
} from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { configureDiscordRpc, getDiscordRpcStatus, shutdownDiscordRpc, updateDiscordActivity } from './discord';
import { AudioEngineManager } from './audioEngine';
import { ScrobbleManager } from './scrobble';
import { UpdateManager } from './updater';
import {
  clearYouTubeCache,
  connectYouTubeAccount,
  disconnectYouTubeAccount,
  ensureYouTubeVideo,
  fetchYouTubeIntroEnd,
  searchYouTubeVideo,
  startYouTubeCacheServer,
  youtubeAuthStatus,
} from './youtube';
import { parseWavrSyncInviteCode } from '../../shared/wavrsync';
import { parseYouTubeVideoId } from '../../shared/youtube';
import { fetchFanartArtistBanner } from './fanart';
import type { ScrobbleProvider } from '../../shared/models';
import {
  PAGE_BACKGROUND_MAX_GIF_BYTES,
  PAGE_BACKGROUND_MAX_IMAGE_BYTES,
  PAGE_BACKGROUND_MAX_VIDEO_BYTES,
} from '../../shared/constants';

const APP_NAME = 'WAVR';
const APP_ID = 'app.wavr.desktop';

const isDev =
  process.env['NODE_ENV'] === 'development' ||
  process.env['VITE_DEV_SERVER_URL'] !== undefined;
const allowsDevTools = /(dev|beta)/i.test(app.getVersion());

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let trayOnClose = process.platform !== 'linux';
let isMiniWindow = false;
let preMiniBounds: Electron.Rectangle | null = null;
let audioEngine: AudioEngineManager | null = null;
let scrobbleManager: ScrobbleManager | null = null;
let updateManager: UpdateManager | null = null;
let rendererReady = false;
let pendingWavrSyncInvite = '';

function wavrSyncInviteFromArgv(argv: string[]): string {
  for (const argument of argv) {
    if (!/^wavr:/i.test(argument)) continue;
    const code = parseWavrSyncInviteCode(argument);
    if (code) return code;
  }
  return '';
}

function deliverWavrSyncInvite() {
  if (!pendingWavrSyncInvite || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('wavrsync-invite', { code: pendingWavrSyncInvite });
  pendingWavrSyncInvite = '';
}

function queueWavrSyncInvite(code: string) {
  if (!code) return;
  pendingWavrSyncInvite = code;
  deliverWavrSyncInvite();
}

const userData = app.getPath('userData');
const windowStatePath = path.join(userData, 'window-state.json');
const settingsPath = path.join(userData, 'settings.json');
const scrobbleSessionsPath = path.join(userData, 'scrobble-sessions.json');
const scrobbleQueuePath = path.join(userData, 'scrobble-queue.json');
const pageBackgroundsDir = path.join(userData, 'page-backgrounds');
const PAGE_BACKGROUND_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'mp4'];
const PAGE_BACKGROUND_MIME_TYPES: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
};
pendingWavrSyncInvite = wavrSyncInviteFromArgv(process.argv);

function readHardwareAccelerationSetting(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return parsed?.hardwareAcceleration !== false;
  } catch {
    return true;
  }
}

if (!readHardwareAccelerationSetting()) {
  app.disableHardwareAcceleration();
}

function appIconPath(): string {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'icon.png');
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.join(app.getAppPath(), 'assets', 'icon.png');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wavr-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: 'wavr-bg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
  passwordEnc?: string;
  token?: string;
  publicUrl?: string;
  default: boolean;
  createdAt: number;
}

interface AppSettings {
  themeMode: 'light' | 'dark' | 'system';
  dynamicTheme: 'auto' | 'fixed' | 'disabled';
  accentColor: string;
  themeIntensity: number;
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  hardwareAcceleration: boolean;
  defaultVolume: number;
  restoreQueue: boolean;
  discordRPC: boolean;
  discordClientId: string;
  usageHeartbeatEnabled: boolean;
  showLyricsBanner: boolean;
  streamFormat: string;
  streamBitrate: number;
  equalizerEnabled: boolean;
  equalizerPreset: string;
  equalizerBands: number[];
  equalizerQ: number;
  audioEngine: string;
  audioDeviceId: string;
  dspEnabled: boolean;
  replayGain: string;
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  channelMode: string;
  resampleQuality: string;
  lyricaInstanceMode: string;
  lyricaInstanceUrl: string;
  lyricsTranslation: boolean;
  lyricsRomanization: boolean;
  lyricsLanguage: string;
  lastFmApiKey: string;
  lastFmApiSecret: string;
  libreFmApiKey: string;
  libreFmApiSecret: string;
  scrobbleEnabled: boolean;
  scrobbleProvider: ScrobbleProvider;
  wavrSyncServerUrl: string;
  wavrSyncAutoConnect: boolean;
  wavrSyncSettingsSync: boolean;
  autoUpdate: boolean;
  updateFeedUrl: string;
  updateMode: 'all' | 'critical';
  updateChannel: 'stable' | 'beta' | 'dev';
  profileBanner: string;
  profileTags: string[];
  profileImage: string;
  pageBackgrounds: Record<string, string>;
  youtubeBackgrounds: Record<string, string>;
  youtubeBackgroundSyncOffsets: Record<string, number>;
  fullscreenYoutubeBackground: boolean;
  youtubeBackgroundPauseWithPlayback: boolean;
  youtubeBackgroundSkipIntro: boolean;
  fullscreenAutoHideUi: boolean;
  servers: ServerProfile[];
}

const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'dark',
  dynamicTheme: 'auto',
  accentColor: '#C8D879',
  themeIntensity: 45,
  density: 'comfortable',
  reducedMotion: false,
  hardwareAcceleration: true,
  defaultVolume: 0.85,
  restoreQueue: true,
  discordRPC: false,
  discordClientId: '',
  usageHeartbeatEnabled: true,
  showLyricsBanner: true,
  streamFormat: 'raw',
  streamBitrate: 0,
  equalizerEnabled: false,
  equalizerPreset: 'flat',
  equalizerBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
  lastFmApiKey: '',
  lastFmApiSecret: '',
  libreFmApiKey: '',
  libreFmApiSecret: '',
  scrobbleEnabled: false,
  scrobbleProvider: 'lastfm',
  wavrSyncServerUrl: 'wss://sync.listenwavr.xyz',
  wavrSyncAutoConnect: true,
  wavrSyncSettingsSync: true,
  autoUpdate: true,
  updateFeedUrl: 'https://update.listenwavr.xyz',
  updateMode: 'all',
  updateChannel: 'stable',
  profileBanner: '',
  profileTags: [],
  profileImage: '',
  pageBackgrounds: {},
  youtubeBackgrounds: {},
  youtubeBackgroundSyncOffsets: {},
  fullscreenYoutubeBackground: false,
  youtubeBackgroundPauseWithPlayback: true,
  youtubeBackgroundSkipIntro: true,
  fullscreenAutoHideUi: false,
  servers: [],
};

function readWindowState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWindowState(state: object) {
  try {
    fs.mkdirSync(path.dirname(windowStatePath), { recursive: true });
    fs.writeFileSync(windowStatePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn('Failed to persist window state:', error);
  }
}

function clampBoundsToDisplay(bounds: Partial<Electron.Rectangle>) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const primaryWorkArea = primaryDisplay.workArea;
  const minW = 380;
  const minH = 520;
  const width = Math.max(minW, Math.min(bounds.width || 0, primaryWorkArea.width));
  const height = Math.max(minH, Math.min(bounds.height || 0, primaryWorkArea.height));
  const display =
    screen.getDisplayMatching({
      x: bounds.x ?? primaryWorkArea.x,
      y: bounds.y ?? primaryWorkArea.y,
      width,
      height,
    }) || primaryDisplay;
  const workArea = display.workArea;
  const x = Math.min(
    Math.max(bounds.x ?? workArea.x + Math.round((workArea.width - width) / 2), workArea.x),
    workArea.x + Math.max(0, workArea.width - width),
  );
  const y = Math.min(
    Math.max(bounds.y ?? workArea.y + Math.round((workArea.height - height) / 2), workArea.y),
    workArea.y + Math.max(0, workArea.height - height),
  );
  return { x, y, width, height };
}

function getResponsiveWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const persisted = readWindowState();
  const responsiveBounds = {
    width: Math.round(workArea.width * 0.84),
    height: Math.round(workArea.height * 0.88),
    x: workArea.x + Math.round(workArea.width * 0.08),
    y: workArea.y + Math.round(workArea.height * 0.06),
  };
  const merged = { ...responsiveBounds, ...(persisted && persisted.bounds ? persisted.bounds : {}) };
  return clampBoundsToDisplay(merged);
}

function persistWindowState() {
  if (isMiniWindow) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const isMaximized = mainWindow.isMaximized();
  const isFullScreen = mainWindow.isFullScreen();
  const bounds = isMaximized || isFullScreen ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  writeWindowState({ bounds, isMaximized, isFullScreen });
}

const SECRET_SETTING_KEYS = [
  'lastFmApiSecret',
  'libreFmApiSecret',
  'fanartTvApiKey',
] as const;

function encryptSettings(settings: AppSettings): AppSettings {
  const copy: AppSettings = JSON.parse(JSON.stringify(settings));
  if (safeStorage.isEncryptionAvailable()) {
    for (const key of SECRET_SETTING_KEYS) {
      const value = String((copy as any)[key] || '');
      if (!value) continue;
      try {
        (copy as any)[`${key}Enc`] = safeStorage.encryptString(value).toString('base64');
        (copy as any)[key] = '';
      } catch {
        /* fall through */
      }
    }
  }
  for (const server of copy.servers || []) {
    if (server.password) {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          server.passwordEnc = safeStorage.encryptString(server.password).toString('base64');
          delete server.password;
        } catch {
          /* fall through */
        }
      }
    }
  }
  return copy;
}

function decryptSettings(parsed: any): AppSettings {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    servers: Array.isArray(parsed?.servers) ? parsed.servers : [],
  };
  if (!parsed?.wavrSyncServerUrl && parsed?.pulseServerUrl) {
    settings.wavrSyncServerUrl = String(parsed.pulseServerUrl);
  }
  for (const key of SECRET_SETTING_KEYS) {
    const encoded = parsed?.[`${key}Enc`];
    if (encoded) {
      if (safeStorage.isEncryptionAvailable()) {
        try {
          (settings as any)[key] = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
        } catch {
          /* ignore corrupt entry */
        }
      }
      delete (settings as any)[`${key}Enc`];
    }
  }
  for (const server of settings.servers) {
    if (server.passwordEnc && safeStorage.isEncryptionAvailable()) {
      try {
        server.password = safeStorage.decryptString(Buffer.from(server.passwordEnc, 'base64'));
      } catch {
        /* ignore corrupt entry */
      }
      delete server.passwordEnc;
    }
  }
  return settings;
}

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    return decryptSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: AppSettings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(encryptSettings(settings), null, 2));
  } catch (error) {
    console.warn('Failed to persist settings:', error);
  }
}

function registerMediaProtocol() {
  protocol.handle('wavr-media', async (request) => {
    try {
      const url = new URL(request.url);
      const target = url.searchParams.get('url');
      if (!target) return new Response('Missing url', { status: 400 });
      if (!/^https?:\/\//i.test(target)) return new Response('Unsupported url', { status: 400 });
      const targetUrl = new URL(target);
      const allowedOrigins = new Set<string>();
      for (const server of readSettings().servers) {
        try {
          allowedOrigins.add(new URL(server.url).origin);
        } catch {
          /* ignore malformed profile urls */
        }
      }
      if (!allowedOrigins.has(targetUrl.origin)) {
        return new Response('Artwork host is not a configured server', { status: 403 });
      }
      const response = await net.fetch(target, {
        headers: {
          'User-Agent': `WAVR/${app.getVersion()} (Electron)`,
        },
      });
      const headers = new Headers();
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      headers.set('Content-Type', contentType);
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, { status: response.status, headers });
    } catch (error: any) {
      return new Response(`Artwork proxy failed: ${error?.message || 'unknown'}`, { status: 502 });
    }
  });
}

function pageBackgroundPathFromUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'wavr-bg:' || url.hostname !== 'local') return '';
    const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!/^[a-z0-9-]+\.(gif|png|jpe?g|webp|avif|mp4)$/i.test(fileName)) return '';
    return path.join(pageBackgroundsDir, fileName);
  } catch {
    return '';
  }
}

function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return null;
  let start = 0;
  let end = size - 1;
  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
  } else {
    start = Number(startValue);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
    if (endValue) {
      end = Math.min(Number(endValue), size - 1);
      if (!Number.isSafeInteger(end) || end < start) return null;
    }
  }
  return { start, end };
}

function registerPageBackgroundProtocol() {
  protocol.handle('wavr-bg', async (request) => {
    try {
      const filePath = pageBackgroundPathFromUrl(request.url);
      if (!filePath) return new Response('Invalid background path', { status: 400 });
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) return new Response('Not found', { status: 404 });
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const headers = new Headers();
      headers.set('Content-Type', PAGE_BACKGROUND_MIME_TYPES[ext] || 'application/octet-stream');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      headers.set('Accept-Ranges', 'bytes');
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const range = parseByteRange(rangeHeader, stats.size);
        if (!range) {
          headers.set('Content-Range', `bytes */${stats.size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
        headers.set('Content-Length', String(range.end - range.start + 1));
        if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
        const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
        return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
          status: 206,
          headers,
        });
      }
      headers.set('Content-Length', String(stats.size));
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function createWindow() {
  const initialBounds = getResponsiveWindowBounds();
  rendererReady = false;

  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 380,
    minHeight: 520,
    backgroundColor: '#101010',
    title: APP_NAME,
    icon: appIconPath(),
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.setIcon(appIconPath());

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });

  mainWindow.webContents.on('devtools-opened', () => {
    if (allowsDevTools) return;
    mainWindow?.webContents.closeDevTools();
  });

  if (process.env['VITE_DEV_SERVER_URL']) {
    await mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']!);
    if (isDev && allowsDevTools) {
      try {
        await mainWindow.webContents.openDevTools({ mode: 'detach' });
      } catch {
        /* ignore */
      }
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'src', 'dist', 'index.html'));
  }

  const sendVisibility = (visible: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-visibility', visible);
    }
  };

  mainWindow.on('minimize', () => sendVisibility(false));
  mainWindow.on('restore', () => sendVisibility(true));
  mainWindow.on('hide', () => sendVisibility(false));
  mainWindow.on('show', () => sendVisibility(true));
  mainWindow.on('app-command', (_event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return;
    mainWindow?.webContents.send(
      'navigate-history',
      command === 'browser-backward' ? 'back' : 'forward',
    );
  });
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
  mainWindow.on('maximize', persistWindowState);
  mainWindow.on('unmaximize', persistWindowState);
  mainWindow.on('enter-full-screen', () => {
    persistWindowState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', true);
    }
  });
  mainWindow.on('leave-full-screen', () => {
    persistWindowState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-changed', false);
    }
  });

  mainWindow.on('close', (event) => {
    persistWindowState();
    if (trayOnClose && tray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    }
    const devToolsShortcut =
      input.type === 'keyDown' &&
      (input.key === 'F12' ||
        ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') ||
        (input.meta && input.alt && input.key.toLowerCase() === 'i'));
    if (devToolsShortcut && !allowsDevTools) {
      event.preventDefault();
      return;
    }
    if (input.type === 'keyDown' && input.key === 'F12' && allowsDevTools) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

}

function setupIpcHandlers() {
  ipcMain.handle('read-settings', () => readSettings());
  ipcMain.handle('audio-engine-info', () => {
    return audioEngine?.getInfo() || {
      available: false,
      platform: process.platform,
      reason: 'The WavrPulse engine is not initialised.',
    };
  });
  ipcMain.handle('audio-engine-devices', async () => {
    if (!audioEngine) throw new Error('The WavrPulse engine is not initialised.');
    return audioEngine.devices();
  });
  ipcMain.handle('youtube-auth-status', () => youtubeAuthStatus());
  ipcMain.handle('youtube-auth-connect', () => connectYouTubeAccount());
  ipcMain.handle('youtube-auth-disconnect', async () => {
    await disconnectYouTubeAccount();
    return youtubeAuthStatus();
  });
  ipcMain.handle('fanart-artist-banner', async (_event, payload) => {
    return fetchFanartArtistBanner(
      payload && typeof payload === 'object' ? payload : {},
    );
  });
  ipcMain.handle('youtube-video-search', async (_event, query: string, artist: string, title: string) => {
    return searchYouTubeVideo(String(query || ''), String(artist || ''), String(title || ''));
  });
  ipcMain.handle('youtube-video-cache', async (_event, videoId: string) => {
    return ensureYouTubeVideo(String(videoId || ''));
  });
  ipcMain.handle('youtube-video-intro', async (_event, videoId: string) => {
    return fetchYouTubeIntroEnd(String(videoId || ''));
  });
  ipcMain.handle('youtube-custom-video', async (_event, url: string) => {
    const videoId = parseYouTubeVideoId(String(url || ''));
    if (!videoId) return { error: 'Enter a valid YouTube video URL.' };
    try {
      const cachedUrl = await ensureYouTubeVideo(videoId);
      return { videoId, url: cachedUrl };
    } catch (error: any) {
      return { error: error?.message || 'Could not download that YouTube video.' };
    }
  });
  ipcMain.handle('youtube-cache-clear', () => {
    return clearYouTubeCache();
  });
  ipcMain.handle('audio-engine-play', async (_event, payload: unknown) => {
    if (!audioEngine) throw new Error('The WavrPulse engine is not initialised.');
    return audioEngine.play(payload);
  });
  ipcMain.handle('audio-engine-command', async (_event, command: string, payload: unknown) => {
    if (!audioEngine) throw new Error('The WavrPulse engine is not initialised.');
    try {
      return await audioEngine.command(command, payload);
    } catch (error: any) {
      if (String(error?.message || '').toLowerCase().includes('nothing is playing')) {
        return { ok: false, ignored: true };
      }
      throw error;
    }
  });
  ipcMain.handle('write-settings', (_event, settings: AppSettings) => {
    writeSettings(settings);
    scrobbleManager?.refresh();
    void scrobbleManager?.flush();
    updateManager?.refreshSettings();
    configureDiscordRpc(settings.discordRPC, settings.discordClientId || '', (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-status', status);
      }
    }).catch(() => {});
    return true;
  });
  ipcMain.handle('scrobble-status', () => scrobbleManager?.status() || null);
  ipcMain.handle('scrobble-connect', async (_event, provider: ScrobbleProvider) => {
    if (!scrobbleManager) throw new Error('Scrobbling is not available.');
    return scrobbleManager.connect(provider);
  });
  ipcMain.handle('scrobble-disconnect', () => {
    if (!scrobbleManager) return null;
    return scrobbleManager.disconnect();
  });
  ipcMain.on('scrobble-now-playing', (_event, track) => {
    void scrobbleManager?.nowPlaying(track);
  });
  ipcMain.on('scrobble-submit', (_event, track) => {
    void scrobbleManager?.submit(track);
  });
  ipcMain.on('wavrsync-renderer-ready', () => {
    rendererReady = true;
    deliverWavrSyncInvite();
  });
  ipcMain.handle('update-status', () => updateManager?.getStatus() || null);
  ipcMain.handle('update-check', async () => updateManager?.check(true) || null);
  ipcMain.handle('update-download', async () => updateManager?.download() || null);
  ipcMain.handle('update-install', async () => updateManager?.install() || false);
  ipcMain.on('discord-activity', (_event, payload) => {
    updateDiscordActivity(payload || null);
  });
  ipcMain.on('discord-clear', () => {
    updateDiscordActivity(null);
  });
  ipcMain.handle('discord-status', () => getDiscordRpcStatus());

  ipcMain.handle('test-connection', async (_event, profile: ServerProfile) => {
    try {
      const { SubsonicClient } = await import('../../shared/api/subsonic-client');
      const client = new SubsonicClient({
        url: profile.url,
        username: profile.username,
        password: profile.password,
        token: profile.token,
        clientName: 'wavr',
        apiVersion: '1.16.1',
        timeoutMs: 12000,
      });
      const license = await client.ping();
      const capabilities = await client.probeCapabilities();
      return {
        ok: true,
        license,
        version: capabilities.version,
        capabilities,
        secure: /^https:\/\//i.test(profile.url),
      };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error), code: error?.code };
    }
  });

  ipcMain.handle('get-window-state', () => readWindowState());

  ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.on('window-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window-is-maximized', () => {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
  });
  ipcMain.handle('window-is-fullscreen', () => {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
  });
  ipcMain.handle('window-set-fullscreen', (_event, value: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setFullScreen(!!value);
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('window-toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.on('open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });

  ipcMain.handle('copy-text', (_event, text: string) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('pick-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('pick-page-background', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose page background',
      properties: ['openFile'],
      filters: [
        { name: 'Images, GIFs and MP4 videos', extensions: PAGE_BACKGROUND_EXTENSIONS },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath).slice(1).toLowerCase();
    if (!PAGE_BACKGROUND_EXTENSIONS.includes(ext)) {
      return { error: 'Choose a GIF, PNG, JPEG, WebP, AVIF or MP4 file.' };
    }
    const isGif = ext === 'gif';
    const isVideo = ext === 'mp4';
    const maxBytes = isVideo
      ? PAGE_BACKGROUND_MAX_VIDEO_BYTES
      : isGif
        ? PAGE_BACKGROUND_MAX_GIF_BYTES
        : PAGE_BACKGROUND_MAX_IMAGE_BYTES;
    try {
      const stats = await fs.promises.stat(sourcePath);
      if (!stats.isFile()) return { error: 'That file could not be read.' };
      if (stats.size > maxBytes) {
        return {
          error: isVideo
            ? 'MP4 backgrounds must be 1 GB or smaller.'
            : isGif
              ? 'Animated GIFs must be 500 MB or smaller.'
              : 'Background images must be 12 MB or smaller. Animated GIFs can be up to 500 MB and MP4 videos up to 1 GB.',
        };
      }
      await fs.promises.mkdir(pageBackgroundsDir, { recursive: true });
      const fileName = `${Date.now()}-${randomUUID()}.${ext}`;
      const destinationPath = path.join(pageBackgroundsDir, fileName);
      try {
        await fs.promises.copyFile(sourcePath, destinationPath);
      } catch (error) {
        await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
        throw error;
      }
      return {
        url: `wavr-bg://local/${fileName}`,
        fileName,
        size: stats.size,
        animatedGif: isGif,
        video: isVideo,
      };
    } catch (error: any) {
      return { error: error?.message || 'Could not save that background file.' };
    }
  });

  ipcMain.handle('delete-page-background', async (_event, url: string) => {
    const filePath = pageBackgroundPathFromUrl(String(url || ''));
    if (!filePath) return false;
    try {
      await fs.promises.rm(filePath, { force: true });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.on('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('toggle-mini-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (!isMiniWindow) {
      isMiniWindow = true;
      preMiniBounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      mainWindow.setMinimumSize(340, 140);
      mainWindow.setSize(420, 180);
      mainWindow.setAlwaysOnTop(true);
      return true;
    }
    isMiniWindow = false;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(380, 520);
    if (preMiniBounds) mainWindow.setBounds(clampBoundsToDisplay(preMiniBounds));
    else mainWindow.setSize(1200, 800);
    return false;
  });

  ipcMain.on('set-tray-on-close', (_event, value: boolean) => {
    trayOnClose = !!value;
  });

  ipcMain.handle('get-diagnostics', () => {
    return [
      `${APP_NAME} ${app.getVersion()}`,
      `OS ${process.platform} ${process.arch} ${os.release()}`,
      `Electron ${process.versions.electron} Chromium ${process.versions.chrome} Node ${process.versions.node}`,
      `Data ${app.getPath('userData')}`,
    ].join('\n');
  });
}

function setupTray() {
  try {
    const iconPath = appIconPath();
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    } else {
      trayIcon = trayIcon.resize({ width: 32, height: 32 });
    }
    tray = new Tray(trayIcon);
    tray.setToolTip(APP_NAME);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show / Hide WAVR',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isVisible()) mainWindow.hide();
          else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Play / Pause',
        click: () => {
          mainWindow?.webContents.send('media-command', 'toggle');
        },
      },
      { label: 'Next Track', click: () => mainWindow?.webContents.send('media-command', 'next') },
      { label: 'Previous Track', click: () => mainWindow?.webContents.send('media-command', 'prev') },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.warn('Tray creation failed:', error);
    tray = null;
  }
}

const MEDIA_KEYS = {
  MediaPlayPause: 'toggle',
  MediaNextTrack: 'next',
  MediaPreviousTrack: 'prev',
  MediaStop: 'stop',
};
let mediaKeysWanted = true;
let mediaKeysActive = false;

function unregisterMediaKeys() {
  for (const key of Object.keys(MEDIA_KEYS)) {
    try {
      globalShortcut.unregister(key);
    } catch {
      /* ignore */
    }
  }
}

function registerMediaKeys() {
  if (process.platform !== 'win32') return;
  unregisterMediaKeys();
  if (!mediaKeysWanted || !mediaKeysActive) return;
  for (const [key, command] of Object.entries(MEDIA_KEYS)) {
    try {
      globalShortcut.register(key, () => {
        mainWindow?.webContents.send('media-command', command);
      });
    } catch {
      /* ignore */
    }
  }
}

function setupMediaKeys() {
  ipcMain.on('set-media-keys', (_event, enabled: boolean) => {
    mediaKeysWanted = !!enabled;
    registerMediaKeys();
  });
  ipcMain.on('media-keys-active', () => {
    if (!mediaKeysActive) {
      mediaKeysActive = true;
      registerMediaKeys();
    }
  });
  powerMonitor.on('resume', registerMediaKeys);
  powerMonitor.on('unlock-screen', registerMediaKeys);
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    scrobbleManager?.shutdown();
    updateManager?.shutdown();
    shutdownDiscordRpc().catch(() => {});
    audioEngine?.shutdown().catch(() => {});
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const invite = wavrSyncInviteFromArgv(argv);
    if (invite) queueWavrSyncInvite(invite);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (/^wavr:\/\/lastfm\/callback/i.test(url)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      return;
    }
    const code = parseWavrSyncInviteCode(url);
    if (code) queueWavrSyncInvite(code);
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.whenReady().then(() => {
    startYouTubeCacheServer();
    try {
      if (process.defaultApp && process.argv[1]) {
        app.setAsDefaultProtocolClient('wavr', process.execPath, [path.resolve(process.argv[1])]);
      } else {
        app.setAsDefaultProtocolClient('wavr');
      }
    } catch {
      /* deep links are optional */
    }
    try {
      registerMediaProtocol();
      registerPageBackgroundProtocol();
    } catch (error) {
      console.warn('Failed to register media protocols:', error);
    }
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    audioEngine = new AudioEngineManager((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio-engine-event', event);
      }
    });
    scrobbleManager = new ScrobbleManager({
      getSettings: () => readSettings(),
      sessionsPath: scrobbleSessionsPath,
      queuePath: scrobbleQueuePath,
      onStatus: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scrobble-status', status);
        }
      },
    });
    updateManager = new UpdateManager({
      getSettings: () => readSettings(),
      userDataPath: app.getPath('userData'),
      onStatus: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-status', status);
        }
      },
    });
    setupIpcHandlers();
    scrobbleManager.start();
    updateManager.start();
    setupMediaKeys();
    setupTray();
    createWindow();
    const discordSettings = readSettings();
    configureDiscordRpc(discordSettings.discordRPC, discordSettings.discordClientId || '', (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('discord-status', status);
      }
    }).catch(() => {});
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

export {};














