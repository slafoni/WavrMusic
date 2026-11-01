import type { Album } from '../../../shared/models';
import { store } from '../state';
import { fetchAlbum, setAlbumStarred } from '../services/serverService';
import { playback } from '../services/playbackService';
import { pushToast } from '../services/toastService';
import { go } from '../app/routes';
import { showAlbumMenu } from '../services/mediaActions';
import { MediaCard } from './MediaCard';

export function AlbumCard({
  album,
  subtitle,
  badge,
  onOpen,
}: {
  album: Album;
  subtitle?: string;
  badge?: string;
  onOpen?: () => void;
}) {
  const play = async () => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.setShuffle(false);
      playback.playQueue(detail.songs, 0);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not start album playback.', 'error');
    }
  };

  const queue = async () => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.addToQueue(detail.songs);
      pushToast(`Added “${album.name}” to the queue.`, 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not add the album to the queue.', 'error');
    }
  };

  const star = async (next: boolean) => {
    try {
      await setAlbumStarred(album.id, next);
    } catch {
      pushToast('Could not update favourite.', 'error');
      throw new Error('favourite failed');
    }
  };

  return (
    <MediaCard
      title={album.name}
      subtitle={subtitle ?? album.artist}
      coverArt={album.coverArt}
      badge={badge}
      starred={album.starred}
      onClick={onOpen ?? (() => store.setNavigation(go.album(album.id)))}
      onSubtitleClick={
        (!subtitle || subtitle === album.artist) && album.artistId
          ? () => store.setNavigation(go.artist(album.artistId!))
          : undefined
      }
      onPlay={play}
      onQueue={queue}
      onToggleStar={star}
      onContextMenu={(event) => showAlbumMenu(event, album)}
    />
  );
}
