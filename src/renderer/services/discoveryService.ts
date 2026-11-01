import type { Track } from '../../../shared/models';
import {
  LASTFM_API_KEY,
  LASTFM_API_URL,
  LASTFM_TIMEOUT_MS,
} from '../../../shared/constants';
import { store } from '../state';
import {
  fetchArtists,
  fetchTopSongs,
  searchLibrary,
} from './serverService';

export type DiscoveryGroupKind = 'artist' | 'track' | 'library';

export interface DiscoveryGroup {
  id: string;
  title: string;
  subtitle?: string;
  tracks: Track[];
  kind: DiscoveryGroupKind;
  seed?: string;
}

export interface DiscoveryTab {
  id: string;
  label: string;
  groupIds: string[];
}

export interface DiscoveryResult {
  groups: DiscoveryGroup[];
  personalized: boolean;
  warning?: string;
}

export function buildDiscoveryTabs(groups: DiscoveryGroup[]): DiscoveryTab[] {
  if (groups.length < 2) return [];
  return [
    {
      id: 'all',
      label: 'All picks',
      groupIds: groups.map((group) => group.id),
    },
    ...groups
      .filter((group) => group.kind === 'artist' || group.kind === 'track')
      .map((group) => ({
        id: group.id,
        label: group.title,
        groupIds: [group.id],
      })),
  ];
}

interface LastFmArtist {
  name: string;
  match: number;
}

interface LastFmUserArtist {
  name: string;
  playcount: number;
}

export interface LastFmUserTrack {
  name: string;
  artist: string;
  playcount: number;
}

export interface LastFmTrack {
  name: string;
  artist: string;
  match: number;
}

export function normalizeDiscoveryText(value: string): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function libraryTrackMatches(
  candidate: { name: string; artist: string },
  track: Track,
): boolean {
  const title = normalizeDiscoveryText(candidate.name);
  const artist = normalizeDiscoveryText(candidate.artist);
  const trackTitle = normalizeDiscoveryText(track.title);
  const trackArtist = normalizeDiscoveryText(track.artist);
  if (!title || !artist || !trackTitle || !trackArtist) return false;
  const titleMatch =
    title === trackTitle ||
    trackTitle.includes(title) ||
    title.includes(trackTitle);
  const artistMatch =
    artist === trackArtist ||
    trackArtist.includes(artist) ||
    artist.includes(trackArtist);
  return titleMatch && artistMatch;
}

export function mapLastFmSimilarArtists(payload: any): LastFmArtist[] {
  const entries = payload?.similarartists?.artist;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      name: String(entry?.name ?? '').trim(),
      match: Number(entry?.match) || 0,
    }))
    .filter((entry) => !!entry.name)
    .sort((a, b) => b.match - a.match);
}

export function mapLastFmSimilarTracks(payload: any): LastFmTrack[] {
  const entries = payload?.similartracks?.track;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      name: String(entry?.name ?? '').trim(),
      artist: String(entry?.artist?.name ?? entry?.artist ?? '').trim(),
      match: Number(entry?.match) || 0,
    }))
    .filter((entry) => !!entry.name && !!entry.artist)
    .sort((a, b) => b.match - a.match);
}

export function mapLastFmUserArtists(payload: any): LastFmUserArtist[] {
  const entries = payload?.topartists?.artist;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      name: String(entry?.name ?? '').trim(),
      playcount: Number(entry?.playcount) || 0,
    }))
    .filter((entry) => !!entry.name)
    .sort((a, b) => b.playcount - a.playcount);
}

function mapUserTrackEntries(entries: any): LastFmUserTrack[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      name: String(entry?.name ?? '').trim(),
      artist: String(entry?.artist?.name ?? entry?.artist ?? '').trim(),
      playcount: Number(entry?.playcount) || 0,
    }))
    .filter((entry) => !!entry.name && !!entry.artist)
    .sort((a, b) => b.playcount - a.playcount);
}

export function mapLastFmUserTracks(payload: any): LastFmUserTrack[] {
  return mapUserTrackEntries(payload?.toptracks?.track);
}

export function mapLastFmLovedTracks(payload: any): LastFmUserTrack[] {
  return mapUserTrackEntries(payload?.lovedtracks?.track);
}

async function lastFmRequest(
  method: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<any | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LASTFM_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({
      method,
      api_key: apiKey,
      format: 'json',
      autocorrect: '1',
      ...params,
    });
    const response = await fetch(`${LASTFM_API_URL}?${query.toString()}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.error) return null;
    return data;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchSimilarArtists(
  artist: string,
  apiKey: string,
  limit = 10,
): Promise<LastFmArtist[]> {
  const payload = await lastFmRequest('artist.getSimilar', apiKey, {
    artist,
    limit: String(limit),
  });
  return mapLastFmSimilarArtists(payload);
}

async function fetchSimilarTracks(
  artist: string,
  title: string,
  apiKey: string,
  limit = 10,
): Promise<LastFmTrack[]> {
  const payload = await lastFmRequest('track.getSimilar', apiKey, {
    artist,
    track: title,
    limit: String(limit),
  });
  return mapLastFmSimilarTracks(payload);
}

async function fetchUserTopArtists(
  username: string,
  apiKey: string,
  limit = 16,
): Promise<LastFmUserArtist[] | null> {
  const payload = await lastFmRequest('user.getTopArtists', apiKey, {
    user: username,
    period: '3month',
    limit: String(limit),
  });
  return payload ? mapLastFmUserArtists(payload) : null;
}

async function fetchUserTopTracks(
  username: string,
  apiKey: string,
  limit = 16,
): Promise<LastFmUserTrack[] | null> {
  const payload = await lastFmRequest('user.getTopTracks', apiKey, {
    user: username,
    period: '3month',
    limit: String(limit),
  });
  return payload ? mapLastFmUserTracks(payload) : null;
}

async function fetchUserLovedTracks(
  username: string,
  apiKey: string,
  limit = 16,
): Promise<LastFmUserTrack[] | null> {
  const payload = await lastFmRequest('user.getLovedTracks', apiKey, {
    user: username,
    limit: String(limit),
  });
  return payload ? mapLastFmLovedTracks(payload) : null;
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeDiscoveryText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
  }
  return result;
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function dedupeTracks(tracks: LastFmTrack[]): LastFmTrack[] {
  const seen = new Set<string>();
  const result: LastFmTrack[] = [];
  for (const track of tracks) {
    const key = `${normalizeDiscoveryText(track.artist)}|${normalizeDiscoveryText(track.name)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

export async function findLibraryTrack(candidate: LastFmTrack): Promise<Track | null> {
  const queries = [
    `${candidate.artist} ${candidate.name}`,
    candidate.name,
  ];
  for (const query of queries) {
    try {
      const result = await searchLibrary(query);
      const match = result.songs.find((track) => libraryTrackMatches(candidate, track));
      if (match) return match;
    } catch {
      /* try the next query */
    }
  }
  return null;
}

export async function loadDiscovery(username: string, force = false): Promise<DiscoveryResult> {
  const listener = String(username || '').trim();
  if (!listener) {
    return {
      groups: [],
      personalized: false,
      warning: 'Sign in to Last.fm to load personalised recommendations.',
    };
  }

  const profile = store.getServerProfile();
  if (!profile) return { groups: [], personalized: false };

  const apiKey = LASTFM_API_KEY;
  const [topArtistsResult, topTracksResult, lovedTracksResult, artistsResult] = await Promise.allSettled([
    fetchUserTopArtists(listener, apiKey, 16),
    fetchUserTopTracks(listener, apiKey, 16),
    fetchUserLovedTracks(listener, apiKey, 16),
    fetchArtists(),
  ]);

  const topArtists = topArtistsResult.status === 'fulfilled' ? topArtistsResult.value : null;
  const topTracks = topTracksResult.status === 'fulfilled' ? topTracksResult.value : null;
  const lovedTracks = lovedTracksResult.status === 'fulfilled' ? lovedTracksResult.value : null;
  const artists = artistsResult.status === 'fulfilled' ? artistsResult.value : [];

  if (topArtists === null && topTracks === null && lovedTracks === null) {
    return {
      groups: [],
      personalized: false,
      warning: `Could not load Last.fm listening history for ${listener}.`,
    };
  }

  const libraryArtistNames = new Set(artists.map((artist) => normalizeDiscoveryText(artist.name)));
  const seedArtists = uniqueNames((topArtists ?? []).map((artist) => artist.name));
  const seedTracks = dedupeTracks([
    ...(topTracks ?? []).map((track) => ({
      name: track.name,
      artist: track.artist,
      match: track.playcount,
    })),
    ...(lovedTracks ?? []).map((track) => ({
      name: track.name,
      artist: track.artist,
      match: track.playcount,
    })),
  ]);

  if (!seedArtists.length && !seedTracks.length) {
    return {
      groups: [],
      personalized: false,
      warning: `Last.fm has no listening history for ${listener} yet.`,
    };
  }

  const groups: DiscoveryGroup[] = [];
  const usedTrackIds = new Set<string>();
  const artistGroupTarget = force ? 6 : 5;

  for (const seedArtist of shuffle(seedArtists).slice(0, artistGroupTarget)) {
    if (groups.filter((group) => group.kind === 'artist').length >= artistGroupTarget) break;
    const groupId = `artist:${normalizeDiscoveryText(seedArtist)}`;
    if (groups.some((group) => group.id === groupId)) continue;
    const similarArtists = await fetchSimilarArtists(seedArtist, apiKey, 10);
    const tracks: Track[] = [];
    for (const candidate of similarArtists) {
      if (tracks.length >= 6) break;
      if (libraryArtistNames.size && !libraryArtistNames.has(normalizeDiscoveryText(candidate.name))) {
        continue;
      }
      const topSongs = await fetchTopSongs(candidate.name, 6);
      for (const track of topSongs) {
        if (usedTrackIds.has(track.id)) continue;
        usedTrackIds.add(track.id);
        tracks.push(track);
        if (tracks.length >= 6) break;
      }
    }
    if (tracks.length >= 2) {
      groups.push({
        id: groupId,
        kind: 'artist',
        seed: seedArtist,
        title: `Because you listen to ${seedArtist}`,
        subtitle: 'Similar artists in your library, based on your Last.fm history',
        tracks: tracks.slice(0, 6),
      });
    }
  }

  const trackGroupTarget = force ? 3 : 2;
  for (const seedTrack of shuffle(seedTracks).slice(0, trackGroupTarget)) {
    if (groups.filter((group) => group.kind === 'track').length >= trackGroupTarget) break;
    const groupId = `track:${normalizeDiscoveryText(seedTrack.artist)}:${normalizeDiscoveryText(seedTrack.name)}`;
    if (groups.some((group) => group.id === groupId)) continue;
    const similarTracks = await fetchSimilarTracks(
      seedTrack.artist,
      seedTrack.name,
      apiKey,
      10,
    );
    const tracks: Track[] = [];
    for (const candidate of similarTracks) {
      if (tracks.length >= 5) break;
      const match = await findLibraryTrack(candidate);
      if (!match || usedTrackIds.has(match.id)) continue;
      usedTrackIds.add(match.id);
      tracks.push(match);
    }
    if (tracks.length >= 2) {
      groups.push({
        id: groupId,
        kind: 'track',
        seed: seedTrack.name,
        title: `Because you listen to ${seedTrack.name}`,
        subtitle: `Matched from ${seedTrack.artist} listeners on Last.fm`,
        tracks,
      });
    }
  }

  if (!groups.length) {
    return {
      groups: [],
      personalized: false,
      warning: `No library tracks matched the Last.fm recommendations for ${listener} yet.`,
    };
  }

  return { groups, personalized: true };
}
