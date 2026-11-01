import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Track } from '../../../shared/models';
import { formatDuration } from '../../../shared/constants';
import { playback } from '../services/playbackService';
import { coverArtUrl, setTrackStarred } from '../services/serverService';
import { pushToast } from '../services/toastService';
import { showTrackMenu } from '../services/mediaActions';
import { store, useCurrentTrackId, usePlaybackStatus } from '../state';
import { go } from '../app/routes';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { Icon } from './Icon';
import { openTrackDetails } from './MediaDialogHost';

export interface TrackListProps {
  tracks: Track[];
  showAlbum?: boolean;
  showArtist?: boolean;
  showHeader?: boolean;
  showArtwork?: boolean;
  showIndex?: boolean;
  onPlayIndex?: (index: number) => void;
  onStarChange?: (track: Track, starred: boolean) => void;
  onRemove?: (index: number) => void;
  emptyMessage?: string;
}

export function TrackList({
  tracks,
  showAlbum = true,
  showArtist = true,
  showHeader = true,
  showArtwork = true,
  showIndex = true,
  onPlayIndex,
  onStarChange,
  onRemove,
  emptyMessage = 'No tracks here yet.',
}: TrackListProps) {
  const currentId = useCurrentTrackId();
  const status = usePlaybackStatus();
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setStarOverrides({});
  }, [tracks]);

  const playIndex = (index: number) => {
    if (onPlayIndex) onPlayIndex(index);
    else playback.playQueue(tracks, index);
  };

  const isStarred = (track: Track) =>
    Object.prototype.hasOwnProperty.call(starOverrides, track.id)
      ? starOverrides[track.id]
      : !!track.starred;

  const toggleStar = async (track: Track) => {
    const next = !isStarred(track);
    setStarOverrides((current) => ({ ...current, [track.id]: next }));
    try {
      await setTrackStarred(track.id, next);
      onStarChange?.(track, next);
    } catch (error: any) {
      setStarOverrides((current) => ({ ...current, [track.id]: !next }));
      pushToast(error?.message || 'Could not update favourite.', 'error');
    }
  };

  const openAlbum = (event: ReactMouseEvent, track: Track) => {
    if (!track.albumId) return;
    event.stopPropagation();
    store.setNavigation(go.album(track.albumId));
  };

  const openArtist = (event: ReactMouseEvent, track: Track) => {
    if (!track.artistId) return;
    event.stopPropagation();
    store.setNavigation(go.artist(track.artistId));
  };

  const columnCount = useMemo(() => {
    let count = 1;
    if (showIndex) count += 1;
    if (showArtwork) count += 1;
    if (showArtist) count += 1;
    if (showAlbum) count += 1;
    count += 2;
    return count;
  }, [showIndex, showArtwork, showArtist, showAlbum]);

  if (!tracks.length) {
    return (
      <div className="empty-state" style={{ height: 'auto', padding: '32px 12px' }}>
        <div className="empty-icon" style={{ width: 48, height: 48, marginBottom: 8 }}>
          <Icon name="music_note" size={40} />
        </div>
        <p className="empty-subtitle" style={{ margin: 0 }}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <table className="table track-table">
      {showHeader && (
        <thead>
          <tr>
            {showIndex && <th className="track-index">#</th>}
            {showArtwork && <th style={{ width: 54 }} aria-label="Artwork" />}
            <th>Title</th>
            {showArtist && <th style={{ width: '20%' }}>Artist</th>}
            {showAlbum && <th style={{ width: '22%' }}>Album</th>}
            <th style={{ width: 70 }} className="table-number">Time</th>
            <th style={{ width: onRemove ? 108 : 82 }} aria-label="Actions" />
          </tr>
        </thead>
      )}
      <tbody>
        {tracks.map((track, index) => {
          const current = track.id === currentId;
          return (
            <tr
              key={`${track.id}-${index}`}
              className={current ? 'current' : ''}
              onClick={() => playIndex(index)}
              onContextMenu={(event) =>
                showTrackMenu(event, track, {
                  starred: isStarred(track),
                  onToggleStar: () => toggleStar(track),
                  onRemove: onRemove ? () => onRemove(index) : undefined,
                  removeLabel: 'Remove from playlist',
                })
              }
              title={`Play ${track.title}`}
            >
              {showIndex && (
                <td className="track-index">
                  {current ? (
                    status === 'playing' ? (
                      <span className="equalizer" aria-label="Now playing">
                        <i /><i /><i />
                      </span>
                    ) : (
                      <Icon name="play_arrow" size={14} />
                    )
                  ) : (
                    index + 1
                  )}
                </td>
              )}
              {showArtwork && (
                <td>
                  <Artwork
                    src={coverArtUrl(track.coverArt || track.albumCover, 80) || null}
                    size={40}
                    radius="small"
                    alt={track.title}
                    className="track-art"
                  />
                </td>
              )}
              <td>
                <div className="track-title-cell">
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
                  {!showArtist && (
                    <button
                      type="button"
                      className="link-button subtitle"
                      disabled={!track.artistId}
                      onClick={(event) => openArtist(event, track)}
                    >
                      {track.artist}
                    </button>
                  )}
                </div>
              </td>
              {showArtist && (
                <td>
                  <button
                    type="button"
                    className="link-button muted"
                    disabled={!track.artistId}
                    onClick={(event) => openArtist(event, track)}
                  >
                    {track.artist}
                  </button>
                </td>
              )}
              {showAlbum && (
                <td>
                  <button
                    type="button"
                    className="link-button muted"
                    disabled={!track.albumId}
                    onClick={(event) => openAlbum(event, track)}
                  >
                    {track.album}
                  </button>
                </td>
              )}
              <td className="table-number">{formatDuration(track.duration)}</td>
              <td>
                <div className="row-actions">
                  <Button
                    variant="icon"
                    className="btn-compact"
                    icon={isStarred(track) ? 'favorite' : 'favorite_border'}
                    active={isStarred(track)}
                    title={isStarred(track) ? 'Remove from favourites' : 'Add to favourites'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStar(track);
                    }}
                  />
                  <Button
                    variant="icon"
                    className="btn-compact"
                    icon="queue_music"
                    title="Add to queue"
                    onClick={(event) => {
                      event.stopPropagation();
                      playback.addToQueue([track]);
                      pushToast(`Added “${track.title}” to the queue.`, 'success');
                    }}
                  />
                  {onRemove ? (
                    <Button
                      variant="icon"
                      className="btn-compact"
                      icon="remove"
                      title="Remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(index);
                      }}
                    />
                  ) : (
                    <Button
                      variant="icon"
                      className="btn-compact"
                      icon="playlist_play"
                      title="Play next"
                      onClick={(event) => {
                        event.stopPropagation();
                        playback.playNext(track);
                        pushToast(`“${track.title}” will play next.`, 'success');
                      }}
                    />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
