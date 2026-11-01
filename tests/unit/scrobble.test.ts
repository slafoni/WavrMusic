import { describe, expect, it } from 'vitest';
import {
  buildScrobbleRequest,
  createScrobbleSignature,
  scrobbleTrackParams,
} from '../../src/main/scrobbleApi';
import {
  isScrobbleEligible,
  normalizeScrobbleTrack,
  scrobbleThreshold,
  toScrobbleTrack,
} from '../../shared/scrobble';

describe('scrobbling signatures', () => {
  it('matches the Last.fm documented signature example', () => {
    const signature = createScrobbleSignature(
      {
        api_key: 'xxxxxxxxxx',
        method: 'auth.getSession',
        token: 'yyyyyy',
      },
      'ilovecher',
    );
    expect(signature).toBe('b87d61da3cda91a8b6746c4aef55d6f8');
  });

  it('excludes format and callback from the signature', () => {
    const base = {
      api_key: 'abc',
      method: 'track.scrobble',
      artist: 'Artist',
      track: 'Song',
      timestamp: 1700000000,
    };
    const signature = createScrobbleSignature(base, 'secret');
    const request = buildScrobbleRequest(
      'track.scrobble',
      'abc',
      'secret',
      '',
      {
        artist: 'Artist',
        track: 'Song',
        timestamp: 1700000000,
        format: 'xml',
        callback: 'ignored',
      },
    );
    expect(request['api_sig']).toBe(signature);
    expect(request.format).toBe('json');
  });

  it('includes session keys in signed requests', () => {
    const request = buildScrobbleRequest(
      'track.updateNowPlaying',
      'key',
      'secret',
      'session',
      { artist: 'Artist', track: 'Song' },
    );
    expect(request.sk).toBe('session');
    expect(request.api_sig).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('scrobble eligibility', () => {
  it('uses half the track length capped at four minutes', () => {
    expect(scrobbleThreshold(200)).toBe(100);
    expect(scrobbleThreshold(600)).toBe(240);
    expect(scrobbleThreshold(31)).toBe(15.5);
    expect(scrobbleThreshold(0)).toBe(240);
  });

  it('does not scrobble tracks of 30 seconds or less', () => {
    expect(scrobbleThreshold(30)).toBeNull();
    expect(scrobbleThreshold(12)).toBeNull();
  });

  it('requires a non-empty artist and title', () => {
    expect(isScrobbleEligible({ artist: 'A', title: 'T' })).toBe(true);
    expect(isScrobbleEligible({ artist: ' ', title: 'T' })).toBe(false);
    expect(isScrobbleEligible({ artist: 'A', title: '' })).toBe(false);
  });

  it('normalizes metadata and omits empty optional fields', () => {
    expect(
      normalizeScrobbleTrack({
        artist: '  Artist  ',
        title: '  Song ',
        album: '   ',
        duration: 201.6,
        trackNumber: 3,
      }),
    ).toEqual({
      artist: 'Artist',
      title: 'Song',
      duration: 202,
      trackNumber: 3,
    });
  });

  it('maps library tracks and preferred playback duration', () => {
    expect(
      toScrobbleTrack(
        {
          id: '1',
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 180,
          trackNumber: 2,
        },
        240,
      ),
    ).toEqual({
      artist: 'Artist',
      title: 'Song',
      album: 'Album',
      duration: 240,
      trackNumber: 2,
    });
  });

  it('builds scrobble parameters with a timestamp', () => {
    expect(
      scrobbleTrackParams(
        {
          artist: 'Artist',
          title: 'Song',
          album: 'Album',
          duration: 180,
        },
        1700000000,
      ),
    ).toEqual({
      artist: 'Artist',
      track: 'Song',
      album: 'Album',
      duration: 180,
      trackNumber: undefined,
      timestamp: 1700000000,
    });
  });
});
