import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useTheme } from './ThemeProvider';

interface ColourContextValue {
  accent: string;
  accent2: string;
  isDark: boolean;
}

const ColourContext = createContext<ColourContextValue | null>(null);

export function ColourProvider({ children, accent }: { children: ReactNode; accent?: string }) {
  const { accentColor, resolvedMode } = useTheme();
  const resolvedAccent = accent || accentColor || '#C8D879';
  const value = useMemo<ColourContextValue>(
    () => ({
      accent: resolvedAccent,
      accent2: '#D8E99A',
      isDark: resolvedMode !== 'light',
    }),
    [resolvedAccent, resolvedMode],
  );
  return <ColourContext.Provider value={value}>{children}</ColourContext.Provider>;
}

export function useColour() {
  const context = useContext(ColourContext);
  if (!context) return { accent: '#C8D879', accent2: '#D8E99A', isDark: true };
  return context;
}
