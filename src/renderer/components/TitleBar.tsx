import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useServer } from '../state';
import { APP_NAME } from '../../../shared/constants';
import appIcon from '../../../assets/icon.png';

function api(): any {
  return (window as any).electronAPI;
}

export function TitleBar() {
  const { profile, info } = useServer();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    api()?.isMaximized?.().then((value: boolean) => {
      if (mounted) setMaximized(!!value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isElectron = !!api();

  const toggleMaximize = async () => {
    api()?.maximizeWindow?.();
    window.setTimeout(async () => {
      const value = await api()?.isMaximized?.();
      setMaximized(!!value);
    }, 80);
  };

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-brand-mark">
          <img src={appIcon} alt="" />
        </span>
        <span>{APP_NAME}</span>
      </div>
      <div className="titlebar-drag" onDoubleClick={isElectron ? toggleMaximize : undefined} />
      <div className="titlebar-status" title={profile?.url || 'Not connected'}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: profile
              ? 'var(--md-sys-color-tertiary)'
              : 'var(--md-sys-color-outline)',
            display: 'inline-block',
          }}
        />
        {profile ? `${profile.name}${info?.version ? ` · API ${info.version}` : ''}` : 'Not connected'}
      </div>
      {isElectron && (
        <div className="window-controls">
          <button
            className="window-btn"
            onClick={() => api()?.minimizeWindow?.()}
            aria-label="Minimise"
            title="Minimise"
          >
            <Icon name="window_minimize" size={12} />
          </button>
          <button
            className="window-btn"
            onClick={toggleMaximize}
            aria-label={maximized ? 'Restore' : 'Maximise'}
            title={maximized ? 'Restore' : 'Maximise'}
          >
            <Icon name={maximized ? 'window_restore' : 'window_maximize'} size={12} />
          </button>
          <button
            className="window-btn close"
            onClick={() => api()?.closeWindow?.()}
            aria-label="Close"
            title="Close"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </header>
  );
}
