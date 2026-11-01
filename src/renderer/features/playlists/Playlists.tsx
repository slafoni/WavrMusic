import { useEffect, useState } from 'react';
import type { Playlist } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { createPlaylist, fetchPlaylists } from '../../services/serverService';
import { pushToast } from '../../services/toastService';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { MediaCard } from '../../components/MediaCard';
import { go } from '../../app/routes';

export function Playlists() {
  const { profile } = useServer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchPlaylists()
      .then((result) => {
        if (!cancelled) setPlaylists(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load playlists.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey]);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createPlaylist(name.trim(), []);
      pushToast(`Created playlist “${name.trim()}”.`, 'success');
      setCreating(false);
      setName('');
      setReloadKey((key) => key + 1);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not create the playlist.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse playlists."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Playlists</h1>
          <div className="page-subtitle">{playlists.length} playlist{playlists.length === 1 ? '' : 's'}</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon="playlist_play" label="New playlist" onClick={() => setCreating(true)} />
          <Button variant="surface" icon="refresh" label="Refresh" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 10 }}>
          <input
            className="form-input"
            autoFocus
            placeholder="Playlist name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
              if (event.key === 'Escape') setCreating(false);
            }}
          />
          <Button variant="primary" label={saving ? 'Creating…' : 'Create'} onClick={create} disabled={saving || !name.trim()} />
          <Button variant="surface" label="Cancel" onClick={() => setCreating(false)} />
        </div>
      )}

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading playlists…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load playlists"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : playlists.length === 0 ? (
        <EmptyState
          icon={<Icon name="playlist_play" size={64} />}
          title="No playlists yet"
          subtitle="Create a playlist, or save the current queue as one from the queue panel."
          action={<Button variant="primary" icon="playlist_play" label="New playlist" onClick={() => setCreating(true)} />}
        />
      ) : (
        <div className="grid">
          {playlists.map((playlist) => (
            <MediaCard
              key={playlist.id}
              title={playlist.name}
              subtitle={`${playlist.songCount ?? 0} track${playlist.songCount === 1 ? '' : 's'}${playlist.owner ? ` · ${playlist.owner}` : ''}`}
              coverArt={playlist.coverArt}
              fallbackIcon="playlist_play"
              onClick={() => store.setNavigation(go.playlist(playlist.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
