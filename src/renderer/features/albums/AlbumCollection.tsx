import { useEffect, useState } from 'react';
import type { Album } from '../../../../shared/models';
import type { AlbumListType } from '../../../../shared/api/subsonic-client';
import { useServer } from '../../state';
import { fetchAlbums } from '../../services/serverService';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { AlbumCard } from '../../components/AlbumCard';

export function AlbumCollection({
  title,
  type,
  subtitle,
}: {
  title: string;
  type: AlbumListType;
  subtitle: string;
}) {
  const { profile } = useServer();
  const [albums, setAlbums] = useState<Album[]>([]);
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
    fetchAlbums(type, 100)
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
  }, [profile?.id, type, reloadKey]);

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
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{subtitle}</div>
        </div>
        <div className="page-actions">
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
          title="Nothing here yet"
          subtitle="Albums will appear here once this server has listening history."
        />
      ) : (
        <div className="grid">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}
    </div>
  );
}
