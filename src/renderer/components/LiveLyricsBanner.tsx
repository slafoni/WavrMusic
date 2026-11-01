import type { Track } from '../../../shared/models';
import { activeLyricIndex } from '../../../shared/lyrics';
import { useLyrics } from '../hooks/useLyrics';
import { Icon } from './Icon';
import { LyricLineContent } from './LyricLineContent';

export function LiveLyricsBanner({
  track,
  currentTime,
  onOpenLyrics,
}: {
  track: Track | null;
  currentTime: number;
  onOpenLyrics: () => void;
}) {
  const { lyrics, onlineLoading } = useLyrics(track);
  if (!track || !lyrics?.lines.length) return null;

  const active = activeLyricIndex(lyrics.lines, currentTime);
  const line = lyrics.lines[Math.max(0, active)];
  if (!line) return null;

  const label =
    lyrics.syncLevel === 'syllable'
      ? 'Syllable'
      : lyrics.syncLevel === 'word'
        ? 'Word'
        : 'Line';

  return (
    <button className="ep-live-banner" onClick={onOpenLyrics} title="Open lyrics">
      <span className="ep-live-badge">
        <span className="ep-live-pulse" />
        Live · {label}
      </span>
      <span className="ep-live-text">
        <LyricLineContent line={line} currentTime={currentTime} active={active >= 0} />
      </span>
      {onlineLoading ? <span className="ep-live-searching">finding lyrics</span> : <Icon name="chevron_right" size={16} />}
    </button>
  );
}
