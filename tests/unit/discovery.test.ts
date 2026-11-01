import { describe, expect, it } from 'vitest';
import { buildDiscoveryTabs, type DiscoveryGroup } from '../../src/renderer/services/discoveryService';

function group(id: string, title: string, kind: DiscoveryGroup['kind']): DiscoveryGroup {
  return {
    id,
    title,
    kind,
    tracks: [{ id: `track-${id}`, title: 'Song', artist: 'Artist', album: 'Album', duration: 200 }],
  };
}

describe('Discovery tabs', () => {
  it('builds an All picks tab plus one tab per recommendation section', () => {
    const tabs = buildDiscoveryTabs([
      group('artist:aurora', 'Because you like Aurora Skies', 'artist'),
      group('track:yellow', 'Because you like Yellow', 'track'),
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual([
      'All picks',
      'Because you like Aurora Skies',
      'Because you like Yellow',
    ]);
    expect(tabs[0].groupIds).toEqual(['artist:aurora', 'track:yellow']);
    expect(tabs[2].groupIds).toEqual(['track:yellow']);
  });

  it('does not show tabs for a single fallback section', () => {
    expect(buildDiscoveryTabs([group('library', 'From your library', 'library')])).toEqual([]);
  });
});
