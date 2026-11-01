export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
  token?: string;
  publicUrl?: string;
  default: boolean;
  createdAt: number;
}

export type StreamFormat = 'raw' | 'mp3' | 'aac' | 'flac' | 'opus' | 'wav';
export type EqualizerPreset = 'flat' | 'bass' | 'vocal' | 'rock' | 'electronic' | 'custom';
export type AudioEngineMode = 'wasapi-shared' | 'wasapi-exclusive' | 'browser';
export type ReplayGainMode = 'off' | 'track' | 'album';
export type ChannelMode = 'auto' | 'stereo' | 'surround';
export type ResampleQuality = 'auto' | 'high' | 'fast';
export type LyricaInstanceMode = 'official' | 'community';
export type ScrobbleProvider = 'lastfm' | 'librefm';
export type WavrSyncControlMode = 'host' | 'everyone';
export type WavrSyncVisibility = 'private' | 'public';
export type WavrSyncPlaybackStatus = 'playing' | 'paused' | 'idle';
export type UpdateMode = 'all' | 'critical';
export type UpdateChannel = 'stable' | 'beta' | 'dev';

export interface AppSettings {
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
  streamFormat: StreamFormat;
  streamBitrate: number;
  equalizerEnabled: boolean;
  equalizerPreset: EqualizerPreset;
  equalizerBands: number[];
  equalizerQ: number;
  audioEngine: AudioEngineMode;
  audioDeviceId: string;
  dspEnabled: boolean;
  replayGain: ReplayGainMode;
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  channelMode: ChannelMode;
  resampleQuality: ResampleQuality;
  lyricaInstanceMode: LyricaInstanceMode;
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
  friendsSidebarEnabled: boolean;
  autoUpdate: boolean;
  updateFeedUrl: string;
  updateMode: UpdateMode;
  updateChannel: UpdateChannel;
  profileBanner: string;
  profileTags: string[];
  profileImage: string;
  fanartTvApiKey: string;
  pageBackgrounds: Record<string, string>;
  youtubeBackgrounds: Record<string, string>;
  youtubeBackgroundSyncOffsets: Record<string, number>;
  fullscreenYoutubeBackground: boolean;
  youtubeBackgroundPauseWithPlayback: boolean;
  youtubeBackgroundSkipIntro: boolean;
  fullscreenAutoHideUi: boolean;
  servers: ServerProfile[];
}

export interface ScrobbleTrack {
  artist: string;
  title: string;
  album?: string;
  duration?: number;
  trackNumber?: number;
  timestamp?: number;
}

export interface ScrobbleStatus {
  enabled: boolean;
  provider: ScrobbleProvider;
  connected: boolean;
  username: string;
  pending: number;
  connecting: boolean;
  error: string;
}

export type WavrSyncBadge = 'developer' | 'alpha' | 'beta';

export interface WavrSyncParticipant {
  id: string;
  name: string;
  avatar?: string;
  badges?: WavrSyncBadge[];
  joinedAt: number;
  isHost: boolean;
}

export interface WavrSyncPlayback {
  status: WavrSyncPlaybackStatus;
  position: number;
  updatedAt: number;
  trackId: string | null;
}

export interface WavrSyncRoom {
  code: string;
  name: string;
  hostId: string;
  controlMode: WavrSyncControlMode;
  visibility: WavrSyncVisibility;
  libraryUrl: string;
  libraryName: string;
  participants: WavrSyncParticipant[];
  queue: Track[];
  currentIndex: number;
  playback: WavrSyncPlayback;
  version: number;
  lastChangedBy: string;
  createdAt: number;
  updatedAt: number;
  inviteUrl: string;
}

export interface WavrSyncRoomSummary {
  code: string;
  name: string;
  hostName: string;
  participants: number;
  libraryName: string;
  trackTitle: string;
  trackArtist: string;
  visibility: WavrSyncVisibility;
  updatedAt: number;
}

export interface WavrSyncAccount {
  id: string;
  username: string;
  createdAt: number;
  settingsUpdatedAt: number;
  settingsVersion: number;
  badges?: WavrSyncBadge[];
}

export interface WavrSyncAccountSession {
  serverUrl: string;
  token: string;
  account: WavrSyncAccount;
}

export interface WavrSyncAccountConfig {
  server: string;
  registration: 'open' | 'invite' | 'closed';
  inviteRequired: boolean;
  protocolVersion: number;
  features: string[];
}

export interface WavrSyncEncryptedSettings {
  ciphertext: string;
  salt: string;
  iv: string;
  version: number;
  updatedAt?: number;
}

export interface WavrSyncProfile {
  id: string;
  name: string;
  avatar: string;
  banner: string;
  bio: string;
  tags: string[];
  badges?: WavrSyncBadge[];
  currentTrack: Track | null;
  topSongs: Track[];
  topArtists: Artist[];
  favoriteSongs: Track[];
  favoriteArtists: Artist[];
  favoriteAlbums: Album[];
  playlists: Playlist[];
  friends: string[];
  incomingFriendRequests?: string[];
  outgoingFriendRequests?: string[];
  online?: boolean;
  updatedAt: number;
}

export interface WavrSyncRoomInvite {
  id: string;
  code: string;
  roomName: string;
  fromId: string;
  fromName: string;
  fromAvatar: string;
  createdAt: number;
  expiresAt: number;
}

export type WavrSyncProfileInput = Partial<
  Omit<WavrSyncProfile, 'id' | 'friends' | 'badges' | 'updatedAt'>
>;

export interface WavrSyncProfileSummary {
  id: string;
  name: string;
  avatar: string;
  tags: string[];
  badges?: WavrSyncBadge[];
  updatedAt: number;
}

export interface WavrSyncProfileView {
  profile: WavrSyncProfile | null;
  loading: boolean;
  error: string;
}

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion: string;
  progress: number;
  message: string;
  releaseNotes: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration: number;
  bitRate?: number;
  bpm?: number;
  size?: number;
  contentType?: string;
  suffix?: string;
  playCount?: number;
  starred?: boolean;
  rating?: number;
  albumCover?: string;
  coverArt?: string;
  serverId?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  year?: number;
  genre?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  starred?: boolean;
  serverId?: string;
}

export interface Artist {
  id: string;
  name: string;
  artistType?: 'main' | 'various';
  albumCount?: number;
  songCount?: number;
  coverArt?: string;
  starred?: boolean;
  musicBrainzId?: string;
  serverId?: string;
}

export interface Playlist {
  id: string;
  name: string;
  owner?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  starred?: boolean;
  serverId?: string;
  songIds?: string[];
}

export interface Genre {
  name: string;
  songCount?: number;
  albumCount?: number;
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  songs: Track[];
  playlists: Playlist[];
}

export interface PlaybackState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'seeking' | 'ended' | 'failed';
  track: Track | null;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  error: string | null;
}

export interface QueueEntry {
  id: string;
  track: Track;
  position: number;
  current: boolean;
}

export interface Lyrics {
  id: string;
  trackId: string;
  text: string;
  lines: LyricLine[];
  source: 'server' | 'embedded';
}

export type LyricSyncLevel = 'syllable' | 'word' | 'line' | 'plain';

export interface LyricWord {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  time: number;
  end?: number;
  text: string;
  words?: LyricWord[];
  translation?: string;
  romanization?: string;
}

export interface LyricsDocument {
  source: 'lyrica' | 'server';
  provider: string | null;
  syncLevel: LyricSyncLevel;
  lines: LyricLine[];
  plain: string;
  translatedPlain?: string;
  romanizedPlain?: string;
}

export interface DynamicColor {
  accent: string;
  accent2: string;
  luminance: number;
  saturation: number;
}

export interface ServerCapabilities {
  version: string | null;
  openSubsonic: boolean;
  supportsLyrics: boolean;
  supportsStarred: boolean;
  supportsPlayQueue: boolean;
  supportsGenres: boolean;
  supportsInternetRadio: boolean;
  supportsTopSongs: boolean;
  operations: Record<string, boolean>;
}

export interface ServerInfo {
  url: string;
  username: string;
  connected: boolean;
  capabilities: ServerCapabilities | null;
  version: string | null;
}




