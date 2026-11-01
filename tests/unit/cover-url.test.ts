import { describe, it, expect, afterEach } from 'vitest';
import type { ServerProfile } from '../../shared/models';
import { store } from '../../src/renderer/state';
import { directCoverArtUrl, publicCoverArtUrl } from '../../src/renderer/services/serverService';

const profile: ServerProfile = {
  id: 'cover-cache-profile',
  name: 'Test',
  url: 'https://music.example.com',
  username: 'listener',
  password: 'secret',
  default: true,
  createdAt: 1,
};

describe('cover art URL caching', () => {
  afterEach(() => {
    store.setServerProfile(null);
  });

  it('reuses the same authentication token for the same cover and size', () => {
    store.setServerProfile(profile);
    const first = directCoverArtUrl('cover-123', 900);
    const second = directCoverArtUrl('cover-123', 900);
    const otherSize = directCoverArtUrl('cover-123', 700);
    expect(first).toBe(second);
    expect(otherSize).not.toBe(first);
    expect(first).toContain('size=900');
    expect(otherSize).toContain('size=700');
  });

  it('uses a fresh cache for a new profile object', () => {
    store.setServerProfile(profile);
    const first = directCoverArtUrl('cover-456', 500);
    store.setServerProfile({ ...profile, id: 'cover-cache-profile-2' });
    const second = directCoverArtUrl('cover-456', 500);
    expect(second).not.toBe(first);
  });

  it('builds an unauthenticated public artwork URL', () => {
    store.setServerProfile({
      ...profile,
      publicUrl: 'https://public.example.com/music/',
    });
    const url = publicCoverArtUrl('cover-789', 512);
    expect(url).toBe('https://public.example.com/music/rest/getCoverArt?id=cover-789&size=512');
    store.setServerProfile({ ...profile, publicUrl: '' });
    expect(publicCoverArtUrl('cover-789', 512)).toBe('');
  });
});
