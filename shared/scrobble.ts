import type { ScrobbleProvider, ScrobbleTrack, Track } from './models';

export interface ScrobbleProviderInfo {
  id: ScrobbleProvider;
  label: string;
  apiUrl: string;
  authUrl: string;
  apiKeyUrl: string;
  apiKeyLabel: string;
}

export const SCROBBLE_PROVIDERS: Record<ScrobbleProvider, ScrobbleProviderInfo> = {
  lastfm: {
    id: 'lastfm',
    label: 'Last.fm',
    apiUrl: 'https://ws.audioscrobbler.com/2.0/',
    authUrl: 'https://www.last.fm/api/auth/',
    apiKeyUrl: 'https://www.last.fm/api/account/create',
    apiKeyLabel: 'API key',
  },
  librefm: {
    id: 'librefm',
    label: 'Libre.fm',
    apiUrl: 'https://libre.fm/2.0/',
    authUrl: 'https://libre.fm/api/auth/',
    apiKeyUrl: 'https://libre.fm/api-keys.php',
    apiKeyLabel: 'API key',
  },
};

export const SCROBBLE_PROVIDER_LIST: ScrobbleProviderInfo[] = [
  SCROBBLE_PROVIDERS.lastfm,
  SCROBBLE_PROVIDERS.librefm,
];

export function scrobbleThreshold(durationSeconds: number): number | null {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 240;
  if (duration <= 30) return null;
  return Math.min(240, duration / 2);
}

export function normalizeScrobbleTrack(track: Partial<ScrobbleTrack>): ScrobbleTrack {
  const normalized: ScrobbleTrack = {
    artist: String(track.artist || '').trim(),
    title: String(track.title || '').trim(),
  };
  const album = String(track.album || '').trim();
  if (album) normalized.album = album;
  const duration = Math.round(Number(track.duration) || 0);
  if (duration > 0) normalized.duration = duration;
  const trackNumber = Math.round(Number(track.trackNumber) || 0);
  if (trackNumber > 0) normalized.trackNumber = trackNumber;
  const timestamp = Math.round(Number(track.timestamp) || 0);
  if (timestamp > 0) normalized.timestamp = timestamp;
  return normalized;
}

export function isScrobbleEligible(track: Partial<ScrobbleTrack> | null | undefined): boolean {
  if (!track) return false;
  return !!String(track.artist || '').trim() && !!String(track.title || '').trim();
}

export function toScrobbleTrack(track: Track, duration?: number): ScrobbleTrack {
  return normalizeScrobbleTrack({
    artist: track.artist,
    title: track.title,
    album: track.album,
    duration: duration || track.duration,
    trackNumber: track.trackNumber,
  });
}
