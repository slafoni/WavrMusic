/* Lightweight, typed state store with React bindings.
   Keeps playback, server, queue, navigation, and settings separate. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AppSettings,
  PlaybackState,
  Track,
  QueueEntry,
  ServerProfile,
  ServerInfo,
  ServerCapabilities,
} from '../../../shared/models';
import { DEFAULT_SETTINGS } from '../../../shared/constants';

type Listener = () => void;

class Store {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private playback: PlaybackState = {
    status: 'idle',
    track: null,
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_SETTINGS.defaultVolume,
    muted: false,
    shuffle: false,
    repeat: 'off',
    error: null,
  };
  private queue: Track[] = [];
  private queueIndex = -1;
  private serverProfile: ServerProfile | null = null;
  private serverInfo: ServerInfo | null = null;
  private capabilities: ServerCapabilities | null = null;
  private navigation: string = 'home';
  private navigationHistory: string[] = ['home'];
  private navigationIndex = 0;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  // Settings
  getSettings(): AppSettings { return this.settings; }
  updateSettings(patch: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.emit();
  }

  // Playback
  getPlayback(): PlaybackState { return this.playback; }
  setPlayback(patch: Partial<PlaybackState>) {
    this.playback = { ...this.playback, ...patch };
    this.emit();
  }
  setTrack(track: Track | null, status: PlaybackState['status'] = 'loading') {
    this.playback = {
      ...this.playback,
      track,
      status,
      currentTime: 0,
      duration: track?.duration ?? 0,
      error: null,
    };
    this.emit();
  }
  setProgress(currentTime: number, duration?: number) {
    const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
    const safeDuration =
      duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : undefined;
    this.playback = {
      ...this.playback,
      currentTime: safeTime,
      ...(safeDuration !== undefined ? { duration: safeDuration } : {}),
    };
    this.emit();
  }
  setPlaybackStatus(status: PlaybackState['status']) {
    this.playback = { ...this.playback, status };
    this.emit();
  }

  // Queue
  getQueue(): Track[] { return this.queue; }
  getQueueIndex(): number { return this.queueIndex; }
  getCurrentQueueEntry(): QueueEntry | null {
    if (this.queueIndex < 0 || this.queueIndex >= this.queue.length) return null;
    return { id: `q-${this.queueIndex}`, track: this.queue[this.queueIndex], position: this.queueIndex, current: true };
  }
  setQueue(tracks: Track[], index = -1) {
    this.queue = tracks;
    this.queueIndex = index;
    this.emit();
  }
  addToQueue(tracks: Track[], playNow = false) {
    if (playNow) {
      this.queue = [...tracks, ...this.queue];
      this.queueIndex = 0;
    } else {
      this.queue = [...this.queue, ...tracks];
    }
    this.emit();
  }
  playNextInQueue(track: Track) {
    const insertAt = Math.max(0, this.queueIndex + 1);
    this.queue = [...this.queue.slice(0, insertAt), track, ...this.queue.slice(insertAt)];
    this.emit();
  }
  removeFromQueue(index: number) {
    this.queue = this.queue.filter((_, i) => i !== index);
    if (this.queueIndex >= this.queue.length) this.queueIndex = this.queue.length - 1;
    if (this.queueIndex < 0 && this.queue.length > 0) this.queueIndex = 0;
    this.emit();
  }
  requeue(fromIndex: number, toIndex: number) {
    const tracks = [...this.queue];
    const [removed] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, removed);
    this.queue = tracks;
    if (this.queueIndex === fromIndex) this.queueIndex = toIndex;
    else if (this.queueIndex > fromIndex && this.queueIndex <= toIndex) this.queueIndex -= 1;
    else if (this.queueIndex < fromIndex && this.queueIndex >= toIndex) this.queueIndex += 1;
    this.emit();
  }
  clearQueue() {
    this.queue = [];
    this.queueIndex = -1;
    this.emit();
  }
  setQueueIndex(index: number) {
    this.queueIndex = index;
    this.emit();
  }

  // Server
  getServerProfile(): ServerProfile | null { return this.serverProfile; }
  setServerProfile(profile: ServerProfile | null) {
    this.serverProfile = profile;
    this.emit();
  }
  getServerInfo(): ServerInfo | null { return this.serverInfo; }
  setServerInfo(info: ServerInfo | null) {
    this.serverInfo = info;
    this.emit();
  }
  getCapabilities(): ServerCapabilities | null { return this.capabilities; }
  setCapabilities(caps: ServerCapabilities | null) {
    this.capabilities = caps;
    this.emit();
  }

  // Navigation
  getNavigation(): string { return this.navigation; }
  setNavigation(id: string) {
    if (!id || id === this.navigation) return;
    this.navigation = id;
    this.navigationHistory = this.navigationHistory.slice(0, this.navigationIndex + 1);
    this.navigationHistory.push(id);
    if (this.navigationHistory.length > 100) {
      this.navigationHistory.shift();
    }
    this.navigationIndex = this.navigationHistory.length - 1;
    this.emit();
  }
  navigateBack(): boolean {
    if (this.navigationIndex <= 0) return false;
    this.navigationIndex -= 1;
    this.navigation = this.navigationHistory[this.navigationIndex];
    this.emit();
    return true;
  }
  navigateForward(): boolean {
    if (this.navigationIndex >= this.navigationHistory.length - 1) return false;
    this.navigationIndex += 1;
    this.navigation = this.navigationHistory[this.navigationIndex];
    this.emit();
    return true;
  }

  // Utils
  getCurrentTrack(): Track | null { return this.playback.track; }
  isPlaying(): boolean { return this.playback.status === 'playing'; }
}

export const store = new Store();

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used within StoreProvider');
  return s;
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

function useStoreSnapshot<T>(
  selector: (s: Store) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;

  const [value, setValue] = useState<T>(() => selector(store));

  useEffect(() => {
    const check = () =>
      setValue((previous) => {
        const next = selectorRef.current(store);
        return equalRef.current(previous, next) ? previous : next;
      });
    check();
    return store.subscribe(check);
  }, []);

  return value;
}

export function useStoreSelector<T>(selector: (s: Store) => T): T {
  return useStoreSnapshot(selector, shallowEqual);
}

export function usePlayback() {
  return useStoreSnapshot((s) => s.getPlayback());
}
export function useQueue() {
  return useStoreSnapshot(
    (s) => ({ queue: s.getQueue(), index: s.getQueueIndex() }),
    shallowEqual,
  );
}
export function useSettings() {
  return useStoreSnapshot((s) => s.getSettings(), shallowEqual);
}
export function useServer() {
  return useStoreSnapshot(
    (s) => ({ profile: s.getServerProfile(), info: s.getServerInfo(), caps: s.getCapabilities() }),
    shallowEqual,
  );
}
export function useNavigation() {
  return useStoreSnapshot((s) => s.getNavigation());
}
export function useCurrentTrackId() {
  return useStoreSnapshot((s) => s.getPlayback().track?.id ?? null);
}
export function usePlaybackStatus() {
  return useStoreSnapshot((s) => s.getPlayback().status);
}

export type { Store };
