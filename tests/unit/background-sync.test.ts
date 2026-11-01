import { describe, expect, it } from 'vitest';
import { synchronizedBackgroundTime } from '../../src/renderer/utils/backgroundMedia';

describe('music video background sync', () => {
  it('starts after the intro and follows the song position', () => {
    expect(synchronizedBackgroundTime(300, 12, 0)).toBe(12);
    expect(synchronizedBackgroundTime(300, 12, 42)).toBe(54);
  });

  it('loops the video after its ending while preserving the intro offset', () => {
    expect(synchronizedBackgroundTime(100, 10, 95)).toBe(15);
    expect(synchronizedBackgroundTime(100, 10, 190)).toBe(20);
  });

  it('handles invalid metadata safely', () => {
    expect(synchronizedBackgroundTime(0, 10, 20)).toBe(0);
    expect(synchronizedBackgroundTime(Number.NaN, 10, 20)).toBe(0);
    expect(synchronizedBackgroundTime(10, 20, 20)).toBe(9.75);
  });
});

