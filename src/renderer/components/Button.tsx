import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'surface' | 'icon' | 'compact' | 'play' | 'danger';
  icon?: string;
  iconRight?: string;
  label?: ReactNode;
  active?: boolean;
  size?: 'small' | 'medium' | 'large';
}

const VARIANT_CLASSES: Record<string, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  surface: 'btn-surface',
  icon: 'btn-icon',
  compact: 'btn-icon btn-compact',
  play: 'btn-play',
  danger: 'btn-icon danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  icon,
  iconRight,
  label,
  active,
  size,
  className,
  disabled,
  children,
  ...props
}, ref) => {
  const cls = [`btn`, VARIANT_CLASSES[variant], active ? 'active' : '', className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      {...props}
    >
      {icon && <Icon name={icon} size={18} />}
      {children ?? label}
      {iconRight && <Icon name={iconRight} size={18} />}
    </button>
  );
});

Button.displayName = 'Button';
