import { useState, useRef, useEffect } from 'react';

interface ArtworkProps {
  src: string | null;
  size?: number;
  radius?: 'small' | 'medium' | 'large' | 'full' | 'none';
  alt?: string;
  className?: string;
  onError?: () => void;
}

const RADIUS: Record<string, string> = {
  small: '8px',
  medium: '16px',
  large: '28px',
  full: '9999px',
  none: '0',
};

export function Artwork({ src, size = 64, radius = 'medium', alt, className, onError }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) {
      setFailed(false);
      return;
    }
    const img = imgRef.current;
    if (!img) return;
    if (img.getAttribute('src') !== src) img.src = src;
    img.onerror = () => {
      setFailed(true);
      onError?.();
    };
  }, [src, onError]);

  const r = RADIUS[radius] ?? RADIUS['medium'];
  const style: React.CSSProperties = { width: size, height: size, borderRadius: r };

  if (failed || !src) {
    return (
      <div className={`artwork ${className ? className : ''}`} style={style}>
        <span className="artwork-placeholder" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 13a1 1 0 0 1-1-1v-2a1 1 0 0 1 2 0v2a1 1 0 0 1-1 1z" />
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49l-8.48-8.49a6 6 0 0 1 8.49 0z" />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <div className={`artwork ${className ? className : ''}`} style={style} role="img" aria-label={alt}>
      <img ref={imgRef} src={src} alt={alt ?? ''} loading="lazy" decoding="async" draggable="false" />
    </div>
  );
}
