import { describe, expect, it } from 'vitest';
import {
  compareAppVersions,
  isTrustedUpdateUrl,
  updateChannelsForBadges,
  updateFeedBase,
  updateManifestFrom,
} from '../../shared/updates';

describe('update version handling', () => {
  it('compares numeric and beta version suffixes', () => {
    expect(compareAppVersions('0.8.6beta', '0.8.5beta')).toBe(1);
    expect(compareAppVersions('0.8.10beta', '0.8.9beta')).toBe(1);
    expect(compareAppVersions('0.8.5beta', '0.8.5-beta')).toBe(0);
    expect(compareAppVersions('1.0.0', '1.0.0-beta')).toBe(1);
    expect(compareAppVersions('v1.2.3', '1.2.2')).toBe(1);
  });

  it('normalizes feed URLs', () => {
    expect(updateFeedBase(' https://updates.example.com/ ')).toBe('https://updates.example.com');
    expect(updateFeedBase('')).toBe('');
  });

  it('maps tester badges to update branches', () => {
    expect(updateChannelsForBadges([])).toEqual(['stable']);
    expect(updateChannelsForBadges(['beta'])).toEqual(['stable', 'beta']);
    expect(updateChannelsForBadges(['alpha'])).toEqual(['stable', 'dev']);
    expect(updateChannelsForBadges(['alpha', 'beta'])).toEqual(['stable', 'beta', 'dev']);
    expect(updateChannelsForBadges(['developer'])).toEqual(['stable', 'beta', 'dev']);
  });

  it('trusts HTTPS and localhost HTTP only', () => {
    expect(isTrustedUpdateUrl('https://updates.example.com')).toBe(true);
    expect(isTrustedUpdateUrl('http://127.0.0.1:8792')).toBe(true);
    expect(isTrustedUpdateUrl('http://localhost:8792')).toBe(true);
    expect(isTrustedUpdateUrl('http://updates.example.com')).toBe(false);
    expect(isTrustedUpdateUrl('file:///tmp/installer.exe')).toBe(false);
  });

  it('validates update manifests', () => {
    const manifest = updateManifestFrom({
      version: '0.9.0beta',
      url: 'https://updates.example.com/downloads/WAVR.exe',
      sha512: 'abc123',
      size: 1234,
      notes: 'Changes',
      publishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(manifest).toEqual({
      version: '0.9.0beta',
      url: 'https://updates.example.com/downloads/WAVR.exe',
      sha512: 'abc123',
      size: 1234,
      notes: 'Changes',
      publishedAt: '2026-01-01T00:00:00.000Z',
      critical: false,
    });
    expect(updateManifestFrom({ version: '0.9.0' })).toBeNull();
    expect(updateManifestFrom({
      version: '0.9.0',
      url: 'http://updates.example.com/WAVR.exe',
      sha512: 'abc',
      size: 10,
    })).toBeNull();
    expect(updateManifestFrom({
      version: '0.9.0',
      url: 'https://updates.example.com/WAVR.exe',
      sha512: 'abc',
      size: 10,
      critical: true,
    })?.critical).toBe(true);
  });
});
