/* Artwork caching service.
   Caches cover art URLs and extracted dominant colours deterministically.
   Avoids repeated requests for the same image. */

import { analyzeCover } from '../themes/themeEngine';

interface CacheEntry {
  url: string;
  timestamp: number;
}

const coverUrlCache = new Map<string, CacheEntry>();
const colourCache = new Map<string, { accent: string; timestamp: number }>();
const MAX_ENTRIES = 200;

function prune(map: Map<string, any>) {
  if (map.size <= MAX_ENTRIES) return;
  const keys = Array.from(map.keys()).slice(0, map.size - MAX_ENTRIES);
  for (const k of keys) map.delete(k);
}

export function getCoverUrl(serverUrl: string | null, id: string, size?: number): string | null {
  if (!serverUrl || !id) return null;
  const key = `${serverUrl}|${id}|${size || 0}`;
  const now = Date.now();
  const entry = coverUrlCache.get(key);
  if (entry && now - entry.timestamp < 5 * 60 * 1000) return entry.url;
  return null;
}

export function setCoverUrl(serverUrl: string | null, id: string, url: string, size?: number) {
  if (!serverUrl || !id) return;
  const key = `${serverUrl}|${id}|${size || 0}`;
  coverUrlCache.set(key, { url, timestamp: Date.now() });
  prune(coverUrlCache);
}

export async function extractCoverColour(imageUrl: string | null): Promise<string> {
  if (!imageUrl) return '#C8D879';
  const now = Date.now();
  const cached = colourCache.get(imageUrl);
  if (cached && now - cached.timestamp < 30 * 60 * 1000) return cached.accent;
  try {
    const { accent } = await analyzeCover(imageUrl);
    colourCache.set(imageUrl, { accent, timestamp: now });
    prune(colourCache);
    return accent;
  } catch {
    return '#C8D879';
  }
}

export function clearCoverCache() {
  coverUrlCache.clear();
  colourCache.clear();
}

