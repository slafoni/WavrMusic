import { useEffect, useState } from 'react';
import type { AppSettings, WavrSyncAccountConfig, WavrSyncAccountSession } from '../../../../shared/models';
import { store, useSettings } from '../../state';
import { wavrSyncAccount, wavrSyncHttpBase } from '../../services/wavrSyncAccountService';
import { connectServer } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { copyText } from '../../services/clipboardService';
import { wavrSync } from '../../services/wavrSyncService';
import { Button } from '../../components/Button';
import { Card, Chip, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { Switch } from '../../components/Switch';
import { go } from '../../app/routes';

function applySettings(imported: AppSettings) {
  const merged: AppSettings = {
    ...store.getSettings(),
    ...imported,
    servers: Array.isArray(imported.servers) ? imported.servers : store.getSettings().servers,
  };
  store.updateSettings(merged);
  playback.setVolume(Number.isFinite(merged.defaultVolume) ? merged.defaultVolume : 0.85);
  playback.applyAudioSettings();
  const profile = merged.servers.find((entry) => entry.default) || merged.servers[0];
  if (profile) {
    connectServer(profile).catch((reason: any) => {
      pushToast(reason?.message || 'Settings were imported, but the music server could not reconnect.', 'error');
    });
  }
}

export function WavrSyncAccountGate({
  serverUrl,
  onAuthenticated,
}: {
  serverUrl: string;
  onAuthenticated: (session: WavrSyncAccountSession) => void;
}) {
  const [config, setConfig] = useState<WavrSyncAccountConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setConfigError('');
    wavrSyncAccount
      .config(serverUrl)
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((reason: any) => {
        if (!cancelled) setConfigError(reason?.message || 'This WavrSync server does not support accounts yet.');
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const registrationDisabled = !config || config.registration === 'closed';

  const submit = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        const session = await wavrSyncAccount.register(
          serverUrl,
          username.trim(),
          password,
          inviteCode,
          store.getSettings(),
        );
        pushToast(`Created WavrSync account ${session.account.username}.`, 'success');
        onAuthenticated(session);
      } else {
        const result = await wavrSyncAccount.login(
          serverUrl,
          username.trim(),
          password,
          store.getSettings(),
        );
        if (result.importedSettings) {
          applySettings(result.importedSettings);
          pushToast('WavrSync settings and logins were imported.', 'success');
        }
        onAuthenticated(result.session);
      }
    } catch (reason: any) {
      setError(reason?.message || 'Could not sign in to WavrSync.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page wavrsync-page" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">WavrSync account</h1>
          <div className="page-subtitle">Sign in to sync settings, logins, profiles and listening across devices</div>
        </div>
      </div>

      <Card className="wavrsync-auth-card">
        <div className="wavrsync-auth-tabs" role="tablist">
          <Button
            variant="surface"
            active={mode === 'login'}
            label="Sign in"
            onClick={() => { setMode('login'); setError(''); }}
          />
          <Button
            variant="surface"
            active={mode === 'register'}
            label="Create account"
            onClick={() => { setMode('register'); setError(''); }}
            disabled={registrationDisabled}
          />
        </div>

        <div className="wavrsync-auth-form">
          <input
            className="form-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            autoComplete="username"
            aria-label="WavrSync username"
          />
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder="Password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            aria-label="WavrSync password"
          />
          {mode === 'register' && config?.inviteRequired && (
            <input
              className="form-input"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Invitation code"
              aria-label="WavrSync invitation code"
            />
          )}
          <Button
            variant="primary"
            icon={mode === 'register' ? 'person_add' : 'login'}
            label={
              busy
                ? mode === 'register'
                  ? 'Creating account...'
                  : 'Signing in...'
                : mode === 'register'
                  ? 'Create WavrSync account'
                  : 'Sign in to WavrSync'
            }
            onClick={submit}
            disabled={
              busy ||
              !username.trim() ||
              !password ||
              (mode === 'register' && registrationDisabled) ||
              (mode === 'register' && !!config?.inviteRequired && !inviteCode.trim())
            }
          />
        </div>

        {configError && <div className="status-line error">{configError}</div>}
        {error && <div className="status-line error">{error}</div>}
        {mode === 'register' && config?.registration === 'invite' && (
          <div className="form-hint">
            This WavrSync server is invite-only. Ask the server owner for an invitation code.
          </div>
        )}
        {mode === 'register' && config?.registration === 'closed' && (
          <div className="form-hint">Registration is closed on this WavrSync server.</div>
        )}
        <div className="form-hint">
          Your music-server logins and WAVR settings are encrypted on this device with your WavrSync password before they are uploaded. The server cannot read them.
        </div>
      </Card>
    </div>
  );
}

export function WavrSyncAccountCard({
  serverUrl,
  session,
}: {
  serverUrl: string;
  session: WavrSyncAccountSession;
}) {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [username, setUsername] = useState(session.account.username);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState('');

  useEffect(() => {
    setUsername(session.account.username);
  }, [session.account.username]);

  const upload = async () => {
    setBusy(true);
    setMessage('');
    try {
      const uploaded = await wavrSyncAccount.uploadSettings(serverUrl, store.getSettings());
      setMessage(uploaded ? 'Settings backup uploaded.' : 'No local encryption key is available. Sign in again.');
    } catch (reason: any) {
      setMessage(reason?.message || 'Could not upload settings.');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setMessage('');
    try {
      const imported = await wavrSyncAccount.downloadSettings(serverUrl);
      if (!imported) {
        setMessage('There is no settings backup on this account yet.');
      } else {
        applySettings(imported);
        setMessage('Settings backup imported.');
      }
    } catch (reason: any) {
      setMessage(reason?.message || 'Could not import settings.');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    await wavrSyncAccount.logout(serverUrl);
    wavrSync.resetGuestIdentity();
    setBusy(false);
  };

  const copyId = async () => {
    if (!(await copyText(session.account.id))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const changeUsername = async () => {
    const next = username.trim();
    if (!next || next === session.account.username) return;
    setUsernameBusy(true);
    setUsernameMessage('');
    try {
      const updated = await wavrSyncAccount.changeUsername(serverUrl, next);
      setUsername(updated.account.username);
      setUsernameMessage('Username updated. WavrSync and your profile now use the new name.');
      pushToast('WavrSync username updated.', 'success');
    } catch (reason: any) {
      setUsernameMessage(reason?.message || 'Could not update the username.');
    } finally {
      setUsernameBusy(false);
    }
  };

  return (
    <Card className="wavrsync-account-card">
      <SectionHeader title="WavrSync account">
        <Chip selected>Logged in</Chip>
      </SectionHeader>
      <div className="wavrsync-account-identity">
        <div>
          <div className="settings-label">{session.account.username}</div>
          <button type="button" className="link-button muted wavrsync-account-id" onClick={copyId}>
            {session.account.id}
            <Icon name="content_copy" size={13} />
          </button>
        </div>
        {copied && <span className="form-hint">Copied</span>}
      </div>
      <div className="settings-row">
        <div className="settings-row-main">
          <div className="settings-label">Username</div>
          <div className="settings-description">
            Used across WavrSync, your shared profile, friends lists, and the WAVR website.
          </div>
          {usernameMessage && <div className="form-hint">{usernameMessage}</div>}
        </div>
        <div className="wavrsync-username-editor">
          <input
            className="form-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void changeUsername();
            }}
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,31}"
            spellCheck={false}
            aria-label="WavrSync username"
          />
          <Button
            variant="surface"
            icon="save"
            label={usernameBusy ? 'Saving...' : 'Save'}
            onClick={changeUsername}
            disabled={usernameBusy || !username.trim() || username.trim() === session.account.username}
          />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-main">
          <div className="settings-label">Sync settings and logins</div>
          <div className="settings-description">
            Upload encrypted WAVR settings to this account and import them on other devices.
          </div>
        </div>
        <Switch
          checked={settings.wavrSyncSettingsSync !== false}
          onChange={(wavrSyncSettingsSync) => store.updateSettings({ wavrSyncSettingsSync })}
          label={settings.wavrSyncSettingsSync !== false ? 'Enabled' : 'Disabled'}
          ariaLabel="Sync settings with WavrSync"
        />
      </div>
      <div className="wavrsync-account-actions">
        <Button variant="surface" icon="cloud_upload" label="Upload now" onClick={upload} disabled={busy} />
        <Button variant="surface" icon="cloud_download" label="Import now" onClick={download} disabled={busy} />
        <Button variant="surface" className="danger-text" icon="logout" label="Sign out" onClick={logout} disabled={busy} />
      </div>
      {message && <div className="form-hint">{message}</div>}
    </Card>
  );
}




