import { useEffect } from 'react';
import { store } from '../state';
import { publicCoverArtUrl, directCoverArtUrl } from '../services/serverService';

function electronApi(): any {
  return (window as any).electronAPI;
}

const artworkCache = new Map<string, string | undefined>();

type DiscordPlaybackStatus = 'playing' | 'buffering' | 'paused' | 'loading';

export interface DiscordWavrSyncPresence {
  roomCode: string;
  roomName: string;
  inviteUrl: string;
  participants: number;
  visibility: 'private' | 'public';
}

export function useDiscordPresence(
  enabled: boolean,
  clientId: string,
  wavrSyncPresence: DiscordWavrSyncPresence | null = null,
) {
  useEffect(() => {
    const api = electronApi();
    if (!api?.updateDiscordActivity) return;
    if (!enabled) {
      api.clearDiscordActivity?.();
      return;
    }

    let lastKey = '';
    let timer = 0;
    let artworkTrackId = '';
    let artworkUrl: string | undefined;
    let artworkSource = '';
    let publishedAt = 0;
    let publishedTime = 0;
    let publishedTrackId = '';
    let publishedStatus: DiscordPlaybackStatus | null = null;
    let cancelled = false;

    const publish = () => {
      if (cancelled) return;
      const playback = store.getPlayback();
      const track = playback.track;
      const playbackStatus: DiscordPlaybackStatus | null =
        playback.status === 'paused'
          ? 'paused'
          : playback.status === 'loading'
            ? 'loading'
            : playback.status === 'buffering'
              ? 'buffering'
              : playback.status === 'playing' || playback.status === 'seeking'
                ? 'playing'
                : null;

      if (!track || !playbackStatus) {
        if (lastKey) {
          lastKey = '';
          artworkTrackId = '';
          artworkUrl = undefined;
          publishedStatus = null;
          api.clearDiscordActivity?.();
        }
        return;
      }

      if (playbackStatus === 'paused') {
        if (lastKey) {
          lastKey = '';
          artworkTrackId = '';
          artworkUrl = undefined;
          publishedStatus = null;
          api.clearDiscordActivity?.();
        }
        return;
      }

      const candidate = publicCoverArtUrl(track.coverArt || track.albumCover, 512);
      if (artworkSource !== candidate) {
        artworkSource = candidate;
        artworkTrackId = '';
        artworkUrl = undefined;
      }
      if (candidate && artworkTrackId !== track.id) {
        artworkTrackId = track.id;
        const cached = artworkCache.get(candidate);
        artworkUrl = cached;
        if (!artworkCache.has(candidate)) {
          const image = new Image();
          let settled = false;
          const finish = (resolved: string | undefined) => {
            if (settled || cancelled) return;
            settled = true;
            artworkCache.set(candidate, resolved);
            if (store.getPlayback().track?.id === track.id) {
              artworkUrl = resolved;
              publish();
            }
          };
          const timeout = window.setTimeout(() => finish(undefined), 2500);
          image.onload = () => {
            window.clearTimeout(timeout);
            finish(candidate);
          };
          image.onerror = () => {
            window.clearTimeout(timeout);
            finish(undefined);
          };
          image.src = candidate;
        }
      } else if (!candidate) {
        artworkTrackId = '';
        artworkUrl = undefined;
      }

      const duration = Math.round(playback.duration || track.duration || 0);
      const elapsed =
        playbackStatus === 'playing' && publishedStatus === 'playing' && publishedTrackId === track.id
          ? Math.max(0, (Date.now() - publishedAt) / 1000)
          : 0;
      const drifted =
        publishedStatus === 'playing' &&
        publishedTrackId === track.id &&
        Math.abs(playback.currentTime - (publishedTime + elapsed)) > 2;

      const key = `${track.id}|${playbackStatus}|${duration}|${artworkUrl || ''}|${wavrSyncPresence?.roomCode || ''}|${wavrSyncPresence?.participants || 0}|${wavrSyncPresence?.inviteUrl || ''}|${wavrSyncPresence?.visibility || ''}`;
      if (key === lastKey && !drifted) return;
      lastKey = key;
      publishedAt = Date.now();
      publishedTime = playback.currentTime;
      publishedTrackId = track.id;
      publishedStatus = playbackStatus;
      api.updateDiscordActivity?.({
        title: track.title,
        artist: track.artist,
        album: track.album,
        isPlaying: playbackStatus === 'playing',
        playbackStatus,
        currentTime: playback.currentTime,
        duration,
        updatedAt: publishedAt,
        artworkUrl,
        artworkFetchUrl: directCoverArtUrl(track.coverArt || track.albumCover, 512),
        wavrSync: wavrSyncPresence || undefined,
      });
    };

    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        publish();
      }, 200);
    };

    publish();
    const unsubscribe = store.subscribe(schedule);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe();
      api.clearDiscordActivity?.();
    };
  }, [
    enabled,
    clientId,
    wavrSyncPresence?.roomCode,
    wavrSyncPresence?.roomName,
    wavrSyncPresence?.inviteUrl,
    wavrSyncPresence?.participants,
    wavrSyncPresence?.visibility,
  ]);
}
