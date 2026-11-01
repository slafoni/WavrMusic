import { useEffect, useState } from 'react';
import { Icon } from './Icon';

function api(): any {
  return (window as any).electronAPI;
}

export function WindowControls({ className = '' }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);
  const isElectron = !!api();

  useEffect(() => {
    let mounted = true;
    api()?.isMaximized?.().then((value: boolean) => {
      if (mounted) setMaximized(!!value);
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  if (!isElectron) return null;

  const toggleMaximize = () => {
    api()?.maximizeWindow?.();
    window.setTimeout(async () => {
      const value = await api()?.isMaximized?.();
      setMaximized(!!value);
    }, 80);
  };

  return (
    <div className={`window-controls-inline ${className}`.trim()} aria-label="Window controls">
      <button
        type="button"
        className="window-btn"
        onClick={() => api()?.minimizeWindow?.()}
        aria-label="Minimise window"
        title="Minimise"
      >
        <Icon name="window_minimize" size={13} />
      </button>
      <button
        type="button"
        className="window-btn"
        onClick={toggleMaximize}
        aria-label={maximized ? 'Restore window' : 'Maximise window'}
        title={maximized ? 'Restore' : 'Maximise'}
      >
        <Icon name={maximized ? 'window_restore' : 'window_maximize'} size={13} />
      </button>
      <button
        type="button"
        className="window-btn close"
        onClick={() => api()?.closeWindow?.()}
        aria-label="Close window"
        title="Close"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
