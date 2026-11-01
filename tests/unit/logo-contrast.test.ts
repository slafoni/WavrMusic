import { describe, it, expect } from 'vitest';
import { isBrightLogoBackground } from '../../src/renderer/utils/logoContrast';

describe('logo background contrast', () => {
  it('uses the dark logo for bright gradients', () => {
    expect(isBrightLogoBackground('#C8D879', '#7FD1AE')).toBe(true);
    expect(isBrightLogoBackground('#FFFFFF', '#D0D0D0')).toBe(true);
    expect(isBrightLogoBackground('rgb(200, 216, 121)', 'rgb(127, 209, 174)')).toBe(true);
  });

  it('uses the light logo for dark gradients', () => {
    expect(isBrightLogoBackground('#111111', '#444444')).toBe(false);
    expect(isBrightLogoBackground('#000000', '#202020')).toBe(false);
  });

  it('falls back to the light logo when colours cannot be parsed', () => {
    expect(isBrightLogoBackground('', 'not-a-colour')).toBe(false);
  });
});
