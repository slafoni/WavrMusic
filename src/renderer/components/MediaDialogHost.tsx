import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Playlist, Track } from '../../../shared/models';
import { formatDuration } from '../../../shared/constants';
import { store } from '../state';
import {
  addSongsToPlaylist,
  coverArtUrl,
  createPlaylist,
  fetchPlaylists,
} from '../services/serverService';
import { pushToast } from '../services/toastService';
import { copyText } from '../services/clipboardService';
import { go } from '../app/routes';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { Icon } from './Icon';

interface PlaylistPickerRequest {
  tracks: Track[];
  label: string;
}

interface ShareDialogRequest {
  url: string;
  expiresAt: number;
  title: string;
  artist: string;
}

type PlaylistListener = (request: PlaylistPickerRequest | null) => void;
type TrackDetailsListener = (track: Track | null) => void;
type ShareListener = (request: ShareDialogRequest | null) => void;

let playlistListener: PlaylistListener | null = null;
let trackDetailsListener: TrackDetailsListener | null = null;
let shareListener: ShareListener | null = null;

export function openPlaylistPicker(tracks: Track[], label = '') {
  if (!tracks.length) return;
  playlistListener?.({
    tracks,
    label: label || (tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks`),
  });
}

export function openTrackDetails(track: Track) {
  trackDetailsListener?.(track);
}

export function openShareDialog(request: ShareDialogRequest) {
  shareListener?.(request);
}

function remainingLabel(expiresAt: number, now: number): string {
  const remaining = expiresAt - now;
  if (remaining <= 0) return 'This link has expired.';
  const minutes = Math.ceil(remaining / 60000);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `Expires in ${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hour${hours === 1 ? '' : 's'}` : ''}`;
  }
  if (hours > 0) return `Expires in ${hours} hour${hours === 1 ? '' : 's'} ${mins} minute${mins === 1 ? '' : 's'}`;
  return `Expires in ${mins} minute${mins === 1 ? '' : 's'}`;
}

export function MediaDialogHost() {
  const [picker, setPicker] = useState<PlaylistPickerRequest | null>(null);
  const [details, setDetails] = useState<Track | null>(null);
  const [share, setShare] = useState<ShareDialogRequest | null>(null);
  const [now, setNow] = useState(Date.now());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    playlistListener = setPicker;
    trackDetailsListener = setDetails;
    shareListener = setShare;
    return () => {
      if (playlistListener === setPicker) playlistListener = null;
      if (trackDetailsListener === setDetails) trackDetailsListener = null;
      if (shareListener === setShare) shareListener = null;
    };
  }, []);

  useEffect(() => {
    if (!share) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [share]);

  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setName('');
    fetchPlaylists()
      .then((result) => {
        if (!cancelled) setPlaylists(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load playlists.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [picker]);

  const closePicker = () => {
    if (busy) return;
    setPicker(null);
  };

  const addExisting = async (playlist: Playlist) => {
    if (!picker) return;
    setBusy(true);
    try {
      await addSongsToPlaylist(playlist.id, picker.tracks.map((track) => track.id));
      pushToast(`Added ${picker.tracks.length} track${picker.tracks.length === 1 ? '' : 's'} to "${playlist.name}".`, 'success');
      setPicker(null);
    } catch (reason: any) {
      setError(reason?.message || 'Could not update the playlist.');
    } finally {
      setBusy(false);
    }
  };

  const createNew = async () => {
    if (!picker || !name.trim()) return;
    setBusy(true);
    try {
      await createPlaylist(name.trim(), picker.tracks.map((track) => track.id));
      pushToast(`Created "${name.trim()}" with ${picker.tracks.length} track${picker.tracks.length === 1 ? '' : 's'}.`, 'success');
      setPicker(null);
    } catch (reason: any) {
      setError(reason?.message || 'Could not create the playlist.');
    } finally {
      setBusy(false);
    }
  };

  const copyShareUrl = async () => {
    if (!share) return;
    const copied = await copyText(share.url);
    pushToast(copied ? 'Share URL copied.' : 'Could not copy the share URL.', copied ? 'success' : 'error');
  };

  const openShareUrl = () => {
    if (!share) return;
    (window as any).electronAPI?.openExternal?.(share.url);
  };

  return (
    <>
      {picker &&
        createPortal(
          <div className="backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePicker()}>
            <div className="dialog media-dialog" role="dialog" aria-modal="true" aria-label="Add to playlist">
              <div className="dialog-header">
                <div>
                  <div className="dialog-title">Add to playlist</div>
                  <div className="settings-description">{picker.label}</div>
                </div>
                <Button variant="icon" icon="close" title="Close" onClick={closePicker} />
              </div>
              <div className="dialog-body">
                <div className="media-dialog-create">
                  <input
                    className="form-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') createNew();
                    }}
                    placeholder="New playlist name"
                    aria-label="New playlist name"
                  />
                  <Button
                    variant="primary"
                    icon="add"
                    label="Create"
                    onClick={createNew}
                    disabled={busy || !name.trim()}
                  />
                </div>
                {loading ? (
                  <div className="loading-block"><span className="spinner" /> Loading playlists...</div>
                ) : error ? (
                  <div className="status-line error">{error}</div>
                ) : (
                  <div className="media-dialog-list">
                    {playlists.length === 0 ? (
                      <div className="profile-empty">No playlists yet. Create one above.</div>
                    ) : (
                      playlists.map((playlist) => (
                        <button
                          type="button"
                          key={playlist.id}
                          className="media-dialog-row"
                          onClick={() => addExisting(playlist)}
                          disabled={busy}
                        >
                          <span className="profile-playlist-icon"><Icon name="playlist_play" size={20} /></span>
                          <span>
                            <strong>{playlist.name}</strong>
                            <small>{playlist.songCount ?? 0} tracks{playlist.owner ? ` - ${playlist.owner}` : ''}</small>
                          </span>
                          <Icon name="add" size={18} />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {details &&
        createPortal(
          <div className="backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetails(null)}>
            <div className="dialog media-dialog track-details-dialog" role="dialog" aria-modal="true" aria-label="Track details">
              <div className="dialog-header">
                <div className="dialog-title">Track details</div>
                <Button variant="icon" icon="close" title="Close" onClick={() => setDetails(null)} />
              </div>
              <div className="dialog-body">
                <div className="track-details-hero">
                  <Artwork
                    src={coverArtUrl(details.coverArt || details.albumCover, 240) || null}
                    size={120}
                    radius="medium"
                    alt={details.title}
                  />
                  <div>
                    <div className="track-details-title">{details.title}</div>
                    <button
                      type="button"
                      className="link-button"
                      disabled={!details.artistId}
                      onClick={() => {
                        if (!details.artistId) return;
                        setDetails(null);
                        store.setNavigation(go.artist(details.artistId!));
                      }}
                    >
                      {details.artist}
                    </button>
                    <button
                      type="button"
                      className="link-button muted"
                      disabled={!details.albumId}
                      onClick={() => {
                        if (!details.albumId) return;
                        setDetails(null);
                        store.setNavigation(go.album(details.albumId!));
                      }}
                    >
                      {details.album}
                    </button>
                  </div>
                </div>
                <div className="track-details-grid">
                  <span>Duration</span><strong>{formatDuration(details.duration)}</strong>
                  <span>Track</span><strong>{details.trackNumber || '-'}</strong>
                  <span>Disc</span><strong>{details.discNumber || '-'}</strong>
                  <span>Year</span><strong>{details.year || '-'}</strong>
                  <span>Genre</span><strong>{details.genre || '-'}</strong>
                  <span>Bitrate</span><strong>{details.bitRate ? `${details.bitRate} kbps` : '-'}</strong>
                </div>
              </div>
              <div className="dialog-footer">
                <Button
                  variant="surface"
                  icon="album"
                  label="Go to album"
                  disabled={!details.albumId}
                  onClick={() => {
                    if (!details.albumId) return;
                    setDetails(null);
                    store.setNavigation(go.album(details.albumId!));
                  }}
                />
                <Button
                  variant="primary"
                  icon="person"
                  label="Go to artist"
                  disabled={!details.artistId}
                  onClick={() => {
                    if (!details.artistId) return;
                    setDetails(null);
                    store.setNavigation(go.artist(details.artistId!));
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {share &&
        createPortal(
          <div className="backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShare(null)}>
            <div className="dialog media-dialog share-dialog" role="dialog" aria-modal="true" aria-label="Share song">
              <div className="dialog-header">
                <div>
                  <div className="dialog-title">Share song</div>
                  <div className="settings-description">{share.title} - {share.artist}</div>
                </div>
                <Button variant="icon" icon="close" title="Close" onClick={() => setShare(null)} />
              </div>
              <div className="dialog-body">
                <div className="form-label">Public share URL</div>
                <input
                  className="form-input share-dialog-url"
                  readOnly
                  value={share.url}
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label="Share URL"
                />
                <div className="share-dialog-expiry">
                  <Icon name="schedule" size={16} />
                  <span>{remainingLabel(share.expiresAt, now)}</span>
                  <span className="share-dialog-date">
                    {new Date(share.expiresAt).toLocaleString()}
                  </span>
                </div>
                <div className="form-hint">
                  Anyone with this link can listen to the shared song until it expires. Navidrome must have public sharing enabled.
                </div>
              </div>
              <div className="dialog-footer">
                <Button variant="surface" icon="open_in_new" label="Open" onClick={openShareUrl} />
                <Button variant="primary" icon="content_copy" label="Copy URL" onClick={copyShareUrl} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

