import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Track } from '../../../../shared/models';
import { store, useSettings } from '../../state';
import { pushToast } from '../../services/toastService';
import { Button } from '../../components/Button';

function electronApi(): any {
  return (window as any).electronAPI;
}

export function CustomYouTubeBackgroundDialog({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  const settings = useSettings();
  const currentVideoId = settings.youtubeBackgrounds?.[track.id] || '';
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setUrl(currentVideoId ? `https://www.youtube.com/watch?v=${currentVideoId}` : '');
    setError('');
  }, [currentVideoId, track.id]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onClose]);

  const save = async () => {
    const value = url.trim();
    if (!value) {
      setError('Enter a YouTube video URL.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await electronApi()?.youtubeCustomVideo?.(value);
      if (!result?.videoId) {
        setError(String(result?.error || 'Enter a valid YouTube video URL.'));
        return;
      }
      store.updateSettings({
        youtubeBackgrounds: {
          ...(settings.youtubeBackgrounds || {}),
          [track.id]: result.videoId,
        },
        fullscreenYoutubeBackground: true,
      });
      pushToast('Custom background cached for this song.', 'success');
      onClose();
    } catch (reason: any) {
      setError(reason?.message || 'Could not cache that YouTube video.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    const next = { ...(settings.youtubeBackgrounds || {}) };
    delete next[track.id];
    store.updateSettings({ youtubeBackgrounds: next });
    pushToast('Custom background removed.');
    onClose();
  };

  return createPortal(
    <div
      className="backdrop youtube-background-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        className="dialog media-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Custom YouTube background"
      >
        <div className="dialog-header">
          <div>
            <div className="dialog-title">Custom YouTube background</div>
            <div className="settings-description">
              {track.title}{track.artist ? ` - ${track.artist}` : ''}
            </div>
          </div>
          <Button variant="icon" icon="close" title="Close" onClick={onClose} disabled={busy} />
        </div>
        <div className="dialog-body">
          <div className="settings-description" style={{ marginBottom: 14 }}>
            The video is downloaded once with yt-dlp and saved as this song's music video background.
          </div>
          <label className="form-label" htmlFor="custom-youtube-url">YouTube URL</label>
          <input
            id="custom-youtube-url"
            className="form-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            autoFocus
            disabled={busy}
          />
          <div className="form-hint">
            Supports youtube.com, youtu.be, Shorts, live, and embed URLs. The automatic search is used when no custom video is set. In fullscreen, use the -/+ sync controls to adjust the background by 0.5 seconds.
          </div>
          {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>
        <div className="dialog-footer">
          {currentVideoId && (
            <Button
              variant="surface"
              icon="delete"
              label="Remove"
              onClick={remove}
              disabled={busy}
              style={{ marginRight: 'auto' }}
            />
          )}
          <Button variant="surface" label="Cancel" onClick={onClose} disabled={busy} />
          <Button
            variant="primary"
            icon="download"
            label={busy ? 'Caching...' : 'Save and cache'}
            onClick={save}
            disabled={busy || !url.trim()}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
