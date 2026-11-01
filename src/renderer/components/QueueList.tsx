import { useState } from 'react';
import type { Track } from '../../../shared/models';
import { formatDuration } from '../../../shared/constants';
import { store, useQueue } from '../state';
import { playback } from '../services/playbackService';
import { coverArtUrl, createPlaylist } from '../services/serverService';
import { showQueueMenu } from '../services/mediaActions';
import { pushToast } from '../services/toastService';
import { go } from '../app/routes';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { EmptyState } from './Card';
import { Icon } from './Icon';
import { openTrackDetails } from './MediaDialogHost';

export function QueueList({
  compact = false,
  showActions = true,
}: {
  compact?: boolean;
  showActions?: boolean;
}) {
  const { queue, index } = useQueue();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  if (!queue.length) {
    return (
      <EmptyState
        icon={<Icon name="queue_music" size={56} />}
        title="Queue is empty"
        subtitle="Play songs or add them to the queue and they will appear here."
        action={
          <Button variant="surface" icon="home" label="Browse library" onClick={() => store.setNavigation('home')} />
        }
      />
    );
  }

  const saveQueue = async () => {
    const playlistName = name.trim() || `Queue ${new Date().toLocaleDateString()}`;
    try {
      await createPlaylist(playlistName, queue.map((track) => track.id));
      pushToast(`Saved “${playlistName}” as a playlist.`, 'success');
      setSaving(false);
      setName('');
    } catch (error: any) {
      pushToast(error?.message || 'Could not save the queue.', 'error');
    }
  };

  return (
    <>
      <div className="queue-panel-scroll">
        {queue.map((track: Track, i: number) => {
          const current = i === index;
          return (
            <div
              key={`${track.id}-${i}`}
              className={`queue-row ${current ? 'current' : ''} ${dragOver === i ? 'drag-over' : ''}`}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(i);
              }}
              onDragLeave={() => setDragOver((value) => (value === i ? null : value))}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null && dragIndex !== i) playback.moveInQueue(dragIndex, i);
                setDragIndex(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOver(null);
              }}
              onClick={() => playback.playAt(i)}
              onContextMenu={(event) => showQueueMenu(event, track, i, queue.length)}
            >
              <span className="queue-drag" title="Drag to reorder">
                <Icon name="drag_indicator" size={16} />
              </span>
              <Artwork
                src={coverArtUrl(track.coverArt || track.albumCover, 80) || null}
                size={compact ? 34 : 40}
                radius="small"
                alt={track.title}
              />
              <div className="queue-row-info">
                <div className="queue-row-title">
                  {current ? <Icon name="play_arrow" size={12} /> : null}
                  <button
                    type="button"
                    className="link-button title"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTrackDetails(track);
                    }}
                  >
                    {track.title}
                  </button>
                </div>
                <div className="queue-row-sub">
                  <button
                    type="button"
                    className="link-button muted"
                    disabled={!track.artistId}
                    onClick={(event) => {
                      if (!track.artistId) return;
                      event.stopPropagation();
                      store.setNavigation(go.artist(track.artistId));
                    }}
                  >
                    {track.artist}
                  </button> · {formatDuration(track.duration)}
                </div>
              </div>
              <Button
                variant="icon"
                className="btn-compact"
                icon="close"
                title="Remove from queue"
                onClick={(event) => {
                  event.stopPropagation();
                  playback.removeFromQueue(i);
                }}
              />
            </div>
          );
        })}
      </div>
      {showActions && (
        <div className="queue-footer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {saving ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="form-input"
                placeholder="Playlist name"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveQueue();
                  if (event.key === 'Escape') setSaving(false);
                }}
              />
              <Button variant="primary" onClick={saveQueue}>Save</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="surface"
                icon="playlist_play"
                label="Save as playlist"
                style={{ flex: 1 }}
                onClick={() => setSaving(true)}
              />
              <Button
                variant="surface"
                icon="delete"
                label="Clear"
                onClick={() => {
                  playback.clearQueue();
                  pushToast('Queue shortened to the current track.');
                }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
