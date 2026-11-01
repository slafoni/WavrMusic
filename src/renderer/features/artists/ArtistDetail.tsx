import { useEffect, useState } from 'react';
import type { Album, Artist, Track } from '../../../../shared/models';
import { store, useServer, useSettings } from '../../state';
import {
  coverArtUrl,
  fetchArtist,
  fetchTopSongs,
  setArtistStarred,
} from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { showArtistMenu } from '../../services/mediaActions';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { AlbumCard } from '../../components/AlbumCard';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';

export function ArtistDetail({ id }: { id: string }) {
  const { profile } = useServer();
  const settings = useSettings();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [topSongs, setTopSongs] = useState<Track[]>([]);
  const [starred, setStarred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fanartBanner, setFanartBanner] = useState('');

  useEffect(() => {
    if (!profile || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchArtist(id)
      .then(async (result) => {
        if (cancelled) return;
        if (!result) {
          setError('Artist not found on this server.');
          return;
        }
        setArtist(result.artist);
        setAlbums(result.albums || []);
        setStarred(!!result.artist.starred);
        const songs = await fetchTopSongs(result.artist.name, 20);
        if (!cancelled) setTopSongs(songs);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load this artist.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, id]);

  useEffect(() => {
    if (!artist) {
      setFanartBanner('');
      return;
    }
    const apiKey = String(settings.fanartTvApiKey || '').trim();
    if (!apiKey) {
      setFanartBanner('');
      return;
    }
    const cacheKey = `wavr.fanart.artist.${artist.musicBrainzId || artist.name.toLowerCase()}`;
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    const applyImage = (url: string, fromCache = false) => {
      if (!url) {
        if (!cancelled) setFanartBanner('');
        return;
      }
      image = new Image();
      image.onload = () => {
        if (!cancelled) setFanartBanner(url);
      };
      image.onerror = () => {
        if (fromCache) {
          try {
            localStorage.removeItem(cacheKey);
          } catch {
            /* storage is optional */
          }
        }
        if (!cancelled) setFanartBanner('');
      };
      image.src = url;
    };

    let cachedUrl = '';
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached?.url && Date.now() - Number(cached.at || 0) < 7 * 24 * 60 * 60 * 1000) {
        cachedUrl = String(cached.url);
      }
    } catch {
      /* storage is optional */
    }
    if (cachedUrl) {
      applyImage(cachedUrl, true);
      return () => {
        cancelled = true;
        if (image) image.onload = null;
      };
    }

    const api = (window as any).electronAPI;
    void api?.fanartArtistBanner?.({
      artistName: artist.name,
      musicBrainzId: artist.musicBrainzId || '',
      apiKey,
    })
      .then((result: { url?: string } | null) => {
        if (cancelled) return;
        const url = String(result?.url || '');
        if (!url) {
          setFanartBanner('');
          return;
        }
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ url, at: Date.now() }));
        } catch {
          /* storage is optional */
        }
        applyImage(url);
      })
      .catch(() => {
        if (!cancelled) setFanartBanner('');
      });

    return () => {
      cancelled = true;
      if (image) image.onload = null;
    };
  }, [artist?.id, artist?.name, artist?.musicBrainzId, settings.fanartTvApiKey]);

  const playTop = (shuffle: boolean) => {
    if (!topSongs.length) return;
    playback.setShuffle(shuffle);
    playback.playQueue(topSongs, shuffle ? Math.floor(Math.random() * topSongs.length) : 0);
  };

  const toggleStar = async () => {
    if (!artist) return;
    const next = !starred;
    setStarred(next);
    try {
      await setArtistStarred(artist.id, next);
      pushToast(next ? `Added "${artist.name}" to favourites.` : `Removed "${artist.name}" from favourites.`);
    } catch (reason: any) {
      setStarred(!next);
      pushToast(reason?.message || 'Could not update favourite.', 'error');
    }
  };

  const back = (
    <Button variant="icon" icon="arrow_back" title="Back to artists" onClick={() => store.setNavigation(go.artists())} />
  );

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <div className="loading-block"><span className="spinner" /> Loading artistâ€¦</div>
      </div>
    );
  }

  if (error || !artist) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <EmptyState
          icon={<Icon name="person" size={64} />}
          title="Artist unavailable"
          subtitle={error || 'This artist could not be found.'}
        />
      </div>
    );
  }

  const cover = artist.coverArt || albums[0]?.coverArt;
  const banner = fanartBanner || coverArtUrl(cover, 1600);

  return (
    <div className="page artist-detail-page">
      <div
        className={`artist-banner ${banner ? 'has-image' : ''} ${fanartBanner ? 'has-fanart-banner' : ''}`}
        style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
      >
        <div className="artist-banner-actions">{back}</div>
      </div>

      <div className="artist-detail-content">
        <div
          className="detail-hero artist-detail-hero"
          onContextMenu={(event) => showArtistMenu(event, artist)}
        >
        <div className="detail-cover round">
          <Artwork
            src={coverArtUrl(cover, 500) || null}
            size={200}
            radius="full"
            alt={artist.name}
          />
        </div>
        <div className="detail-info">
          <div className="detail-kicker">Artist</div>
          <h1 className="detail-title">{artist.name}</h1>
          <div className="detail-meta">
            <span>{albums.length} album{albums.length === 1 ? '' : 's'}</span>
            {artist.songCount !== undefined && (
              <span className="meta-dot">{artist.songCount} songs</span>
            )}
          </div>
          <div className="detail-actions">
            <Button variant="primary" icon="play_arrow" label="Play top songs" onClick={() => playTop(false)} disabled={!topSongs.length} />
            <Button variant="surface" icon="shuffle" label="Shuffle" onClick={() => playTop(true)} disabled={!topSongs.length} />
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

      {topSongs.length > 0 && (
        <section style={{ marginBottom: 30 }}>
          <SectionHeader title="Top songs" />
          <TrackList tracks={topSongs} showAlbum showArtist={false} />
        </section>
      )}

      <section>
        <SectionHeader title="Albums" />
        {albums.length === 0 ? (
          <EmptyState
            icon={<Icon name="album" size={48} />}
            title="No albums"
            subtitle="No albums were returned for this artist."
          />
        ) : (
          <div className="grid">
            {albums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                subtitle={album.year ? String(album.year) : album.artist}
              />
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

