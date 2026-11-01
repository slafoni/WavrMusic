import { Fragment, type ReactNode, type HTMLAttributes, type CSSProperties } from 'react';

export function Card({ children, className, style, ...props }: { children: ReactNode; className?: string; style?: CSSProperties } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className ?? ''}`} style={style} {...props}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`section-header ${className ?? ''}`}>
      <div className="h3">{title}</div>
      {children}
    </div>
  );
}

export function Divider({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={`divider ${className ?? ''}`} style={style} role="separator" aria-orientation="horizontal" />;
}

export function Chip({ children, selected = false, className }: { children: ReactNode; selected?: boolean; className?: string }) {
  return (
    <span className={`chip ${selected ? 'selected' : ''} ${className ?? ''}`} role="checkbox" aria-checked={selected}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, subtitle, action, className }: {
  icon?: ReactNode; title: string; subtitle?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={`empty-state ${className ?? ''}`}>
      {icon && <div className="empty-icon">{icon}</div>}
      <h2 className="empty-title">{title}</h2>
      {subtitle && <p className="empty-subtitle">{subtitle}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

export { Fragment };
