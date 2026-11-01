import { useEffect, useState } from 'react';

function initialFor(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function ProfileAvatar({
  src,
  name,
  size = 64,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={`profile-avatar ${className || ''}`}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.34)) }}
      role="img"
      aria-label={name ? `${name} profile picture` : 'Profile picture'}
    >
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initialFor(name)}</span>
      )}
    </div>
  );
}
