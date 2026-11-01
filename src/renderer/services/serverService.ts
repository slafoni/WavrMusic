/* Server service: owns the Subsonic client and maps API responses to
   the shared models. No React imports. */

import { store } from '../state';
import {
  SubsonicClient,
  buildStreamUrl,
  buildCoverArtUrl,
  isSecure,
  type AlbumListType,
  type SubsonicClientOptions,
} from '../../../shared/api/subsonic-client';
import type {
  Track,
  Album,
  Artist,
  Playlist,
  ServerProfile,
  Genre,
  ServerCapabilities,
} from '../../../shared/models';
import { API_VERSION, CLIENT_NAME } from '../../../shared/constants';

let client: SubsonicClient | null = null;
const coverUrlCache = new WeakMap<ServerProfile, Map<string, string>>();
const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShareLinkInfo {
  url: string;
  expiresAt: number;
}

function electronApi(): any {
  return (window as any).electronAPI;
}

export function getClient(): SubsonicClient | null {
  return client;
}

function optionsFromProfile(profile: ServerProfile): SubsonicClientOptions {
  return {
    url: profile.url,
    username: profile.username,
    password: profile.password,
    token: profile.token,
    clientName: CLIENT_NAME,
    apiVersion: API_VERSION,
    timeoutMs: 15000,
  };
}

export function setClientFromProfile(profile: ServerProfile): SubsonicClient {
  client = new SubsonicClient(optionsFromProfile(profile));
  return client;
}

export async function connectServer(profile: ServerProfile): Promise<{
  capabilities: ServerCapabilities;
  version: string | null;
}> {
  const candidate = new SubsonicClient({
    ...optionsFromProfile(profile),
    timeoutMs: 12000,
  });

  const capabilities = await candidate.probeCapabilities(true);

  client = candidate;
  store.setServerProfile(profile);
  store.setCapabilities(capabilities);
  store.setServerInfo({
    url: profile.url,
    username: profile.username,
    connected: true,
    capabilities,
    version: capabilities.version,
  });

  return { capabilities, version: capabilities.version };
}

export function disconnectServer() {
  client = null;
  store.setServerProfile(null);
  store.setServerInfo(null);
  store.setCapabilities(null);
}

export function isConnected(): boolean {
  return client !== null && !!store.getServerProfile();
}

export function requireClient(): SubsonicClient {
  if (!client) throw new Error('No server connected. Add a server to get started.');
  return client;
}

export function streamUrl(songId: string, maxBitRate?: number, format?: string): string {
  const profile = store.getServerProfile();
  if (!profile) throw new Error('No server connected.');
  return buildStreamUrl(optionsFromProfile(profile), songId, maxBitRate, format);
}

export function directCoverArtUrl(coverArtId?: string | null, size?: number): string {
  if (!coverArtId) return '';
  const profile = store.getServerProfile();
  if (!profile) return '';
  let cache = coverUrlCache.get(profile);
  if (!cache) {
    cache = new Map();
    coverUrlCache.set(profile, cache);
  }
  const key = `${coverArtId}|${size ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = buildCoverArtUrl(optionsFromProfile(profile), coverArtId, size);
  cache.set(key, url);
  return url;
}

export function coverArtUrl(coverArtId?: string | null, size?: number): string {
  const direct = directCoverArtUrl(coverArtId, size);
  if (!direct) return '';
  const api = electronApi();
  return api?.mediaProxyUrl ? api.mediaProxyUrl(direct) : direct;
}

export function publicCoverArtUrl(coverArtId?: string | null, size?: number): string {
  if (!coverArtId) return '';
  const profile = store.getServerProfile();
  if (!profile) return '';
  const publicUrl = profile.publicUrl?.trim();
  if (!publicUrl) return '';
  try {
    const base = publicUrl.replace(/\/+$/, '');
    const endpoint = /\/rest$/i.test(base) ? `${base}/getCoverArt` : `${base}/rest/getCoverArt`;
    const url = new URL(endpoint);
    url.searchParams.set('id', coverArtId);
    if (size) url.searchParams.set('size', String(size));
    return url.toString();
  } catch {
    return '';
  }
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/* ---------- Mapping ---------- */

export function toTrack(raw: any): Track {
  return {
    id: String(raw.id),
    title: raw.title || raw.name || 'Unknown title',
    artist: raw.artist || 'Unknown artist',
    artistId: raw.artistId,
    album: raw.album || 'Unknown album',
    albumId: raw.albumId,
    genre: raw.genre,
    year: raw.year,
    trackNumber: raw.track,
    discNumber: raw.discNumber,
    duration: Number(raw.duration) || 0,
    bitRate: raw.bitRate,
    bpm: Number(raw.bpm) > 0 ? Number(raw.bpm) : undefined,
    size: raw.size,
    contentType: raw.contentType,
    suffix: raw.suffix,
    playCount: raw.playCount,
    starred: !!raw.starred,
    rating: raw.userRating ?? raw.rating,
    albumCover: raw.albumCover,
    coverArt: raw.coverArt,
  };
}

export function toAlbum(raw: any): Album {
  return {
    id: String(raw.id),
    name: raw.name || raw.title || 'Unknown album',
    artist: raw.artist || 'Unknown artist',
    artistId: raw.artistId,
    year: raw.year,
    genre: raw.genre,
    songCount: raw.songCount,
    duration: raw.duration,
    coverArt: raw.coverArt,
    starred: !!raw.starred,
  };
}

export function toArtist(raw: any): Artist {
  return {
    id: String(raw.id),
    name: raw.name || 'Unknown artist',
    albumCount: raw.albumCount,
    songCount: raw.songCount,
    coverArt: raw.coverArt,
    starred: !!raw.starred,
    musicBrainzId: raw.musicBrainzId || raw.musicBrainzID,
  };
}

export function toPlaylist(raw: any): Playlist {
  return {
    id: String(raw.id),
    name: raw.name || 'Untitled playlist',
    owner: raw.owner,
    songCount: raw.songCount,
    duration: raw.duration,
    coverArt: raw.coverArt,
    starred: !!raw.starred,
    songIds: asArray(raw.entry).map((entry) => String(entry.id)),
  };
}

export function toGenre(raw: any): Genre {
  return {
    name: raw.value || raw.name || 'Unknown genre',
    songCount: raw.songCount,
    albumCount: raw.albumCount,
  };
}

/* ---------- Library ---------- */

export async function fetchArtists(): Promise<Artist[]> {
  const response = await requireClient().getArtists();
  const indexes = asArray(response?.artists?.index);
  const artists: Artist[] = [];
  for (const index of indexes) {
    for (const artist of asArray(index?.artist)) {
      artists.push(toArtist(artist));
    }
  }
  return artists.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchArtist(id: string): Promise<{ artist: Artist; albums: Album[] } | null> {
  const response = await requireClient().getArtist({ id });
  const raw = response?.artist;
  if (!raw) return null;
  return {
    artist: toArtist(raw),
    albums: asArray(raw.album).map(toAlbum),
  };
}

export async function fetchTopSongs(artistName: string, count = 20): Promise<Track[]> {
  try {
    const response = await requireClient().getTopSongs({ artist: artistName, count });
    return asArray(response?.topSongs?.song).map(toTrack);
  } catch {
    return [];
  }
}

export async function fetchAlbums(
  type: AlbumListType = 'alphabeticalByName',
  size = 100,
  offset = 0,
  genre?: string,
  fromYear?: number,
  toYear?: number,
): Promise<Album[]> {
  const response = await requireClient().getAlbumList2({ type, size, offset, genre, fromYear, toYear });
  return asArray(response?.albumList2?.album).map(toAlbum);
}

export async function fetchAlbum(id: string): Promise<(Album & { songs: Track[] }) | null> {
  const response = await requireClient().getAlbum({ id });
  const raw = response?.album;
  if (!raw) return null;
  return {
    ...toAlbum(raw),
    songs: asArray(raw.song)
      .map(toTrack)
      .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0)),
  };
}

export async function fetchRandomSongs(size = 100, genre?: string): Promise<Track[]> {
  const response = await requireClient().getRandomSongs({ size, genre });
  return asArray(response?.randomSongs?.song).map(toTrack);
}

export async function fetchSongsByGenre(genre: string, count = 200): Promise<Track[]> {
  const response = await requireClient().getSongsByGenre({ genre, count });
  return asArray(response?.songsByGenre?.song).map(toTrack);
}

export async function fetchGenres(): Promise<Genre[]> {
  const response = await requireClient().getGenres();
  return asArray(response?.genres?.genre).map(toGenre);
}

export async function fetchStarred(): Promise<{
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}> {
  const response = await requireClient().getStarred2();
  const starred = response?.starred2 || {};
  return {
    songs: asArray(starred.song).map(toTrack),
    albums: asArray(starred.album).map(toAlbum),
    artists: asArray(starred.artist).map(toArtist),
  };
}

export async function searchLibrary(query: string): Promise<{
  artists: Artist[];
  albums: Album[];
  songs: Track[];
  playlists: Playlist[];
}> {
  if (!query.trim()) return { artists: [], albums: [], songs: [], playlists: [] };
  const response = await requireClient().search3({
    query,
    artistCount: 12,
    albumCount: 18,
    songCount: 40,
    playlistCount: 12,
  });
  const result = response?.searchResult3 || response?.searchResult || {};
  return {
    artists: asArray(result.artist).map(toArtist),
    albums: asArray(result.album).map(toAlbum),
    songs: asArray(result.song).map(toTrack),
    playlists: asArray(result.playlist).map(toPlaylist),
  };
}

/* ---------- Playlists ---------- */

export async function fetchPlaylists(): Promise<Playlist[]> {
  const response = await requireClient().getPlaylists();
  return asArray(response?.playlists?.playlist).map(toPlaylist);
}

export async function fetchPlaylist(id: string): Promise<(Playlist & { songs: Track[] }) | null> {
  const response = await requireClient().getPlaylist({ id });
  const raw = response?.playlist;
  if (!raw) return null;
  return {
    ...toPlaylist(raw),
    songs: asArray(raw.entry).map(toTrack),
  };
}

export async function createPlaylist(name: string, songIds: string[]): Promise<void> {
  await requireClient().createPlaylist({ name, songId: songIds });
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  await requireClient().updatePlaylist({ playlistId, name });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await requireClient().deletePlaylist({ id: playlistId });
}

export async function addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
  await requireClient().updatePlaylist({ playlistId, songIdToAdd: songIds });
}

export async function removeSongFromPlaylist(playlistId: string, index: number): Promise<void> {
  await requireClient().updatePlaylist({ playlistId, songIndexToRemove: [index] });
}

export async function createShareLink(songIds: string[], description = ''): Promise<ShareLinkInfo> {
  if (!songIds.length) throw new Error('There is nothing to share.');
  const requestedExpiry = Date.now() + SHARE_TTL_MS;
  const response = await requireClient().createShare({
    id: songIds,
    description: description.trim() || 'Shared from WAVR',
    expires: requestedExpiry,
  });
  const share = asArray(response?.shares?.share)[0] || asArray(response?.share)[0];
  let url = String(share?.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    const profile = store.getServerProfile();
    if (profile) url = new URL(url, profile.url).toString();
  }
  if (!url) throw new Error('The server did not return a share link. Check its sharing settings.');
  const returnedExpiry = Number(share?.expires);
  return {
    url,
    expiresAt: Number.isFinite(returnedExpiry) && returnedExpiry > 0 ? returnedExpiry : requestedExpiry,
  };
}

/* ---------- Favourites ---------- */

export async function setTrackStarred(id: string, starred: boolean): Promise<void> {
  const c = requireClient();
  if (starred) await c.star({ id });
  else await c.unstar({ id });
}

export async function setAlbumStarred(id: string, starred: boolean): Promise<void> {
  const c = requireClient();
  if (starred) await c.star({ albumId: id });
  else await c.unstar({ albumId: id });
}

export async function setArtistStarred(id: string, starred: boolean): Promise<void> {
  const c = requireClient();
  if (starred) await c.star({ artistId: id });
  else await c.unstar({ artistId: id });
}

export async function setTrackRating(id: string, rating: number): Promise<void> {
  await requireClient().setRating({ id, rating });
}

/* ---------- Playback helpers ---------- */

export async function scrobbleTrack(id: string, submission = true): Promise<void> {
  try {
    await requireClient().scrobble({ id, time: Date.now(), submission });
  } catch {
    /* Scrobbling must never interrupt playback. */
  }
}

export async function fetchLyrics(
  track: Track,
): Promise<{ text: string; synced: boolean }> {
  const capabilities = store.getCapabilities();
  const c = requireClient();

  try {
    if (capabilities?.operations?.['getLyricsBySongId']) {
      const response = await c.getLyricsBySongId({ id: track.id });
      const entries = asArray(response?.lyricsList?.lyrics);
      const entry = entries[0];
      if (entry) {
        const lines = asArray(entry.line);
        if (lines.length) {
          const text = lines
            .map((line) => {
              const ms = Number(line.start) || 0;
              const totalSeconds = Math.floor(ms / 1000);
              const minutes = Math.floor(totalSeconds / 60);
              const seconds = totalSeconds % 60;
              const hundredths = Math.floor((ms % 1000) / 10);
              const stamp = `${minutes.toString().padStart(2, '0')}:${seconds
                .toString()
                .padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
              return `[${stamp}]${line.value ?? ''}`;
            })
            .join('\n');
          return { text, synced: true };
        }
        if (entry.value) return { text: String(entry.value), synced: false };
      }
    }

    const response = await c.getLyrics({ artist: track.artist, title: track.title });
    const value = response?.lyrics?.value;
    if (value) {
      const text = String(value);
      return { text, synced: /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text) };
    }
  } catch {
    /* Lyrics are optional. */
  }

  return { text: '', synced: false };
}

export { isSecure };

