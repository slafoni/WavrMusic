import { describe, it, expect } from 'vitest';
import type { LyricsDocument } from '../../shared/models';
import { activeLyricIndex, lyricWordsWithText, mergeLyricsExtras, parseLrc, pickBestLyrics } from '../../shared/lyrics';
import {
  mapLrcmuxResponse,
  mapLyricaResponse,
  mapLyricaTrack,
  resolveLyricaBaseUrl,
} from '../../src/renderer/services/lyricsService';
import {
  libraryTrackMatches,
  mapLastFmSimilarArtists,
  mapLastFmSimilarTracks,
  mapLastFmUserArtists,
  mapLastFmUserTracks,
  mapLastFmLovedTracks,
  normalizeDiscoveryText,
} from '../../src/renderer/services/discoveryService';

function doc(overrides: Partial<LyricsDocument>): LyricsDocument {
  return {
    source: 'server',
    provider: 'Server',
    syncLevel: 'line',
    lines: [],
    plain: '',
    ...overrides,
  };
}

describe('lyrics parsing', () => {
  it('parses multiple timestamps and LRC fractions', () => {
    const lines = parseLrc('[00:01.50][00:03.000]Hello\n[01:02.25]World');
    expect(lines).toHaveLength(3);
    expect(lines[0].time).toBe(1.5);
    expect(lines[1].time).toBe(3);
    expect(lines[1].end).toBe(62.25);
    expect(activeLyricIndex(lines, 1.6)).toBe(0);
    expect(activeLyricIndex(lines, 62.3)).toBe(2);
  });

  it('chooses the higher sync level regardless of arrival order', () => {
    const line = doc({ syncLevel: 'line', lines: [{ time: 0, text: 'line' }] });
    const word = doc({ source: 'lyrica', syncLevel: 'word', lines: [{ time: 0, text: 'word' }] });
    expect(pickBestLyrics(line, word)).toBe(word);
    expect(pickBestLyrics(word, line)).toBe(word);
  });

  it('prefers Lyrica when both candidates have the same sync level', () => {
    const server = doc({ syncLevel: 'plain', plain: 'server' });
    const online = doc({ source: 'lyrica', syncLevel: 'plain', plain: 'online' });
    expect(pickBestLyrics(server, online)).toBe(online);
  });

  it('merges line-level translation and romanization into word-synced lyrics', () => {
    const word = doc({
      source: 'lyrica',
      syncLevel: 'word',
      lines: [
        { time: 10, text: 'foreign line', words: [{ text: 'foreign', start: 10, end: 11 }, { text: ' line', start: 11, end: 12 }] },
      ],
    });
    const translated = doc({
      source: 'lyrica',
      syncLevel: 'line',
      lines: [{ time: 10.05, text: 'foreign line', translation: 'English line', romanization: 'foreign line' }],
    });
    const merged = mergeLyricsExtras(word, [translated]);
    expect(merged?.syncLevel).toBe('word');
    expect(merged?.lines[0].translation).toBe('English line');
    expect(merged?.lines[0].romanization).toBe('foreign line');
    expect(merged?.lines[0].words).toHaveLength(2);
  });
});

describe('Lyrica mapping', () => {
  it('maps word-level milliseconds to seconds', () => {
    const result = mapLyricaTrack({
      source: 'lrcmux',
      sync_level: 'word',
      timed_lyrics: [
        {
          id: 'lrc_0',
          text: 'Look at the stars',
          start_time: 36189,
          end_time: 37719,
          words: [
            { text: 'Look', start: 36189, end: 36546 },
            { text: ' ', start: 36546, end: 36806 },
            { text: 'at', start: 36806, end: 36833 },
          ],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.syncLevel).toBe('word');
    expect(result?.provider).toBe('lrcmux');
    expect(result?.lines[0].time).toBeCloseTo(36.189, 3);
    expect(result?.lines[0].end).toBeCloseTo(37.719, 3);
    expect(result?.lines[0].words).toHaveLength(3);
  });

  it('flattens syllables when Apple Music provides them', () => {
    const result = mapLyricaResponse({
      data: {
        source: 'apple_music',
        sync_level: 'syllable',
        timed_lyrics: [
          {
            text: 'Looking',
            start_time: 1000,
            end_time: 2000,
            words: [
              {
                text: 'Looking',
                start: 1000,
                end: 2000,
                syllables: [
                  { text: 'Look', start: 1000, end: 1300 },
                  { text: 'ing', start: 1300, end: 2000 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result?.syncLevel).toBe('syllable');
    expect(result?.lines[0].words).toHaveLength(2);
    expect(result?.lines[0].words?.[0].start).toBe(1);
    expect(result?.lines[0].translation).toBeUndefined();
  });

  it('maps translated and romanized timed lines', () => {
    const result = mapLyricaResponse({
      data: {
        source: 'lrclib',
        timed_lyrics: [
          {
            text: 'Tum hi ho',
            start_time: 1000,
            end_time: 2000,
            translated: 'You are my everything',
            romanized: 'Tum hi ho',
          },
        ],
      },
    });
    expect(result?.lines[0].translation).toBe('You are my everything');
    expect(result?.lines[0].romanization).toBe('Tum hi ho');
  });

  it('maps direct Lrcmux word timings', () => {
    const result = mapLrcmuxResponse({
      meta: { source: { name: 'KuGou' }, level: 'word' },
      lines: [
        {
          text: 'Look at the stars',
          start: 33580,
          end: 35700,
          words: [
            { text: 'Look ', start: 33580, end: 33870 },
            { text: 'at ', start: 33870, end: 34160 },
            { text: 'the ', start: 34160, end: 34500 },
            { text: 'stars', start: 34500, end: 35700 },
          ],
        },
      ],
    });
    expect(result?.syncLevel).toBe('word');
    expect(result?.provider).toBe('Lrcmux / KuGou');
    expect(result?.lines[0].time).toBeCloseTo(33.58, 3);
    expect(result?.lines[0].words).toHaveLength(4);
  });

  it('uses line-level timed lyrics as a fallback', () => {
    const result = mapLyricaResponse({
      data: {
        source: 'lrclib',
        sync_level: 'line',
        hasTimestamps: true,
        timed_lyrics: [{ text: 'Look at the stars', start_time: 32470, end_time: 36650 }],
      },
    });
    expect(result?.syncLevel).toBe('line');
    expect(result?.lines[0].time).toBeCloseTo(32.47, 3);
    expect(result?.lines[0].words).toBeUndefined();
  });

  it('maps plain lyrics with translation', () => {
    const result = mapLyricaResponse({
      data: {
        source: 'genius',
        hasTimestamps: false,
        lyrics: 'A plain lyric line',
        translated_lyrics: 'A translated line',
        romanized_lyrics: 'A romanized line',
      },
    });
    expect(result?.syncLevel).toBe('plain');
    expect(result?.plain).toBe('A plain lyric line');
    expect(result?.translatedPlain).toBe('A translated line');
    expect(result?.romanizedPlain).toBe('A romanized line');
  });

  it('uses the official Lyrica instance by default', () => {
    expect(resolveLyricaBaseUrl('official', '')).toContain('test-0k.onrender.com');
    expect(resolveLyricaBaseUrl('community', 'http://localhost:9999/lyrics')).toBe('http://localhost:9999');
    expect(resolveLyricaBaseUrl('community', '')).toContain('test-0k.onrender.com');
  });
});

describe('Lyric word rendering', () => {
  it('keeps punctuation attached to the word it follows', () => {
    const words = lyricWordsWithText({
      time: 0,
      text: 'Hello, world!',
      words: [
        { text: 'Hello', start: 0, end: 1 },
        { text: 'world', start: 1, end: 2 },
      ],
    });
    expect(words.map((word) => word.text)).toEqual(['Hello, ', 'world!']);
    expect(words[1].end).toBe(2);
  });

  it('preserves the complete lyric line when rebuilding timed words', () => {
    const line = {
      time: 0,
      text: 'We are the champions, my friend',
      words: [
        { text: 'We', start: 0, end: 0.2 },
        { text: 'are', start: 0.2, end: 0.4 },
        { text: 'the', start: 0.4, end: 0.5 },
        { text: 'champions', start: 0.5, end: 1 },
        { text: 'my', start: 1, end: 1.2 },
        { text: 'friend', start: 1.2, end: 1.6 },
      ],
    };
    expect(lyricWordsWithText(line).map((word) => word.text).join('')).toBe(line.text);
  });
});

describe('Discovery matching', () => {
  it('parses Last.fm similar artists and tracks', () => {
    const artists = mapLastFmSimilarArtists({
      similarartists: { artist: [{ name: 'Keane', match: '0.9' }, { name: 'Travis', match: '0.4' }] },
    });
    expect(artists[0]).toEqual({ name: 'Keane', match: 0.9 });
    const tracks = mapLastFmSimilarTracks({
      similartracks: { track: [{ name: 'Somewhere Only We Know', artist: { name: 'Keane' }, match: '0.8' }] },
    });
    expect(tracks[0]).toEqual({ name: 'Somewhere Only We Know', artist: 'Keane', match: 0.8 });
  });

  it('parses the signed-in listener history', () => {
    const artists = mapLastFmUserArtists({
      topartists: { artist: [{ name: 'Keane', playcount: '42' }] },
    });
    expect(artists[0]).toEqual({ name: 'Keane', playcount: 42 });
    const topTracks = mapLastFmUserTracks({
      toptracks: { track: [{ name: 'Somewhere Only We Know', artist: { name: 'Keane' }, playcount: '18' }] },
    });
    expect(topTracks[0]).toEqual({ name: 'Somewhere Only We Know', artist: 'Keane', playcount: 18 });
    const lovedTracks = mapLastFmLovedTracks({
      lovedtracks: { track: [{ name: 'Yellow', artist: { name: 'Coldplay' } }] },
    });
    expect(lovedTracks[0]).toEqual({ name: 'Yellow', artist: 'Coldplay', playcount: 0 });
  });

  it('validates Last.fm candidates against library tracks', () => {
    const libraryTrack = {
      id: '1',
      title: 'Somewhere Only We Know',
      artist: 'Keane',
      album: 'Hopes and Fears',
      duration: 225,
    };
    expect(normalizeDiscoveryText('Keane (UK)')).toBe('keane');
    expect(libraryTrackMatches({ name: 'Somewhere Only We Know', artist: 'Keane' }, libraryTrack)).toBe(true);
    expect(libraryTrackMatches({ name: 'Yellow', artist: 'Coldplay' }, libraryTrack)).toBe(false);
  });
});
