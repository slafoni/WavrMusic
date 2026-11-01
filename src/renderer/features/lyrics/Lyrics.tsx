import { usePlayback } from '../../state';
import { coverArtUrl } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { LyricsView } from '../../components/LyricsView';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { store } from '../../state';
import { go } from '../../app/routes';

export function LyricsPage() {
  const { track, currentTime } = usePlayback();

  if (!track) {
    return (
      <EmptyState
        icon={<Icon name="lyrics" size={64} />}
        title="Nothing playing"
        subtitle="Start a song to see its lyrics here."
        action={<Button variant="primary" icon="home" label="Browse library" onClick={() => store.setNavigation(go.home())} />}
      />
    );
  }

  return (
    <div className="lyrics-page">
      <div className="lyrics-page-head">
        <div className="lyrics-page-track">
          <Artwork src={coverArtUrl(track.coverArt, 240) || null} size={72} radius="medium" alt={track.title} />
          <div className="lyrics-page-info">
            <div className="resume-eyebrow">Lyrics</div>
            <button
              type="button"
              className="lyrics-page-title link-button"
              onClick={() => openTrackDetails(track)}
            >
              {track.title}
            </button>
            <div className="page-subtitle">
              <button
                type="button"
                className="link-button"
                disabled={!track.artistId}
                onClick={() => {
                  if (track.artistId) store.setNavigation(go.artist(track.artistId));
                }}
              >
                {track.artist}
              </button>
              <span> / </span>
              <button
                type="button"
                className="link-button muted"
                disabled={!track.albumId}
                onClick={() => {
                  if (track.albumId) store.setNavigation(go.album(track.albumId));
                }}
              >
                {track.album}
              </button>
            </div>
          </div>
        </div>
        <Button variant="surface" icon="fullscreen" label="Now playing" onClick={() => store.setNavigation(go.player())} />
      </div>

      <div className="lyrics-page-body">
        <LyricsView track={track} currentTime={currentTime} onSeek={(seconds) => playback.seek(seconds)} />
      </div>
    </div>
  );
}
