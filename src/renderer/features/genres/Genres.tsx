import { useEffect, useState } from 'react';
import type { Genre } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { fetchGenres } from '../../services/serverService';
import { Button } from '../../components/Button';
import { Card, EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { go } from '../../app/routes';

export function Genres() {
  const { profile } = useServer();
  const [genres, setGenres] = useState<Genre[]>([]);
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
    fetchGenres()
      .then((result) => {
        if (!cancelled) {
          setGenres(result.sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load genres.');
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
        subtitle="Connect to a server to browse genres."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Genres</h1>
          <div className="page-subtitle">{genres.length} genre{genres.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <Button variant="surface" icon="refresh" label="Refresh" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading genres…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load genres"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : genres.length === 0 ? (
        <EmptyState
          icon={<Icon name="category" size={64} />}
          title="No genres"
          subtitle="This server does not report any genres."
        />
      ) : (
        <div className="grid">
          {genres.map((genre, index) => (
            <div
              key={genre.name}
              className="media-card"
              onClick={() => store.setNavigation(go.genre(genre.name))}
            >
              <Card>
                <div
                  className="genre-tile"
                  style={{
                    aspectRatio: '1 / 1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 8,
                    background: `linear-gradient(135deg, color-mix(in srgb, var(--md-sys-color-primary) ${28 + (index % 4) * 8}%, var(--md-sys-color-surface-container-high)), var(--md-sys-color-surface-container-high))`,
                  }}
                >
                  <Icon name="category" size={34} />
                  <span style={{ fontSize: 12, color: 'var(--md-sys-color-on-surface-variant)' }}>
                    {genre.songCount ?? genre.albumCount ?? 0} songs
                  </span>
                </div>
                <div className="album-info">
                  <div className="album-title" title={genre.name}>{genre.name}</div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
