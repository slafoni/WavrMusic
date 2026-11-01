import { describe, expect, it } from 'vitest';
import { WavrSyncRoomStore, WavrSyncStoreError } from '../../wavrsync-server/rooms.mjs';

function track(id, title = 'Song') {
  return {
    id,
    title,
    artist: 'Artist',
    album: 'Album',
    duration: 200,
    coverArt: `cover-${id}`,
  };
}

function storeAt(now = 1000) {
  return new WavrSyncRoomStore({ now: () => now });
}

describe('WavrSyncRoomStore', () => {
  it('creates a room with a host, queue and invite snapshot', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Friday',
      hostId: 'host-1',
      hostName: 'Host',
      visibility: 'private',
      controlMode: 'host',
      queue: [track('a'), track('b')],
      currentIndex: 1,
      libraryName: 'Home',
      libraryUrl: 'http://127.0.0.1:4533',
    });
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.participants).toHaveLength(1);
    expect(room.participants[0]).toMatchObject({ id: 'host-1', isHost: true });
    expect(room.playback.trackId).toBe('b');
    const snapshot = store.snapshot(room, 'https://wavrsync.example');
    expect(snapshot.inviteUrl).toBe(`https://wavrsync.example/join/${room.code}`);
    expect(snapshot.libraryName).toBe('Home');
    expect(snapshot.lastChangedBy).toBe('host-1');
  });

  it('enforces host-only control until everyone mode is enabled', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      queue: [track('a')],
      currentIndex: 0,
    });
    store.joinRoom(room.code, 'guest-1', 'Guest');
    expect(() =>
      store.setPlayback(room.code, 'guest-1', {
        status: 'playing',
        position: 10,
        currentIndex: 0,
      }),
    ).toThrow(WavrSyncStoreError);
    store.setControlMode(room.code, 'host-1', 'everyone');
    const updated = store.setPlayback(room.code, 'guest-1', {
      status: 'playing',
      position: 10,
      currentIndex: 0,
    });
    expect(updated.playback.status).toBe('playing');
    expect(updated.lastChangedBy).toBe('guest-1');
  });

  it('updates queues, playback and version together', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      queue: [track('a')],
      currentIndex: 0,
    });
    const version = room.version;
    store.setQueue(room.code, 'host-1', [track('a'), track('c')], 1);
    expect(room.queue.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(room.currentIndex).toBe(1);
    expect(room.version).toBe(version + 1);
    store.setPlayback(room.code, 'host-1', {
      status: 'playing',
      position: 42,
      currentIndex: 1,
    });
    expect(room.playback).toMatchObject({
      status: 'playing',
      position: 42,
      trackId: 'c',
    });
  });

  it('keeps playing state when the host moves to the next track', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      queue: [track('a'), track('b')],
      currentIndex: 0,
    });
    store.setPlayback(room.code, 'host-1', {
      status: 'playing',
      position: 30,
      currentIndex: 0,
    });
    store.setQueue(room.code, 'host-1', [track('a'), track('b')], 1);
    expect(room.playback).toMatchObject({
      status: 'playing',
      position: 0,
      trackId: 'b',
    });
  });

  it('shares validated participant avatars', () => {
    const store = storeAt();
    const avatar = 'data:image/webp;base64,AAAA';
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      hostAvatar: avatar,
    });
    expect(room.participants[0].avatar).toBe(avatar);
    store.joinRoom(room.code, 'guest-1', 'Guest', avatar);
    expect(room.participants.find((entry) => entry.id === 'guest-1')?.avatar).toBe(avatar);
    store.joinRoom(room.code, 'guest-2', 'No Avatar', 'not-an-image');
    expect(room.participants.find((entry) => entry.id === 'guest-2')?.avatar).toBeUndefined();
  });

  it('lets the host change room visibility', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      visibility: 'private',
    });
    store.joinRoom(room.code, 'guest-1', 'Guest');
    expect(() => store.setVisibility(room.code, 'guest-1', 'public')).toThrow(WavrSyncStoreError);
    const updated = store.setVisibility(room.code, 'host-1', 'public');
    expect(updated.visibility).toBe('public');
    expect(store.listPublic()).toHaveLength(1);
    store.setVisibility(room.code, 'host-1', 'private');
    expect(store.listPublic()).toHaveLength(0);
  });

  it('transfers the host and drops empty rooms', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
    });
    store.joinRoom(room.code, 'guest-1', 'Guest');
    store.transferHost(room.code, 'host-1', 'guest-1');
    expect(room.hostId).toBe('guest-1');
    expect(room.participants.find((entry) => entry.isHost)?.id).toBe('guest-1');
    const remaining = store.leaveRoom(room.code, 'host-1');
    expect(remaining).not.toBeNull();
    expect(store.leaveRoom(room.code, 'guest-1')).toBeNull();
    expect(store.getRoom(room.code)).toBeNull();
  });

  it('lists only populated public rooms', () => {
    const store = storeAt();
    const publicRoom = store.createRoom({
      name: 'Public',
      hostId: 'host-1',
      hostName: 'Host',
      visibility: 'public',
      queue: [track('a')],
      currentIndex: 0,
    });
    store.createRoom({
      name: 'Private',
      hostId: 'host-2',
      hostName: 'Host 2',
      visibility: 'private',
    });
    const rooms = store.listPublic('https://wavrsync.example');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      code: publicRoom.code,
      name: 'Public',
      hostName: 'Host',
      participants: 1,
      trackTitle: 'Song',
    });
  });

  it('serializes rooms without stale participants', () => {
    const store = storeAt();
    const room = store.createRoom({
      name: 'Room',
      hostId: 'host-1',
      hostName: 'Host',
      queue: [track('a')],
      currentIndex: 0,
    });
    const serialized = store.serialize();
    const restored = storeAt(2000);
    restored.load(serialized);
    const restoredRoom = restored.getRoom(room.code);
    expect(restoredRoom?.queue).toHaveLength(1);
    expect(restoredRoom?.participants).toHaveLength(0);
    restored.joinRoom(room.code, 'new-host', 'New Host');
    expect(restored.getRoom(room.code)?.hostId).toBe('new-host');
  });
});
