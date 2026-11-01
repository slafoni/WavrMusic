import type { Playlist, Track } from '../../../shared/models';
import {
  LASTFM_API_KEY,
  LASTFM_API_URL,
  LASTFM_TIMEOUT_MS,
} from '../../../shared/constants';
import { fetchPlaylist } from './serverService';
import {
  findLibraryTrack,
  normalizeDiscoveryText,
  type LastFmTrack,
} from './discoveryService';

export type SmartMixRule = 'similar' | 'tempo';

export type SmartMixSeed =
  | { kind: 'track'; track: Track }
  | { kind: 'playlist'; playlist: Playlist };

export interface SmartMixCandidate {
  track: Track;
  score: number;
  seedHits: number;
  sharedTags: string[];
  weight: number;
}

export interface SmartMixResult {
  tracks: Track[];
  candidates: SmartMixCandidate[];
  matched: number;
  missingCandidates: number;
  seedTracks: number;
  sharedTags: string[];
  warning: string;
}

interface LastFmTag {
  name: string;
  count: number;
}

interface CandidateAggregate {
  candidate: LastFmTrack;
  weight: number;
  seedHits: Set<number>;
}

const LASTFM_CACHE_TTL_MS = 15 * 60 * 1000;
const requestCache = new Map<string, { data: any; at: number }>();
const tagCache = new Map<string, { tags: LastFmTag[]; at: number }>();
const NON_GENRE_TAGS = new Set([
  'love',
  'loved',
  'favorite',
  'favourite',
  'favorites',
  'favourites',
  'seen live',
  'awesome',
  'amazing',
  'good',
  'great',
  'best',
  'cool',
  'beautiful',
  'male vocalists',
  'female vocalists',
  'british',
  'american',
  'english',
  'uk',
  'usa',
  'britain',
  'australian',
  'canadian',
  'german',
  'french',
  'swedish',
  'norwegian',
  'irish',
  'scottish',
  'welsh',
  'spotify',
  'youtube',
  'albums i own',
  'my music',
  'music',
  'songs',
  'male',
  'female',
]);

function isGenreTag(name: string): boolean {
  const key = normalizeDiscoveryText(name);
  if (!key || NON_GENRE_TAGS.has(key)) return false;
  if (/^\d{2,4}s?$/.test(key)) return false;
  return true;
}

async function lastFmRequest(
  method: string,
  params: Record<string, string>,
): Promise<any | null> {
  const query = new URLSearchParams({
    method,
    api_key: LASTFM_API_KEY,
    format: 'json',
    autocorrect: '1',
    ...params,
  });
  const cacheKey = query.toString();
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LASTFM_CACHE_TTL_MS) return cached.data;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LASTFM_TIMEOUT_MS);
  try {
    const response = await fetch(`${LASTFM_API_URL}?${cacheKey}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.error) return null;
    requestCache.set(cacheKey, { data, at: Date.now() });
    return data;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchSimilarTracks(
  artist: string,
  title: string,
  limit = 30,
): Promise<LastFmTrack[]> {
  const data = await lastFmRequest('track.getSimilar', {
    artist,
    track: title,
    limit: String(limit),
  });
  const entries = data?.similartracks?.track;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry: any) => ({
      name: String(entry?.name || '').trim(),
      artist: String(entry?.artist?.name || entry?.artist || '').trim(),
      match: Number(entry?.match) || 0,
    }))
    .filter((entry: LastFmTrack) => !!entry.name && !!entry.artist)
    .sort((a: LastFmTrack, b: LastFmTrack) => b.match - a.match);
}

async function fetchTrackTags(artist: string, title: string): Promise<LastFmTag[]> {
  const key = `${normalizeDiscoveryText(artist)}|${normalizeDiscoveryText(title)}`;
  const cached = tagCache.get(key);
  if (cached && Date.now() - cached.at < LASTFM_CACHE_TTL_MS) return cached.tags;
  const data = await lastFmRequest('track.getTopTags', { artist, track: title });
  const entries = data?.toptags?.tag;
  const tags = Array.isArray(entries)
    ? entries
        .map((entry: any) => ({
          name: String(entry?.name || '').trim(),
          count: Number(entry?.count) || 0,
        }))
        .filter((entry: LastFmTag) => !!entry.name && isGenreTag(entry.name))
        .slice(0, 12)
    : [];
  tagCache.set(key, { tags, at: Date.now() });
  return tags;
}

function candidateKey(candidate: LastFmTrack): string {
  return `${normalizeDiscoveryText(candidate.artist)}|${normalizeDiscoveryText(candidate.name)}`;
}

function sampleSeeds(tracks: Track[], limit = 6): Track[] {
  if (tracks.length <= limit) return tracks;
  const sampled: Track[] = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(tracks[Math.round((index * (tracks.length - 1)) / (limit - 1))]);
  }
  return sampled;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await task(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function seedTagWeights(
  tagSets: LastFmTag[][],
  blockedNames: Set<string>,
): Map<string, { label: string; weight: number }> {
  const weights = new Map<string, { label: string; weight: number }>();
  for (const tags of tagSets) {
    for (const tag of tags) {
      const key = normalizeDiscoveryText(tag.name);
      if (!key || blockedNames.has(key)) continue;
      const existing = weights.get(key);
      const weight = Math.log10(tag.count + 1) + 1;
      if (existing) existing.weight += weight;
      else weights.set(key, { label: tag.name, weight });
    }
  }
  return weights;
}

function warningText(warnings: string[]): string {
  return warnings.filter(Boolean).join(' ');
}

export async function buildSmartMix(
  seed: SmartMixSeed,
  rule: SmartMixRule,
  requested = 24,
): Promise<SmartMixResult> {
  const warnings: string[] = [];
  const allSeedTracks = seed.kind === 'track'
    ? [seed.track]
    : (await fetchPlaylist(seed.playlist.id))?.songs || [];
  if (!allSeedTracks.length) {
    throw new Error('This seed has no tracks to build a mix from.');
  }
  const seedTracks = sampleSeeds(allSeedTracks);
  const seedIds = new Set(allSeedTracks.map((track) => track.id));

  const [similarResults, seedTagSets] = await Promise.all([
    Promise.all(seedTracks.map((track) => fetchSimilarTracks(track.artist, track.title))),
    Promise.all(seedTracks.map((track) => fetchTrackTags(track.artist, track.title))),
  ]);

  const aggregates = new Map<string, CandidateAggregate>();
  similarResults.forEach((results, seedIndex) => {
    for (const candidate of results) {
      const key = candidateKey(candidate);
      const existing = aggregates.get(key);
      if (existing) {
        existing.weight += candidate.match;
        existing.seedHits.add(seedIndex);
      } else {
        aggregates.set(key, {
          candidate,
          weight: candidate.match,
          seedHits: new Set([seedIndex]),
        });
      }
    }
  });

  const rankedCandidates = [...aggregates.values()]
    .sort((a, b) => b.seedHits.size - a.seedHits.size || b.weight - a.weight)
    .slice(0, 60);

  const matches = await mapLimit(rankedCandidates, 3, async (aggregate) => ({
    aggregate,
    track: await findLibraryTrack(aggregate.candidate),
  }));

  const seen = new Set<string>();
  let missingCandidates = 0;
  const matched: Array<{
    aggregate: CandidateAggregate;
    track: Track;
    tags: LastFmTag[];
  }> = [];

  for (const match of matches) {
    if (!match.track || seedIds.has(match.track.id) || seen.has(match.track.id)) {
      if (!match.track) missingCandidates += 1;
      continue;
    }
    seen.add(match.track.id);
    matched.push({ ...match, track: match.track, tags: [] });
  }

  const tagSets = await mapLimit(matched, 3, async (entry) =>
    fetchTrackTags(entry.aggregate.candidate.artist, entry.aggregate.candidate.name),
  );
  const blockedSeedNames = new Set(
    seedTracks.flatMap((track) => [
      normalizeDiscoveryText(track.artist),
      normalizeDiscoveryText(track.title),
      normalizeDiscoveryText(track.album),
    ]),
  );
  const seedTags = seedTagWeights(seedTagSets, blockedSeedNames);
  const candidates: SmartMixCandidate[] = matched.map((entry, index) => {
    const sharedTags: Array<{ label: string; weight: number }> = [];
    for (const tag of tagSets[index]) {
      const seedTag = seedTags.get(normalizeDiscoveryText(tag.name));
      if (seedTag) sharedTags.push(seedTag);
    }
    sharedTags.sort((a, b) => b.weight - a.weight);
    const tagScore = sharedTags.reduce((sum, tag) => sum + tag.weight, 0);
    const score =
      entry.aggregate.weight +
      entry.aggregate.seedHits.size * 8 +
      tagScore * 3;
    return {
      track: entry.track,
      score,
      seedHits: entry.aggregate.seedHits.size,
      sharedTags: sharedTags.slice(0, 6).map((tag) => tag.label),
      weight: tagScore,
    };
  });

  let ordered = [...candidates];
  if (rule === 'tempo') {
    const genreMatched = candidates.filter((candidate) => candidate.sharedTags.length > 0);
    if (genreMatched.length >= Math.min(8, candidates.length)) {
      ordered = genreMatched;
      warnings.push('Candidates were filtered to tracks sharing Last.fm genre tags.');
    } else if (genreMatched.length > 0) {
      warnings.push('Only a few candidates shared Last.fm tags, so the mix includes additional close matches.');
    }
    ordered.sort((a, b) => {
      const aBpm = a.track.bpm || Number.POSITIVE_INFINITY;
      const bBpm = b.track.bpm || Number.POSITIVE_INFINITY;
      if (aBpm !== bBpm) return aBpm - bBpm;
      return b.score - a.score;
    });
    const missingBpm = ordered.slice(0, requested).filter((candidate) => !candidate.track.bpm).length;
    if (missingBpm > 0) {
      warnings.push(
        `${missingBpm} track${missingBpm === 1 ? '' : 's'} have no BPM metadata; tempo ordering used available BPM values.`,
      );
    }
    warnings.push('Last.fm does not provide energy scores, so this rule uses BPM and tag similarity.');
  } else {
    ordered.sort((a, b) => b.score - a.score);
  }

  const tracks = ordered.slice(0, requested).map((candidate) => candidate.track);
  if (!tracks.length) {
    warnings.push('Last.fm returned similar tracks, but none could be matched to your local library.');
  } else if (tracks.length < requested) {
    warnings.push(`Only ${tracks.length} of ${requested} requested tracks were matched in your library.`);
  }
  if (missingCandidates > 0) {
    warnings.push(
      `${missingCandidates} Last.fm candidate${missingCandidates === 1 ? ' was' : 's were'} not found in your library.`,
    );
  }
  if (seed.kind === 'playlist' && allSeedTracks.length > seedTracks.length) {
    warnings.push(
      `Used ${seedTracks.length} of ${allSeedTracks.length} playlist tracks as similarity seeds.`,
    );
  }

  const overallTags = [...seedTags.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map((tag) => tag.label);

  return {
    tracks,
    candidates: ordered.slice(0, requested),
    matched: tracks.length,
    missingCandidates,
    seedTracks: seedTracks.length,
    sharedTags: overallTags,
    warning: warningText(warnings),
  };
}
