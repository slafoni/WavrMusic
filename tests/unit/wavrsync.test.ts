import { describe, expect, it } from 'vitest';
import {
  WAVRSYNC_DRIFT_LIMIT_SECONDS,
  normalizeWavrSyncServerUrl,
  parseWavrSyncInviteCode,
  wavrSyncExpectedPosition,
  wavrSyncQueueKey,
} from '../../shared/wavrsync';

describe('WavrSync protocol helpers', () => {
  it('allows a generous drift window before correcting playback', () => {
    expect(WAVRSYNC_DRIFT_LIMIT_SECONDS).toBeGreaterThanOrEqual(10);
    expect(WAVRSYNC_DRIFT_LIMIT_SECONDS).toBeLessThanOrEqual(15);
  });
  it('normalizes WebSocket server URLs', () => {
    expect(normalizeWavrSyncServerUrl('')).toBe('wss://sync.listenwavr.xyz');
    expect(normalizeWavrSyncServerUrl('http://127.0.0.1:8787/')).toBe('ws://127.0.0.1:8787');
    expect(normalizeWavrSyncServerUrl('https://wavrsync.example')).toBe('wss://wavrsync.example');
    expect(normalizeWavrSyncServerUrl('wavrsync.example:9000')).toBe('ws://wavrsync.example:9000');
  });

  it('parses room codes and invite links', () => {
    expect(parseWavrSyncInviteCode('abc123')).toBe('ABC123');
    expect(parseWavrSyncInviteCode('wavr://wavrsync/join/ABC123')).toBe('ABC123');
    expect(parseWavrSyncInviteCode('wavr://pulse/join/ABC123')).toBe('ABC123');
    expect(parseWavrSyncInviteCode('https://wavrsync.example/join/abc123')).toBe('ABC123');
    expect(parseWavrSyncInviteCode('not a room')).toBeNull();
  });

  it('advances playing positions without advancing paused positions', () => {
    const playing = {
      status: 'playing' as const,
      position: 10,
      updatedAt: 5000,
      trackId: 'a',
    };
    expect(wavrSyncExpectedPosition(playing, 8000, 0)).toBe(13);
    expect(
      wavrSyncExpectedPosition(
        { ...playing, status: 'paused' as const },
        8000,
        0,
      ),
    ).toBe(10);
    expect(wavrSyncExpectedPosition(playing, 8000, 500)).toBe(13.5);
  });

  it('builds stable queue keys', () => {
    const queue = [
      { id: 'a', title: 'A', artist: 'X', album: '', duration: 1 },
      { id: 'b', title: 'B', artist: 'X', album: '', duration: 1 },
    ];
    expect(wavrSyncQueueKey(queue, 1)).toBe('a|b::1');
  });
});

