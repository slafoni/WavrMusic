import { useEffect } from 'react';
import type { WavrRemoteCommand, WavrRemotePlayback } from '../../../shared/wavrsync';
import { store } from '../state';
import { playback } from '../services/playbackService';
import { wavrSync } from '../services/wavrSyncService';

function currentRemotePlayback(): WavrRemotePlayback {
  const current = store.getPlayback();
  const track = current.track;
  const status = current.status;
  return {
    status:
      status === 'playing' || status === 'loading' || status === 'buffering' || status === 'seeking'
        ? 'playing'
        : track
          ? 'paused'
          : 'idle',
    track: track
      ? {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          coverArt: track.coverArt || track.albumCover || '',
        }
      : null,
    position: playback.getCurrentTime(),
    duration: playback.getDuration() || track?.duration || 0,
    volume: playback.getVolume(),
    muted: playback.isMuted(),
  };
}

export function useWavrRemoteControl() {
  useEffect(() => {
    return wavrSync.onRemoteCommand((command: WavrRemoteCommand) => {
      switch (command.command) {
        case 'play':
          playback.resume();
          break;
        case 'pause':
          playback.pause();
          break;
        case 'toggle':
          playback.playPause();
          break;
        case 'next':
          playback.next(true);
          break;
        case 'prev':
          playback.prev();
          break;
        case 'volume':
          playback.setVolume(Number(command.volume) || 0);
          break;
        case 'mute':
          playback.setMuted(!!command.muted);
          break;
      }
    });
  }, []);

  useEffect(() => {
    let lastSent = 0;
    let trailing = 0;
    const publish = () => {
      const state = wavrSync.getState();
      if (state.connection !== 'connected' || !state.features.includes('remoteControl')) return;
      const now = Date.now();
      const wait = Math.max(0, 750 - (now - lastSent));
      if (wait > 0) {
        window.clearTimeout(trailing);
        trailing = window.setTimeout(publish, wait);
        return;
      }
      lastSent = now;
      wavrSync.sendRemoteState(currentRemotePlayback());
    };
    publish();
    const unsubscribe = store.subscribe(publish);
    const heartbeat = window.setInterval(publish, 5000);
    return () => {
      unsubscribe();
      window.clearTimeout(trailing);
      window.clearInterval(heartbeat);
    };
  }, []);
}
