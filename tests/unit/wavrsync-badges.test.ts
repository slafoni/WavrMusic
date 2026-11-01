import { describe, it, expect } from 'vitest';
import { normalizeWavrBadges } from '../../src/renderer/components/DeveloperBadge';

describe('WavrSync verified badges', () => {
  it('uses only badges advertised by the server', () => {
    expect(normalizeWavrBadges(['developer', 'beta'])).toEqual(['developer', 'beta']);
    expect(normalizeWavrBadges(['usr_test', 'owner'])).toEqual([]);
    expect(normalizeWavrBadges(undefined)).toEqual([]);
  });

  it('sorts and deduplicates advertised badges', () => {
    expect(normalizeWavrBadges(['beta', 'developer', 'beta', 'alpha'])).toEqual([
      'developer',
      'alpha',
      'beta',
    ]);
  });
});
