import { describe, it, expect } from 'vitest';
import { analyzeCover } from '../../src/renderer/themes/themeEngine';
import { APP_VERSION, formatDuration, DEFAULT_SETTINGS } from '../../shared/constants';
import packageJson from '../../package.json';

describe('themeEngine colour extraction', () => {
  it('returns default accent for null/empty src', async () => {
    const r1 = await analyzeCover(null);
    expect(r1.accent).toBe('#C8D879');
    const r2 = await analyzeCover('');
    expect(r2.accent).toBe('#C8D879');
  });

  it('returns default accent for a broken image url', async () => {
    const r = await analyzeCover('http://invalid.invalid/cover.jpg');
    expect(r.accent).toBe('#C8D879');
    expect(r.accent2).toBe('#D8E99A');
    expect(typeof r.luminance).toBe('number');
    expect(typeof r.saturation).toBe('number');
  });

  it('caches results for the same url', async () => {
    // Use a data URL (small valid PNG) so it resolves without network.
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const r1 = await analyzeCover(tinyPng);
    const r2 = await analyzeCover(tinyPng);
    expect(r1.accent).toBe(r2.accent);
  });
});

describe('constants', () => {
  it('formatDuration formats correctly', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(-1)).toBe('0:00');
  });

  it('DEFAULT_SETTINGS has expected keys', () => {
    expect(DEFAULT_SETTINGS.themeMode).toBe('dark');
    expect(DEFAULT_SETTINGS.defaultVolume).toBe(0.85);
    expect(DEFAULT_SETTINGS.profileImage).toBe('');
    expect(DEFAULT_SETTINGS.audioEngine).toBe('wasapi-shared');
    expect(DEFAULT_SETTINGS.dspEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.crossfadeSeconds).toBe(0);
    expect(DEFAULT_SETTINGS.showLyricsBanner).toBe(true);
    expect(APP_VERSION).toBe(packageJson.version);
    expect(Array.isArray(DEFAULT_SETTINGS.servers)).toBe(true);
  });
});

