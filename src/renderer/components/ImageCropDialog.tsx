import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

const VIEW_WIDTH = 640;

interface ImageCropDialogProps {
  file: File;
  aspect: number;
  title: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void | Promise<void>;
}

interface Offset {
  x: number;
  y: number;
}

export function ImageCropDialog({
  file,
  aspect,
  title,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const viewHeight = Math.round(VIEW_WIDTH / aspect);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      if (cancelled) return;
      setImage(next);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError('');
    };
    next.onerror = () => {
      if (!cancelled) setError('This image could not be opened.');
    };
    next.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const baseScale = image
    ? Math.max(VIEW_WIDTH / image.naturalWidth, viewHeight / image.naturalHeight)
    : 1;

  const clampOffsets = (x: number, y: number, nextZoom: number): Offset => {
    if (!image) return { x: 0, y: 0 };
    const scale = baseScale * nextZoom;
    const maxX = Math.max(0, (image.naturalWidth * scale - VIEW_WIDTH) / 2);
    const maxY = Math.max(0, (image.naturalHeight * scale - viewHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = baseScale * zoom;
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const clamped = clampOffsets(offset.x, offset.y, zoom);
    context.clearRect(0, 0, VIEW_WIDTH, viewHeight);
    context.drawImage(
      image,
      (VIEW_WIDTH - drawWidth) / 2 + clamped.x,
      (viewHeight - drawHeight) / 2 + clamped.y,
      drawWidth,
      drawHeight,
    );
  }, [image, zoom, offset, baseScale, viewHeight]);

  const updateZoom = (value: number) => {
    const next = Math.max(1, Math.min(3, value));
    setZoom(next);
    setOffset((current) => clampOffsets(current.x, current.y, next));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!image || saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampOffsets(
      drag.offsetX + event.clientX - drag.startX,
      drag.offsetY + event.clientY - drag.startY,
      zoom,
    );
    setOffset(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const confirm = async () => {
    if (!image || saving) return;
    const outputWidth = aspect === 1 ? 512 : 1600;
    const outputHeight = Math.round(outputWidth / aspect);
    const ratio = outputWidth / VIEW_WIDTH;
    const scale = baseScale * zoom * ratio;
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const clamped = clampOffsets(offset.x, offset.y, zoom);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#000';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(
      image,
      (outputWidth - drawWidth) / 2 + clamped.x * ratio,
      (outputHeight - drawHeight) / 2 + clamped.y * ratio,
      drawWidth,
      drawHeight,
    );
    setSaving(true);
    try {
      await onConfirm(canvas.toDataURL('image/webp', 0.9));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="backdrop crop-backdrop" role="presentation">
      <div className="dialog crop-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-header">
          <div className="dialog-title">{title}</div>
        </div>
        <div className="dialog-body">
          <div className="crop-stage" style={{ aspectRatio: String(aspect) }}>
            <canvas
              ref={canvasRef}
              width={VIEW_WIDTH}
              height={viewHeight}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <div className="crop-grid" aria-hidden="true" />
          </div>
          <div className="crop-controls">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => updateZoom(Number(event.target.value))}
              aria-label="Zoom image"
            />
          </div>
          <div className="crop-hint">Drag the image to reposition it.</div>
          {error && <div className="status-line error">{error}</div>}
        </div>
        <div className="dialog-footer">
          <Button variant="surface" label="Cancel" onClick={onCancel} disabled={saving} />
          <Button
            variant="primary"
            label={saving ? 'Saving...' : 'Save image'}
            onClick={confirm}
            disabled={!image || saving}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
