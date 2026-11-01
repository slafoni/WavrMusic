import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useServer, useNavigation, store } from '../state';
import { NAVIGATION_ITEMS, APP_VERSION } from '../../../shared/constants';
import { isBrightLogoBackground } from '../utils/logoContrast';
import appIcon from '../../../assets/icon.png';
import appIconBlack from '../../../assets/iconBlack.png';

const GROUPS = [
  { id: 'main', label: 'Main', items: ['home', 'discover', 'wavrsync', 'search'] },
  {
    id: 'library',
    label: 'Your Library',
    items: ['songs', 'albums', 'artists', 'genres', 'playlists', 'favourites', 'recently-played'],
  },
];

export function NavRail({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('wavr.nav.expanded') === 'true';
    } catch {
      return false;
    }
  });
  const navigation = useNavigation();
  const { profile, info, caps } = useServer();
  const logoMarkRef = useRef<HTMLSpanElement>(null);
  const [useBlackLogo, setUseBlackLogo] = useState(() => {
    const style = getComputedStyle(document.documentElement);
    return isBrightLogoBackground(
      style.getPropertyValue('--md-sys-color-primary'),
      style.getPropertyValue('--md-sys-color-tertiary'),
    );
  });

  useEffect(() => {
    try {
      localStorage.setItem('wavr.nav.expanded', String(expanded));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  useEffect(() => {
    const mark = logoMarkRef.current;
    if (!mark) return;
    let frame = 0;
    const update = () => {
      const style = getComputedStyle(mark);
      setUseBlackLogo(
        isBrightLogoBackground(
          style.getPropertyValue('--md-sys-color-primary'),
          style.getPropertyValue('--md-sys-color-tertiary'),
        ),
      );
    };
    update();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);


  const supported = (id: string) => {
    if (id === 'genres' && caps && !caps.supportsGenres) return false;
    if (id === 'favourites' && caps && !caps.supportsStarred) return false;
    return true;
  };

  const itemFor = (id: string) => NAVIGATION_ITEMS.find((item) => item.id === id);

  const navigate = (id: string) => store.setNavigation(id);

  return (
    <nav className={`nav-rail ${expanded ? 'expanded' : ''}`} aria-label="Main navigation">
      <button
        type="button"
        className="nav-logo"
        title={expanded ? 'Collapse navigation' : 'Expand navigation'}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span ref={logoMarkRef} className="nav-logo-mark">
          <img src={useBlackLogo ? appIconBlack : appIcon} alt="" />
        </span>
        <span className="nav-logo-text">WAVR</span>
        <span className="nav-toggle">
          <Icon name={expanded ? 'chevron_left' : 'chevron_right'} size={16} />
        </span>
      </button>

      <div className="nav-scroll">
        {GROUPS.map((group, groupIndex) => {
          const items = group.items.filter(supported).map(itemFor).filter(Boolean);
          if (!items.length) return null;
          return (
            <div className="nav-group" key={group.id}>
              {expanded ? (
                <div className="nav-section-label">{group.label}</div>
              ) : groupIndex > 0 ? (
                <div className="nav-section-divider" role="separator" />
              ) : null}
              {items.map((item) => {
                if (!item) return null;
                const active = navigation === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`nav-item ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="nav-footer">
        <button
          type="button"
          className={`nav-item ${navigation === 'settings' ? 'active' : ''}`}
          aria-label="Settings"
          title="Settings"
          aria-current={navigation === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
        >
          <Icon name="settings" size={20} />
          <span>Settings</span>
        </button>
        <div className={`nav-server ${profile ? "connected" : ""}`} title={profile?.url || "Not connected"}>
          <span className="nav-server-dot" />
          {expanded && (
            <span className="nav-server-name">
              {profile ? `${profile.name}${info?.version ? ` · API ${info.version}` : ""}` : "Not connected"}
            </span>
          )}
        </div>
        {expanded && <div className="nav-version">WAVR v{APP_VERSION}</div>}
      </div>
    </nav>
  );
}




