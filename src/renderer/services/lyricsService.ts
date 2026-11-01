import type {
  LyricLine,
  LyricSyncLevel,
  LyricWord,
  LyricsDocument,
  Track,
} from '../../../shared/models';
import { LRCMUX_API_URL, LRCMUX_TIMEOUT_MS, LYRICA_API_BASE, LYRICA_TIMEOUT_MS } from '../../../shared/constants';
import { parseLrc } from '../../../shared/lyrics';
import { fetchLyrics } from './serverService';

type RawWord = {
  text?: string;
  start?: number;
  end?: number;
  syllables?: RawWord[];
};

type RawLine = {
  id?: string;
  text?: string;
  start_time?: number;
  end_time?: number;
  words?: RawWord[];
  translated?: string;
  romanized?: string;
};

type RawData = {
  source?: string;
  sync_level?: string;
  lyrics?: string;
  translated_lyrics?: string;
  romanized_lyrics?: string;
  hasTimestamps?: boolean;
  timed_lyrics?: RawLine[];
  artist?: string;
  title?: string;
  album?: string;
  duration?: number;
};

export interface LyricaRequestOptions {
  baseUrl?: string;
  translate?: boolean;
  romanize?: boolean;
  language?: string;
}

const lyricaCache = new Map<string, Promise<LyricsDocument | null>>();
const lrcmuxCache = new Map<string, Promise<LyricsDocument | null>>();
const serverCache = new Map<string, Promise<LyricsDocument | null>>();

export function normalizeLyricaBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/lyrics\/?$/i, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function resolveLyricaBaseUrl(mode: string | undefined, communityUrl: string | undefined): string {
  if (mode === 'community') {
    const normalized = normalizeLyricaBaseUrl(communityUrl || '');
    if (normalized) return normalized;
  }
  return LYRICA_API_BASE;
}

function trackKey(track: Track): string {
  return [track.id, track.title, track.artist, track.album, Math.round(track.duration || 0)].join('|');
}

function lyricaKey(track: Track, options: LyricaRequestOptions): string {
  return [
    trackKey(track),
    options.baseUrl || LYRICA_API_BASE,
    options.translate ? 'translate' : '',
    options.romanize ? 'romanize' : '',
    options.language || 'en',
  ].join('|');
}

function cached(
  cache: Map<string, Promise<LyricsDocument | null>>,
  key: string,
  load: () => Promise<LyricsDocument | null>,
): Promise<LyricsDocument | null> {
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = load().catch(() => null);
  cache.set(key, promise);
  promise.then((result) => {
    if (!result) {
      setTimeout(() => {
        if (cache.get(key) === promise) cache.delete(key);
      }, 15000);
    }
  });
  return promise;
}

function toSeconds(value: unknown): number {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds / 1000) : 0;
}

function mapWord(raw: RawWord, includeSyllables: boolean): LyricWord[] {
  const text = String(raw.text ?? '');
  if (!text) return [];
  const start = toSeconds(raw.start);
  const end = toSeconds(raw.end);
  if (includeSyllables && Array.isArray(raw.syllables) && raw.syllables.length) {
    return raw.syllables
      .map((syllable) => {
        const syllableText = String(syllable.text ?? '');
        if (!syllableText) return null;
        const syllableStart = toSeconds(syllable.start);
        const syllableEnd = toSeconds(syllable.end);
        return {
          text: syllableText,
          start: syllableStart,
          end: syllableEnd > syllableStart ? syllableEnd : syllableStart + 0.08,
        };
      })
      .filter((entry): entry is LyricWord => !!entry);
  }
  return [{
    text,
    start,
    end: end > start ? end : start + Math.max(0.06, text.length * 0.045),
  }];
}

function normalizeSyncLevel(value: string | undefined): LyricSyncLevel | null {
  if (value === 'syllable' || value === 'word' || value === 'line' || value === 'plain') {
    return value;
  }
  return null;
}

export function mapLyricaTrack(raw: RawData): LyricsDocument | null {
  const timed = Array.isArray(raw.timed_lyrics) ? raw.timed_lyrics : [];
  const lines: LyricLine[] = [];
  let hasSyllables = false;
  let hasWords = false;

  for (const entry of timed) {
    const text = String(entry.text ?? '');
    const rawWords = Array.isArray(entry.words) ? entry.words : [];
    if (rawWords.some((word) => Array.isArray(word.syllables) && word.syllables.length)) {
      hasSyllables = true;
    }
    const words = rawWords.flatMap((word) => mapWord(word, true));
    if (words.length) hasWords = true;
    if (!text && !words.length) continue;
    const time = toSeconds(entry.start_time);
    const end = toSeconds(entry.end_time);
    lines.push({
      time,
      ...(end > time ? { end } : {}),
      text: text || words.map((word) => word.text).join(''),
      ...(words.length ? { words } : {}),
      ...(entry.translated ? { translation: String(entry.translated) } : {}),
      ...(entry.romanized ? { romanization: String(entry.romanized) } : {}),
    });
  }

  lines.sort((a, b) => a.time - b.time);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].end === undefined) {
      const next = lines[i + 1];
      if (next) lines[i].end = next.time;
    }
  }

  const plain = String(raw.lyrics ?? '').trim() || lines.map((line) => line.text).join('\n').trim();
  const declared = normalizeSyncLevel(raw.sync_level);
  let syncLevel: LyricSyncLevel;
  if (!lines.length) {
    syncLevel = 'plain';
  } else if (hasSyllables) {
    syncLevel = 'syllable';
  } else if (hasWords) {
    syncLevel = 'word';
  } else {
    syncLevel = declared === 'plain' ? 'plain' : 'line';
  }

  if (!lines.length && !plain) return null;

  return {
    source: 'lyrica',
    provider: raw.source ? String(raw.source) : 'Lyrica',
    syncLevel,
    lines,
    plain,
    ...(raw.translated_lyrics ? { translatedPlain: String(raw.translated_lyrics) } : {}),
    ...(raw.romanized_lyrics ? { romanizedPlain: String(raw.romanized_lyrics) } : {}),
  };
}

export function mapLyricaResponse(data: any): LyricsDocument | null {
  if (!data || typeof data !== 'object') return null;
  const payload: RawData = data.data && typeof data.data === 'object' ? data.data : data;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.hasTimestamps === false && payload.lyrics) {
    const plain = String(payload.lyrics).trim();
    if (!plain) return null;
    const lines = parseLrc(plain);
    return {
      source: 'lyrica',
      provider: payload.source ? String(payload.source) : 'Lyrica',
      syncLevel: lines.length ? 'line' : 'plain',
      lines,
      plain,
      ...(payload.translated_lyrics ? { translatedPlain: String(payload.translated_lyrics) } : {}),
      ...(payload.romanized_lyrics ? { romanizedPlain: String(payload.romanized_lyrics) } : {}),
    };
  }
  return mapLyricaTrack(payload);
}

export function fetchLyricaLyrics(
  track: Track,
  options: LyricaRequestOptions = {},
): Promise<LyricsDocument | null> {
  return cached(lyricaCache, lyricaKey(track, options), async () => {
    const baseUrl = options.baseUrl || LYRICA_API_BASE;
    const params = new URLSearchParams({
      artist: track.artist,
      song: track.title,
      timestamps: 'true',
      word: 'true',
      syllabus: 'true',
      fast: 'true',
      sequence: '8,7,2,3,1,4,5,6',
    });
    if (options.translate) params.set('translate', 'true');
    if (options.romanize) params.set('romanize', 'true');
    if (options.translate || options.romanize) params.set('language', options.language || 'en');

    const load = async (withAi: boolean): Promise<LyricsDocument | null> => {
      const requestParams = new URLSearchParams(params);
      if (!withAi) {
        requestParams.delete('translate');
        requestParams.delete('romanize');
        requestParams.delete('language');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LYRICA_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/lyrics/?${requestParams.toString()}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return null;
        return mapLyricaResponse(await response.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    };

    const result = await load(true);
    if (result || (!options.translate && !options.romanize)) return result;
    return load(false);
  });
}

type LrcmuxWord = {
  text?: string;
  start?: number;
  end?: number;
};

type LrcmuxLine = {
  text?: string;
  start?: number;
  end?: number;
  words?: LrcmuxWord[];
};

type LrcmuxResponse = {
  track?: { artist?: string; title?: string; album?: string; duration?: number };
  meta?: { level?: string; source?: { name?: string } };
  lines?: LrcmuxLine[];
};

export function mapLrcmuxResponse(data: LrcmuxResponse): LyricsDocument | null {
  const source = data.meta?.source?.name ? `Lrcmux / ${data.meta.source.name}` : 'Lrcmux';
  const lines: LyricLine[] = [];
  let hasWords = false;

  for (const entry of Array.isArray(data.lines) ? data.lines : []) {
    const text = String(entry.text ?? '');
    const words = (Array.isArray(entry.words) ? entry.words : [])
      .map((word) => {
        const wordText = String(word.text ?? '');
        if (!wordText) return null;
        const start = toSeconds(word.start);
        const end = toSeconds(word.end);
        return {
          text: wordText,
          start,
          end: end > start ? end : start + Math.max(0.06, wordText.length * 0.04),
        };
      })
      .filter((word): word is LyricWord => !!word);
    if (words.length) hasWords = true;
    if (!text && !words.length) continue;
    const time = toSeconds(entry.start);
    const end = toSeconds(entry.end);
    lines.push({
      time,
      ...(end > time ? { end } : {}),
      text: text || words.map((word) => word.text).join(''),
      ...(words.length ? { words } : {}),
    });
  }

  lines.sort((a, b) => a.time - b.time);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].end === undefined) {
      const next = lines[i + 1];
      if (next) lines[i].end = next.time;
    }
  }

  const plain = lines.map((line) => line.text).join('\n').trim();
  if (!lines.length && !plain) return null;

  return {
    source: 'lyrica',
    provider: source,
    syncLevel: hasWords ? 'word' : 'line',
    lines,
    plain,
  };
}

export function fetchLrcmuxLyrics(track: Track): Promise<LyricsDocument | null> {
  return cached(lrcmuxCache, trackKey(track), async () => {
    const params = new URLSearchParams({
      artist: track.artist,
      title: track.title,
      format: 'json',
      level: 'word',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LRCMUX_TIMEOUT_MS);
    try {
      const response = await fetch(`${LRCMUX_API_URL}/get?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      return mapLrcmuxResponse(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}
export function fetchServerLyricsDocument(track: Track): Promise<LyricsDocument | null> {
  return cached(serverCache, trackKey(track), async () => {
    const result = await fetchLyrics(track);
    const text = result?.text?.trim();
    if (!text) return null;
    const lines = result.synced ? parseLrc(text) : [];
    if (lines.length) {
      return {
        source: 'server',
        provider: 'Server',
        syncLevel: 'line',
        lines,
        plain: text,
      };
    }
    return {
      source: 'server',
      provider: 'Server',
      syncLevel: 'plain',
      lines: [],
      plain: text,
    };
  });
}

export function clearLyricaCacheFor(track: Track): void {
  const prefix = `${trackKey(track)}|`;
  for (const key of lyricaCache.keys()) {
    if (key === trackKey(track) || key.startsWith(prefix)) lyricaCache.delete(key);
  }
  lrcmuxCache.delete(trackKey(track));
}

export function clearLyricsCache(): void {
  lyricaCache.clear();
  lrcmuxCache.clear();
  serverCache.clear();
}





const MACHINE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MACHINE_TRANSLATE_TIMEOUT = 12000;

async function translateLineChunk(
  text: string,
  target: string,
  mode: 'translate' | 'romanize',
): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MACHINE_TRANSLATE_TIMEOUT);
  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: target,
      q: text,
    });
    params.append('dt', mode === 'romanize' ? 'rm' : 't');
    const response = await fetch(`${MACHINE_TRANSLATE_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    const segments = Array.isArray(data?.[0]) ? data[0] : [];
    let combined = '';
    for (const segment of segments) {
      const value = mode === 'romanize' ? segment?.[3] : segment?.[0];
      if (typeof value === 'string') combined += value;
    }
    return combined.replace(/\r/g, '').trimEnd().split('\n');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateLines(
  lines: string[],
  target: string,
  mode: 'translate' | 'romanize',
): Promise<Array<string | undefined>> {
  const result: Array<string | undefined> = new Array(lines.length);
  const chunks: Array<{ indexes: number[]; text: string }> = [];
  let indexes: number[] = [];
  let text = '';
  const flush = () => {
    if (indexes.length && text) chunks.push({ indexes, text });
    indexes = [];
    text = '';
  };
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    if (text && text.length + line.length + 1 > 1600) flush();
    indexes.push(index);
    text += `${text ? '\n' : ''}${line}`;
  });
  flush();

  await Promise.all(
    chunks.map(async (chunk) => {
      const translated = await translateLineChunk(chunk.text, target, mode);
      if (!translated || translated.length !== chunk.indexes.length) return;
      chunk.indexes.forEach((lineIndex, offset) => {
        result[lineIndex] = translated[offset];
      });
    }),
  );

  return result;
}

function isLatinText(value: string): boolean {
  const letters = value.match(/\p{L}/gu);
  if (!letters?.length) return true;
  return letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

export async function addMachineLyricsExtras(
  document: LyricsDocument,
  options: { translate?: boolean; romanize?: boolean; language?: string },
): Promise<LyricsDocument> {
  if (!options.translate && !options.romanize) return document;
  const centered = document.lines.length
    ? document.lines.map((line) => line.text)
    : document.plain.split(/\r?\n/);
  if (!centered.some((line) => line.trim())) return document;

  const hasTranslation = document.lines.length
    ? document.lines.some((line) => !!line.translation)
    : !!document.translatedPlain;
  const hasRomanization = document.lines.length
    ? document.lines.some((line) => !!line.romanization)
    : !!document.romanizedPlain;

  const [translations, romanizations] = await Promise.all([
    options.translate && !hasTranslation
      ? translateLines(centered, options.language || 'en', 'translate')
      : Promise.resolve([] as Array<string | undefined>),
    options.romanize && !hasRomanization
      ? translateLines(centered, 'en', 'romanize')
      : Promise.resolve([] as Array<string | undefined>),
  ]);

  if (document.lines.length) {
    const lines = document.lines.map((line, index) => {
      const romanization =
        romanizations[index] || (options.romanize && isLatinText(line.text) ? line.text : undefined);
      return {
        ...line,
        ...(translations[index] && !line.translation ? { translation: translations[index] } : {}),
        ...(romanization && !line.romanization ? { romanization } : {}),
      };
    });
    return { ...document, lines };
  }

  const allLatin = centered.every(isLatinText);
  const plainRomanization = romanizations.filter(Boolean).length
    ? romanizations.map((line) => line || '').join('\n').trim()
    : options.romanize && allLatin
      ? document.plain
      : '';

  return {
    ...document,
    ...(translations.filter(Boolean).length
      ? { translatedPlain: translations.map((line) => line || '').join('\n').trim() }
      : {}),
    ...(plainRomanization ? { romanizedPlain: plainRomanization } : {}),
  };
}