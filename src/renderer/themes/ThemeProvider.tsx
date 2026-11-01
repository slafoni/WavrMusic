/* Theme provider: light/dark/system, dynamic artwork colours, fixed
   accent, intensity, density and reduced motion. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyDynamicTheme, DEFAULT_ACCENT } from './themeEngine';
import { store, useSettings } from '../state';

interface ThemeContextValue {
  themeMode: 'light' | 'dark' | 'system';
  resolvedMode: 'light' | 'dark';
  dynamicTheme: 'auto' | 'fixed' | 'disabled';
  accentColor: string;
  themeIntensity: number;
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  setThemeMode: (mode: 'light' | 'dark' | 'system') => void;
  setDynamicTheme: (value: 'auto' | 'fixed' | 'disabled') => void;
  setAccentColor: (color: string) => void;
  setThemeIntensity: (value: number) => void;
  setDensity: (value: 'comfortable' | 'compact') => void;
  setReducedMotion: (value: boolean) => void;
  applyArtworkColour: (accent: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemMode(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const [osMode, setOsMode] = useState<'light' | 'dark'>(systemMode);
  const artworkAccent = useRef<string>(DEFAULT_ACCENT);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => setOsMode(query.matches ? 'light' : 'dark');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const resolvedMode: 'light' | 'dark' =
    settings.themeMode === 'system' ? osMode : settings.themeMode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedMode);
    document.documentElement.style.colorScheme = resolvedMode;
  }, [resolvedMode]);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-reduced-motion',
      settings.reducedMotion ? 'true' : 'false',
    );
    document.documentElement.setAttribute('data-density', settings.density);
    document.documentElement.setAttribute('data-dynamic-theme', settings.dynamicTheme);
  }, [settings.reducedMotion, settings.density, settings.dynamicTheme]);

  useEffect(() => {
    const accent =
      settings.dynamicTheme === 'fixed'
        ? settings.accentColor
        : settings.dynamicTheme === 'disabled'
          ? DEFAULT_ACCENT
          : artworkAccent.current;
    try {
      applyDynamicTheme(document.documentElement, {
        accent,
        mode: resolvedMode,
        intensity: settings.themeIntensity,
        brightness: 50,
        style: 'classic',
      });
    } catch {
      /* theme generation is best-effort */
    }
  }, [
    resolvedMode,
    settings.dynamicTheme,
    settings.accentColor,
    settings.themeIntensity,
  ]);

  const applyArtworkColour = useCallback(
    (accent: string) => {
      if (store.getSettings().dynamicTheme !== 'auto') return;
      artworkAccent.current = accent || DEFAULT_ACCENT;
      const settings = store.getSettings();
      const mode = settings.themeMode === 'system' ? systemMode() : settings.themeMode;
      try {
        applyDynamicTheme(document.documentElement, {
          accent: artworkAccent.current,
          mode,
          intensity: settings.themeIntensity,
          brightness: 50,
          style: 'classic',
        });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const setThemeMode = useCallback((mode: 'light' | 'dark' | 'system') => {
    store.updateSettings({ themeMode: mode });
  }, []);

  const setDynamicTheme = useCallback((value: 'auto' | 'fixed' | 'disabled') => {
    store.updateSettings({ dynamicTheme: value });
  }, []);

  const setAccentColor = useCallback((color: string) => {
    store.updateSettings({ accentColor: color });
  }, []);

  const setThemeIntensity = useCallback((value: number) => {
    store.updateSettings({ themeIntensity: Math.max(0, Math.min(100, value)) });
  }, []);

  const setDensity = useCallback((value: 'comfortable' | 'compact') => {
    store.updateSettings({ density: value });
  }, []);

  const setReducedMotion = useCallback((value: boolean) => {
    store.updateSettings({ reducedMotion: value });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode: settings.themeMode,
      resolvedMode,
      dynamicTheme: settings.dynamicTheme,
      accentColor: settings.accentColor,
      themeIntensity: settings.themeIntensity,
      density: settings.density,
      reducedMotion: settings.reducedMotion,
      setThemeMode,
      setDynamicTheme,
      setAccentColor,
      setThemeIntensity,
      setDensity,
      setReducedMotion,
      applyArtworkColour,
    }),
    [
      settings.themeMode,
      resolvedMode,
      settings.dynamicTheme,
      settings.accentColor,
      settings.themeIntensity,
      settings.density,
      settings.reducedMotion,
      setThemeMode,
      setDynamicTheme,
      setAccentColor,
      setThemeIntensity,
      setDensity,
      setReducedMotion,
      applyArtworkColour,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
