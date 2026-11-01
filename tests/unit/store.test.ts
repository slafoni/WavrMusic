import { describe, it, expect } from 'vitest';
import { store } from '../../src/renderer/state/store';
import type { Track } from '../../shared/models';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: overrides.id ?? 't1',
    title: overrides.title ?? 'Song',
    artist: overrides.artist ?? 'Artist',
    album: overrides.album ?? 'Album',
    duration: overrides.duration ?? 200,
    ...overrides,
  };
}

describe('store playback state', () => {
  it('starts idle with no track', () => {
    expect(store.getPlayback().status).toBe('idle');
    expect(store.getPlayback().track).toBeNull();
  });

  it('setTrack transitions to loading', () => {
    const track = makeTrack();
    store.setTrack(track, 'loading');
    const p = store.getPlayback();
    expect(p.status).toBe('loading');
    expect(p.track).toBe(track);
    expect(p.currentTime).toBe(0);
  });

  it('setProgress updates time and duration', () => {
    store.setProgress(30, 200);
    const p = store.getPlayback();
    expect(p.currentTime).toBe(30);
    expect(p.duration).toBe(200);
  });

  it('setPlaybackStatus updates status', () => {
    store.setPlaybackStatus('playing');
    expect(store.getPlayback().status).toBe('playing');
    store.setPlaybackStatus('paused');
    expect(store.getPlayback().status).toBe('paused');
  });
});

describe('store navigation', () => {
  it('navigates back and forward through visited pages', () => {
    store.setNavigation('navigation-test-a');
    store.setNavigation('navigation-test-b');
    store.setNavigation('navigation-test-c');
    expect(store.navigateBack()).toBe(true);
    expect(store.getNavigation()).toBe('navigation-test-b');
    expect(store.navigateBack()).toBe(true);
    expect(store.getNavigation()).toBe('navigation-test-a');
    expect(store.navigateForward()).toBe(true);
    expect(store.getNavigation()).toBe('navigation-test-b');
  });

  it('does not add duplicate consecutive entries', () => {
    store.setNavigation('navigation-test-duplicate');
    store.setNavigation('navigation-test-duplicate');
    store.navigateBack();
    expect(store.getNavigation()).toBe('navigation-test-b');
  });
});

describe('store queue', () => {
  beforeEach(() => {
    store.setQueue([], -1);
  });

  it('setQueue stores tracks and index', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })];
    store.setQueue(tracks, 0);
    expect(store.getQueue()).toEqual(tracks);
    expect(store.getQueueIndex()).toBe(0);
  });

  it('addToQueue appends tracks', () => {
    store.setQueue([makeTrack({ id: 'a' })], 0);
    store.addToQueue([makeTrack({ id: 'b' }), makeTrack({ id: 'c' })]);
    expect(store.getQueue().length).toBe(3);
    expect(store.getQueueIndex()).toBe(0);
  });

  it('addToQueue playNow inserts at front', () => {
    store.setQueue([makeTrack({ id: 'a' })], 0);
    store.addToQueue([makeTrack({ id: 'b' })], true);
    expect(store.getQueue()[0].id).toBe('b');
    expect(store.getQueueIndex()).toBe(0);
  });

  it('removeFromQueue removes by index', () => {
    store.setQueue([makeTrack({ id: 'a' }), makeTrack({ id: 'b' }), makeTrack({ id: 'c' })], 1);
    store.removeFromQueue(0);
    expect(store.getQueue().map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('requeue moves a track', () => {
    store.setQueue([makeTrack({ id: 'a' }), makeTrack({ id: 'b' }), makeTrack({ id: 'c' })], 0);
    store.requeue(2, 0);
    expect(store.getQueue().map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('clearQueue empties queue', () => {
    store.setQueue([makeTrack({ id: 'a' })], 0);
    store.clearQueue();
    expect(store.getQueue().length).toBe(0);
    expect(store.getQueueIndex()).toBe(-1);
  });

  it('getCurrentQueueEntry returns null when empty', () => {
    expect(store.getCurrentQueueEntry()).toBeNull();
  });
});

describe('store server', () => {
  it('setServerProfile and setServerInfo round-trip', () => {
    const profile = { id: '1', name: 'S', url: 'http://x', username: 'u', default: true, createdAt: Date.now() };
    store.setServerProfile(profile);
    expect(store.getServerProfile()).toEqual(profile);
    store.setServerInfo({ url: 'http://x', username: 'u', connected: true, capabilities: null, version: '1.16.1' });
    expect(store.getServerInfo()?.connected).toBe(true);
  });

  it('setCapabilities stores caps', () => {
    const caps = { version: '1.16.1', openSubsonic: true, supportsLyrics: true, supportsStarred: true, supportsPlayQueue: true, supportsGenres: true, supportsInternetRadio: true, operations: { getArtists: true } };
    store.setCapabilities(caps);
    expect(store.getCapabilities()?.supportsLyrics).toBe(true);
  });
});

describe('store settings', () => {
  it('updateSettings merges and notifies', () => {
    const orig = store.getSettings();
    let calls = 0;
    const unsub = store.subscribe(() => { calls++; });
    store.updateSettings({ themeMode: 'light' });
    expect(store.getSettings().themeMode).toBe('light');
    expect(calls).toBeGreaterThan(0);
    unsub();
  });
});
