import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../../../shared/constants';
import { store, usePlayback, useSettings } from '../../state';
import { useTheme } from '../../themes';
import { coverArtUrl, setTrackStarred } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { showTrackMenu } from '../../services/mediaActions';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { LiveLyricsBanner } from '../../components/LiveLyricsBanner';
import { LyricsView } from '../../components/LyricsView';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { QueueList } from '../../components/QueueList';
import { BackgroundVideo } from '../../components/BackgroundVideo';
import { isVideoPageBackground, synchronizedBackgroundTime } from '../../utils/backgroundMedia';
import { CustomYouTubeBackgroundDialog } from './CustomYouTubeBackgroundDialog';
import { WindowControls } from '../../components/WindowControls';
import { go } from '../../app/routes';

type Tab = 'now' | 'lyrics' | 'queue';

const youtubeVideoCache = new Map<string, string>();

function electronApi(): any {
  return (window as any).electronAPI;
}

export function ExpandedPlayer({
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: {
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { track, status, currentTime, duration, volume, muted, shuffle, repeat } = usePlayback();
  const settings = useSettings();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab | null>('now');
  const [starred, setStarred] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [introEnd, setIntroEnd] = useState(0);
  const [youtubeVideoFailed, setYoutubeVideoFailed] = useState(false);
  const [customVideoOpen, setCustomVideoOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const youtubeReadyRef = useRef(false);
  const youtubeVideoRef = useRef<HTMLVideoElement>(null);
  const hideUiTimer = useRef(0);
  const customVideoId = track ? settings.youtubeBackgrounds?.[track.id] || '' : '';
  const manualSyncOffset = track
    ? settings.youtubeBackgroundSyncOffsets?.[track.id] || 0
    : 0;
  const effectiveVideoOffset = Math.max(0, introEnd + manualSyncOffset);
  const hasVideoSync = introEnd > 0 || manualSyncOffset !== 0;
  const resolvedVideoId = /\/youtube\/cache\/([a-zA-Z0-9_-]{11})\.mp4/.exec(videoUrl)?.[1] || '';

  useEffect(() => {
    setStarred(!!track?.starred);
  }, [track?.id]);

  useEffect(() => {
    window.clearTimeout(hideUiTimer.current);
    if (!isFullscreen || !settings.fullscreenAutoHideUi) {
      setUiHidden(false);
      return;
    }
    const showUi = () => {
      window.clearTimeout(hideUiTimer.current);
      setUiHidden(false);
      hideUiTimer.current = window.setTimeout(() => setUiHidden(true), 3500);
    };
    showUi();
    window.addEventListener('mousemove', showUi);
    window.addEventListener('mousedown', showUi);
    window.addEventListener('keydown', showUi);
    return () => {
      window.clearTimeout(hideUiTimer.current);
      window.removeEventListener('mousemove', showUi);
      window.removeEventListener('mousedown', showUi);
      window.removeEventListener('keydown', showUi);
    };
  }, [isFullscreen, settings.fullscreenAutoHideUi]);

  useEffect(() => {
    if (!settings.fullscreenYoutubeBackground || !track) {
      setVideoUrl('');
      return;
    }
    const key = customVideoId
      ? `custom:${customVideoId}`
      : `${track.artist}|${track.title}`.toLowerCase();
    const cachedUrl = youtubeVideoCache.get(key);
    if (cachedUrl) {
      setVideoUrl(cachedUrl);
      return;
    }
    let cancelled = false;
    setVideoUrl('');
    const videoId = customVideoId
      ? Promise.resolve(customVideoId)
      : electronApi()?.youtubeVideoSearch?.(
          `${track.artist} ${track.title} official music video`,
          track.artist,
          track.title,
        ) || Promise.resolve('');
    videoId
      .then(async (id: string) => {
        if (cancelled || !id) return '';
        return electronApi()?.youtubeVideoCache?.(id) || '';
      })
      .then((url: string) => {
        if (cancelled) return;
        youtubeVideoCache.set(key, url || '');
        setVideoUrl(url || '');
      })
      .catch(() => {
        if (!cancelled) setVideoUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [
    settings.fullscreenYoutubeBackground,
    customVideoId,
    track?.id,
    track?.artist,
    track?.title,
  ]);

  useEffect(() => {
    const video = youtubeVideoRef.current;
    if (!video) return;
    const playing = ['playing', 'buffering', 'loading', 'seeking'].includes(status);
    if (settings.youtubeBackgroundPauseWithPlayback !== false && !playing) {
      video.pause();
    } else if (video.paused) {
      video.play().catch(() => {});
    }
  }, [
    status,
    videoUrl,
    isFullscreen,
    settings.youtubeBackgroundPauseWithPlayback,
  ]);

  useEffect(() => {
    setIntroEnd(0);
    if (!resolvedVideoId || settings.youtubeBackgroundSkipIntro === false) return;
    let cancelled = false;
    electronApi()
      ?.youtubeVideoIntro?.(resolvedVideoId)
      .then((end: number) => {
        if (!cancelled) setIntroEnd(Number.isFinite(Number(end)) ? Math.max(0, Number(end)) : 0);
      })
      .catch(() => {
        if (!cancelled) setIntroEnd(0);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedVideoId, settings.youtubeBackgroundSkipIntro]);

  useEffect(() => {
    if (
      !isFullscreen ||
      !settings.fullscreenYoutubeBackground ||
      !videoUrl ||
      youtubeVideoFailed ||
      !hasVideoSync
    ) {
      return;
    }
    let frame = 0;
    const sync = () => {
      const video = youtubeVideoRef.current;
      const audioPlaying = ['playing', 'buffering', 'loading', 'seeking'].includes(
        playback.getStatus(),
      );
      if (
        video &&
        audioPlaying &&
        video.readyState >= 2 &&
        Number.isFinite(video.duration) &&
        video.duration > 0
      ) {
        const songTime = playback.getCurrentTime();
        const target = synchronizedBackgroundTime(
          video.duration,
          effectiveVideoOffset,
          songTime,
        );
        const delta = target - video.currentTime;
        const drift = Math.abs(delta);
        if (video.paused) {
          video.playbackRate = 1;
        } else if (drift > 0.3) {
          video.currentTime = target;
          video.playbackRate = 1;
        } else {
          video.playbackRate =
            drift > 0.04 ? Math.max(0.94, Math.min(1.06, 1 + delta * 0.4)) : 1;
        }
      } else if (video) {
        video.playbackRate = 1;
      }
      frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(frame);
      const video = youtubeVideoRef.current;
      if (video) video.playbackRate = 1;
    };
  }, [
    isFullscreen,
    settings.fullscreenYoutubeBackground,
    videoUrl,
    youtubeVideoFailed,
    hasVideoSync,
    effectiveVideoOffset,
  ]);

  useEffect(() => {
    youtubeReadyRef.current = false;
    setYoutubeVideoFailed(false);
    if (!isFullscreen || !settings.fullscreenYoutubeBackground || !videoUrl) return;
    const timer = window.setTimeout(() => {
      if (!youtubeReadyRef.current) setYoutubeVideoFailed(true);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [isFullscreen, settings.fullscreenYoutubeBackground, videoUrl]);
  const lyricsMode = tab === 'lyrics';
  const noSide = tab === null;
  const showLiveBanner = settings.showLyricsBanner !== false;
  const dynamicFullscreen = isFullscreen && theme.dynamicTheme === 'auto';

  if (!track) {
    return (
      <div className={`expanded-player ${lyricsMode ? 'lyrics-mode' : ''}`}>
        <div className="ep-topbar">
          <Button variant="icon" icon="expand_more" title="Close player" onClick={onClose} />
          <div className="ep-topbar-actions">
            <WindowControls className="ep-window-controls" />
          </div>
        </div>
        <EmptyState
          icon={<Icon name="music_note" size={64} />}
          title="Nothing playing"
          subtitle="Choose a song to open the now playing view."
          action={<Button variant="surface" label="Close" onClick={onClose} />}
        />
      </div>
    );
  }

  const playing = status === 'playing' || status === 'buffering';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const repeatIcon = repeat === 'one' ? 'repeat_one' : 'repeat';
  const customBackground = settings.pageBackgrounds?.["player"] || '';
  const background =
    customBackground || coverArtUrl(track.coverArt || track.albumCover, 900);
  const backgroundIsVideo = isVideoPageBackground(customBackground);
  const youtubeVideoActive =
    isFullscreen && !!settings.fullscreenYoutubeBackground && !!videoUrl && !youtubeVideoFailed;
  const videoSyncLabel = `${manualSyncOffset > 0 ? '+' : ''}${manualSyncOffset.toFixed(1)}s`;

  const adjustVideoSync = (delta: number) => {
    const nextValue = Math.max(
      -30,
      Math.min(30, Math.round((manualSyncOffset + delta) * 2) / 2),
    );
    const next = { ...(settings.youtubeBackgroundSyncOffsets || {}) };
    if (nextValue === 0) delete next[track.id];
    else next[track.id] = nextValue;
    store.updateSettings({ youtubeBackgroundSyncOffsets: next });
  };

  const toggleStar = async () => {
    const next = !starred;
    setStarred(next);
    try {
      await setTrackStarred(track.id, next);
    } catch (reason: any) {
      setStarred(!next);
      pushToast(reason?.message || 'Could not update favourite.', 'error');
    }
  };

  return (
    <div
      className={`expanded-player ${lyricsMode ? 'lyrics-mode' : ''} ${noSide ? 'no-side' : ''} ${dynamicFullscreen ? 'dynamic-fullscreen' : ''} ${uiHidden && isFullscreen && settings.fullscreenAutoHideUi ? 'ui-hidden' : ''} ${youtubeVideoActive ? 'youtube-background' : ''}`}
    >
      {background && !youtubeVideoActive && (
        <div
          className={`ep-bg ${customBackground ? 'custom' : ''} ${backgroundIsVideo ? 'ep-bg-video' : ''}`}
          style={
            backgroundIsVideo ? undefined : { backgroundImage: `url("${background}")` }
          }
        >
          {backgroundIsVideo && (
            <BackgroundVideo className="ep-bg-video-element" src={background} />
          )}
        </div>
      )}
      {youtubeVideoActive && (
        <div className="ep-video-bg" aria-hidden="true">
          <video
            ref={youtubeVideoRef}
            src={videoUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            tabIndex={-1}
            disablePictureInPicture
            onLoadedMetadata={(event) => {
              if (hasVideoSync) {
                event.currentTarget.currentTime =
                  effectiveVideoOffset + Math.max(0, currentTime);
              }
            }}
            onTimeUpdate={(event) => {
              if (hasVideoSync && event.currentTarget.currentTime < effectiveVideoOffset) {
                event.currentTarget.currentTime = effectiveVideoOffset;
              }
            }}
            onCanPlay={() => {
              youtubeReadyRef.current = true;
              setYoutubeVideoFailed(false);
            }}
            onError={() => setYoutubeVideoFailed(true)}
          />
        </div>
      )}
      {dynamicFullscreen && !youtubeVideoActive && (
        <div className="ep-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="ep-scrim" />

      <div className="ep-topbar">
        <Button variant="icon" icon="expand_more" title="Close player" onClick={onClose} />
        <div className="ep-tabs" role="tablist" aria-label="Player panes">
          {([
            ['now', 'Up next'],
            ['lyrics', 'Lyrics'],
            ['queue', 'Queue'],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button
              key={id}
              className={`tab ep-tab ${tab === id ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab((current) => (current === id ? null : id))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ep-topbar-actions">
          <Button
            variant="icon"
            icon="lyrics"
            active={showLiveBanner}
            title={showLiveBanner ? 'Hide live lyrics banner' : 'Show live lyrics banner'}
            onClick={() =>
              store.updateSettings({ showLyricsBanner: !showLiveBanner })
            }
          />
          <Button
            variant="icon"
            icon="link"
            active={!!customVideoId}
            title={customVideoId ? 'Change custom YouTube background' : 'Set custom YouTube background'}
            onClick={() => setCustomVideoOpen(true)}
          />
          {isFullscreen &&
            settings.fullscreenYoutubeBackground &&
            videoUrl &&
            !youtubeVideoFailed && (
              <div className="ep-sync-adjust" title="Adjust background video sync">
                <Button
                  variant="icon"
                  className="btn-compact"
                  icon="remove"
                  title="Play video 0.5 seconds earlier"
                  onClick={() => adjustVideoSync(-0.5)}
                />
                <button
                  type="button"
                  className="ep-sync-value"
                  title="Reset video sync offset"
                  aria-label={`Video sync offset ${videoSyncLabel}. Reset offset.`}
                  onClick={() => adjustVideoSync(-manualSyncOffset)}
                >
                  {videoSyncLabel}
                </button>
                <Button
                  variant="icon"
                  className="btn-compact"
                  icon="add"
                  title="Play video 0.5 seconds later"
                  onClick={() => adjustVideoSync(0.5)}
                />
              </div>
            )}
          {isFullscreen && (
            <Button
              variant="icon"
              icon="smart_display"
              active={!!settings.fullscreenYoutubeBackground}
              title={
                settings.fullscreenYoutubeBackground
                  ? 'Disable YouTube video background'
                  : 'Use YouTube music video as background'
              }
              onClick={() =>
                store.updateSettings({
                  fullscreenYoutubeBackground: !settings.fullscreenYoutubeBackground,
                })
              }
            />
          )}
          <Button
            variant="icon"
            icon={isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            onClick={onToggleFullscreen}
          />
          <Button
            variant="icon"
            icon={starred ? 'favorite' : 'favorite_border'}
            active={starred}
            title={starred ? 'Remove from favourites' : 'Add to favourites'}
            onClick={toggleStar}
          />
          <WindowControls className="ep-window-controls" />
        </div>
      </div>

      <div className={`ep-body ${noSide ? 'no-side' : ''}`}>

        <div className="ep-art-col">
          <div className="ep-art" key={track.id}>
            <Artwork
              src={coverArtUrl(track.coverArt || track.albumCover, 700) || null}
              size={380}
              radius="none"
              alt={track.title}
            />
          </div>
          <div
            className="ep-info"
            onContextMenu={(event) =>
              showTrackMenu(event, track, {
                starred,
                onToggleStar: toggleStar,
              })
            }
          >
            <button
              type="button"
              className="ep-title link-button"
              onClick={() => openTrackDetails(track)}
            >
              {track.title}
            </button>
            <button
              type="button"
              className="ep-artist link-button"
              disabled={!track.artistId}
              onClick={() => {
                if (track.artistId) store.setNavigation(go.artist(track.artistId));
              }}
            >
              {track.artist}
            </button>
            <button
              type="button"
              className="ep-album link-button muted"
              disabled={!track.albumId}
              onClick={() => {
                if (track.albumId) store.setNavigation(go.album(track.albumId));
              }}
            >
              {track.album}
            </button>
          </div>

          <div className="ep-progress">
            <div
              className="bp-progress"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={0}
              onClick={(event) => {
                if (duration <= 0) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                playback.seek(ratio * duration);
              }}
            >
              <div className="bp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span className="bp-time">{formatDuration(currentTime)}</span>
              <span className="bp-time">{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="ep-controls">
            <Button
              variant="icon"
              icon="shuffle"
              active={shuffle}
              title="Shuffle"
              onClick={() => playback.setShuffle(!shuffle)}
            />
            <Button variant="icon" icon="skip_previous" title="Previous" onClick={() => playback.prev()} />
            <Button
              variant="play"
              icon={playing ? 'pause' : 'play_arrow'}
              title={playing ? 'Pause' : 'Play'}
              onClick={() => playback.playPause()}
              style={{ width: 56, height: 56 }}
            />
            <Button variant="icon" icon="skip_next" title="Next" onClick={() => playback.next(true)} />
            <Button
              variant="icon"
              icon={repeatIcon}
              active={repeat !== 'off'}
              title="Repeat"
              onClick={() => {
                const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
                playback.setRepeat(modes[(modes.indexOf(repeat) + 1) % modes.length]);
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 240 }}>
            <Button
              variant="icon"
              className="btn-compact"
              icon={muted ? 'volume_off' : volume > 0.5 ? 'volume_up' : 'volume_down'}
              title={muted ? 'Unmute' : 'Mute'}
              onClick={() => playback.toggleMute()}
            />
            <input
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => {
                if (muted) playback.setMuted(false);
                playback.setVolume(Number(event.target.value));
              }}
              aria-label="Volume"
            />
          </div>
        </div>

        {tab !== null && (
          <div className={`ep-side ${tab === 'lyrics' ? 'lyrics-mode' : ''}`}>
            <div className="ep-side-title">
              <div className="h3">
                {tab === 'lyrics' ? 'Lyrics' : tab === 'queue' ? 'Queue' : 'Up next'}
              </div>
            </div>
            {tab === 'lyrics' ? (
              <LyricsView track={track} currentTime={currentTime} onSeek={(seconds) => playback.seek(seconds)} />
            ) : (
              <QueueList compact showActions={tab === 'queue'} />
            )}
          </div>
        )}
      </div>

      {showLiveBanner && tab !== 'lyrics' ? (
        <div className="ep-live-wrap">
          <LiveLyricsBanner
            track={track}
            currentTime={currentTime}
            onOpenLyrics={() => setTab('lyrics')}
          />
        </div>
      ) : null}
      {customVideoOpen && (
        <CustomYouTubeBackgroundDialog track={track} onClose={() => setCustomVideoOpen(false)} />
      )}
    </div>
  );
}




