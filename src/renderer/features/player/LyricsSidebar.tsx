import { store, usePlayback } from '../../state';
import { playback } from '../../services/playbackService';
import { Button } from '../../components/Button';
import { LyricsView } from '../../components/LyricsView';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { go } from '../../app/routes';

export function LyricsSidebar({ onClose }: { onClose: () => void }) {
  const { track, currentTime } = usePlayback();
  if (!track) return null;

  return (
    <>
      <button
        className="drawer-backdrop lyrics-backdrop"
        aria-label="Close lyrics sidebar"
        onClick={onClose}
      />
      <aside className="lyrics-drawer" aria-label="Lyrics sidebar">
        <div className="lyrics-drawer-header">
          <div className="lyrics-drawer-heading">
            <div className="h3">Lyrics</div>
            <div className="settings-description">
              <button
                type="button"
                className="link-button"
                onClick={() => openTrackDetails(track)}
              >
                {track.title}
              </button>
              <span> / </span>
              <button
                type="button"
                className="link-button muted"
                disabled={!track.artistId}
                onClick={() => {
                  if (track.artistId) store.setNavigation(go.artist(track.artistId));
                }}
              >
                {track.artist}
              </button>
            </div>
          </div>
          <Button variant="icon" icon="close" title="Close lyrics" onClick={onClose} />
        </div>
        <div className="lyrics-drawer-body">
          <LyricsView
            track={track}
            currentTime={currentTime}
            onSeek={(seconds) => playback.seek(seconds)}
            forceCenter
          />
        </div>
      </aside>
    </>
  );
}
