import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Card } from './Card';
import { Icon } from './Icon';
import { coverArtUrl } from '../services/serverService';

export interface MediaCardProps {
  title: string;
  subtitle?: string;
  coverArt?: string | null;
  round?: boolean;
  fallbackIcon?: string;
  badge?: ReactNode;
  starred?: boolean;
  onClick?: () => void;
  onTitleClick?: () => void;
  onSubtitleClick?: () => void;
  onPlay?: () => void;
  onQueue?: () => void;
  onToggleStar?: (next: boolean) => void | Promise<void>;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function MediaCard({
  title,
  subtitle,
  coverArt,
  round = false,
  fallbackIcon = 'album',
  badge,
  starred = false,
  onClick,
  onTitleClick,
  onSubtitleClick,
  onPlay,
  onQueue,
  onToggleStar,
  onContextMenu,
}: MediaCardProps) {
  const url = coverArtUrl(coverArt || undefined, 400);
  const [starredState, setStarredState] = useState(starred);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStarredState(starred);
  }, [starred, title]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  const hasMenu = !!(onPlay || onQueue || onToggleStar || onClick);
  const hasActions = !!(onPlay || onQueue || (onToggleStar && !round));

  const toggleStar = async () => {
    const next = !starredState;
    setStarredState(next);
    try {
      await onToggleStar?.(next);
    } catch {
      setStarredState(!next);
    }
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`media-card ${round ? 'round-art' : ''} ${menuOpen ? 'menu-open' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={() => {
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        onClick?.();
      }}
      onKeyDown={onCardKeyDown}
      onContextMenu={onContextMenu}
      aria-label={onClick ? `Open ${title}` : undefined}
    >
      <Card className="media-card-surface">
        <div className="album-art">
          {url ? (
            <img src={url} alt={title} loading="lazy" decoding="async" draggable={false} />
          ) : (
            <span className="placeholder">
              <Icon name={fallbackIcon} size={30} />
            </span>
          )}
          <span className="album-art-shade" aria-hidden="true" />
          {badge && <span className="status-pill media-card-badge">{badge}</span>}

          {hasActions && (
            <div className="media-card-actions" onClick={(event) => event.stopPropagation()}>
              {onPlay && (
                <button
                  type="button"
                  className="media-action media-action-play"
                  onClick={() => { setMenuOpen(false); onPlay(); }}
                  aria-label={`Play ${title}`}
                  title={`Play ${title}`}
                >
                  <Icon name="play_arrow" size={18} />
                </button>
              )}
              {onToggleStar && !round && (
                <button
                  type="button"
                  className={`media-action ${starredState ? 'active' : ''}`}
                  onClick={() => { setMenuOpen(false); toggleStar(); }}
                  aria-label={starredState ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
                  aria-pressed={starredState}
                  title={starredState ? 'Remove from favourites' : 'Add to favourites'}
                >
                  <Icon name={starredState ? 'favorite' : 'favorite_border'} size={16} />
                </button>
              )}
              {onQueue && (
                <button
                  type="button"
                  className="media-action"
                  onClick={() => { setMenuOpen(false); onQueue(); }}
                  aria-label={`Add ${title} to queue`}
                  title="Add to queue"
                >
                  <Icon name="queue_music" size={16} />
                </button>
              )}
              {hasMenu && (
                <button
                  type="button"
                  className="media-action"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label={`More options for ${title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="More options"
                >
                  <Icon name="more_vert" size={16} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="album-info">
          <button
            type="button"
            className="album-title link-button"
            title={title}
            onClick={(event) => {
              event.stopPropagation();
              (onTitleClick || onClick)?.();
            }}
          >
            {title}
          </button>
          {subtitle && (
            <button
              type="button"
              className="album-artist link-button"
              title={subtitle}
              disabled={!onSubtitleClick}
              onClick={(event) => {
                event.stopPropagation();
                onSubtitleClick?.();
              }}
            >
              {subtitle}
            </button>
          )}
        </div>
      </Card>

      {menuOpen && (
        <div
          className="media-card-menu"
          role="menu"
          aria-label={`${title} options`}
          onClick={(event) => event.stopPropagation()}
        >
          {onPlay && (
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onPlay(); }}>
              <Icon name="play_arrow" size={16} /> Play
            </button>
          )}
          {onQueue && (
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onQueue(); }}>
              <Icon name="queue_music" size={16} /> Add to queue
            </button>
          )}
          {onToggleStar && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                toggleStar();
              }}
            >
              <Icon name={starredState ? 'favorite' : 'favorite_border'} size={16} />
              {starredState ? 'Remove from favourites' : 'Add to favourites'}
            </button>
          )}
          {onClick && (
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onClick(); }}>
              <Icon name="open_in_new" size={16} /> Open
            </button>
          )}
        </div>
      )}
    </div>
  );
}

