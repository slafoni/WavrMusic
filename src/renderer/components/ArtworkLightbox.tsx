import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export function ArtworkLightbox({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean;
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div className="artwork-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button
        type="button"
        className="artwork-lightbox-close"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close artwork"
      >
        <Icon name="close" size={22} />
      </button>
      <img
        className="artwork-lightbox-image"
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body,
  );
}
