import { useEffect, useState } from 'react';
import type { Album, Track } from '../../../../shared/models';
import { formatLongDuration } from '../../../../shared/constants';
import { store, useServer } from '../../state';
import { coverArtUrl, fetchAlbum, setAlbumStarred } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { Artwork } from '../../components/Artwork';
import { ArtworkLightbox } from '../../components/ArtworkLightbox';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { TrackList } from '../../components/TrackList';
import { showAlbumMenu } from '../../services/mediaActions';
import { go } from '../../app/routes';

type AlbumDetailData = Album & { songs: Track[] };

export function AlbumDetail({ id }: { id: string }) {
  const { profile } = useServer();
  const [album, setAlbum] = useState<AlbumDetailData | null>(null);
  const [starred, setStarred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [artworkOpen, setArtworkOpen] = useState(false);

  useEffect(() => {
    if (!profile || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchAlbum(id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('Album not found on this server.');
          return;
        }
        setAlbum(result);
        setStarred(!!result.starred);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load this album.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, id]);

  const play = (shuffle: boolean) => {
    if (!album?.songs.length) return;
    playback.setShuffle(shuffle);
    playback.playQueue(album.songs, shuffle ? Math.floor(Math.random() * album.songs.length) : 0);
  };

  const queue = () => {
    if (!album?.songs.length) return;
    playback.addToQueue(album.songs);
    pushToast(`Added ${album.songs.length} track${album.songs.length === 1 ? '' : 's'} to the queue.`, 'success');
  };

  const toggleStar = async () => {
    if (!album) return;
    const next = !starred;
    setStarred(next);
    try {
      await setAlbumStarred(album.id, next);
      pushToast(next ? `Added “${album.name}” to favourites.` : `Removed “${album.name}” from favourites.`);
    } catch (reason: any) {
      setStarred(!next);
      pushToast(reason?.message || 'Could not update favourite.', 'error');
    }
  };

  const back = (
    <Button variant="icon" icon="arrow_back" title="Back to albums" onClick={() => store.setNavigation(go.albums())} />
  );

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <div className="loading-block"><span className="spinner" /> Loading album…</div>
      </div>
    );
  }

  if (error || !album) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <EmptyState
          icon={<Icon name="album" size={64} />}
          title="Album unavailable"
          subtitle={error || 'This album could not be found.'}
        />
      </div>
    );
  }

  const totalDuration = album.songs.reduce((sum, track) => sum + (track.duration || 0), 0);

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 16 }}>
        {back}
      </div>

      <div className="detail-hero" onContextMenu={(event) => showAlbumMenu(event, album)}>
        <div className="detail-cover">
          <button
            type="button"
            className="detail-cover-button"
            onClick={() => setArtworkOpen(true)}
            disabled={!album.coverArt}
            title="View album artwork"
            aria-label={`View ${album.name} artwork`}
          >
            <Artwork
              src={coverArtUrl(album.coverArt, 500) || null}
              size={200}
              radius="none"
              alt={album.name}
            />
          </button>
        </div>
        <div className="detail-info">
          <div className="detail-kicker">Album</div>
          <h1 className="detail-title">{album.name}</h1>
          <button
            type="button"
            className="detail-subtitle link-button"
            disabled={!album.artistId}
            onClick={() => {
              if (album.artistId) store.setNavigation(go.artist(album.artistId));
            }}
          >
            {album.artist}
          </button>
          <div className="detail-meta">
            {album.year && <span>{album.year}</span>}
            {album.genre && <span className={album.year ? 'meta-dot' : ''}>{album.genre}</span>}
            <span className={album.year || album.genre ? 'meta-dot' : ''}>
              {album.songs.length} track{album.songs.length === 1 ? '' : 's'}
            </span>
            <span className="meta-dot">{formatLongDuration(totalDuration)}</span>
          </div>
          <div className="detail-actions">
            <Button variant="primary" icon="play_arrow" label="Play" onClick={() => play(false)} disabled={!album.songs.length} />
            <Button variant="surface" icon="shuffle" label="Shuffle" onClick={() => play(true)} disabled={!album.songs.length} />
            <Button variant="surface" icon="queue_music" label="Queue" onClick={queue} disabled={!album.songs.length} />
            <Button
              variant="icon"
              icon={starred ? 'favorite' : 'favorite_border'}
              active={starred}
              title={starred ? 'Remove from favourites' : 'Add to favourites'}
              onClick={toggleStar}
            />
          </div>
        </div>
      </div>

      <TrackList tracks={album.songs} showAlbum={false} emptyMessage="This album has no tracks." />

      <ArtworkLightbox
        open={artworkOpen}
        src={coverArtUrl(album.coverArt, 1400) || null}
        alt={`${album.name} artwork`}
        onClose={() => setArtworkOpen(false)}
      />
    </div>
  );
}
