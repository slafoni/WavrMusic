import type { UpdateChannel } from './models';

export interface UpdateManifest {
  version: string;
  url: string;
  sha512: string;
  size: number;
  notes: string;
  publishedAt: string;
  critical: boolean;
}

function parseVersion(value: string) {
  const raw = String(value || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!match) return { parts: [0], suffix: raw.toLowerCase() };
  return {
    parts: match[1].split('.').map((part) => Number(part) || 0),
    suffix: match[2].replace(/^[-._+]/, '').toLowerCase(),
  };
}

export function compareAppVersions(left: string, right: string): number {
  const first = parseVersion(left);
  const second = parseVersion(right);
  const length = Math.max(first.parts.length, second.parts.length);
  for (let index = 0; index < length; index += 1) {
    const a = first.parts[index] || 0;
    const b = second.parts[index] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  if (first.suffix === second.suffix) return 0;
  if (!first.suffix) return 1;
  if (!second.suffix) return -1;
  return first.suffix.localeCompare(second.suffix, undefined, { numeric: true }) > 0 ? 1 : -1;
}

export function isTrustedUpdateUrl(value: string): boolean {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1'
    );
  } catch {
    return false;
  }
}

export function updateFeedBase(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function updateChannelsForBadges(badges: string[] = []): UpdateChannel[] {
  if (badges.includes('developer')) return ['stable', 'beta', 'dev'];
  const channels: UpdateChannel[] = ['stable'];
  if (badges.includes('beta')) channels.push('beta');
  if (badges.includes('alpha')) channels.push('dev');
  return channels;
}

export function updateManifestFrom(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as Record<string, unknown>;
  const version = String(manifest['version'] || '').trim();
  const url = String(manifest['url'] || '').trim();
  const sha512 = String(manifest['sha512'] || '').trim();
  const size = Number(manifest['size']);
  if (!version || !isTrustedUpdateUrl(url) || !sha512 || !Number.isFinite(size) || size <= 0) {
    return null;
  }
  return {
    version,
    url,
    sha512,
    size,
    notes: String(manifest['notes'] || '').slice(0, 4000),
    publishedAt: String(manifest['publishedAt'] || ''),
    critical: manifest['critical'] === true,
  };
}
