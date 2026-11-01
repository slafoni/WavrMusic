import { describe, expect, it } from 'vitest';
import { WavrSyncProfileStore } from '../../wavrsync-server/profiles.mjs';

function track(id) {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    coverArt: `cover-${id}`,
  };
}

describe('WavrSyncProfileStore', () => {
  it('stores profile metadata and Subsonic summaries', () => {
    const store = new WavrSyncProfileStore({ now: () => 1000 });
    const profile = store.publish('user-1', {
      name: 'Listener',
      avatar: 'data:image/webp;base64,AAAA',
      banner: 'data:image/webp;base64,BBBB',
      tags: ['ambient', 'Ambient', 'jazz'],
      currentTrack: track('current'),
      topSongs: [track('a')],
      topArtists: [{ id: 'ar1', name: 'Artist', coverArt: 'cover-ar1' }],
      favoriteSongs: [track('b')],
      playlists: [{ id: 'p1', name: 'Favourites', owner: 'listener', songCount: 4 }],
    });
    expect(profile.name).toBe('Listener');
    expect(profile.tags).toEqual(['ambient', 'jazz']);
    expect(profile.currentTrack?.id).toBe('current');
    expect(profile.topSongs).toHaveLength(1);
    expect(profile.playlists[0].name).toBe('Favourites');
  });

  it('rejects invalid image payloads and preserves profile metadata', () => {
    const store = new WavrSyncProfileStore({ now: () => 1000 });
    const profile = store.publish('user-1', {
      name: 'Listener',
      avatar: 'not-an-image',
      banner: 'https://example.com/banner.jpg',
    });
    expect(profile.avatar).toBe('');
    expect(profile.banner).toBe('');
  });

  it('creates symmetric friend relationships', () => {
    const store = new WavrSyncProfileStore({ now: () => 1000 });
    store.ensure('user-1', 'One');
    store.ensure('user-2', 'Two');
    const [first, second] = store.addFriend('user-1', 'user-2');
    expect(first.friends).toContain('user-2');
    expect(second.friends).toContain('user-1');
    store.removeFriend('user-1', 'user-2');
    expect(store.get('user-1')?.friends).toEqual([]);
    expect(store.get('user-2')?.friends).toEqual([]);
  });

  it('searches public profile summaries by name', () => {
    const store = new WavrSyncProfileStore({ now: () => 1000 });
    store.publish('user-1', { name: 'Soham', avatar: 'data:image/webp;base64,AAAA', tags: ['ambient'] });
    store.publish('user-2', { name: 'Listener', tags: ['rock'] });
    const results = store.search('soh');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'user-1',
      name: 'Soham',
      avatar: 'data:image/webp;base64,AAAA',
      tags: ['ambient'],
    });
    expect(store.search('')).toEqual([]);
  });

  it('serializes and restores profiles', () => {
    const store = new WavrSyncProfileStore({ now: () => 1000 });
    store.publish('user-1', {
      name: 'One',
      tags: ['rock'],
      topSongs: [track('a')],
    });
    const restored = new WavrSyncProfileStore({ now: () => 2000 });
    restored.load(store.serialize());
    expect(restored.get('user-1')?.name).toBe('One');
    expect(restored.get('user-1')?.tags).toEqual(['rock']);
    expect(restored.get('user-1')?.topSongs[0].id).toBe('a');
  });
});
