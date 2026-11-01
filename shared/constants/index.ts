import type { ServerProfile, AppSettings } from '../models';
import packageJson from '../../package.json';

export const APP_NAME = 'WAVR';
export const APP_TAGLINE = 'Your music, your way.';
export const APP_ID = 'app.wavr.desktop';
export const APP_VERSION = packageJson.version;

export const PAGE_BACKGROUND_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const PAGE_BACKGROUND_MAX_GIF_BYTES = 500 * 1024 * 1024;
export const PAGE_BACKGROUND_MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export const THEME_MODES: { value: 'light' | 'dark' | 'system'; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

export const DYNAMIC_THEMES: { value: 'auto' | 'fixed' | 'disabled'; label: string }[] = [
  { value: 'auto', label: 'From artwork' },
  { value: 'fixed', label: 'Fixed accent' },
  { value: 'disabled', label: 'Disabled' },
];

export const DENSITIES: { value: 'comfortable' | 'compact'; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

export const REPEAT_MODES: { value: 'off' | 'one' | 'all'; label: string }[] = [
  { value: 'off', label: 'Repeat off' },
  { value: 'all', label: 'Repeat all' },
  { value: 'one', label: 'Repeat one' },
];

export const ACCENT_SWATCHES = [
  '#C8D879',
  '#7FD1AE',
  '#7CB8E8',
  '#E5A15D',
  '#D67FA6',
  '#B6A7E8',
  '#E0C36A',
  '#7CC4D8',
];

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'seeking'
  | 'ended'
  | 'failed';

export const STREAM_FORMATS = [
  { value: 'raw', label: 'Original' },
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
  { value: 'opus', label: 'Opus' },
  { value: 'wav', label: 'WAV' },
] as const;

export const STREAM_BITRATES = [
  { value: 0, label: 'Unlimited' },
  { value: 128, label: '128 kbps' },
  { value: 192, label: '192 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 320, label: '320 kbps' },
] as const;

export const EQUALIZER_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const AUDIO_ENGINE_MODES = [
  { value: 'wasapi-shared', label: 'WASAPI Shared' },
  { value: 'wasapi-exclusive', label: 'WASAPI Exclusive' },
] as const;

export const REPLAY_GAIN_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'track', label: 'Track gain' },
  { value: 'album', label: 'Album gain' },
] as const;

export const CHANNEL_MODES = [
  { value: 'auto', label: 'Automatic' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'surround', label: 'Surround' },
] as const;

export const RESAMPLE_QUALITIES = [
  { value: 'auto', label: 'Automatic' },
  { value: 'high', label: 'High quality' },
  { value: 'fast', label: 'Fast' },
] as const;

export const LYRIC_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
] as const;

export const EQUALIZER_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, -1, -1, 0, 0],
  vocal: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1],
  rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4],
  electronic: [5, 4, 1, 0, -1, 0, 2, 4, 5, 4],
} as const;
export const DEFAULT_SERVER_PROFILE: Partial<ServerProfile> = {
  name: '',
  url: '',
  username: '',
  password: '',
  token: '',
  default: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
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
  lastFmApiKey: '70b11f117c0a8cdb36bbd6c62688fe31',
  lastFmApiSecret: '38095e16fa1d3ac834fdd30eeb9de106',
  libreFmApiKey: '',
  libreFmApiSecret: '',
  scrobbleEnabled: false,
  scrobbleProvider: 'lastfm',
  wavrSyncServerUrl: 'wss://sync.listenwavr.xyz',
  wavrSyncAutoConnect: true,
  wavrSyncSettingsSync: true,
  friendsSidebarEnabled: true,
  autoUpdate: true,
  updateFeedUrl: 'https://update.listenwavr.xyz',
  updateMode: 'all',
  updateChannel: 'stable',
  profileBanner: '',
  profileTags: [],
  profileImage: '',
  fanartTvApiKey: '',
  pageBackgrounds: {},
  youtubeBackgrounds: {},
  youtubeBackgroundSyncOffsets: {},
  fullscreenYoutubeBackground: false,
  youtubeBackgroundPauseWithPlayback: true,
  youtubeBackgroundSkipIntro: true,
  fullscreenAutoHideUi: false,
  servers: [],
};

export const API_VERSION = '1.16.1';
export const CLIENT_NAME = 'wavr';
export const LYRICA_API_BASE = 'https://test-0k.onrender.com';
export const LYRICA_TIMEOUT_MS = 20000;
export const LRCMUX_API_URL = 'https://api.lrcmux.dev';
export const LRCMUX_TIMEOUT_MS = 12000;
export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_TIMEOUT_MS = 12000;
export const LASTFM_API_KEY = '70b11f117c0a8cdb36bbd6c62688fe31';
export const LASTFM_API_SECRET = '38095e16fa1d3ac834fdd30eeb9de106';
export const LASTFM_CALLBACK_PORT = 43879;
export const LASTFM_CALLBACK_PATH = '/lastfm/callback';
export const LASTFM_CALLBACK_URL = `http://127.0.0.1:${LASTFM_CALLBACK_PORT}${LASTFM_CALLBACK_PATH}`;
export const WAVRSYNC_DEFAULT_SERVER_URL = 'wss://sync.listenwavr.xyz';

export const ICON_SIZE_MAP: Record<string, number> = {
  small: 32,
  medium: 64,
  large: 128,
  hero: 512,
};

export const NAVIGATION_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'artists', label: 'Artists', icon: 'people' },
  { id: 'albums', label: 'Albums', icon: 'album' },
  { id: 'songs', label: 'Songs', icon: 'library_music' },
  { id: 'genres', label: 'Genres', icon: 'category' },
  { id: 'playlists', label: 'Playlists', icon: 'playlist_play' },
  { id: 'favourites', label: 'Favourites', icon: 'favorite' },
  { id: 'recently-played', label: 'Recently Played', icon: 'history' },
  { id: 'recently-added', label: 'Recently Added', icon: 'add_circle' },
  { id: 'most-played', label: 'Most Played', icon: 'trending_up' },
  { id: 'discover', label: 'Discover', icon: 'auto_awesome' },
  { id: 'wavrsync', label: 'WavrSync', icon: 'sync' },
  { id: 'queue', label: 'Queue', icon: 'queue_music' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export const PAGE_BACKGROUND_ALL_ID = 'all';

export const PAGE_BACKGROUND_OPTIONS = [
  { id: PAGE_BACKGROUND_ALL_ID, label: 'All pages (except fullscreen)' },
  { id: 'home', label: 'Home' },
  { id: 'search', label: 'Search' },
  { id: 'artists', label: 'Artists' },
  { id: 'artist', label: 'Artist pages' },
  { id: 'albums', label: 'Albums' },
  { id: 'album', label: 'Album pages' },
  { id: 'songs', label: 'Songs' },
  { id: 'genres', label: 'Genres' },
  { id: 'genre', label: 'Genre pages' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'playlist', label: 'Playlist pages' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'recently-played', label: 'Recently Played' },
  { id: 'recently-added', label: 'Recently Added' },
  { id: 'most-played', label: 'Most Played' },
  { id: 'discover', label: 'Discover' },
  { id: 'wavrsync', label: 'WavrSync' },
  { id: 'profile', label: 'WavrSync profiles' },
  { id: 'queue', label: 'Queue' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'player', label: 'Now Playing / fullscreen' },
  { id: 'settings', label: 'Settings' },
] as const;

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatLongDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}








