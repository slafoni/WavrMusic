import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SubsonicClient,
  buildAuthParams,
  buildStreamUrl,
  buildCoverArtUrl,
  isSecure,
  _md5HexForTests,
} from '../../shared/api/subsonic-client';

describe('SubsonicClient auth', () => {
  it('builds salted-token auth params when password is provided', () => {
    const params = buildAuthParams({
      url: 'http://localhost:4533',
      username: 'admin',
      password: 'password',
      clientName: 'test-client',
      apiVersion: '1.16.1',
    });
    expect(params.u).toBe('admin');
    expect(params.v).toBe('1.16.1');
    expect(params.c).toBe('test-client');
    expect(params.f).toBe('json');
    expect(params.s).toBeDefined();
    expect(params.t).toBeDefined();
    expect(typeof params.s).toBe('string');
    expect(typeof params.t).toBe('string');
  });

  it('computes the RFC 1321 MD5 digest', () => {
    expect(_md5HexForTests('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(_md5HexForTests('password')).toBe('5f4dcc3b5aa765d61d8327deb882cf99');
    expect(_md5HexForTests('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });

  it('computes the salted token as md5(password + salt)', () => {
    const params = buildAuthParams({
      url: 'http://localhost:4533',
      username: 'admin',
      password: 'password',
    });
    expect(params.t).toBe(_md5HexForTests(`password${params.s}`));
  });

  it('matches the documented Subsonic token example', () => {
    expect(_md5HexForTests('sesamec19b2d')).toBe('26719a1196d2a940705a59634eb18eab');
  });

  it('uses token directly when provided', () => {
    const params = buildAuthParams({
      url: 'http://localhost:4533',
      username: 'admin',
      token: 'mytoken123',
    });
    expect(params.t).toBe('mytoken123');
    expect(params.s).toBeUndefined();
  });

  it('normalizes server url', () => {
    expect(SubsonicClient.prototype.getServerVersion).toBeDefined();
    const c = new SubsonicClient({ url: 'localhost:4533', username: 'admin' });
    // url normalized to http://localhost:4533
    expect((c as any).url.startsWith('http')).toBe(true);
  });

  it('buildStreamUrl includes auth params', () => {
    const url = buildStreamUrl(
      { url: 'http://localhost:4533', username: 'admin', password: 'pw' },
      'song123',
      320,
    );
    expect(url).toContain('/rest/stream.view');
    expect(url).toContain('id=song123');
    expect(url).toContain('maxBitRate=320');
    expect(url).toContain('u=admin');
  });

  it('includes transcoding format when requested', () => {
    const url = buildStreamUrl(
      { url: 'http://localhost:4533', username: 'admin', password: 'pw' },
      'song123',
      128,
      'mp3',
    );
    expect(url).toContain('format=mp3');
    expect(url).toContain('maxBitRate=128');
  });

  it('omits format for original streams', () => {
    const url = buildStreamUrl(
      { url: 'http://localhost:4533', username: 'admin', password: 'pw' },
      'song123',
      0,
      'raw',
    );
    expect(url).not.toContain('format=');
    expect(url).not.toContain('maxBitRate=');
  });

  it('buildCoverArtUrl includes auth params', () => {
    const url = buildCoverArtUrl(
      { url: 'http://localhost:4533', username: 'admin', password: 'pw' },
      'cover456',
      200,
    );
    expect(url).toContain('/rest/getCoverArt.view');
    expect(url).toContain('id=cover456');
    expect(url).toContain('size=200');
  });

  it('isSecure detects https', () => {
    expect(isSecure('https://example.com')).toBe(true);
    expect(isSecure('http://example.com')).toBe(false);
  });
});

describe('SubsonicClient capability detection', () => {
  it('rejects when the server cannot be reached', async () => {
    const c = new SubsonicClient({
      url: 'http://invalid.invalid:1',
      username: 'admin',
      password: 'pw',
      timeoutMs: 500,
    });
    await expect(c.probeCapabilities()).rejects.toThrow(/Network error|fetch failed|abort/i);
  });
});

