import { useEffect, useRef, useState } from 'react';
import type { WavrSyncPlaybackStatus } from '../../../shared/models';
import {
  WAVRSYNC_DRIFT_LIMIT_SECONDS,
  wavrSyncExpectedPosition,
  wavrSyncQueueKey,
} from '../../../shared/wavrsync';
import { store } from '../state';
import { playback } from '../services/playbackService';
import { wavrSync, type WavrSyncState } from '../services/wavrSyncService';

export function useWavrSyncState(): WavrSyncState {
  const [state, setState] = useState<WavrSyncState>(() => wavrSync.getState());
  useEffect(() => {
    const unsubscribe = wavrSync.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}

function playbackStatusForWavrSync(): WavrSyncPlaybackStatus {
  const current = store.getPlayback();
  if (current.status === 'paused' || current.status === 'ended') return 'paused';
  if (
    current.status === 'playing' ||
    current.status === 'loading' ||
    current.status === 'buffering' ||
    current.status === 'seeking'
  ) {
    return 'playing';
  }
  return current.track ? 'paused' : 'idle';
}

export function useWavrSyncPlaybackSync(state: WavrSyncState) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const suppressUntil = useRef(0);
  const lastAppliedVersion = useRef(-1);
  const lastRoomCode = useRef('');
  const lastPublished = useRef({
    queueKey: '',
    index: -1,
    status: 'idle' as WavrSyncPlaybackStatus,
    trackId: null as string | null,
    position: 0,
    at: 0,
  });
  const retryTimer = useRef(0);
  const resumeTimer = useRef(0);
  const seekTimers = useRef<number[]>([]);

  useEffect(() => {
    const room = state.room;
    window.clearTimeout(resumeTimer.current);
    for (const timer of seekTimers.current) window.clearTimeout(timer);
    seekTimers.current = [];
    if (!room || state.connection !== 'connected') {
      if (!room) {
        lastAppliedVersion.current = -1;
        lastRoomCode.current = '';
      }
      return;
    }
    if (room.code !== lastRoomCode.current) {
      lastRoomCode.current = room.code;
      lastAppliedVersion.current = -1;
      lastPublished.current = {
        queueKey: '',
        index: -1,
        status: 'idle',
        trackId: null,
        position: 0,
        at: 0,
      };
    }
    if (room.version === lastAppliedVersion.current) return;
    lastAppliedVersion.current = room.version;

    const target = room.queue[room.currentIndex];
    if (!target) return;
    const localQueue = playback.getQueue();
    const localIndex = playback.getQueueIndex();
    const localKey = wavrSyncQueueKey(localQueue, localIndex);
    const roomKey = wavrSyncQueueKey(room.queue, room.currentIndex);
    const current = playback.getCurrentTrack();
    const needsLoad = !current || current.id !== target.id || localKey !== roomKey;
    if (needsLoad || room.lastChangedBy !== state.userId) {
      suppressUntil.current = Date.now() + 1200;
    }
    if (room.lastChangedBy !== state.userId) {
      lastPublished.current = {
        queueKey: roomKey,
        index: room.currentIndex,
        status: room.playback.status,
        trackId: room.playback.trackId,
        position: room.playback.position,
        at: Date.now(),
      };
    }

    const expected = wavrSyncExpectedPosition(room.playback, Date.now(), state.clockOffset);
    const duration = target.duration || playback.getDuration();
    const targetPosition = duration > 0 ? Math.min(expected, duration) : expected;
    const autoplay = room.playback.status === 'playing';
    const ensurePlaying = () => {
      if (playback.getCurrentTrack()?.id !== target.id) return;
      if (room.playback.status !== 'playing') return;
      const status = playback.getStatus();
      if (status === 'playing') return;
      if (status === 'loading' || status === 'buffering' || status === 'seeking') {
        resumeTimer.current = window.setTimeout(ensurePlaying, 300);
        return;
      }
      playback.resume();
    };

    if (needsLoad) {
      playback.playQueue(room.queue, room.currentIndex, autoplay);
      const applyPosition = () => {
        if (playback.getCurrentTrack()?.id === target.id) playback.seek(targetPosition);
      };
      seekTimers.current.push(
        window.setTimeout(applyPosition, 1200),
        window.setTimeout(applyPosition, 3200),
      );
      if (autoplay) resumeTimer.current = window.setTimeout(ensurePlaying, 500);
      return;
    }

    const localStatus = playback.getStatus();
    if (autoplay && localStatus !== 'playing') {
      if (localStatus === 'loading' || localStatus === 'buffering' || localStatus === 'seeking') {
        resumeTimer.current = window.setTimeout(ensurePlaying, 300);
      } else {
        playback.resume();
      }
    } else if (!autoplay && room.playback.status === 'paused' && localStatus === 'playing') {
      playback.pause();
    }
    if (
      localStatus !== 'loading' &&
      localStatus !== 'buffering' &&
      localStatus !== 'seeking' &&
      Math.abs(playback.getCurrentTime() - targetPosition) > WAVRSYNC_DRIFT_LIMIT_SECONDS
    ) {
      playback.seek(targetPosition);
    }
  }, [state.room?.code, state.room?.version, state.connection, state.userId, state.clockOffset]);

  useEffect(() => {
    if (state.connection !== 'connected' || !state.room) {
      lastPublished.current.at = 0;
      return;
    }

    const publish = () => {
      const currentState = stateRef.current;
      const room = currentState.room;
      if (!room || currentState.connection !== 'connected') return;
      const isHost = room.hostId === currentState.userId;
      const canControl = room.controlMode === 'everyone' || isHost;
      if (!canControl) return;
      if (Date.now() < suppressUntil.current) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(
          publish,
          Math.max(50, suppressUntil.current - Date.now() + 50),
        );
        return;
      }

      const queue = playback.getQueue();
      const index = playback.getQueueIndex();
      const current = store.getPlayback();
      if (!current.track || index < 0 || !queue.length) return;
      if (room.queue.length === 0 && !isHost) return;

      const queueKey = wavrSyncQueueKey(queue, index);
      const status = playbackStatusForWavrSync();
      const trackId = current.track.id;
      const now = Date.now();
      if (queueKey !== lastPublished.current.queueKey) {
        wavrSync.sendQueue(queue, index);
        lastPublished.current.queueKey = queueKey;
      }

      const expected = wavrSyncExpectedPosition(room.playback, now, currentState.clockOffset);
      const sameTrack = room.playback.trackId === trackId;
      const drift = sameTrack ? Math.abs(current.currentTime - expected) : 0;
      const changed =
        trackId !== lastPublished.current.trackId ||
        status !== lastPublished.current.status ||
        index !== lastPublished.current.index;
      const heartbeat = isHost && now - lastPublished.current.at >= 5000;
      if (changed || heartbeat || drift > WAVRSYNC_DRIFT_LIMIT_SECONDS) {
        wavrSync.sendPlayback(status, Math.max(0, current.currentTime), index);
        lastPublished.current = {
          queueKey,
          index,
          status,
          trackId,
          position: current.currentTime,
          at: now,
        };
      }
    };

    publish();
    let publishTimer = 0;
    const unsubscribe = store.subscribe(() => {
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(publish, 300);
    });
    const heartbeat = window.setInterval(publish, 5000);
    return () => {
      unsubscribe();
      window.clearTimeout(publishTimer);
      window.clearTimeout(retryTimer.current);
      window.clearInterval(heartbeat);
    };
  }, [state.connection, state.room?.code, state.userId]);
}
