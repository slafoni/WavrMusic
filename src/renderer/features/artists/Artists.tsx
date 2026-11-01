import { useEffect, useState } from 'react';
import type { Artist } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { coverArtUrl, fetchArtists } from '../../services/serverService';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { MediaCard } from '../../components/MediaCard';
import { showArtistMenu } from '../../services/mediaActions';
import { go } from '../../app/routes';

export function Artists() {
  const { profile } = useServer();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchArtists()
      .then((result) => {
        if (!cancelled) setArtists(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load artists.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey]);

  const open = (artist: Artist) => store.setNavigation(go.artist(artist.id));

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse artists."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Artists</h1>
          <div className="page-subtitle">{artists.length} artist{artists.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <Button variant="icon" icon="grid_view" active={view === 'grid'} onClick={() => setView('grid')} title="Grid view" />
          <Button variant="icon" icon="list" active={view === 'list'} onClick={() => setView('list')} title="List view" />
          <Button variant="surface" icon="refresh" label="Refresh" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading artists…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load artists"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : artists.length === 0 ? (
        <EmptyState
          icon={<Icon name="people" size={64} />}
          title="No artists"
          subtitle="This library does not contain any artists yet."
        />
      ) : view === 'grid' ? (
        <div className="grid">
          {artists.map((artist) => (
            <MediaCard
              key={artist.id}
              title={artist.name}
              subtitle={`${artist.albumCount ?? 0} albums`}
              coverArt={artist.coverArt}
              round
              fallbackIcon="person"
              onClick={() => open(artist)}
              onContextMenu={(event) => showArtistMenu(event, artist)}
            />
          ))}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }} />
              <th>Artist</th>
              <th className="table-number">Albums</th>
              <th className="table-number">Songs</th>
            </tr>
          </thead>
          <tbody>
            {artists.map((artist) => (
              <tr
                key={artist.id}
                style={{ cursor: 'pointer' }}
                onClick={() => open(artist)}
                onContextMenu={(event) => showArtistMenu(event, artist)}
              >
                <td>
                  <Artwork
                    src={coverArtUrl(artist.coverArt, 80) || null}
                    size={36}
                    radius="full"
                    alt={artist.name}
                  />
                </td>
                <td>{artist.name}</td>
                <td className="table-number">{artist.albumCount ?? '—'}</td>
                <td className="table-number">{artist.songCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
