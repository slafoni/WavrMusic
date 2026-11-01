import { useEffect, useState, type FormEvent } from 'react';
import type { ServerProfile, ServerCapabilities } from '../../../shared/models';
import { APP_NAME, API_VERSION, CLIENT_NAME, generateId } from '../../../shared/constants';
import { SubsonicClient } from '../../../shared/api/subsonic-client';
import { connectServer } from '../services/serverService';
import { store, useSettings } from '../state';
import { pushToast } from '../services/toastService';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import appIcon from '../../../assets/icon.png';

function normalizeUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'Music server';
  }
}

function electronApi(): any {
  return (window as any).electronAPI;
}

export function ConnectDialog({
  open,
  initial,
  onClose,
  onConnected,
}: {
  open: boolean;
  initial?: ServerProfile | null;
  onClose?: () => void;
  onConnected: (profile: ServerProfile) => void;
}) {
  const settings = useSettings();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || '');
    setUrl(initial?.url || '');
    setPublicUrl(initial?.publicUrl || '');
    setUsername(initial?.username || '');
    setPassword(initial?.password || '');
    setBusy(false);
    setTestState('idle');
    setMessage('');
    setDetails('');
  }, [open, initial?.id]);

  useEffect(() => {
    if (!open || !onClose) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const buildProfile = (): ServerProfile | null => {
    const normalized = normalizeUrl(url);
    if (!normalized || !username.trim()) return null;
    return {
      id: initial?.id || generateId(),
      name: name.trim() || hostLabel(normalized),
      url: normalized,
      username: username.trim(),
      password,
      token: initial?.token,
      publicUrl: publicUrl.trim() ? normalizeUrl(publicUrl) : undefined,
      default: true,
      createdAt: initial?.createdAt || Date.now(),
    };
  };

  const test = async () => {
    const profile = buildProfile();
    if (!profile) {
      setTestState('error');
      setMessage('Enter a server URL and username first.');
      return;
    }
    setTestState('testing');
    setMessage('Testing connection…');
    setDetails('');
    try {
      const client = new SubsonicClient({
        url: profile.url,
        username: profile.username,
        password: profile.password,
        clientName: CLIENT_NAME,
        apiVersion: API_VERSION,
        timeoutMs: 12000,
      });
      const capabilities: ServerCapabilities = await client.probeCapabilities(true);
      setTestState('ok');
      setMessage(`Connected successfully${capabilities.version ? ` · API ${capabilities.version}` : ''}`);
      setDetails(
        `OpenSubsonic: ${capabilities.openSubsonic ? 'yes' : 'no'} · ` +
        `Lyrics: ${capabilities.supportsLyrics ? 'yes' : 'no'} · ` +
        `Favourites: ${capabilities.supportsStarred ? 'yes' : 'no'}`,
      );
    } catch (error: any) {
      setTestState('error');
      setMessage(error?.message || 'Connection failed.');
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const profile = buildProfile();
    if (!profile) {
      setTestState('error');
      setMessage('Enter a server URL and username first.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await connectServer({ ...profile, default: true });
      const others = settings.servers
        .filter((server) => server.id !== profile.id)
        .map((server) => ({ ...server, default: false }));
      store.updateSettings({ servers: [profile, ...others] });
      try {
        await electronApi()?.writeSettings?.(store.getSettings());
      } catch {
        /* The regular debounced persistence will retry. */
      }
      pushToast(
        `Connected to ${profile.name}${result.version ? ` (API ${result.version})` : ''}.`,
        'success',
      );
      onConnected(profile);
    } catch (error: any) {
      setTestState('error');
      setMessage(error?.message || 'Could not connect to the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label="Connect to a music server">
      <form className="dialog dialog-wide" onSubmit={save}>
        <div className="dialog-header">
          <div>
            <div className="connect-logo">
              <span className="connect-mark">
                <img src={appIcon} alt="" />
              </span>
              <div className="dialog-title">{initial ? 'Edit server' : `Connect to ${APP_NAME}`}</div>
            </div>
          </div>
          {onClose && (
            <Button variant="icon" icon="close" type="button" onClick={onClose} title="Close" />
          )}
        </div>
        <div className="dialog-body">
          <p style={{ marginTop: 0 }}>
            {APP_NAME} uses the Subsonic API to stream from Navidrome, Airsonic, Gonic and other
            compatible servers. Your library stays on your server.
          </p>
          <div className="form-field">
            <label className="form-label" htmlFor="server-name">Display name</label>
            <input
              id="server-name"
              className="form-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={url ? hostLabel(normalizeUrl(url)) : 'My music server'}
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="server-url">Server URL</label>
            <input
              id="server-url"
              className="form-input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://music.example.com"
              spellCheck={false}
              autoComplete="url"
              required
            />
            <div className="form-hint">Use HTTPS whenever your server is reachable over the internet.</div>
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="server-public-url">Public artwork URL (optional)</label>
            <input
              id="server-public-url"
              className="form-input"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://music.example.com"
              spellCheck={false}
              autoComplete="url"
            />
            <div className="form-hint">
              Publicly reachable Navidrome URL used for Discord album artwork and artwork fallbacks. If empty, WAVR uploads the current cover to a temporary public image host for Discord.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-field" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="server-user">Username</label>
              <input
                id="server-user"
                className="form-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="form-field" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="server-pass">Password</label>
              <input
                id="server-pass"
                type="password"
                className="form-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>
          <div className="form-hint">
            <Icon name="lock" size={12} /> Credentials are encrypted with the operating system
            credential store before settings are written to disk.
          </div>
          {message && (
            <div className={`status-line ${testState === 'ok' ? 'ok' : testState === 'error' ? 'error' : ''}`}>
              {testState === 'testing' && <span className="spinner" style={{ width: 12, height: 12 }} />}
              {testState === 'ok' && <Icon name="check_circle" size={14} />}
              {testState === 'error' && <Icon name="error" size={14} />}
              <span>{message}</span>
            </div>
          )}
          {details && <div className="form-hint" style={{ marginTop: 4 }}>{details}</div>}
        </div>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="surface"
            icon="refresh"
            label={testState === 'testing' ? 'Testing…' : 'Test connection'}
            onClick={test}
            disabled={busy || testState === 'testing'}
          />
          <Button type="submit" variant="primary" icon="cloud" label={busy ? 'Connecting…' : 'Save & connect'} disabled={busy} />
        </div>
      </form>
    </div>
  );
}
