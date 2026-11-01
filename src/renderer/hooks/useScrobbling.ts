import { useCallback, useEffect, useState } from 'react';
import type { ScrobbleProvider, ScrobbleStatus } from '../../../shared/models';
import { isScrobbleEligible, scrobbleThreshold, toScrobbleTrack } from '../../../shared/scrobble';
import { store } from '../state';

function electronApi(): any {
  return (window as any).electronAPI;
}

export function useScrobbleStatus(enabled: boolean, provider: ScrobbleProvider) {
  const [status, setStatus] = useState<ScrobbleStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await electronApi()?.scrobbleStatus?.();
      if (next) setStatus(next);
      return (next || null) as ScrobbleStatus | null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await electronApi()?.scrobbleStatus?.();
        if (!cancelled && next) setStatus(next);
      } catch {
        /* status is optional */
      }
    };
    void load();
    const unsubscribe = electronApi()?.onScrobbleStatus?.((next: ScrobbleStatus) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, provider]);

  const connect = useCallback(async (target: ScrobbleProvider) => {
    const next = await electronApi()?.scrobbleConnect?.(target);
    if (next) setStatus(next);
    return (next || null) as ScrobbleStatus | null;
  }, []);

  const disconnect = useCallback(async () => {
    const next = await electronApi()?.scrobbleDisconnect?.();
    if (next) setStatus(next);
    return (next || null) as ScrobbleStatus | null;
  }, []);

  return { status, refresh, connect, disconnect };
}

export function useScrobbler(enabled: boolean, provider: ScrobbleProvider) {
  const { status } = useScrobbleStatus(enabled, provider);
  const connected = !!status?.connected && status.provider === provider;

  useEffect(() => {
    if (!enabled || !connected) return;
    const api = electronApi();
    if (!api?.scrobbleNowPlaying || !api?.scrobbleSubmit) return;

    let trackKey = '';
    let timestamp = 0;
    let played = 0;
    let nowPlayingSent = false;
    let submitted = false;
    let lastStatus = store.getPlayback().status;
    let lastTick = Date.now();

    const reset = () => {
      trackKey = '';
      timestamp = Math.floor(Date.now() / 1000);
      played = 0;
      nowPlayingSent = false;
      submitted = false;
      lastTick = Date.now();
      lastStatus = store.getPlayback().status;
    };

    const tick = () => {
      const playback = store.getPlayback();
      const track = playback.track;
      if (!track || !isScrobbleEligible(toScrobbleTrack(track, playback.duration))) {
        trackKey = '';
        return;
      }
      const key = `${track.id}|${store.getQueueIndex()}`;
      const restarted = lastStatus === 'ended' && playback.status !== 'ended';
      if (key !== trackKey || restarted) {
        reset();
        trackKey = key;
      }

      const now = Date.now();
      const delta = Math.max(0, Math.min(2, (now - lastTick) / 1000));
      lastTick = now;

      if (playback.status === 'playing') {
        const payload = toScrobbleTrack(track, playback.duration);
        if (!nowPlayingSent) {
          nowPlayingSent = true;
          api.scrobbleNowPlaying(payload);
        }
        played += delta;
        const threshold = scrobbleThreshold(playback.duration || track.duration || 0);
        if (!submitted && threshold !== null && played >= threshold) {
          submitted = true;
          api.scrobbleSubmit({ ...payload, timestamp });
        }
      }
      lastStatus = playback.status;
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, connected, provider]);
}
