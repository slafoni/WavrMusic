import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { LyricsDocument, Track } from '../../../shared/models';
import { activeLyricIndex } from '../../../shared/lyrics';
import { store, useSettings } from '../state';
import { pushToast } from '../services/toastService';
import { useLyrics } from '../hooks/useLyrics';
import { Icon } from './Icon';
import { LyricLineContent } from './LyricLineContent';

function sourceLabel(lyrics: LyricsDocument): string {
  if (lyrics.source === 'lyrica') {
    const raw = (lyrics.provider || '').trim();
    if (!raw || raw.toLowerCase() === 'lyrica') return 'Lyrica';
    const provider = raw
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
    return provider.length > 28 ? 'Lyrica' : provider;
  }
  return 'Server';
}

function syncLabel(lyrics: LyricsDocument): string {
  if (lyrics.syncLevel === 'syllable') return 'Syllable sync';
  if (lyrics.syncLevel === 'word') return 'Word sync';
  if (lyrics.syncLevel === 'line') return 'Line sync';
  return 'Plain text';
}

function differsFromSource(value: string | undefined, source: string): boolean {
  return !!value && value.trim().toLocaleLowerCase() !== source.trim().toLocaleLowerCase();
}

const LYRICS_PREFS_KEY = 'wavr.lyrics.preferences.v1';

interface LyricsPreferences {
  fontSize: number;
  align: 'left' | 'center';
}

function loadLyricsPreferences(): LyricsPreferences {
  try {
    const raw = localStorage.getItem(LYRICS_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const size = Number(parsed?.fontSize);
      return {
        fontSize: Number.isFinite(size) ? Math.max(16, Math.min(40, size)) : 24,
        align: parsed?.align === 'center' ? 'center' : 'left',
      };
    }
  } catch {
    /* fall through */
  }
  return { fontSize: 24, align: 'left' };
}


export function LyricsView({
  track,
  currentTime,
  onSeek,
  forceCenter = false,
}: {
  track: Track | null;
  currentTime: number;
  onSeek?: (seconds: number) => void;
  forceCenter?: boolean;
}) {
  const settings = useSettings();
  const [retryKey, setRetryKey] = useState(0);
  const {
    lyrics,
    loading,
    onlineLoading,
    onlineFailed,
    failed,
    translationRequested,
    translationAvailable,
    romanizationRequested,
    romanizationAvailable,
  } = useLyrics(track, retryKey);
  const [preferences, setPreferences] = useState<LyricsPreferences>(loadLyricsPreferences);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = lyrics?.lines ?? [];
  const activeIndex = activeLyricIndex(lines, currentTime);

  useEffect(() => {
    try {
      localStorage.setItem(LYRICS_PREFS_KEY, JSON.stringify(preferences));
    } catch {
      /* preferences are optional */
    }
  }, [preferences]);

  const changeFontSize = (delta: number) => {
    setPreferences((current) => ({
      ...current,
      fontSize: Math.max(16, Math.min(40, current.fontSize + delta)),
    }));
  };

  const toggleAlignment = () => {
    setPreferences((current) => ({
      ...current,
      align: current.align === 'center' ? 'left' : 'center',
    }));
  };

  const lyricsClassName = `lyrics-view ${(forceCenter || preferences.align === 'center') ? 'centered' : ''}`;
  const lyricsStyle = { '--lyrics-font-size': `${preferences.fontSize}px` } as CSSProperties;


  useEffect(() => {
    if (activeIndex < 0) return;
    const container = scrollRef.current;
    const line = lineRefs.current[activeIndex];
    if (!container || !line) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const target =
      container.scrollTop +
      lineRect.top -
      containerRect.top -
      (container.clientHeight - lineRect.height) / 2;
    container.scrollTo({
      top: Math.max(0, target),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    const settle = window.setTimeout(() => {
      const current = lineRefs.current[activeIndex];
      const scroller = scrollRef.current;
      if (!current || !scroller) return;
      const nextRect = current.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const nextTarget =
        scroller.scrollTop +
        nextRect.top -
        scrollerRect.top -
        (scroller.clientHeight - nextRect.height) / 2;
      scroller.scrollTo({ top: Math.max(0, nextTarget), behavior: 'smooth' });
    }, 320);
    return () => window.clearTimeout(settle);
  }, [activeIndex]);

  if (!track) {
    return (
      <div className="lyrics-view">
        <div className="lyrics-empty">
          <div className="empty-subtitle" style={{ textAlign: 'center' }}>
            <Icon name="lyrics" size={40} />
            <div style={{ marginTop: 10 }}>Play a song to see its lyrics.</div>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !lyrics) {
    return (
      <div className="lyrics-view">
        <div className="loading-block" style={{ justifyContent: 'center', flex: 1 }}>
          <span className="spinner" /> Looking for lyrics…
        </div>
      </div>
    );
  }

  if (!lyrics) {
    return (
      <div className="lyrics-view">
        <div className="lyrics-empty">
          <div className="empty-subtitle" style={{ textAlign: 'center' }}>
            <Icon name="lyrics" size={40} />
            <div style={{ marginTop: 10 }}>
              {failed ? 'Lyrics could not be loaded.' : 'No lyrics are available for this track.'}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--md-sys-color-outline)' }}>
              {track.title} · {track.artist}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={lyricsClassName} style={lyricsStyle}>
      <div className="lyrics-status">
        <span className={`lyrics-source ${lyrics.source}`} title={lyrics.provider || sourceLabel(lyrics)}>
          {lyrics.source === 'lyrica' ? <span className="lyrics-live-dot" /> : null}
          {sourceLabel(lyrics)}
        </span>
        <span className="lyrics-sync">{syncLabel(lyrics)}</span>
        {translationRequested && !translationAvailable ? (
          <span className="lyrics-sync">Translation unavailable</span>
        ) : null}
        {romanizationRequested && !romanizationAvailable ? (
          <span className="lyrics-sync">Romanization unavailable</span>
        ) : null}
        {onlineLoading ? (
          <span className="lyrics-searching">
            <span className="lyrics-searching-dot" /> Searching live lyrics
          </span>
        ) : onlineFailed && lyrics.source === "server" ? (
          <button
            type="button"
            className="lyrics-retry"
            onClick={() => setRetryKey((key) => key + 1)}
            title="Retry live lyrics"
          >
            Lyrica unavailable · Retry
          </button>
        ) : null}
        <div className="lyrics-actions">
          <button
            type="button"
            className="lyrics-action"
            onClick={() => changeFontSize(-2)}
            aria-label="Decrease lyric text size"
            title="Smaller lyrics"
          >
            A-
          </button>
          <button
            type="button"
            className="lyrics-action"
            onClick={() => changeFontSize(2)}
            aria-label="Increase lyric text size"
            title="Larger lyrics"
          >
            A+
          </button>
          <button
            type="button"
            className={`lyrics-action lyrics-extra-action ${settings.lyricsTranslation ? 'active' : ''}`}
            onClick={() => store.updateSettings({ lyricsTranslation: !settings.lyricsTranslation })}
            aria-pressed={!!settings.lyricsTranslation}
            aria-label="Toggle lyric translation"
            title="Translate lyrics"
          >
            T
          </button>
          <button
            type="button"
            className={`lyrics-action lyrics-extra-action ${settings.lyricsRomanization ? 'active' : ''}`}
            onClick={() => store.updateSettings({ lyricsRomanization: !settings.lyricsRomanization })}
            aria-pressed={!!settings.lyricsRomanization}
            aria-label="Toggle lyric romanization"
            title="Romanize lyrics"
          >
            R
          </button>
          {!forceCenter && (
            <button
              type="button"
              className="lyrics-action"
              onClick={toggleAlignment}
              aria-label={preferences.align === "center" ? "Align lyrics left" : "Center lyrics"}
              title={preferences.align === "center" ? "Align left" : "Center"}
            >
              <Icon name={preferences.align === "center" ? "format_align_center" : "format_align_left"} size={16} />
            </button>
          )}
        </div>
      </div>

      {lines.length > 0 ? (
        <div className="ep-lyrics-scroll" ref={scrollRef}>
          {lines.map((line, index) => (
            <button
              key={`${line.time}-${index}`}
              ref={(element) => {
                lineRefs.current[index] = element;
              }}
              className={`lyric-line ${index === activeIndex ? 'active' : index < activeIndex ? 'past' : 'future'}`}
              onClick={() => {
                if (onSeek) onSeek(line.time);
                else pushToast('Playback is not available.');
              }}
              title="Jump to this line"
              aria-current={index === activeIndex ? 'true' : undefined}
            >
              <span className="lyric-line-text">
                <LyricLineContent line={line} currentTime={currentTime} active={index === activeIndex} />
                {settings.lyricsRomanization && differsFromSource(line.romanization, line.text) ? (
                  <span className="lyric-secondary lyric-romanization" dir="auto">{line.romanization}</span>
                ) : null}
                {settings.lyricsTranslation && differsFromSource(line.translation, line.text) ? (
                  <span className="lyric-secondary lyric-translation" dir="auto">{line.translation}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ep-lyrics-scroll" ref={scrollRef}>
          <div className="lyric-plain">
            {lyrics.plain}
            {settings.lyricsRomanization && differsFromSource(lyrics.romanizedPlain, lyrics.plain) ? (
              <div className="lyric-plain-extra" dir="auto">{lyrics.romanizedPlain}</div>
            ) : null}
            {settings.lyricsTranslation && differsFromSource(lyrics.translatedPlain, lyrics.plain) ? (
              <div className="lyric-plain-extra" dir="auto">{lyrics.translatedPlain}</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}









