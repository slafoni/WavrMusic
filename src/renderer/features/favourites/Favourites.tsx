import { useEffect, useState } from 'react';
import type { Album, Artist, Track } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { fetchStarred } from '../../services/serverService';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { AlbumCard } from '../../components/AlbumCard';
import { MediaCard } from '../../components/MediaCard';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';

type Tab = 'songs' | 'albums' | 'artists';

interface StarredData {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

const EMPTY: StarredData = { songs: [], albums: [], artists: [] };

export function Favourites() {
  const { profile } = useServer();
  const [data, setData] = useState<StarredData>(EMPTY);
  const [tab, setTab] = useState<Tab>('songs');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchStarred()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load favourites.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey]);

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse favourites."
      />
    );
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'songs', label: 'Songs', count: data.songs.length },
    { id: 'albums', label: 'Albums', count: data.albums.length },
    { id: 'artists', label: 'Artists', count: data.artists.length },
  ];

  const isEmpty = data.songs.length + data.albums.length + data.artists.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Favourites</h1>
          <div className="page-subtitle">Everything you have starred on this server</div>
        </div>
        <div className="page-actions">
          <Button variant="surface" icon="refresh" label="Refresh" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading favourites…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load favourites"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<Icon name="favorite" size={64} />}
          title="No favourites yet"
          subtitle="Star songs, albums or artists and they will be collected here."
        />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Favourite types">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                className={`tab ${tab === entry.id ? 'active' : ''}`}
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
                <span className="status-pill">{entry.count}</span>
              </button>
            ))}
          </div>

          {tab === 'songs' && (
            <TrackList
              tracks={data.songs}
              onStarChange={() => setReloadKey((key) => key + 1)}
              emptyMessage="You have not starred any songs yet."
            />
          )}

          {tab === 'albums' && (
            data.albums.length ? (
              <div className="grid">
                {data.albums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Icon name="album" size={48} />} title="No favourite albums" subtitle="Star an album to see it here." />
            )
          )}

          {tab === 'artists' && (
            data.artists.length ? (
              <div className="grid">
                {data.artists.map((artist) => (
                  <MediaCard
                    key={artist.id}
                    title={artist.name}
                    subtitle={`${artist.albumCount ?? 0} albums`}
                    coverArt={artist.coverArt}
                    round
                    fallbackIcon="person"
                    onClick={() => store.setNavigation(go.artist(artist.id))}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Icon name="person" size={48} />} title="No favourite artists" subtitle="Star an artist to see them here." />
            )
          )}
        </>
      )}
    </div>
  );
}

