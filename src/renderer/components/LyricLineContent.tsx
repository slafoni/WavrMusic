import type { LyricLine } from '../../../shared/models';
import { lyricWordsWithText } from '../../../shared/lyrics';

export function LyricLineContent({
  line,
  currentTime,
  active,
}: {
  line: LyricLine;
  currentTime: number;
  active: boolean;
}) {
  const words = lyricWordsWithText(line);
  if (!words.length) {
    return <>{line.text || '♪'}</>;
  }
  return (
    <span className="lyric-words">
      {words.map((word, index) => {
        const sung = active && currentTime >= word.end;
        const singing = active && currentTime >= word.start && currentTime < word.end;
        return (
          <span
            key={`${word.start}-${index}`}
            className={`lyric-word ${sung ? 'sung' : ''} ${singing ? 'singing' : ''}`}
          >
            {word.text}
          </span>
        );
      })}
    </span>
  );
}
