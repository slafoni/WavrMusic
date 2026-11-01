import { useEffect, useState } from 'react';
import type { Playlist, Track } from '../../../../shared/models';
import { formatLongDuration } from '../../../../shared/constants';
import { store, useServer } from '../../state';
import {
  coverArtUrl,
  deletePlaylist,
  fetchPlaylist,
  removeSongFromPlaylist,
  renamePlaylist,
} from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { TrackList } from '../../components/TrackList';
import { openSmartMix } from '../../components/SmartMixDialog';
import { go } from '../../app/routes';

type PlaylistDetailData = Playlist & { songs: Track[] };

export function PlaylistDetail({ id }: { id: string }) {
  const { profile } = useServer();
  const [playlist, setPlaylist] = useState<PlaylistDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!profile || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    fetchPlaylist(id)
      .then((result) => {
        if (!result) {
          setError('Playlist not found on this server.');
          return;
        }
        setPlaylist(result);
        setNewName(result.name);
      })
      .catch((reason: any) => setError(reason?.message || 'Could not load this playlist.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [profile?.id, id]);

  const play = (shuffle: boolean) => {
    if (!playlist?.songs.length) return;
    playback.setShuffle(shuffle);
    playback.playQueue(
      playlist.songs,
      shuffle ? Math.floor(Math.random() * playlist.songs.length) : 0,
    );
  };

  const removeTrack = async (index: number) => {
    if (!playlist) return;
    const track = playlist.songs[index];
    try {
      await removeSongFromPlaylist(playlist.id, index);
      setPlaylist({
        ...playlist,
        songs: playlist.songs.filter((_, i) => i !== index),
        songCount: Math.max(0, (playlist.songCount ?? playlist.songs.length) - 1),
      });
      pushToast(`Removed “${track.title}” from the playlist.`);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not remove the track.', 'error');
    }
  };

  const rename = async () => {
    if (!playlist || !newName.trim()) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await renamePlaylist(playlist.id, newName.trim());
      setPlaylist({ ...playlist, name: newName.trim() });
      setRenaming(false);
      pushToast('Playlist renamed.', 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not rename the playlist.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!playlist) return;
    if (!window.confirm(`Delete the playlist “${playlist.name}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deletePlaylist(playlist.id);
      pushToast(`Deleted “${playlist.name}”.`);
      store.setNavigation(go.playlists());
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not delete the playlist.', 'error');
      setBusy(false);
    }
  };

  const back = (
    <Button variant="icon" icon="arrow_back" title="Back to playlists" onClick={() => store.setNavigation(go.playlists())} />
  );

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <div className="loading-block"><span className="spinner" /> Loading playlist…</div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="page">
        <div className="page-header">{back}</div>
        <EmptyState
          icon={<Icon name="playlist_play" size={64} />}
          title="Playlist unavailable"
          subtitle={error || 'This playlist could not be found.'}
        />
      </div>
    );
  }

  const totalDuration = playlist.songs.reduce((sum, track) => sum + (track.duration || 0), 0);
  const cover = playlist.coverArt || playlist.songs[0]?.coverArt;

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 16 }}>
        {back}
      </div>

      <div className="detail-hero">
        <div className="detail-cover">
          <Artwork src={coverArtUrl(cover, 500) || null} size={200} radius="none" alt={playlist.name} />
        </div>
        <div className="detail-info">
          <div className="detail-kicker">Playlist</div>
          {renaming ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                className="form-input"
                value={newName}
                autoFocus
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') rename();
                  if (event.key === 'Escape') setRenaming(false);
                }}
              />
              <Button variant="primary" label="Save" onClick={rename} disabled={busy || !newName.trim()} />
              <Button variant="surface" label="Cancel" onClick={() => setRenaming(false)} />
            </div>
          ) : (
            <h1 className="detail-title">{playlist.name}</h1>
          )}
          <div className="detail-meta">
            {playlist.owner && <span>{playlist.owner}</span>}
            <span className={playlist.owner ? 'meta-dot' : ''}>
              {playlist.songs.length} track{playlist.songs.length === 1 ? '' : 's'}
            </span>
            <span className="meta-dot">{formatLongDuration(totalDuration)}</span>
          </div>
          <div className="detail-actions">
            <Button variant="primary" icon="play_arrow" label="Play" onClick={() => play(false)} disabled={!playlist.songs.length} />
            <Button variant="surface" icon="shuffle" label="Shuffle" onClick={() => play(true)} disabled={!playlist.songs.length} />
            <Button
              variant="surface"
              icon="queue_music"
              label="Queue"
              disabled={!playlist.songs.length}
              onClick={() => {
                playback.addToQueue(playlist.songs);
                pushToast(`Added ${playlist.songs.length} tracks to the queue.`, 'success');
              }}
            />
            <Button
              variant="surface"
              icon="auto_awesome"
              label="Smart mix"
              disabled={!playlist.songs.length}
              onClick={() => openSmartMix({ kind: 'playlist', playlist })}
            />
            <Button variant="icon" icon="edit" title="Rename playlist" onClick={() => setRenaming(true)} />
            <Button variant="icon" icon="delete" title="Delete playlist" onClick={remove} disabled={busy} />
          </div>
        </div>
      </div>

      <TrackList
        tracks={playlist.songs}
        showAlbum
        showArtist
        onRemove={removeTrack}
        emptyMessage="This playlist is empty. Add songs from the queue or album pages."
      />
    </div>
  );
}
