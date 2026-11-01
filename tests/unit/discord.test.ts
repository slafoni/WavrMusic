import { describe, expect, it } from 'vitest';
import { activityFor } from '../../src/main/discord';

const base = {
  title: 'Yellow',
  artist: 'Coldplay',
  album: 'Parachutes',
  isPlaying: true,
  currentTime: 30,
  duration: 266,
};

describe('Discord activity', () => {
  it('shows the title, album and artist without repeating information', () => {
    const activity = activityFor(base);
    expect(activity.details).toBe('Yellow');
    expect(activity.state).toBe('Parachutes · Coldplay');
    expect(activity.statusDisplayType).toBe(0);
    expect(`${activity.details} ${activity.state}`).not.toMatch(/playing|paused/i);
    expect(activity.startTimestamp).toBeInstanceOf(Date);
    expect(activity.endTimestamp).toBeInstanceOf(Date);
  });

  it('shows only the artist when there is no album', () => {
    const activity = activityFor({ ...base, album: undefined });
    expect(activity.details).toBe('Yellow');
    expect(activity.state).toBe('Coldplay');
  });

  it('omits playback timestamps while paused', () => {
    const activity = activityFor({ ...base, isPlaying: false, playbackStatus: 'paused' });
    expect(activity.details).toBe('Yellow');
    expect(activity.state).toBe('Parachutes · Coldplay');
    expect(activity.startTimestamp).toBeUndefined();
    expect(activity.endTimestamp).toBeUndefined();
  });

  it('omits playback timestamps while buffering or loading', () => {
    for (const playbackStatus of ['buffering', 'loading'] as const) {
      const activity = activityFor({ ...base, isPlaying: false, playbackStatus });
      expect(activity.startTimestamp).toBeUndefined();
      expect(activity.endTimestamp).toBeUndefined();
    }
  });

  it('uses updatedAt to keep playback timestamps accurate', () => {
    const updatedAt = Date.now() - 5000;
    const activity = activityFor({ ...base, updatedAt });
    const start = activity.startTimestamp as Date;
    const end = activity.endTimestamp as Date;
    expect(Math.abs(start.getTime() - (updatedAt - base.currentTime * 1000))).toBeLessThan(1000);
    expect(Math.abs(end.getTime() - (updatedAt + (base.duration - base.currentTime) * 1000))).toBeLessThan(
      1000,
    );
  });

  it('uses public album artwork and omits unavailable artwork assets', () => {
    const art = activityFor({ ...base, artworkUrl: 'https://music.example.com/cover.jpg' });
    expect(art.largeImageUrl).toBe('https://music.example.com/cover.jpg');
    expect(art.largeImageKey).toBe('https://music.example.com/cover.jpg');
    const fallback = activityFor(base);
    expect(fallback.largeImageUrl).toBeUndefined();
    expect(fallback.largeImageKey).toBeUndefined();
    expect(fallback.largeImageText).toBeUndefined();
  });

  it('adds WavrSync party size and an HTTPS join button for public rooms', () => {
    const activity = activityFor({
      ...base,
      wavrSync: {
        roomCode: 'ABC123',
        roomName: 'Friday listening',
        inviteUrl: 'https://wavrsync.example/join/ABC123',
        participants: 3,
        visibility: 'public',
      },
    });
    expect(activity.details).toBe('Yellow');
    expect(activity.state).toBe('Parachutes · Coldplay');
    expect(activity.party).toEqual({ id: 'wavr-wavrsync-ABC123', size: [3, 10] });
    expect(activity.buttons).toEqual([
      { label: 'Join Friday listening', url: 'https://wavrsync.example/join/ABC123' },
    ]);
  });

  it('does not expose a local HTTP invite as a Discord button', () => {
    const activity = activityFor({
      ...base,
      wavrSync: {
        roomCode: 'ABC123',
        roomName: 'Local room',
        inviteUrl: 'http://127.0.0.1:8787/join/ABC123',
        participants: 2,
        visibility: 'public',
      },
    });
    expect(activity.buttons).toBeUndefined();
    expect(activity.party?.size).toEqual([2, 10]);
  });

  it('hides private WavrSync rooms from Discord entirely', () => {
    const activity = activityFor({
      ...base,
      wavrSync: {
        roomCode: 'PRIVATE1',
        roomName: 'Private room',
        inviteUrl: 'https://wavrsync.example/join/PRIVATE1',
        participants: 2,
        visibility: 'private',
      },
    });
    expect(activity.state).toBe('Parachutes · Coldplay');
    expect(activity.party).toBeUndefined();
    expect(activity.buttons).toBeUndefined();
  });
});
