/* Dynamic colour theme engine.
   Extracts a Material Design 3 tonal palette from album artwork,
   analogous to Material You. Deterministic, cached, and safe for
   missing/transparent/monochrome artwork. */

import type { DynamicColor } from '../../../shared/models';

const CACHE_LIMIT = 60;
const coverCache = new Map<string, DynamicColor>();
let coverOrder: string[] = [];

const DEFAULT_ACCENT = '#C8D879';
const DEFAULT_ACCENT2 = '#D8E99A';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

const tint = (hex: string, alphaVar: string) => `color-mix(in srgb, ${hex} var(${alphaVar}), transparent)`;

const SURFACE_TOKENS = new Set([
  '--md-sys-color-background',
  '--md-sys-color-surface',
  '--md-sys-color-surface-dim',
  '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
]);
const TEXT_TOKENS = new Set([
  '--md-sys-color-on-surface',
  '--md-sys-color-on-surface-variant',
]);

const PALETTE_STYLES: Record<string, {
  secHueShift: number;
  tertHueShift: number;
  priSatScale: number;
  surfSatScale: number;
  contSatScale: number;
}> = {
  classic: { secHueShift: 0, tertHueShift: 0, priSatScale: 1.0, surfSatScale: 1.0, contSatScale: 1.0 },
  'tonal-spot': { secHueShift: 0, tertHueShift: 60, priSatScale: 1.0, surfSatScale: 0.8, contSatScale: 0.9 },
  expressive: { secHueShift: 60, tertHueShift: 120, priSatScale: 1.25, surfSatScale: 1.5, contSatScale: 1.3 },
  vibrant: { secHueShift: 0, tertHueShift: 60, priSatScale: 1.4, surfSatScale: 1.2, contSatScale: 1.4 },
  neutral: { secHueShift: 0, tertHueShift: 0, priSatScale: 0.35, surfSatScale: 0.2, contSatScale: 0.25 },
};

function setThemeToken(root: HTMLElement, prop: string, val: string) {
  if (SURFACE_TOKENS.has(prop)) {
    root.style.setProperty(prop, tint(val, '--ui-alpha'));
    root.style.setProperty(`${prop}-solid`, val);
  } else if (TEXT_TOKENS.has(prop)) {
    root.style.setProperty(prop, tint(val, '--text-alpha'));
    root.style.setProperty(`${prop}-solid`, val);
  } else {
    root.style.setProperty(prop, val);
  }
}

function setSurfaceToken(root: HTMLElement, prop: string, val: string) {
  root.style.setProperty(prop, tint(val, '--ui-alpha'));
  root.style.setProperty(`${prop}-solid`, val);
}

const LB = (v: number, br: number) => Math.max(0, Math.min(100, Math.round(v + (br - 0.5) * 24)));
const B = (v: number, br: number) => Math.max(0, Math.min(100, Math.round(v * (br * 2))));

const paletteCache = new Map<string, string>();
const paletteOrder: string[] = [];

function getPaletteCacheKey(accent: string, mode: 'light' | 'dark', intensity: number, brightness: number, style: string): string {
  return `${accent}|${mode}|${Math.round(intensity)}|${Math.round(brightness)}|${style}`;
}

function generateM3Palette(
  root: HTMLElement,
  accent: string,
  mode: 'light' | 'dark',
  intensity: number,
  brightness: number,
  styleKey: string,
): void {
  const key = getPaletteCacheKey(accent, mode, intensity, brightness, styleKey);
  if (paletteCache.has(key)) {
    const cached = paletteCache.get(key)!;
    paletteCache.delete(key);
    paletteCache.set(key, cached);
    applyCachedPalette(root, cached);
    return;
  }

  const hex = accent || DEFAULT_ACCENT;
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const h = hsl.h;
  const intensityFactor = Math.max(0, Math.min(1, intensity / 100));
  const br = Math.max(0, Math.min(1, brightness / 100));
  const style = PALETTE_STYLES[styleKey] || PALETTE_STYLES['classic'];

  const hSec = (h + style.secHueShift) % 360;
  const hTert = (h + style.tertHueShift) % 360;

  const isMonochrome = intensityFactor < 0.08 || (styleKey === 'neutral' && intensityFactor < 0.05);

  const sat = (v: number) => Math.min(100, Math.round(v * intensityFactor));

  const setToken = (prop: string, val: string) => setThemeToken(root, prop, val);
  const setSurface = (prop: string, val: string) => setSurfaceToken(root, prop, val);

  if (mode === 'light') {
    if (isMonochrome) {
      setToken('--md-sys-color-primary', '#111111');
      setToken('--md-sys-color-on-primary', '#FFFFFF');
      setSurface('--md-sys-color-primary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-primary-container', '#111111');
      setToken('--md-sys-color-secondary', '#444444');
      setSurface('--md-sys-color-secondary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-secondary-container', '#111111');
      setToken('--md-sys-color-tertiary', '#444444');
      setSurface('--md-sys-color-tertiary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-tertiary-container', '#111111');
      setToken('--md-sys-color-background', hslToHex(0, 0, LB(99, br)));
      setToken('--md-sys-color-surface', hslToHex(0, 0, LB(98, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(0, 0, LB(87, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(0, 0, LB(98, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, LB(100, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, LB(96, br)));
      setToken('--md-sys-color-surface-container', hslToHex(0, 0, LB(94, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, LB(92, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-surface', '#111111');
      setToken('--md-sys-color-on-surface-variant', '#444444');
      setToken('--md-sys-color-outline', '#777777');
      setSurface('--md-sys-color-outline-variant', '#CFCFCF');
      setToken('--md-sys-color-error', '#777777');
      setToken('--md-sys-color-on-error', '#FFFFFF');
    } else {
      const satPri = sat(48);
      const satCont = sat(80);
      const surfFactor = intensityFactor * style.surfSatScale;
      setToken('--md-sys-color-primary', hslToHex(h, satPri, 40));
      setToken('--md-sys-color-on-primary', '#FEFBFF');
      setToken('--md-sys-color-primary-container', hslToHex(h, satCont, LB(90, br)));
      setToken('--md-sys-color-on-primary-container', hslToHex(h, sat(55), 18));
      setToken('--md-sys-color-secondary', hslToHex(hSec, sat(30), 45));
      setToken('--md-sys-color-secondary-container', hslToHex(hSec, sat(30), LB(90, br)));
      setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, sat(20), 15));
      setToken('--md-sys-color-tertiary', hslToHex(hTert, sat(30), 45));
      setToken('--md-sys-color-tertiary-container', hslToHex(hTert, sat(30), LB(90, br)));
      setToken('--md-sys-color-on-tertiary-container', hslToHex(hTert, sat(20), 15));
      setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), LB(99, br)));
      setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), LB(98, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), LB(87, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(6 * surfFactor), LB(98, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(4 * surfFactor), LB(100, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), LB(96, br)));
      setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), LB(94, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), LB(92, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), LB(90, br)));
      setToken('--md-sys-color-on-surface', '#1C1B1F');
      setToken('--md-sys-color-on-surface-variant', '#49454F');
      setToken('--md-sys-color-outline', '#79747E');
      setSurface('--md-sys-color-outline-variant', '#CAC4D0');
    }
  } else {
    if (isMonochrome) {
      setToken('--md-sys-color-primary', '#FFFFFF');
      setToken('--md-sys-color-on-primary', '#121212');
      setSurface('--md-sys-color-primary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-on-primary-container', '#FFFFFF');
      setToken('--md-sys-color-secondary', '#D0D0D0');
      setSurface('--md-sys-color-secondary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-on-secondary-container', '#FFFFFF');
      setToken('--md-sys-color-tertiary', '#D0D0D0');
      setSurface('--md-sys-color-tertiary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-background', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(0, 0, B(19, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, B(5, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, B(10, br)));
      setToken('--md-sys-color-surface-container', hslToHex(0, 0, B(13, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, B(16, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, B(20, br)));
      setToken('--md-sys-color-on-surface', '#FFFFFF');
      setToken('--md-sys-color-on-surface-variant', '#CFCFCF');
      setToken('--md-sys-color-outline', '#8A8A8A');
      setSurface('--md-sys-color-outline-variant', '#3A3A3A');
      setToken('--md-sys-color-error', '#8A8A8A');
      setToken('--md-sys-color-on-error', '#121212');
    } else {
      const satPri = sat(60);
      const satCont = sat(60);
      const surfFactor = intensityFactor * style.surfSatScale;
      const priHex = hslToHex(h, satPri, 75);
      const priRgb = hexToRgb(priHex);
      setToken('--md-sys-color-primary', priHex);
      setToken('--md-sys-color-on-primary', hslToHex(h, sat(50), 20));
      setToken('--md-sys-color-primary-container', `rgba(${priRgb.r}, ${priRgb.g}, ${priRgb.b}, 0.18)`);
      setToken('--md-sys-color-on-primary-container', priHex);
      setToken('--md-sys-color-secondary', hslToHex(hSec, sat(15), 75));
      setToken('--md-sys-color-secondary-container', hslToHex(hSec, sat(15), 22));
      setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, sat(30), 85));
      setToken('--md-sys-color-tertiary', hslToHex(hTert, sat(15), 75));
      setToken('--md-sys-color-tertiary-container', hslToHex(hTert, sat(15), 22));
      setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), B(7, br)));
      setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), B(8, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), B(7, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(4 * surfFactor), B(24, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(5 * surfFactor), B(5, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), B(10, br)));
      setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), B(13, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), B(16, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), B(20, br)));
      setToken('--md-sys-color-on-surface', '#e2e2e9');
      setToken('--md-sys-color-on-surface-variant', '#c4c6d0');
      setToken('--md-sys-color-outline', '#8e9099');
      setSurface('--md-sys-color-outline-variant', '#282a33');
    }
  }

  if (paletteCache.size >= CACHE_LIMIT) {
    const oldest = paletteOrder.shift();
    if (oldest) paletteCache.delete(oldest);
  }
  paletteCache.set(key, key);
  paletteOrder.push(key);
}

function applyCachedPalette(root: HTMLElement, key: string) {
  // Recompute from key to apply tokens (cache stores key only; regenerate)
  const parts = key.split('|');
  const accent = parts[0] || DEFAULT_ACCENT;
  const mode = (parts[1] as 'light' | 'dark') || 'dark';
  const intensity = Number(parts[2]) || 60;
  const brightness = Number(parts[3]) || 50;
  const style = parts[4] || 'classic';
  const rgb = hexToRgb(accent);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const h = hsl.h;
  // Re-run generation but skip re-caching by temporarily not caching.
  // Simplest: regenerate directly.
  regenerateDirect(root, accent, mode, intensity, brightness, style);
}

function regenerateDirect(
  root: HTMLElement,
  accent: string,
  mode: 'light' | 'dark',
  intensity: number,
  brightness: number,
  styleKey: string,
) {
  const hex = accent || DEFAULT_ACCENT;
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const h = hsl.h;
  const intensityFactor = Math.max(0, Math.min(1, intensity / 100));
  const br = Math.max(0, Math.min(1, brightness / 100));
  const style = PALETTE_STYLES[styleKey] || PALETTE_STYLES['classic'];
  const hSec = (h + style.secHueShift) % 360;
  const hTert = (h + style.tertHueShift) % 360;
  const isMonochrome = intensityFactor < 0.08 || (styleKey === 'neutral' && intensityFactor < 0.05);
  const sat = (v: number) => Math.min(100, Math.round(v * intensityFactor));
  const setToken = (prop: string, val: string) => setThemeToken(root, prop, val);
  const setSurface = (prop: string, val: string) => setSurfaceToken(root, prop, val);
  if (mode === 'light') {
    if (isMonochrome) {
      setToken('--md-sys-color-primary', '#111111');
      setToken('--md-sys-color-on-primary', '#FFFFFF');
      setSurface('--md-sys-color-primary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-primary-container', '#111111');
      setToken('--md-sys-color-secondary', '#444444');
      setSurface('--md-sys-color-secondary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-secondary-container', '#111111');
      setToken('--md-sys-color-tertiary', '#444444');
      setSurface('--md-sys-color-tertiary-container', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-tertiary-container', '#111111');
      setToken('--md-sys-color-background', hslToHex(0, 0, LB(99, br)));
      setToken('--md-sys-color-surface', hslToHex(0, 0, LB(98, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(0, 0, LB(87, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(0, 0, LB(98, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, LB(100, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, LB(96, br)));
      setToken('--md-sys-color-surface-container', hslToHex(0, 0, LB(94, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, LB(92, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, LB(90, br)));
      setToken('--md-sys-color-on-surface', '#111111');
      setToken('--md-sys-color-on-surface-variant', '#444444');
      setToken('--md-sys-color-outline', '#777777');
      setSurface('--md-sys-color-outline-variant', '#CFCFCF');
      setToken('--md-sys-color-error', '#777777');
      setToken('--md-sys-color-on-error', '#FFFFFF');
    } else {
      const surfFactor = intensityFactor * style.surfSatScale;
      setToken('--md-sys-color-primary', hslToHex(h, sat(48), 40));
      setToken('--md-sys-color-on-primary', '#FEFBFF');
      setToken('--md-sys-color-primary-container', hslToHex(h, sat(80), LB(90, br)));
      setToken('--md-sys-color-on-primary-container', hslToHex(h, sat(55), 18));
      setToken('--md-sys-color-secondary', hslToHex(hSec, sat(30), 45));
      setToken('--md-sys-color-secondary-container', hslToHex(hSec, sat(30), LB(90, br)));
      setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, sat(20), 15));
      setToken('--md-sys-color-tertiary', hslToHex(hTert, sat(30), 45));
      setToken('--md-sys-color-tertiary-container', hslToHex(hTert, sat(30), LB(90, br)));
      setToken('--md-sys-color-on-tertiary-container', hslToHex(hTert, sat(20), 15));
      setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), LB(99, br)));
      setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), LB(98, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), LB(87, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(6 * surfFactor), LB(98, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(4 * surfFactor), LB(100, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), LB(96, br)));
      setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), LB(94, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), LB(92, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), LB(90, br)));
      setToken('--md-sys-color-on-surface', '#1C1B1F');
      setToken('--md-sys-color-on-surface-variant', '#49454F');
      setToken('--md-sys-color-outline', '#79747E');
      setSurface('--md-sys-color-outline-variant', '#CAC4D0');
    }
  } else {
    if (isMonochrome) {
      setToken('--md-sys-color-primary', '#FFFFFF');
      setToken('--md-sys-color-on-primary', '#121212');
      setSurface('--md-sys-color-primary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-on-primary-container', '#FFFFFF');
      setToken('--md-sys-color-secondary', '#D0D0D0');
      setSurface('--md-sys-color-secondary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-on-secondary-container', '#FFFFFF');
      setToken('--md-sys-color-tertiary', '#D0D0D0');
      setSurface('--md-sys-color-tertiary-container', hslToHex(0, 0, B(24, br)));
      setToken('--md-sys-color-background', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(0, 0, B(7, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(0, 0, B(19, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(0, 0, B(5, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(0, 0, B(10, br)));
      setToken('--md-sys-color-surface-container', hslToHex(0, 0, B(13, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(0, 0, B(16, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(0, 0, B(20, br)));
      setToken('--md-sys-color-on-surface', '#FFFFFF');
      setToken('--md-sys-color-on-surface-variant', '#CFCFCF');
      setToken('--md-sys-color-outline', '#8A8A8A');
      setSurface('--md-sys-color-outline-variant', '#3A3A3A');
      setToken('--md-sys-color-error', '#8A8A8A');
      setToken('--md-sys-color-on-error', '#121212');
    } else {
      const surfFactor = intensityFactor * style.surfSatScale;
      const priHex = hslToHex(h, sat(60), 75);
      const priRgb = hexToRgb(priHex);
      setToken('--md-sys-color-primary', priHex);
      setToken('--md-sys-color-on-primary', hslToHex(h, sat(50), 20));
      setToken('--md-sys-color-primary-container', `rgba(${priRgb.r}, ${priRgb.g}, ${priRgb.b}, 0.18)`);
      setToken('--md-sys-color-on-primary-container', priHex);
      setToken('--md-sys-color-secondary', hslToHex(hSec, sat(15), 75));
      setToken('--md-sys-color-secondary-container', hslToHex(hSec, sat(15), 22));
      setToken('--md-sys-color-on-secondary-container', hslToHex(hSec, sat(30), 85));
      setToken('--md-sys-color-tertiary', hslToHex(hTert, sat(15), 75));
      setToken('--md-sys-color-tertiary-container', hslToHex(hTert, sat(15), 22));
      setToken('--md-sys-color-background', hslToHex(h, Math.round(5 * surfFactor), B(7, br)));
      setToken('--md-sys-color-surface', hslToHex(h, Math.round(6 * surfFactor), B(8, br)));
      setToken('--md-sys-color-surface-dim', hslToHex(h, Math.round(5 * surfFactor), B(7, br)));
      setToken('--md-sys-color-surface-bright', hslToHex(h, Math.round(4 * surfFactor), B(24, br)));
      setToken('--md-sys-color-surface-container-lowest', hslToHex(h, Math.round(5 * surfFactor), B(5, br)));
      setToken('--md-sys-color-surface-container-low', hslToHex(h, Math.round(5 * surfFactor), B(10, br)));
      setToken('--md-sys-color-surface-container', hslToHex(h, Math.round(6 * surfFactor), B(13, br)));
      setToken('--md-sys-color-surface-container-high', hslToHex(h, Math.round(5 * surfFactor), B(16, br)));
      setToken('--md-sys-color-surface-container-highest', hslToHex(h, Math.round(5 * surfFactor), B(20, br)));
      setToken('--md-sys-color-on-surface', '#e2e2e9');
      setToken('--md-sys-color-on-surface-variant', '#c4c6d0');
      setToken('--md-sys-color-outline', '#8e9099');
      setSurface('--md-sys-color-outline-variant', '#282a33');
    }
  }
}

function extractDominantColor(imgSrc: string): Promise<string> {
  return new Promise((resolve) => {
    if (!imgSrc) return resolve(DEFAULT_ACCENT);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = 10;
      canvas.height = 10;
      ctx.drawImage(img, 0, 0, 10, 10);
      const data = ctx.getImageData(0, 0, 10, 10).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      const count = data.length / 4;
      const hex = '#' + [Math.floor(r / count), Math.floor(g / count), Math.floor(b / count)]
        .map((x) => x.toString(16).padStart(2, '0')).join('');
      resolve(hex);
    };
    img.onerror = () => resolve(DEFAULT_ACCENT);
    img.src = imgSrc;
  });
}

export function analyzeCover(imgSrc: string): Promise<DynamicColor> {
  return new Promise((resolve) => {
    if (!imgSrc) {
      return resolve({ accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT2, luminance: 0.2, saturation: 0.5 });
    }
    if (coverCache.has(imgSrc)) {
      const cached = coverCache.get(imgSrc)!;
      coverCache.delete(imgSrc);
      coverCache.set(imgSrc, cached);
      return resolve(cached);
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    const timeoutId = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      resolve({ accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT2, luminance: 0.2, saturation: 0.5 });
    }, 1000);
    img.onload = () => {
      clearTimeout(timeoutId);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 48, 48);
        const data = ctx.getImageData(0, 0, 48, 48).data;

        let totalLuminance = 0;
        let nonGraySatSum = 0;
        let nonGraySatCount = 0;
        const bins = Array.from({ length: 24 }, (_, i) => ({
          idx: i,
          centerHue: (i + 0.5) * 15,
          weight: 0,
          rSum: 0,
          gSum: 0,
          bSum: 0,
          count: 0,
        }));
        let fallbackR = 0, fallbackG = 0, fallbackB = 0;
        const totalPixels = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          fallbackR += r; fallbackG += g; fallbackB += b;

          const rN = r / 255;
          const gN = g / 255;
          const bN = b / 255;
          const lum = 0.2126 * rN + 0.7152 * gN + 0.0722 * bN;
          totalLuminance += lum;

          const max = Math.max(rN, gN, bN);
          const min = Math.min(rN, gN, bN);
          const d = max - min;
          const l = (max + min) / 2;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

          if (s >= 0.15) {
            nonGraySatSum += s;
            nonGraySatCount++;
            if (l >= 0.10 && l <= 0.90) {
              let hDeg = 0;
              if (d > 0) {
                if (max === rN) {
                  hDeg = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60;
                } else if (max === gN) {
                  hDeg = ((bN - rN) / d + 2) * 60;
                } else {
                  hDeg = ((rN - gN) / d + 4) * 60;
                }
              }
              const binIdx = Math.min(23, Math.max(0, Math.floor(hDeg / 15)));
              const bin = bins[binIdx];
              bin.weight += s;
              bin.rSum += r;
              bin.gSum += g;
              bin.bSum += b;
              bin.count++;
            }
          }
        }

        const meanLuminance = totalLuminance / totalPixels;
        const meanSaturation = nonGraySatCount > 0 ? nonGraySatSum / nonGraySatCount : 0;

        let bestBin = null;
        for (let i = 0; i < 24; i++) {
          if (bins[i].count > 0) {
            if (!bestBin || bins[i].weight > bestBin.weight) bestBin = bins[i];
          }
        }

        let accentR = 0, accentG = 0, accentB = 0;
        if (bestBin && bestBin.count > 0) {
          accentR = Math.round(bestBin.rSum / bestBin.count);
          accentG = Math.round(bestBin.gSum / bestBin.count);
          accentB = Math.round(bestBin.bSum / bestBin.count);
        } else {
          accentR = Math.round(fallbackR / totalPixels);
          accentG = Math.round(fallbackG / totalPixels);
          accentB = Math.round(fallbackB / totalPixels);
        }
        const accentHex = '#' + [accentR, accentG, accentB].map((x) => x.toString(16).padStart(2, '0')).join('');

        let bestBin2 = null;
        if (bestBin) {
          for (let i = 0; i < 24; i++) {
            if (bins[i].count > 0 && i !== bestBin.idx) {
              const diff = Math.abs(bins[i].centerHue - bestBin.centerHue);
              const dist = Math.min(diff, 360 - diff);
              if (dist >= 60) {
                if (!bestBin2 || bins[i].weight > bestBin2.weight) bestBin2 = bins[i];
              }
            }
          }
        }

        let accent2Hex = DEFAULT_ACCENT2;
        if (bestBin2 && bestBin2.count > 0) {
          accent2Hex = '#' + [
            Math.round(bestBin2.rSum / bestBin2.count),
            Math.round(bestBin2.gSum / bestBin2.count),
            Math.round(bestBin2.bSum / bestBin2.count),
          ].map((x) => x.toString(16).padStart(2, '0')).join('');
        } else {
          const hslAcc = rgbToHsl(accentR, accentG, accentB);
          accent2Hex = hslToHex((hslAcc.h + 40) % 360, hslAcc.s, hslAcc.l);
        }

        const result: DynamicColor = {
          accent: accentHex,
          accent2: accent2Hex,
          luminance: meanLuminance,
          saturation: meanSaturation,
        };

        if (coverCache.size >= CACHE_LIMIT) {
          const oldest = coverOrder ? coverOrder.shift() : null;
          if (oldest) coverCache.delete(oldest);
        }
        coverCache.set(imgSrc, result);
        if (!coverOrder) coverOrder = [];
        coverOrder.push(imgSrc);
        resolve(result);
      } catch {
        resolve({ accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT2, luminance: 0.2, saturation: 0.5 });
      }
    };
    img.onerror = () => {
      resolve({ accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT2, luminance: 0.2, saturation: 0.5 });
    };
    img.src = imgSrc;
  });
}

/* Apply a dynamic theme from an accent colour. */
export function applyDynamicTheme(
  root: HTMLElement,
  opts: {
    accent: string;
    mode: 'light' | 'dark';
    intensity: number;
    brightness: number;
    style: string;
  },
): void {
  generateM3Palette(root, opts.accent, opts.mode, opts.intensity, opts.brightness, opts.style);
}

/* Apply a fixed accent colour without dynamic analysis. */
export function applyFixedTheme(
  root: HTMLElement,
  opts: {
    accent: string;
    mode: 'light' | 'dark';
    intensity: number;
    brightness: number;
    style: string;
  },
): void {
  applyDynamicTheme(root, opts);
}

/* Apply default theme tokens (clears dynamic overrides). */
export function resetTheme(root: HTMLElement): void {
  const computed = getComputedStyle(document.documentElement);
  const keys = [
    '--md-sys-color-primary',
    '--md-sys-color-secondary',
    '--md-sys-color-tertiary',
    '--md-sys-color-background',
    '--md-sys-color-surface',
    '--md-sys-color-on-surface',
  ];
  keys.forEach((k) => root.style.removeProperty(k));
}

export { DEFAULT_ACCENT, DEFAULT_ACCENT2 };
