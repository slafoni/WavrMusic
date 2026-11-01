import type { Album, Artist, Track } from '../../../shared/models';
import { store } from '../state';
import { go } from '../app/routes';
import {
  createShareLink,
  fetchAlbum,
  fetchTopSongs,
  setTrackRating,
  setTrackStarred,
} from './serverService';
import { playback } from './playbackService';
import { pushToast } from './toastService';
import { openPlaylistPicker, openTrackDetails, openShareDialog } from '../components/MediaDialogHost';
import { openSmartMix } from '../components/SmartMixDialog';
import {
  showContextMenu,
  type ContextMenuItem,
} from '../components/ContextMenu';

interface MenuEvent {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface TrackMenuOptions {
  starred?: boolean;
  onToggleStar?: () => void | Promise<void>;
  onRemove?: () => void;
  removeLabel?: string;
}

async function albumSongs(album: Album): Promise<Track[]> {
  const detail = await fetchAlbum(album.id);
  if (!detail?.songs.length) throw new Error('This album has no playable tracks.');
  return detail.songs;
}

async function artistSongs(artist: Artist): Promise<Track[]> {
  const songs = await fetchTopSongs(artist.name, 100);
  if (!songs.length) throw new Error('No tracks were found for this artist.');
  return songs;
}

function playSongs(songs: Track[], shuffle = false) {
  playback.setShuffle(shuffle);
  playback.playQueue(songs, shuffle ? Math.floor(Math.random() * songs.length) : 0);
}

export async function shareTrack(track: Track): Promise<void> {
  try {
    const share = await createShareLink(
      [track.id],
      `WAVR: ${track.title} by ${track.artist}`,
    );
    openShareDialog({
      ...share,
      title: track.title,
      artist: track.artist,
    });
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not create a share link.', 'error');
  }
}

async function shuffleAlbum(album: Album) {
  try {
    playSongs(await albumSongs(album), true);
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not shuffle this album.', 'error');
  }
}

async function queueAlbum(album: Album) {
  try {
    const songs = await albumSongs(album);
    playback.addToQueue(songs);
    pushToast(`Added ${songs.length} track${songs.length === 1 ? '' : 's'} to the queue.`, 'success');
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not add the album to the queue.', 'error');
  }
}

async function addAlbumToPlaylist(album: Album) {
  try {
    openPlaylistPicker(await albumSongs(album), album.name);
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not load this album.', 'error');
  }
}

export function showAlbumMenu(event: MenuEvent, album: Album): void {
  showContextMenu(event, [
    {
      label: 'Play',
      icon: 'play_arrow',
      onClick: () => {
        void albumSongs(album)
          .then((songs) => playSongs(songs))
          .catch((reason) => pushToast(reason?.message || 'Could not play this album.', 'error'));
      },
    },
    {
      label: 'Shuffle',
      icon: 'shuffle',
      onClick: () => void shuffleAlbum(album),
    },
    {
      label: 'Add to queue',
      icon: 'queue_music',
      onClick: () => void queueAlbum(album),
    },
    {
      label: 'Add to playlist',
      icon: 'playlist_add',
      onClick: () => void addAlbumToPlaylist(album),
    },
    { separator: true },
    {
      label: 'View album',
      icon: 'album',
      onClick: () => store.setNavigation(go.album(album.id)),
    },
    {
      label: 'Go to artist',
      icon: 'person',
      disabled: !album.artistId,
      onClick: () => {
        if (album.artistId) store.setNavigation(go.artist(album.artistId));
      },
    },
  ]);
}

async function playArtist(artist: Artist, shuffle = false) {
  try {
    playSongs(await artistSongs(artist), shuffle);
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not play this artist.', 'error');
  }
}

async function queueArtist(artist: Artist) {
  try {
    const songs = await artistSongs(artist);
    playback.addToQueue(songs);
    pushToast(`Added ${songs.length} track${songs.length === 1 ? '' : 's'} to the queue.`, 'success');
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not add the artist to the queue.', 'error');
  }
}

async function addArtistToPlaylist(artist: Artist) {
  try {
    openPlaylistPicker(await artistSongs(artist), artist.name);
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not load this artist.', 'error');
  }
}

export function showArtistMenu(event: MenuEvent, artist: Artist): void {
  showContextMenu(event, [
    {
      label: 'Play',
      icon: 'play_arrow',
      onClick: () => void playArtist(artist),
    },
    {
      label: 'Shuffle',
      icon: 'shuffle',
      onClick: () => void playArtist(artist, true),
    },
    {
      label: 'Add to queue',
      icon: 'queue_music',
      onClick: () => void queueArtist(artist),
    },
    {
      label: 'Add to playlist',
      icon: 'playlist_add',
      onClick: () => void addArtistToPlaylist(artist),
    },
    { separator: true },
    {
      label: 'View artist',
      icon: 'person',
      onClick: () => store.setNavigation(go.artist(artist.id)),
    },
  ]);
}

async function setRating(track: Track, rating: number) {
  try {
    await setTrackRating(track.id, rating);
    pushToast(rating ? `Rated "${track.title}" ${rating} star${rating === 1 ? '' : 's'}.` : 'Rating cleared.');
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not update the rating.', 'error');
  }
}

async function toggleLike(track: Track) {
  try {
    const next = !track.starred;
    await setTrackStarred(track.id, next);
    pushToast(next ? `Added "${track.title}" to favourites.` : `Removed "${track.title}" from favourites.`);
  } catch (reason: any) {
    pushToast(reason?.message || 'Could not update favourite.', 'error');
  }
}

export function showTrackMenu(
  event: MenuEvent,
  track: Track,
  options: TrackMenuOptions = {},
): void {
  const items: ContextMenuItem[] = [
    {
      label: 'Play now',
      icon: 'play_arrow',
      onClick: () => playback.playTrackNow(track),
    },
    {
      label: 'Play next',
      icon: 'playlist_play',
      onClick: () => {
        playback.playNext(track);
        pushToast(`"${track.title}" will play next.`, 'success');
      },
    },
    {
      label: 'Add to queue',
      icon: 'queue_music',
      onClick: () => {
        playback.addToQueue([track]);
        pushToast(`Added "${track.title}" to the queue.`, 'success');
      },
    },
    {
      label: 'Add to playlist',
      icon: 'playlist_add',
      onClick: () => openPlaylistPicker([track], track.title),
    },
    {
      label: options.starred ? 'Remove from favourites' : 'Add to favourites',
      icon: options.starred ? 'favorite' : 'favorite_border',
      onClick: options.onToggleStar
        ? () => void options.onToggleStar?.()
        : () => void toggleLike(track),
    },
    {
      label: 'Rate',
      icon: 'star',
      children: [
        ...[1, 2, 3, 4, 5].map((rating) => ({
          label: `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`,
          checked: (track.rating || 0) === rating,
          onClick: () => void setRating(track, rating),
        })),
        { separator: true },
        {
          label: 'Clear rating',
          checked: !track.rating,
          onClick: () => void setRating(track, 0),
        },
      ],
    },
    { separator: true },
    {
      label: 'Go to album',
      icon: 'album',
      disabled: !track.albumId,
      onClick: () => {
        if (track.albumId) store.setNavigation(go.album(track.albumId));
      },
    },
    {
      label: 'Go to artist',
      icon: 'person',
      disabled: !track.artistId,
      onClick: () => {
        if (track.artistId) store.setNavigation(go.artist(track.artistId));
      },
    },
    {
      label: 'View track details',
      icon: 'info',
      onClick: () => openTrackDetails(track),
    },
    {
      label: 'Share song',
      icon: 'share',
      onClick: () => void shareTrack(track),
    },
    {
      label: 'Build Last.fm mix',
      icon: 'auto_awesome',
      onClick: () => openSmartMix({ kind: 'track', track }),
    },
  ];

  if (options.onRemove) {
    items.push(
      { separator: true },
      {
        label: options.removeLabel || 'Remove',
        icon: 'remove',
        danger: true,
        onClick: options.onRemove,
      },
    );
  }

  showContextMenu(event, items);
}

export function showQueueMenu(
  event: MenuEvent,
  track: Track,
  index: number,
  length: number,
): void {
  showContextMenu(event, [
    {
      label: 'Play now',
      icon: 'play_arrow',
      onClick: () => playback.playAt(index),
    },
    {
      label: 'Add to playlist',
      icon: 'playlist_add',
      onClick: () => openPlaylistPicker([track], track.title),
    },
    {
      label: 'Share song',
      icon: 'share',
      onClick: () => void shareTrack(track),
    },
    { separator: true },
    {
      label: 'Move up',
      icon: 'arrow_upward',
      disabled: index <= 0,
      onClick: () => playback.moveInQueue(index, index - 1),
    },
    {
      label: 'Move down',
      icon: 'arrow_downward',
      disabled: index >= length - 1,
      onClick: () => playback.moveInQueue(index, index + 1),
    },
    {
      label: 'Move to top',
      icon: 'vertical_align_top',
      disabled: index <= 0,
      onClick: () => playback.moveInQueue(index, 0),
    },
    {
      label: 'Move to bottom',
      icon: 'vertical_align_bottom',
      disabled: index >= length - 1,
      onClick: () => playback.moveInQueue(index, length - 1),
    },
    { separator: true },
    {
      label: 'Remove from queue',
      icon: 'remove',
      danger: true,
      onClick: () => playback.removeFromQueue(index),
    },
    {
      label: 'Clear queue',
      icon: 'delete_sweep',
      danger: true,
      onClick: () => {
        playback.clearQueue();
        pushToast('Queue cleared.');
      },
    },
  ]);
}
