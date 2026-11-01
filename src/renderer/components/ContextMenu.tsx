import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

export interface ContextMenuRequest {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

type MenuListener = (request: ContextMenuRequest | null) => void;

let menuListener: MenuListener | null = null;

export function showContextMenu(
  event: {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  items: ContextMenuItem[],
) {
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  menuListener?.({ x: event.clientX, y: event.clientY, items });
}

export function hideContextMenu() {
  menuListener?.(null);
}

export function ContextMenuHost() {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [activeSubmenu, setActiveSubmenu] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuListener = setRequest;
    return () => {
      if (menuListener === setRequest) menuListener = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!request) return;
    setActiveSubmenu(-1);
    const menu = menuRef.current;
    const width = menu?.offsetWidth || 240;
    const height = menu?.offsetHeight || 320;
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(request.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(request.y, window.innerHeight - height - margin)),
    });
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setRequest(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRequest(null);
    };
    const scroll = () => setRequest(null);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', scroll);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', scroll);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [request]);

  if (!request) return null;

  const choose = (item: ContextMenuItem) => {
    if (item.disabled || item.separator || item.children?.length) return;
    setRequest(null);
    item.onClick?.();
  };

  const renderItems = (items: ContextMenuItem[], nested = false) => (
    <div className={`context-menu-list ${nested ? 'nested' : ''}`} role="menu">
      {items.map((item, index) => {
        if (item.separator) return <div key={`separator-${index}`} className="context-menu-separator" role="separator" />;
        const hasChildren = !!item.children?.length;
        return (
          <div
            key={`${item.label}-${index}`}
            className="context-menu-item-wrap"
            onMouseEnter={() => setActiveSubmenu(hasChildren ? index : -1)}
          >
            <button
              type="button"
              role={hasChildren ? 'menuitem' : 'menuitem'}
              className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (hasChildren) {
                  setActiveSubmenu((current) => (current === index ? -1 : index));
                  return;
                }
                choose(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={17} /> : <span className="context-menu-icon-spacer" />}
              <span className="context-menu-label">{item.label}</span>
              {item.checked && <Icon name="check" size={16} className="context-menu-check" />}
              {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
              {hasChildren && <Icon name="chevron_right" size={16} className="context-menu-chevron" />}
            </button>
            {hasChildren && activeSubmenu === index && (
              <div className="context-submenu">
                {renderItems(item.children || [], true)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderItems(request.items)}
    </div>,
    document.body,
  );
}
