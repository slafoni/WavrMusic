import { net } from 'electron';

const MUSICBRAINZ_USER_AGENT = 'WAVR/1.0 (https://listenwavr.xyz)';
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;

const mbidCache = new Map<string, { value: string; at: number }>();
const imageCache = new Map<string, { value: string; at: number }>();

function normalizeName(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function pruneCache<T>(cache: Map<string, { value: T; at: number }>) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at > CACHE_TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchJson(url: string, extraHeaders: Record<string, string> = {}): Promise<any> {
  const response = await net.fetch(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      response.status === 401 || response.status === 403
        ? 'The fanart.tv API key is invalid.'
        : `fanart.tv returned HTTP ${response.status}.`,
    );
    (error as any).status = response.status;
    throw error;
  }
  return data;
}

async function resolveMusicBrainzId(name: string, supplied: string): Promise<string> {
  const direct = String(supplied || '').trim();
  if (MBID_PATTERN.test(direct)) return direct;

  const normalized = normalizeName(name);
  if (!normalized) return '';
  const cached = mbidCache.get(normalized);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const query = encodeURIComponent(`artist:"${name}"`);
  const data = await fetchJson(
    `https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=8`,
    { 'user-agent': MUSICBRAINZ_USER_AGENT },
  );
  const artists = Array.isArray(data?.artists) ? data.artists : [];
  let best = '';
  let bestScore = -1;
  for (const artist of artists) {
    const id = String(artist?.id || '').trim();
    if (!MBID_PATTERN.test(id)) continue;
    const candidateName = normalizeName(String(artist?.name || ''));
    const score = Number(artist?.score) || 0;
    const exact = candidateName === normalized ? 1000 : 0;
    const alias = Array.isArray(artist?.aliases)
      ? artist.aliases.some((entry: any) => normalizeName(String(entry?.name || '')) === normalized)
      : false;
    const total = exact + (alias ? 200 : 0) + score;
    if (total > bestScore) {
      best = id;
      bestScore = total;
    }
  }
  mbidCache.set(normalized, { value: best, at: Date.now() });
  pruneCache(mbidCache);
  return best;
}

export async function fetchFanartArtistBanner(payload: {
  artistName?: string;
  musicBrainzId?: string;
  apiKey?: string;
}): Promise<{ url: string; musicBrainzId: string }> {
  const apiKey = String(payload?.apiKey || '').trim();
  if (!apiKey) return { url: '', musicBrainzId: '' };
  const name = String(payload?.artistName || '').trim();
  const musicBrainzId = await resolveMusicBrainzId(name, String(payload?.musicBrainzId || ''));
  if (!musicBrainzId) return { url: '', musicBrainzId: '' };

  const cached = imageCache.get(musicBrainzId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { url: cached.value, musicBrainzId };
  }

  const data = await fetchJson(
    `https://webservice.fanart.tv/v3/music/${encodeURIComponent(musicBrainzId)}?api_key=${encodeURIComponent(apiKey)}`,
  );
  const banners = (Array.isArray(data?.musicbanner) ? data.musicbanner : [])
    .filter((entry: any) => entry?.url);
  banners.sort((left: any, right: any) => {
    const language = (entry: any) => (String(entry?.lang || '').toLowerCase() === 'en' ? 1 : 0);
    return language(right) - language(left) || (Number(right?.likes) || 0) - (Number(left?.likes) || 0);
  });
  const url = String(banners[0]?.url || '');
  imageCache.set(musicBrainzId, { value: url, at: Date.now() });
  pruneCache(imageCache);
  return { url, musicBrainzId };
}
