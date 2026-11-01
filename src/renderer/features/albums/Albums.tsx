import { useCallback, useEffect, useState } from 'react';
import type { Album } from '../../../../shared/models';
import type { AlbumListType } from '../../../../shared/api/subsonic-client';
import { store, useServer } from '../../state';
import { coverArtUrl, fetchAlbums } from '../../services/serverService';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { AlbumCard } from '../../components/AlbumCard';
import { showAlbumMenu } from '../../services/mediaActions';
import { go } from '../../app/routes';

const ALBUM_SORT_STORAGE_KEY = 'wavr.albums.sort.v1';
const ALBUM_SORTS: Array<{ value: AlbumListType; label: string }> = [
  { value: 'newest', label: 'Recently added' },
  { value: 'recent', label: 'Recently played' },
  { value: 'starred', label: 'Favourites' },
  { value: 'byYear', label: 'Year' },
  { value: 'alphabeticalByName', label: 'Album name' },
  { value: 'alphabeticalByArtist', label: 'Artist' },
  { value: 'frequent', label: 'Most played' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'random', label: 'Random' },
];

function initialSort(): AlbumListType {
  try {
    const saved = localStorage.getItem(ALBUM_SORT_STORAGE_KEY);
    if (ALBUM_SORTS.some((option) => option.value === saved)) {
      return saved as AlbumListType;
    }
  } catch {
    /* storage is optional */
  }
  return 'alphabeticalByName';
}

async function loadAlbums(sort: AlbumListType): Promise<Album[]> {
  if (sort === 'byYear') {
    try {
      return await fetchAlbums(sort, 300, 0, undefined, 1900, new Date().getFullYear());
    } catch {
      const albums = await fetchAlbums('alphabeticalByName', 500);
      return albums.sort((left, right) => (right.year || 0) - (left.year || 0));
    }
  }
  return fetchAlbums(sort, 300);
}

export function Albums() {
  const { profile } = useServer();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<AlbumListType>(initialSort);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loadAlbums(sort)
      .then((result) => {
        if (!cancelled) setAlbums(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load albums.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey, sort]);

  const open = useCallback((album: Album) => store.setNavigation(go.album(album.id)), []);

  const changeSort = (value: AlbumListType) => {
    setSort(value);
    try {
      localStorage.setItem(ALBUM_SORT_STORAGE_KEY, value);
    } catch {
      /* storage is optional */
    }
  };

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse albums."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Albums</h1>
          <div className="page-subtitle">{albums.length} album{albums.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <select
            className="form-input albums-sort"
            value={sort}
            onChange={(event) => changeSort(event.target.value as AlbumListType)}
            aria-label="Sort albums"
            title="Sort albums"
          >
            {ALBUM_SORTS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button variant="icon" icon="grid_view" active={view === 'grid'} onClick={() => setView('grid')} title="Grid view" />
          <Button variant="icon" icon="list" active={view === 'list'} onClick={() => setView('list')} title="List view" />
          <Button variant="surface" icon="refresh" label="Refresh" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {loading ? (
        <div className="grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((card) => (
            <div key={card} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load albums"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : albums.length === 0 ? (
        <EmptyState
          icon={<Icon name="album" size={64} />}
          title="No albums"
          subtitle="This library does not contain any albums yet."
        />
      ) : view === 'grid' ? (
        <div className="grid">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} onOpen={() => open(album)} />
          ))}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }} />
              <th>Album</th>
              <th>Artist</th>
              <th className="table-number">Year</th>
              <th className="table-number">Tracks</th>
            </tr>
          </thead>
          <tbody>
            {albums.map((album) => (
              <tr
                key={album.id}
                style={{ cursor: 'pointer' }}
                onClick={() => open(album)}
                onContextMenu={(event) => showAlbumMenu(event, album)}
              >
                <td>
                  <Artwork
                    src={coverArtUrl(album.coverArt, 80) || null}
                    size={36}
                    radius="small"
                    alt={album.name}
                  />
                </td>
                <td>{album.name}</td>
                <td style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{album.artist}</td>
                <td className="table-number">{album.year || '—'}</td>
                <td className="table-number">{album.songCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
