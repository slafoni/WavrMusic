import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { formatDuration } from '../../../../shared/constants';
import { store, usePlayback, useQueue } from '../../state';
import { coverArtUrl, setTrackStarred } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { showTrackMenu } from '../../services/mediaActions';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { go } from '../../app/routes';

export function BottomPlayer({
  onOpenQueue,
  onToggleLyrics,
  onToggleFriends,
  lyricsOpen,
  friendsOpen,
}: {
  onOpenQueue: () => void;
  onToggleLyrics: () => void;
  onToggleFriends: () => void;
  lyricsOpen: boolean;
  friendsOpen: boolean;
}) {
  const { track, status, currentTime, duration, volume, muted, shuffle, repeat } =
    usePlayback();
  const { queue } = useQueue();
  const [starred, setStarred] = useState(false);
  const volumeFrame = useRef(0);
  const pendingVolume = useRef(0);

  useEffect(() => {
    return () => {
      if (volumeFrame.current) cancelAnimationFrame(volumeFrame.current);
    };
  }, []);

  useEffect(() => {
    setStarred(!!track?.starred);
  }, [track?.id]);

  const seekFromEvent = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      playback.seek(ratio * duration);
    },
    [duration],
  );

  const applyVolume = useCallback((ratio: number, immediate = false) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    pendingVolume.current = clamped;
    if (immediate) {
      if (volumeFrame.current) cancelAnimationFrame(volumeFrame.current);
      volumeFrame.current = 0;
      playback.setVolume(clamped);
      return;
    }
    if (volumeFrame.current) return;
    volumeFrame.current = requestAnimationFrame(() => {
      volumeFrame.current = 0;
      playback.setVolume(pendingVolume.current);
    });
  }, []);

  const volumeFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    },
    [],
  );

  const startVolumeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    applyVolume(volumeFromPointer(event));
  };

  const moveVolumeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyVolume(volumeFromPointer(event));
  };

  const endVolumeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyVolume(volumeFromPointer(event), true);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const keyVolume = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.05;
    let next = volume;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else return;
    event.preventDefault();
    applyVolume(next, true);
  };

  const toggleStar = async () => {
    if (!track) return;
    const next = !starred;
    setStarred(next);
    try {
      await setTrackStarred(track.id, next);
    } catch (reason: any) {
      setStarred(!next);
      pushToast(reason?.message || 'Could not update favourite.', 'error');
    }
  };

  if (!track) return null;

  const playing = status === 'playing' || status === 'buffering';
  const repeatIcon = repeat === 'one' ? 'repeat_one' : 'repeat';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={`bottom-player ${status}`} aria-label="Playback controls">
      <span className="sr-only" aria-live="polite">
        {status === 'playing'
          ? `Playing ${track.title} by ${track.artist}`
          : status === 'paused'
            ? `Paused ${track.title}`
            : status === 'buffering'
              ? `Buffering ${track.title}`
              : status === 'failed'
                ? 'Playback failed'
                : track.title}
      </span>
      <div
        className="bp-track"
        role="button"
        tabIndex={0}
        onClick={() => store.setNavigation(go.player())}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') store.setNavigation(go.player());
        }}
        onContextMenu={(event) =>
          showTrackMenu(event, track, {
            starred,
            onToggleStar: toggleStar,
          })
        }
        title="Open now playing"
      >
        <button
          type="button"
          className="bp-artwork-button"
          onClick={(event) => {
            event.stopPropagation();
            store.setNavigation(go.player());
          }}
          title="Open fullscreen player"
          aria-label="Open fullscreen player"
        >
          <Artwork
            src={coverArtUrl(track.coverArt || track.albumCover, 120) || null}
            size={52}
            radius="medium"
            alt={track.title}
          />
        </button>
        <div className="bp-info">
          <button
            type="button"
            className="bp-title link-button"
            title={track.title}
            onClick={(event) => {
              event.stopPropagation();
              openTrackDetails(track);
            }}
          >
            {track.title}
          </button>
          <button
            type="button"
            className="bp-artist link-button"
            title={track.artist}
            disabled={!track.artistId}
            onClick={(event) => {
              if (!track.artistId) return;
              event.stopPropagation();
              store.setNavigation(go.artist(track.artistId));
            }}
          >
            {track.artist}
          </button>
        </div>
        <Button
          variant="icon"
          className="btn-compact"
          icon={starred ? 'favorite' : 'favorite_border'}
          active={starred}
          title={starred ? 'Remove from favourites' : 'Add to favourites'}
          onClick={(event) => {
            event.stopPropagation();
            toggleStar();
          }}
        />
      </div>

      <div className="bp-center">
        <div className="bp-buttons">
          <Button
            variant="icon"
            className="btn-compact"
            icon="shuffle"
            active={shuffle}
            title={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            onClick={() => playback.setShuffle(!shuffle)}
          />
          <Button variant="icon" icon="skip_previous" title="Previous" onClick={() => playback.prev()} />
          <Button
            variant="play"
            icon={playing ? 'pause' : 'play_arrow'}
            title={playing ? 'Pause' : 'Play'}
            onClick={() => playback.playPause()}
          />
          <Button variant="icon" icon="skip_next" title="Next" onClick={() => playback.next(true)} />
          <Button
            variant="icon"
            className="btn-compact"
            icon={repeatIcon}
            active={repeat !== 'off'}
            title={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
            onClick={() => {
              const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
              playback.setRepeat(modes[(modes.indexOf(repeat) + 1) % modes.length]);
            }}
          />
        </div>
        <div className="bp-progress-row">
          <span className="bp-time">{formatDuration(currentTime)}</span>
          <div
            className="bp-progress"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            onClick={seekFromEvent}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') playback.seek(currentTime + 5);
              if (event.key === 'ArrowLeft') playback.seek(currentTime - 5);
            }}
          >
            <div className="bp-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="bp-time">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="bp-right">
        <Button
          variant="icon"
          icon="lyrics"
          active={lyricsOpen}
          title={lyricsOpen ? 'Close lyrics sidebar' : 'Open lyrics sidebar'}
          onClick={onToggleLyrics}
        />
        <Button
          variant="icon"
          icon="queue_music"
          title={`Queue (${queue.length})`}
          onClick={onOpenQueue}
        />
        <Button
          variant="icon"
          icon="people"
          active={friendsOpen}
          title={friendsOpen ? 'Hide friends' : 'Open friends'}
          onClick={onToggleFriends}
        />
        <div className="bp-volume">
          <Button
            variant="icon"
            className="btn-compact"
            icon={muted ? 'volume_off' : volume > 0.5 ? 'volume_up' : 'volume_down'}
            title={muted ? 'Unmute' : 'Mute'}
            onClick={() => playback.toggleMute()}
          />
          <div
            className="bp-volume-slider"
            role="slider"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
            tabIndex={0}
            onPointerDown={startVolumeDrag}
            onPointerMove={moveVolumeDrag}
            onPointerUp={endVolumeDrag}
            onPointerCancel={endVolumeDrag}
            onKeyDown={keyVolume}
          >
            <div
              className="bp-volume-fill"
              style={{ width: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>
        </div>
        <Button
          variant="icon"
          icon="fullscreen"
          title="Expanded player"
          onClick={() => store.setNavigation(go.player())}
        />
      </div>
    </div>
  );
}
