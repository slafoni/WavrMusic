import type { LyricLine, LyricSyncLevel, LyricWord, LyricsDocument } from './models';

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(TIMESTAMP)];
    if (!stamps.length) continue;
    const content = rawLine.replace(/\[[^\]]*\]/g, '').trim();
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]) || 0;
      const seconds = Number(stamp[2]) || 0;
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text: content });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  for (let i = 0; i < lines.length; i += 1) {
    const next = lines[i + 1];
    if (next) lines[i].end = next.time;
  }
  return lines;
}

const SYNC_RANK: Record<LyricSyncLevel, number> = {
  plain: 0,
  line: 1,
  word: 2,
  syllable: 3,
};

export function lyricSyncRank(level: LyricSyncLevel): number {
  return SYNC_RANK[level] ?? 0;
}

export function pickBestLyrics(
  first: LyricsDocument | null,
  second: LyricsDocument | null,
): LyricsDocument | null {
  if (!first) return second;
  if (!second) return first;
  const firstRank = lyricSyncRank(first.syncLevel);
  const secondRank = lyricSyncRank(second.syncLevel);
  if (firstRank > secondRank) return first;
  if (secondRank > firstRank) return second;
  if (first.source === 'lyrica' && second.source !== 'lyrica') return first;
  return second;
}

export function hasLyricExtras(document: LyricsDocument | null): boolean {
  if (!document) return false;
  return (
    document.lines.some((line) => !!line.translation || !!line.romanization) ||
    !!document.translatedPlain ||
    !!document.romanizedPlain
  );
}

export function mergeLyricsExtras(
  primary: LyricsDocument | null,
  supplements: Array<LyricsDocument | null>,
): LyricsDocument | null {
  if (!primary) return null;
  const extras = supplements.filter(
    (document): document is LyricsDocument => !!document && hasLyricExtras(document),
  );
  if (!extras.length) return primary;

  const lines = primary.lines.map((line, index) => {
    let translation = line.translation;
    let romanization = line.romanization;
    let bestDelta = Number.POSITIVE_INFINITY;
    let bestIndexed: (typeof extras)[number]['lines'][number] | null = null;

    for (const document of extras) {
      const indexed = document.lines.length === primary.lines.length ? document.lines[index] : null;
      if (indexed && !bestIndexed) bestIndexed = indexed;
      for (const candidate of document.lines) {
        if (!candidate.translation && !candidate.romanization) continue;
        const delta = Math.abs(candidate.time - line.time);
        if (delta < bestDelta) {
          bestDelta = delta;
          if (!translation) translation = candidate.translation;
          if (!romanization) romanization = candidate.romanization;
        }
      }
    }

    if ((!translation || !romanization) && bestIndexed) {
      if (!translation) translation = bestIndexed.translation;
      if (!romanization) romanization = bestIndexed.romanization;
    }

    return {
      ...line,
      ...(translation ? { translation } : {}),
      ...(romanization ? { romanization } : {}),
    };
  });

  const translatedPlain =
    primary.translatedPlain || extras.find((document) => document.translatedPlain)?.translatedPlain;
  const romanizedPlain =
    primary.romanizedPlain || extras.find((document) => document.romanizedPlain)?.romanizedPlain;

  return {
    ...primary,
    lines,
    ...(translatedPlain ? { translatedPlain } : {}),
    ...(romanizedPlain ? { romanizedPlain } : {}),
  };
}

export function activeLyricIndex(lines: LyricLine[], currentTime: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTime + 0.12) active = i;
    else break;
  }
  return active;
}

export function lyricLineProgress(line: LyricLine | undefined, currentTime: number): number {
  if (!line) return 0;
  const end = line.end ?? line.time + 4;
  const span = Math.max(0.1, end - line.time);
  return Math.max(0, Math.min(1, (currentTime - line.time) / span));
}

export function lyricWordsWithText(line: LyricLine): LyricWord[] {
  const words = line.words || [];
  if (!words.length) return [];
  const text = line.text || '';
  const segments: LyricWord[] = [];
  let cursor = 0;
  let leadingGap = '';

  for (const word of words) {
    const at = text.indexOf(word.text, cursor);
    if (at < 0) {
      segments.push({ ...word });
      continue;
    }
    const gap = text.slice(cursor, at);
    if (gap) {
      if (segments.length) segments[segments.length - 1] = {
        ...segments[segments.length - 1],
        text: segments[segments.length - 1].text + gap,
      };
      else leadingGap = gap;
    }
    segments.push({
      ...word,
      text: leadingGap + word.text,
    });
    leadingGap = '';
    cursor = at + word.text.length;
  }

  if (cursor < text.length && segments.length) {
    segments[segments.length - 1] = {
      ...segments[segments.length - 1],
      text: segments[segments.length - 1].text + text.slice(cursor),
    };
  }
  return segments;
}

