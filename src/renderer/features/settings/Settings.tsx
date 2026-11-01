import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  AppSettings,
  AudioEngineMode,
  ChannelMode,
  EqualizerPreset,
  ReplayGainMode,
  ResampleQuality,
  ServerProfile,
  StreamFormat,
  UpdateStatus,
} from '../../../../shared/models';
import {
  ACCENT_SWATCHES,
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  AUDIO_ENGINE_MODES,
  CHANNEL_MODES,
  DENSITIES,
  DYNAMIC_THEMES,
  EQUALIZER_FREQUENCIES,
  EQUALIZER_PRESETS,
  LASTFM_CALLBACK_URL,
  LYRIC_LANGUAGES,
  LYRICA_API_BASE,
  PAGE_BACKGROUND_ALL_ID,
  PAGE_BACKGROUND_MAX_GIF_BYTES,
  PAGE_BACKGROUND_MAX_IMAGE_BYTES,
  PAGE_BACKGROUND_MAX_VIDEO_BYTES,
  PAGE_BACKGROUND_OPTIONS,
  REPLAY_GAIN_MODES,
  RESAMPLE_QUALITIES,
  STREAM_BITRATES,
  STREAM_FORMATS,
  THEME_MODES,
  WAVRSYNC_DEFAULT_SERVER_URL,
} from '../../../../shared/constants';
import { updateChannelsForBadges } from '../../../../shared/updates';
import { store, useServer, useSettings } from '../../state';
import { useTheme } from '../../themes';
import { useScrobbleStatus } from '../../hooks/useScrobbling';
import { useWavrSyncState } from '../../hooks/useWavrSync';
import { useWavrSyncAccountName } from '../../hooks/useWavrSyncAccount';
import { useWavrSyncAccount } from '../../hooks/useWavrSyncAccount';
import { wavrSync } from '../../services/wavrSyncService';
import { connectServer, disconnectServer } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { copyText } from '../../services/clipboardService';
import {
  getAudioEngineDevices,
  getAudioEngineInfo,
  isAudioEngineSupported,
  onAudioEngineEvent,
} from '../../services/audioEngineService';
import type { AudioEngineDevice, AudioEngineInfo, AudioEngineOutput } from '../../services/audioEngineService';
import { Button } from '../../components/Button';
import { Card, Chip, Divider, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { DeveloperBadge } from '../../components/DeveloperBadge';
import { DangerNotice } from '../../components/DangerNotice';
import { ImageCropDialog } from '../../components/ImageCropDialog';
import { BackgroundVideo } from '../../components/BackgroundVideo';
import { Switch } from '../../components/Switch';
import { isVideoPageBackground } from '../../utils/backgroundMedia';
import appIcon from '../../../../assets/icon.png';

function api(): any {
  return (window as any).electronAPI;
}

export function Settings({
  onAddServer,
  onEditServer,
}: {
  onAddServer: () => void;
  onEditServer: (profile: ServerProfile) => void;
}) {
  const settings = useSettings();
  const { profile, info, caps } = useServer();
  const theme = useTheme();
  const [busyServerId, setBusyServerId] = useState('');
  const [diagnostics, setDiagnostics] = useState('');
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [discordStatus, setDiscordStatus] = useState<{ state?: string; message?: string } | null>(null);
  const [updatingProfileImage, setUpdatingProfileImage] = useState(false);
  const [updatingProfileBanner, setUpdatingProfileBanner] = useState(false);
  const [cropImage, setCropImage] = useState<{
    file: File;
    target: 'avatar' | 'banner';
  } | null>(null);
  const [backgroundPage, setBackgroundPage] = useState<string>(PAGE_BACKGROUND_OPTIONS[0].id);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const pageBackgroundUrl = settings.pageBackgrounds?.[backgroundPage] || '';
  const pageBackgroundIsVideo = isVideoPageBackground(pageBackgroundUrl);
  const allPagesBackgroundSet = !!settings.pageBackgrounds?.[PAGE_BACKGROUND_ALL_ID];
  const [profileTagsDraft, setProfileTagsDraft] = useState(
    Array.isArray(settings.profileTags) ? settings.profileTags.join(', ') : '',
  );
  const [engineInfo, setEngineInfo] = useState<AudioEngineInfo | null>(null);
  const [engineDevices, setEngineDevices] = useState<AudioEngineDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [engineOutput, setEngineOutput] = useState<AudioEngineOutput | null>(
    playback.getAudioEngineOutput(),
  );
  const profileImageInput = useRef<HTMLInputElement>(null);
  const profileBannerInput = useRef<HTMLInputElement>(null);
  const wavrSyncState = useWavrSyncState();
  const wavrSyncUrl = settings.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
  const wavrSyncAccountName = useWavrSyncAccountName(wavrSyncUrl);
  const wavrSyncSession = useWavrSyncAccount(wavrSyncUrl);
  const ownSyncProfile = wavrSyncState.profiles[wavrSyncState.userId];
  const profileBadges = ownSyncProfile?.badges || [];
  const wavrSyncBadges = profileBadges.length
    ? profileBadges
    : wavrSyncSession?.account.badges || [];
  const isLinuxPlatform = (window as any).electronAPI?.platform === 'linux';
  const allowedUpdateChannels = updateChannelsForBadges(wavrSyncBadges);
  const updateAccessKnown =
    !wavrSyncSession
    || !!ownSyncProfile
    || (wavrSyncSession.account.badges?.length || 0) > 0;
  const scrobble = useScrobbleStatus(settings.scrobbleEnabled, 'lastfm');
  const [scrobbleBusy, setScrobbleBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateUrlDraft, setUpdateUrlDraft] = useState(settings.updateFeedUrl || '');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [youtubeAuth, setYoutubeAuth] = useState<{ connected: boolean; accountLabel?: string } | null>(null);
  const [youtubeAuthBusy, setYoutubeAuthBusy] = useState(false);

  useEffect(() => {
    if (!updateAccessKnown) return;
    if (!allowedUpdateChannels.includes(settings.updateChannel || 'stable')) {
      store.updateSettings({ updateChannel: 'stable' });
    }
  }, [updateAccessKnown, allowedUpdateChannels.join(','), settings.updateChannel]);

  useEffect(() => {
    let cancelled = false;
    getAudioEngineInfo().then((info) => {
      if (!cancelled) setEngineInfo(info);
    });
    const loadDevices = async () => {
      if (!isAudioEngineSupported()) return;
      setLoadingDevices(true);
      try {
        const devices = await getAudioEngineDevices();
        if (!cancelled) setEngineDevices(devices);
      } catch {
        if (!cancelled) setEngineDevices([]);
      } finally {
        if (!cancelled) setLoadingDevices(false);
      }
    };
    loadDevices();
    const unsubscribeEngine = onAudioEngineEvent((event) => {
      if (event.event === 'ready') {
        setEngineInfo({
          available: true,
          platform: String(event.platform || 'win32'),
          version: String(event.version || ''),
        });
        return;
      }
      if (event.event === 'engineExit') {
        setEngineInfo((current) => ({
          available: false,
          platform: current?.platform || 'win32',
          reason: String(event.message || 'The WavrPulse engine stopped.'),
        }));
        return;
      }
      if (event.event !== 'output') return;
      setEngineOutput({
        mode: event.mode === 'exclusive' ? 'exclusive' : 'shared',
        deviceName: String(event.deviceName || 'Audio output'),
        sampleRate: Number(event.sampleRate) || 0,
        channels: Number(event.channels) || 0,
        sampleFormat: String(event.sampleFormat || ''),
        usedAudioClient3: !!event.usedAudioClient3,
      });
    });
    return () => {
      cancelled = true;
      unsubscribeEngine();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api()?.youtubeAuthStatus?.()
      .then((status: { connected?: boolean; accountLabel?: string } | null) => {
        if (!cancelled) {
          setYoutubeAuth({
            connected: !!status?.connected,
            accountLabel: String(status?.accountLabel || ''),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAudioDevices = async () => {
    if (!isAudioEngineSupported()) return;
    setLoadingDevices(true);
    try {
      setEngineDevices(await getAudioEngineDevices());
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not enumerate audio devices.', 'error');
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    api()?.getDiscordStatus?.()
      .then((status: { state?: string; message?: string } | null) => {
        if (status) setDiscordStatus(status);
      })
      .catch(() => {});
    const unsubscribe = api()?.onDiscordStatus?.((status: { state?: string; message?: string }) => {
      setDiscordStatus(status || null);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await api()?.updateStatus?.();
        if (!cancelled && status) setUpdateStatus(status);
      } catch {
        /* updates are optional */
      }
    };
    void load();
    const unsubscribe = api()?.onUpdateStatus?.((status: UpdateStatus) => {
      if (!cancelled) setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    setUpdateUrlDraft(settings.updateFeedUrl || '');
  }, [settings.updateFeedUrl]);

  useEffect(() => {
    setProfileTagsDraft(Array.isArray(settings.profileTags) ? settings.profileTags.join(', ') : '');
  }, [settings.profileTags]);

  const updateAudioSettings = (patch: Partial<AppSettings>, reload = false) => {
    store.updateSettings(patch);
    playback.applyAudioSettings();
    if (reload) playback.reloadCurrent();
  };

  const setAudioEngine = (audioEngine: AudioEngineMode) => {
    playback.resetAudioEngineFailure();
    updateAudioSettings({ audioEngine }, true);
  };

  const setAudioDevice = (audioDeviceId: string) => {
    playback.resetAudioEngineFailure();
    updateAudioSettings({ audioDeviceId }, true);
  };

  const setChannelMode = (channelMode: ChannelMode) => {
    updateAudioSettings({ channelMode }, true);
  };

  const setResampleQuality = (resampleQuality: ResampleQuality) => {
    updateAudioSettings({ resampleQuality });
  };

  const setReplayGain = (replayGain: ReplayGainMode) => {
    updateAudioSettings({ replayGain });
  };

  const connectScrobbling = async () => {
    setScrobbleBusy(true);
    try {
      store.updateSettings({ scrobbleProvider: 'lastfm' });
      await api()?.writeSettings?.(store.getSettings());
      const next = await scrobble.connect('lastfm');
      if (next?.connected) {
        store.updateSettings({ scrobbleEnabled: true, scrobbleProvider: 'lastfm' });
        pushToast(`Signed in to Last.fm as ${next.username}.`, 'success');
      }
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not sign in to Last.fm.', 'error');
    } finally {
      setScrobbleBusy(false);
    }
  };

  const disconnectScrobbling = async () => {
    setScrobbleBusy(true);
    try {
      store.updateSettings({ scrobbleProvider: 'lastfm' });
      await api()?.writeSettings?.(store.getSettings());
      await scrobble.disconnect();
      pushToast('Disconnected Last.fm.');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not disconnect Last.fm.', 'error');
    } finally {
      setScrobbleBusy(false);
    }
  };

  const copyLastFmCallback = async () => {
    const copied = await copyText(LASTFM_CALLBACK_URL);
    pushToast(copied ? 'Last.fm callback URL copied.' : LASTFM_CALLBACK_URL, copied ? 'success' : 'info');
  };

  const clearYoutubeCache = async () => {
    try {
      const removed = await api()?.youtubeCacheClear?.();
      pushToast(`Removed ${Number(removed) || 0} cached YouTube video${Number(removed) === 1 ? '' : 's'}.`, 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not clear the YouTube cache.', 'error');
    }
  };

  const connectYoutubeAccount = async () => {
    setYoutubeAuthBusy(true);
    try {
      const status = await api()?.youtubeAuthConnect?.();
      if (status?.connected) {
        setYoutubeAuth({
          connected: true,
          accountLabel: String(status.accountLabel || 'YouTube account'),
        });
        pushToast('YouTube account connected for yt-dlp.', 'success');
      } else {
        setYoutubeAuth({ connected: false, accountLabel: '' });
      }
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not connect the YouTube account.', 'error');
    } finally {
      setYoutubeAuthBusy(false);
    }
  };

  const disconnectYoutubeAccount = async () => {
    setYoutubeAuthBusy(true);
    try {
      const status = await api()?.youtubeAuthDisconnect?.();
      setYoutubeAuth({
        connected: !!status?.connected,
        accountLabel: String(status?.accountLabel || ''),
      });
      pushToast('Disconnected the YouTube account.', 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not disconnect the YouTube account.', 'error');
    } finally {
      setYoutubeAuthBusy(false);
    }
  };

  const saveUpdateUrl = () => {
    const updateFeedUrl = updateUrlDraft.trim();
    store.updateSettings({ updateFeedUrl });
    return updateFeedUrl;
  };

  const checkForUpdates = async () => {
    setUpdateBusy(true);
    try {
      saveUpdateUrl();
      await api()?.writeSettings?.(store.getSettings());
      const next = await api()?.checkForUpdates?.();
      if (next) setUpdateStatus(next);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not check for updates.', 'error');
    } finally {
      setUpdateBusy(false);
    }
  };

  const downloadUpdate = async () => {
    setUpdateBusy(true);
    try {
      const next = await api()?.downloadUpdate?.();
      if (next) setUpdateStatus(next);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not download the update.', 'error');
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    try {
      const installed = await api()?.installUpdate?.();
      if (!installed) {
        pushToast('The update installer could not be started.', 'error');
        setUpdateBusy(false);
      }
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not start the update installer.', 'error');
      setUpdateBusy(false);
    }
  };

  const updateSummary = updateStatus
    ? updateStatus.state === 'downloading'
      ? `${updateStatus.message || 'Downloading update...'} ${updateStatus.progress}%`
      : updateStatus.state === 'available'
        ? `WAVR ${updateStatus.availableVersion} is available.${settings.autoUpdate ? '' : ' Automatic downloads are off.'}`
        : updateStatus.state === 'downloaded'
          ? `WAVR ${updateStatus.availableVersion} is downloaded and ready to install.`
          : updateStatus.state === 'up-to-date'
            ? `WAVR ${updateStatus.currentVersion} is up to date.`
            : updateStatus.message || 'Update status unavailable.'
    : 'Updates have not been checked yet.';

  const updateBusyState =
    updateBusy ||
    updateStatus?.state === 'checking' ||
    updateStatus?.state === 'downloading';

  const setStreamFormat = (format: StreamFormat) => {
    updateAudioSettings({ streamFormat: format }, true);
  };

  const setStreamBitrate = (streamBitrate: number) => {
    updateAudioSettings({ streamBitrate }, true);
  };

  const setEqualizerPreset = (equalizerPreset: Exclude<EqualizerPreset, 'custom'>) => {
    updateAudioSettings({
      equalizerPreset,
      equalizerBands: [...EQUALIZER_PRESETS[equalizerPreset]],
      equalizerEnabled: true,
    });
  };

  const setEqualizerBand = (index: number, value: number) => {
    const bands = Array.isArray(settings.equalizerBands)
      ? [...settings.equalizerBands]
      : Array(EQUALIZER_FREQUENCIES.length).fill(0);
    bands[index] = value;
    updateAudioSettings({ equalizerPreset: 'custom', equalizerBands: bands });
  };

  const chooseProfileImage = () => {
    profileImageInput.current?.click();
  };

  const updateProfileImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setCropImage({ file, target: 'avatar' });
  };

  const removeProfileImage = () => {
    store.updateSettings({ profileImage: '' });
    pushToast('Profile picture removed.');
  };

  const chooseProfileBanner = () => {
    profileBannerInput.current?.click();
  };

  const updateProfileBanner = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setCropImage({ file, target: 'banner' });
  };

  const applyCroppedImage = async (dataUrl: string) => {
    if (!cropImage) return;
    const target = cropImage.target;
    if (target === 'avatar') {
      setUpdatingProfileImage(true);
      try {
        store.updateSettings({ profileImage: dataUrl });
        pushToast('Profile picture updated.', 'success');
      } finally {
        setUpdatingProfileImage(false);
      }
    } else {
      setUpdatingProfileBanner(true);
      try {
        store.updateSettings({ profileBanner: dataUrl });
        pushToast('Profile banner updated.', 'success');
      } finally {
        setUpdatingProfileBanner(false);
      }
    }
    setCropImage(null);
  };

  const removeProfileBanner = () => {
    store.updateSettings({ profileBanner: '' });
    pushToast('Profile banner removed.');
  };

  const updatePageBackground = async () => {
    const previous = settings.pageBackgrounds?.[backgroundPage];
    setBackgroundBusy(true);
    try {
      const result = await api()?.pickPageBackground?.();
      if (!result) return;
      if (result.error) {
        pushToast(String(result.error), 'error');
        return;
      }
      if (!result.url) {
        pushToast('Could not save that background.', 'error');
        return;
      }
      store.updateSettings({
        pageBackgrounds: {
          ...(settings.pageBackgrounds || {}),
          [backgroundPage]: result.url,
        },
      });
      if (previous) void api()?.deletePageBackground?.(previous);
      pushToast('Page background updated.', 'success');
    } catch {
      pushToast('Could not save that background.', 'error');
    } finally {
      setBackgroundBusy(false);
    }
  };

  const removePageBackground = () => {
    const current = settings.pageBackgrounds?.[backgroundPage];
    const next = { ...(settings.pageBackgrounds || {}) };
    delete next[backgroundPage];
    store.updateSettings({ pageBackgrounds: next });
    if (current) void api()?.deletePageBackground?.(current);
    pushToast('Page background removed.');
  };

  const clearPageBackgrounds = () => {
    for (const url of Object.values(settings.pageBackgrounds || {})) {
      void api()?.deletePageBackground?.(url);
    }
    store.updateSettings({ pageBackgrounds: {} });
    pushToast('All page backgrounds removed.');
  };

  const saveProfileTags = () => {
    const profileTags = profileTagsDraft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .filter((tag, index, all) => all.findIndex((entry) => entry.toLowerCase() === tag.toLowerCase()) === index)
      .slice(0, 12);
    setProfileTagsDraft(profileTags.join(', '));
    store.updateSettings({ profileTags });
  };

  const restartApp = async () => {
    try {
      await api()?.writeSettings?.(store.getSettings());
    } catch {
      /* restart anyway */
    }
    api()?.restartApp?.();
  };

  const connect = async (server: ServerProfile) => {
    setBusyServerId(server.id);
    try {
      const result = await connectServer({ ...server, default: true });
      const servers = settings.servers.map((entry) => ({
        ...entry,
        default: entry.id === server.id,
      }));
      store.updateSettings({ servers });
      pushToast(
        `Connected to ${server.name}${result.version ? ` (API ${result.version})` : ''}.`,
        'success',
      );
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not connect to the server.', 'error');
    } finally {
      setBusyServerId('');
    }
  };

  const remove = (server: ServerProfile) => {
    if (!window.confirm(`Remove the server ${server.name} from ${APP_NAME}?`)) return;
    if (profile?.id === server.id) {
      playback.stop();
      playback.clearSavedQueue();
      disconnectServer();
    }
    const servers = settings.servers.filter((entry) => entry.id !== server.id);
    if (!servers.some((entry) => entry.default) && servers.length > 0) {
      servers[0] = { ...servers[0], default: true };
    }
    store.updateSettings({ servers });
    pushToast(`Removed ${server.name}.`);
  };

  const loadDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const text = await api()?.getDiagnostics?.();
      setDiagnostics(
        text ||
          `${APP_NAME} ${APP_VERSION}\nPlatform: ${navigator.platform}\nUser agent: ${navigator.userAgent}`,
      );
    } catch {
      setDiagnostics(`${APP_NAME} ${APP_VERSION}\nPlatform: ${navigator.platform}`);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const lastFmStatus = scrobble.status?.provider === 'lastfm' ? scrobble.status : null;
  const scrobbleConnecting = scrobbleBusy || !!lastFmStatus?.connecting;

  const connectWavrSync = () => {
    wavrSync.connect(
      wavrSyncUrl,
      wavrSyncAccountName || profile?.username || profile?.name || 'Listener',
      settings.profileImage,
    );
  };

  const disconnectWavrSync = () => {
    wavrSync.disconnect();
    pushToast('Disconnected WavrSync.');
  };

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Appearance, playback and server connections</div>
        </div>
      </div>

      <div className="settings-section">
        <SectionHeader title="Home profile" />
        <Card>
          <div className="settings-profile-row">
            <ProfileAvatar
              src={settings.profileImage}
              name={wavrSyncAccountName || profile?.username || profile?.name}
              size={64}
            />
            <div className="settings-row-main">
              <div className="settings-label">Profile picture</div>
              <div className="settings-description">
                Shown above your greeting on Home. Drag and zoom the image before it is resized locally and saved.
              </div>
              <div className="form-hint">
                {profile ? (
                  <>
                    Connected to {profile.name}. WavrSync account: {wavrSyncAccountName || 'not signed in'}.
                    <DeveloperBadge badges={wavrSyncState.profiles[wavrSyncState.userId]?.badges} />
                  </>
                ) : 'Connect a server to display your account name.'}
              </div>
            </div>
            <div className="settings-profile-actions">
              <Button
                variant="surface"
                icon="add"
                label={updatingProfileImage ? 'Preparing' : settings.profileImage ? 'Change' : 'Upload'}
                onClick={chooseProfileImage}
                disabled={updatingProfileImage}
              />
              {settings.profileImage && (
                <Button
                  variant="surface"
                  icon="delete"
                  label="Remove"
                  onClick={removeProfileImage}
                  disabled={updatingProfileImage}
                />
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Profile banner</div>
              <div className="settings-description">
                A wide banner shown at the top of your WavrSync profile.
              </div>
            </div>
            <div className="settings-profile-actions">
              <Button
                variant="surface"
                icon="add"
                label={updatingProfileBanner ? 'Preparing...' : settings.profileBanner ? 'Change' : 'Upload'}
                onClick={chooseProfileBanner}
                disabled={updatingProfileBanner}
              />
              {settings.profileBanner && (
                <Button
                  variant="surface"
                  icon="delete"
                  label="Remove"
                  onClick={removeProfileBanner}
                  disabled={updatingProfileBanner}
                />
              )}
            </div>
          </div>
          {settings.profileBanner && (
            <div
              className="settings-profile-banner-preview"
              style={{ backgroundImage: `url("${settings.profileBanner}")` }}
              role="img"
              aria-label="Profile banner preview"
            />
          )}

          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Favourite genre tags</div>
              <div className="settings-description">
                Comma-separated genres shown on your WavrSync profile.
              </div>
            </div>
            <input
              className="form-input"
              style={{ maxWidth: 340 }}
              value={profileTagsDraft}
              onChange={(event) => setProfileTagsDraft(event.target.value)}
              onBlur={saveProfileTags}
              placeholder="ambient, electronic, jazz"
              aria-label="Favourite genre tags"
            />
          </div>

          <input
            ref={profileImageInput}
            className="profile-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={updateProfileImage}
            aria-label="Choose profile picture"
            tabIndex={-1}
          />
          <input
            ref={profileBannerInput}
            className="profile-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={updateProfileBanner}
            aria-label="Choose profile banner"
            tabIndex={-1}
          />
          {cropImage && (
            <ImageCropDialog
              key={`${cropImage.target}-${cropImage.file.name}-${cropImage.file.lastModified}`}
              file={cropImage.file}
              aspect={cropImage.target === 'avatar' ? 1 : 3.2}
              title={cropImage.target === 'avatar' ? 'Crop profile picture' : 'Crop profile banner'}
              onCancel={() => setCropImage(null)}
              onConfirm={applyCroppedImage}
            />
          )}
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Appearance" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Theme</div>
              <div className="settings-description">Choose a light, dark or system-matched theme.</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {THEME_MODES.map((mode) => (
                <Button
                  key={mode.value}
                  variant="surface"
                  active={theme.themeMode === mode.value}
                  label={mode.label}
                  onClick={() => theme.setThemeMode(mode.value)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Dynamic colour</div>
              <div className="settings-description">
                Derive the palette from the current album artwork, use a fixed accent, or turn it off.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DYNAMIC_THEMES.map((mode) => (
                <Button
                  key={mode.value}
                  variant="surface"
                  active={theme.dynamicTheme === mode.value}
                  label={mode.label}
                  onClick={() => theme.setDynamicTheme(mode.value)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Accent colour</div>
              <div className="settings-description">
                Used with fixed accents and as the fallback while artwork is loading.
              </div>
            </div>
            <div className="swatches">
              {ACCENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  className={`swatch ${theme.accentColor.toLowerCase() === swatch.toLowerCase() ? 'selected' : ''}`}
                  style={{ background: swatch }}
                  aria-label={`Use accent ${swatch}`}
                  title={swatch}
                  onClick={() => theme.setAccentColor(swatch)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Colour intensity</div>
              <div className="settings-description">How strongly the palette tints surfaces.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220 }}>
              <input
                className="slider"
                type="range"
                min={0}
                max={100}
                value={theme.themeIntensity}
                onChange={(event) => theme.setThemeIntensity(Number(event.target.value))}
                aria-label="Colour intensity"
              />
              <span style={{ fontSize: 12, color: 'var(--md-sys-color-outline)', width: 34, textAlign: 'right' }}>
                {theme.themeIntensity}%
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Layout density</div>
              <div className="settings-description">Compact reduces padding for smaller windows.</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DENSITIES.map((density) => (
                <Button
                  key={density.value}
                  variant="surface"
                  active={theme.density === density.value}
                  label={density.label}
                  onClick={() => theme.setDensity(density.value)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Reduce motion</div>
              <div className="settings-description">Disable decorative animation and transitions.</div>
            </div>
            <Switch
              checked={theme.reducedMotion}
              onChange={theme.setReducedMotion}
              label={theme.reducedMotion ? 'On' : 'Off'}
              ariaLabel="Reduce motion"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Hardware acceleration</div>
              <div className="settings-description">
                Use GPU acceleration for the interface. Disable it if WAVR has graphics glitches. Restart WAVR to apply.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch
                checked={settings.hardwareAcceleration !== false}
                onChange={(hardwareAcceleration) => store.updateSettings({ hardwareAcceleration })}
                label={settings.hardwareAcceleration !== false ? 'On' : 'Off'}
                ariaLabel="Hardware acceleration"
              />
              <Button
                variant="surface"
                icon="refresh"
                label="Restart"
                onClick={restartApp}
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">YouTube account</div>
              <div className="settings-description">
                {youtubeAuth?.connected
                  ? `Connected as ${youtubeAuth.accountLabel || 'YouTube account'}. yt-dlp can use this session for age-restricted or account-only videos.`
                  : 'Opens YouTube in your default browser with a temporary WAVR sign-in profile, then saves the session for yt-dlp. Cookies stay on this device.'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {youtubeAuth?.connected ? (
                <Button
                  variant="surface"
                  icon="logout"
                  label="Disconnect"
                  onClick={disconnectYoutubeAccount}
                  disabled={youtubeAuthBusy}
                />
              ) : (
                <Button
                  variant="primary"
                  icon="login"
                  label={youtubeAuthBusy ? 'Signing in...' : 'Sign in'}
                  onClick={connectYoutubeAccount}
                  disabled={youtubeAuthBusy}
                />
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">YouTube video background</div>
              <div className="settings-description">
                In fullscreen, play a muted YouTube music video behind the player. Use the link button in Now Playing to assign a custom video to a song.
              </div>
            </div>
            <Switch
              checked={!!settings.fullscreenYoutubeBackground}
              onChange={(fullscreenYoutubeBackground) =>
                store.updateSettings({ fullscreenYoutubeBackground })
              }
              label={settings.fullscreenYoutubeBackground ? 'On' : 'Off'}
              ariaLabel="YouTube video background in fullscreen"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Pause background with playback</div>
              <div className="settings-description">
                Pause or resume the fullscreen music video background when the song is paused or resumed.
              </div>
            </div>
            <Switch
              checked={settings.youtubeBackgroundPauseWithPlayback !== false}
              onChange={(youtubeBackgroundPauseWithPlayback) =>
                store.updateSettings({ youtubeBackgroundPauseWithPlayback })
              }
              label={settings.youtubeBackgroundPauseWithPlayback !== false ? 'Pause' : 'Keep playing'}
              ariaLabel="Pause music video background when the song is paused"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Skip music video intros</div>
              <div className="settings-description">
                Use SponsorBlock intro markers when available so the video starts with the song.
              </div>
            </div>
            <Switch
              checked={settings.youtubeBackgroundSkipIntro !== false}
              onChange={(youtubeBackgroundSkipIntro) =>
                store.updateSettings({ youtubeBackgroundSkipIntro })
              }
              label={settings.youtubeBackgroundSkipIntro !== false ? 'Skip' : 'Keep'}
              ariaLabel="Skip music video intros"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">YouTube video cache</div>
              <div className="settings-description">
                Cached MP4 backgrounds are downloaded with yt-dlp and reused for the same song.
              </div>
            </div>
            <Button variant="surface" icon="delete_sweep" label="Clear cache" onClick={clearYoutubeCache} />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Auto-hide fullscreen UI</div>
              <div className="settings-description">
                Hide player controls after a few seconds of inactivity in fullscreen. Move the mouse to bring them back.
              </div>
            </div>
            <Switch
              checked={!!settings.fullscreenAutoHideUi}
              onChange={(fullscreenAutoHideUi) => store.updateSettings({ fullscreenAutoHideUi })}
              label={settings.fullscreenAutoHideUi ? 'On' : 'Off'}
              ariaLabel="Auto-hide fullscreen player UI"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Live lyrics banner</div>
              <div className="settings-description">
                Show the current lyric line beneath the Now Playing controls.
              </div>
            </div>
            <Switch
              checked={settings.showLyricsBanner !== false}
              onChange={(showLyricsBanner) => store.updateSettings({ showLyricsBanner })}
              label={settings.showLyricsBanner !== false ? 'Shown' : 'Hidden'}
              ariaLabel="Show live lyrics banner"
            />
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Page backgrounds" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Choose a page</div>
              <div className="settings-description">
                {backgroundPage === PAGE_BACKGROUND_ALL_ID
                  ? 'Use one image, animated GIF or MP4 video on every page. Fullscreen keeps its own background.'
                  : 'Each page can use its own image, animated GIF or MP4 video background.'}
              </div>
            </div>
            <select
              className="form-input"
              style={{ maxWidth: 300 }}
              value={backgroundPage}
              onChange={(event) => setBackgroundPage(event.target.value)}
              aria-label="Page for background media"
            >
              {PAGE_BACKGROUND_OPTIONS.map((page) => (
                <option key={page.id} value={page.id}>{page.label}</option>
              ))}
            </select>
          </div>

          <div
            className="settings-page-background-preview"
            style={
              pageBackgroundUrl && !pageBackgroundIsVideo
                ? { backgroundImage: `url("${pageBackgroundUrl}")` }
                : undefined
            }
            role="img"
            aria-label={`${PAGE_BACKGROUND_OPTIONS.find((page) => page.id === backgroundPage)?.label || backgroundPage} background preview`}
          >
            {pageBackgroundIsVideo && (
              <BackgroundVideo
                className="settings-page-background-video"
                src={pageBackgroundUrl}
              />
            )}
            {!pageBackgroundUrl && (
              <span>No background set</span>
            )}
          </div>

          {allPagesBackgroundSet &&
            backgroundPage !== PAGE_BACKGROUND_ALL_ID &&
            backgroundPage !== 'player' && (
              <div className="form-hint">
                The All pages background is currently overriding this page. Remove it from All pages to use individual backgrounds.
              </div>
            )}

          <div className="settings-page-background-actions">
            <Button
              variant="surface"
              icon="image"
              label={
                backgroundBusy
                  ? 'Saving...'
                  : pageBackgroundUrl
                    ? 'Change background'
                    : 'Upload background'
              }
              onClick={updatePageBackground}
              disabled={backgroundBusy}
            />
            <Button
              variant="surface"
              icon="delete"
              label="Remove"
              onClick={removePageBackground}
              disabled={!pageBackgroundUrl}
            />
            <Button
              variant="surface"
              icon="delete_sweep"
              label="Clear all"
              onClick={clearPageBackgrounds}
              disabled={!Object.keys(settings.pageBackgrounds || {}).length}
            />
          </div>
          <div className="form-hint">
            PNG, JPEG, WebP or AVIF up to {Math.round(PAGE_BACKGROUND_MAX_IMAGE_BYTES / (1024 * 1024))} MB, animated GIFs up to {Math.round(PAGE_BACKGROUND_MAX_GIF_BYTES / (1024 * 1024))} MB, or MP4 videos up to {Math.round(PAGE_BACKGROUND_MAX_VIDEO_BYTES / (1024 * 1024 * 1024))} GB. Uploaded backgrounds are stored locally on this device.
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Integrations" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Discord Rich Presence</div>
              <div className="settings-description">
                Show the current track in Discord. Requires a Discord application ID and the Discord desktop app running.
              </div>
            </div>
            <Switch
              checked={settings.discordRPC}
              onChange={(discordRPC) => store.updateSettings({ discordRPC })}
              label={settings.discordRPC ? 'Enabled' : 'Disabled'}
              ariaLabel="Enable Discord Rich Presence"
            />
          </div>
          {settings.discordRPC && (
            <>
              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Discord application ID</div>
                  <div className="settings-description">
                    Create an application at discord.com/developers/applications and paste its Application ID here.
                  </div>
                  {discordStatus?.state && (
                    <div className="form-hint">
                      {discordStatus.state === "ready"
                        ? "Connected to Discord."
                        : discordStatus.state === "connecting"
                          ? "Connecting to Discord"
                          : discordStatus.state === "error"
                            ? discordStatus.message || "Discord is not available."
                            : discordStatus.message || "Rich Presence is disabled."}
                    </div>
                  )}
                </div>
                <input
                  className="form-input"
                  style={{ maxWidth: 300 }}
                  value={settings.discordClientId}
                  onChange={(event) => store.updateSettings({ discordClientId: event.target.value.trim() })}
                  placeholder="1562933547277352990"
                  spellCheck={false}
                  aria-label="Discord application ID"
                />
              </div>
              <div className="form-hint">
                Album art uses the Public artwork URL when set. Without it, WAVR uploads the current cover to a temporary public image host for Discord. If artwork is unavailable, the activity still shows without album art.
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Artist artwork" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">fanart.tv API key</div>
              <div className="settings-description">
                Artist pages use fanart.tv music banners when an API key is configured. Without a key, WAVR falls back to the artist artwork from your music server.
              </div>
              <div className="form-hint">
                Create a free fanart.tv account and copy the personal API key from your account settings.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="form-input"
                style={{ maxWidth: 300 }}
                type="text"
                value={settings.fanartTvApiKey || ''}
                onChange={(event) => store.updateSettings({ fanartTvApiKey: event.target.value.trim() })}
                placeholder="fanart.tv API key"
                spellCheck={false}
                autoComplete="off"
                aria-label="fanart.tv API key"
              />
              <Button
                variant="surface"
                icon="open_in_new"
                label="Get key"
                onClick={() => api()?.openExternal?.('https://fanart.tv/get-an-api-key/')}
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="WavrSync" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Friends sidebar</div>
              <div className="settings-description">
                Show a bar on the right with your accepted friends and what they are listening to. Close the bar at any time to turn it off.
              </div>
            </div>
            <Switch
              checked={settings.friendsSidebarEnabled !== false}
              onChange={(friendsSidebarEnabled) => store.updateSettings({ friendsSidebarEnabled })}
              label={settings.friendsSidebarEnabled !== false ? 'Enabled' : 'Disabled'}
              ariaLabel="Show the WavrSync friends sidebar"
            />
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Privacy" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Anonymous usage count</div>
              <div className="settings-description">
                Send a random installation ID to WavrSync every minute so the website can show how many people are using WAVR. No library, account, or listening data is included.
              </div>
            </div>
            <Switch
              checked={settings.usageHeartbeatEnabled !== false}
              onChange={(usageHeartbeatEnabled) => store.updateSettings({ usageHeartbeatEnabled })}
              label={settings.usageHeartbeatEnabled !== false ? 'Enabled' : 'Disabled'}
              ariaLabel="Share anonymous WAVR usage count"
            />
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Last.fm" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">
                {lastFmStatus?.connected
                  ? `Signed in as ${lastFmStatus.username || 'Last.fm user'}`
                  : scrobbleConnecting
                    ? 'Waiting for Last.fm...'
                    : 'Not signed in to Last.fm'}
              </div>
              <div className="settings-description">
                One sign-in enables personalised Discover and scrobbling. Discover uses your Last.fm top artists, top tracks, and loved tracks to find similar music, then checks every suggestion against your Subsonic library.
              </div>
              {lastFmStatus?.pending ? (
                <div className="form-hint">
                  {lastFmStatus.pending} scrobble{lastFmStatus.pending === 1 ? '' : 's'} waiting to retry.
                </div>
              ) : null}
              {lastFmStatus?.error ? (
                <div className="form-hint">{lastFmStatus.error}</div>
              ) : null}
            </div>
            <div className="settings-choice-grid" style={{ flexShrink: 0 }}>
              <Button
                variant="primary"
                icon="open_in_new"
                label={
                  scrobbleConnecting
                    ? 'Waiting for browser...'
                    : lastFmStatus?.connected
                      ? 'Sign in again'
                      : 'Sign in with Last.fm'
                }
                onClick={connectScrobbling}
                disabled={scrobbleConnecting}
              />
              {lastFmStatus?.connected && (
                <Button
                  variant="surface"
                  icon="cloud_off"
                  label="Disconnect"
                  onClick={disconnectScrobbling}
                  disabled={scrobbleConnecting}
                />
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Scrobble listening history</div>
              <div className="settings-description">
                Send now-playing updates and completed listens to Last.fm. Tracks are submitted after 50% or 4 minutes, whichever comes first. Tracks shorter than 30 seconds are not scrobbled.
              </div>
            </div>
            <Switch
              checked={!!settings.scrobbleEnabled}
              onChange={(scrobbleEnabled) => store.updateSettings({ scrobbleEnabled })}
              label={settings.scrobbleEnabled ? 'Enabled' : 'Disabled'}
              ariaLabel="Enable scrobbling"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Personalised Discover</div>
              <div className="settings-description">
                Included with your Last.fm sign-in. No API key or shared secret is required.
              </div>
            </div>
            <Chip selected>Ready</Chip>
          </div>
        </Card>
      </div>

      {/* <div className="settings-section">
        <SectionHeader title="WavrSync" />
        <Card>
          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Server URL</div>
              <div className="settings-description">
                Address of your WavrSync backend. Use wss:// for HTTPS deployments and ws:// for HTTP deployments.
              </div>
              <DangerNotice />
            </div>
            <input
              className="form-input"
              style={{ maxWidth: 340 }}
              value={settings.wavrSyncServerUrl || ''}
              onChange={(event) =>
                store.updateSettings({ wavrSyncServerUrl: event.target.value.trim() })
              }
              placeholder={WAVRSYNC_DEFAULT_SERVER_URL}
              spellCheck={false}
              autoComplete="url"
              aria-label="WavrSync server URL"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Connect automatically</div>
              <div className="settings-description">
                Connect to WavrSync when WAVR launches, so shared listening is ready without opening this page first.
              </div>
            </div>
            <Switch
              checked={settings.wavrSyncAutoConnect !== false}
              onChange={(wavrSyncAutoConnect) => store.updateSettings({ wavrSyncAutoConnect })}
              label={settings.wavrSyncAutoConnect !== false ? 'Enabled' : 'Disabled'}
              ariaLabel="Connect to WavrSync automatically"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">
                {wavrSyncState.connection === 'connected'
                  ? 'Connected to WavrSync!'
                  : wavrSyncState.connection === 'connecting' || wavrSyncState.connection === 'reconnecting'
                    ? 'Connecting to WavrSync'
                    : 'Not connected to WavrSync'}
              </div>
              <div className="settings-description">{wavrSyncUrl}</div>
              {wavrSyncState.error && <div className="form-hint">{wavrSyncState.error}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {wavrSyncState.connection === 'connected' ? (
                <>
                  <Button
                    variant="surface"
                    icon="refresh"
                    label="Refresh"
                    onClick={() => wavrSync.listRooms()}
                  />
                  <Button
                    variant="surface"
                    icon="cloud_off"
                    label="Disconnect"
                    onClick={disconnectWavrSync}
                  />
                </>
              ) : (
                <Button
                  variant="primary"
                  icon="cloud"
                  label={
                    wavrSyncState.connection === 'connecting' ||
                    wavrSyncState.connection === 'reconnecting'
                      ? 'Connecting...'
                      : 'Connect'
                  }
                  onClick={connectWavrSync}
                  disabled={
                    wavrSyncState.connection === 'connecting' ||
                    wavrSyncState.connection === 'reconnecting'
                  }
                />
              )}
            </div>
          </div>
          <div className="form-hint">
            Leave the URL empty to use {WAVRSYNC_DEFAULT_SERVER_URL}.
          </div>
        </Card>
      </div> */}

      <div className="settings-section">
        <SectionHeader title="Lyrics" />
        <Card>
          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Lyrica instance</div>
              <div className="settings-description">
                Choose the official hosted instance or point WAVR at a local or community deployment.
              </div>
            </div>
            <div className="lyrica-instance-options" role="radiogroup" aria-label="Lyrica instance">
              {([
                ['official', 'Official Instance', LYRICA_API_BASE],
                ['community', 'Local / Community Instance', 'Custom endpoint'],
              ] as const).map(([mode, label, description]) => (
                <label
                  key={mode}
                  className={`instance-box ${(settings.lyricaInstanceMode || 'official') === mode ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="lyrica-instance"
                    checked={(settings.lyricaInstanceMode || 'official') === mode}
                    onChange={() => store.updateSettings({ lyricaInstanceMode: mode })}
                  />
                  <span className="instance-check">
                    {(settings.lyricaInstanceMode || 'official') === mode && <Icon name="check" size={12} />}
                  </span>
                  <span className="instance-copy">
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {(settings.lyricaInstanceMode || 'official') === 'community' && (
            <div className="settings-row audio-engine-row">
              <div className="settings-row-main">
                <div className="settings-label">Lyrica URL</div>
                <div className="settings-description">
                  Use the base URL of your Lyrica deployment, without <code>/lyrics</code>.
                </div>
                <DangerNotice />
              </div>
              <input
                className="form-input"
                style={{ maxWidth: 320 }}
                value={settings.lyricaInstanceUrl || ''}
                onChange={(event) => store.updateSettings({ lyricaInstanceUrl: event.target.value.trim() })}
                placeholder="http://localhost:9999"
                spellCheck={false}
                autoComplete="url"
                aria-label="Lyrica instance URL"
              />
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Translate lyrics</div>
              <div className="settings-description">
                Translate non-English lyrics to your selected language when the Lyrica instance supports it.
              </div>
            </div>
            <Switch
              checked={!!settings.lyricsTranslation}
              onChange={(lyricsTranslation) => store.updateSettings({ lyricsTranslation })}
              label={settings.lyricsTranslation ? 'On' : 'Off'}
              ariaLabel="Translate lyrics"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Romanize lyrics</div>
              <div className="settings-description">
                Show a Latin transliteration alongside the original lyrics.
              </div>
            </div>
            <Switch
              checked={!!settings.lyricsRomanization}
              onChange={(lyricsRomanization) => store.updateSettings({ lyricsRomanization })}
              label={settings.lyricsRomanization ? 'On' : 'Off'}
              ariaLabel="Romanize lyrics"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Translation language</div>
              <div className="settings-description">Target language passed to Lyrica.</div>
            </div>
            <select
              className="form-input"
              style={{ maxWidth: 220 }}
              value={settings.lyricsLanguage || 'en'}
              onChange={(event) => store.updateSettings({ lyricsLanguage: event.target.value })}
              aria-label="Lyrics translation language"
            >
              {LYRIC_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>{language.label}</option>
              ))}
            </select>
          </div>

          <div className="form-hint">
            Translation and romanization follow the active line and remain aligned with word- and syllable-synced lyrics. Lyrica AI is used when available; otherwise WAVR falls back to a machine translation service.
          </div>
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="WavrPulse" />
        <Card>
          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Output mode</div>
              <div className="settings-description">
                Shared mode mixes with browser audio and notifications. Exclusive mode takes control of the device for bit-perfect playback on Windows.
              </div>
            </div>
            <div className="settings-choice-grid">
              {AUDIO_ENGINE_MODES.map((mode) => (
                <Button
                  key={mode.value}
                  variant="surface"
                  active={settings.audioEngine === mode.value}
                  label={mode.label}
                  onClick={() => setAudioEngine(mode.value)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Output device</div>
              <div className="settings-description">
                Leave on System default, or choose the DAC or output you want WAVR to use.
              </div>
            </div>
            <div className="audio-device-controls">
              <select
                className="form-input"
                style={{ maxWidth: 300 }}
                value={settings.audioDeviceId || ''}
                onChange={(event) => setAudioDevice(event.target.value)}
                aria-label="WavrPulse output device"
              >
                <option value="">System default</option>
                {settings.audioDeviceId &&
                  !engineDevices.some((device) => device.id === settings.audioDeviceId) && (
                    <option value={settings.audioDeviceId}>Selected device (unavailable)</option>
                  )}
                {engineDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                    {device.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <Button
                variant="icon"
                icon="refresh"
                title="Refresh audio devices"
                disabled={loadingDevices}
                onClick={refreshAudioDevices}
              />
            </div>
          </div>

          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Engine status</div>
              <div className="settings-description">
                {engineInfo
                  ? engineInfo.available
                    ? `WavrPulse engine ready${engineInfo.version ? ` · v${engineInfo.version}` : ''}`
                    : engineInfo.reason || 'WavrPulse engine unavailable.'
                  : 'Detecting WavrPulse support...'}
              </div>
            </div>
            <Chip selected={!!engineInfo?.available}>
              {engineInfo?.available ? 'WavrPulse' : 'Unavailable'}
            </Chip>
          </div>

          {settings.audioEngine === 'wasapi-exclusive' && (
            <div className="form-hint">
              Exclusive mode can silence other apps and may fail if another application owns the output device. WAVR falls back to shared mode when necessary. It is available on Windows; Linux always uses the system shared mix. For the unmodified bit-perfect path, keep DSP disabled and volume at 100%.
            </div>
          )}
          {engineOutput && (
            <div className="form-hint">
              Active output: {engineOutput.mode === 'exclusive' ? 'Exclusive' : 'Shared'} ·{' '}
              {engineOutput.deviceName} · {(engineOutput.sampleRate / 1000).toFixed(1)} kHz ·{' '}
              {engineOutput.channels} ch · {engineOutput.sampleFormat}
              {engineOutput.usedAudioClient3 ? ' · IAudioClient3 low latency' : ''}
            </div>
          )}
        </Card>
      </div>

      <div className="settings-section">
        <SectionHeader title="Playback & DSP" />
        <Card>
                    <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Default volume</div>
              <div className="settings-description">Applies to this device and new sessions.</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
              <Icon name={settings.defaultVolume === 0 ? 'volume_off' : 'volume_up'} size={18} />
              <input
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.defaultVolume}
                onChange={(event) => playback.setVolume(Number(event.target.value))}
                aria-label="Default volume"
              />
              <span style={{ fontSize: 12, color: 'var(--md-sys-color-outline)', width: 34, textAlign: 'right' }}>
                {Math.round(settings.defaultVolume * 100)}%
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Restore the queue on launch</div>
              <div className="settings-description">
                Reopen the last queue and track for this server when {APP_NAME} starts.
              </div>
            </div>
            <Switch
              checked={settings.restoreQueue}
              onChange={(restoreQueue) => store.updateSettings({ restoreQueue })}
              label={settings.restoreQueue ? 'On' : 'Off'}
              ariaLabel="Restore the queue on launch"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Media keys</div>
              <div className="settings-description">
                Play/pause, next and previous media keys are registered while {APP_NAME} is running.
              </div>
            </div>
            <Chip selected>Enabled</Chip>
          </div>
          
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">DSP pipeline</div>
              <div className="settings-description">
                Off by default for an unmodified playback path. Enable to use EQ, ReplayGain, crossfade, normalisation, resampling and channel mapping.
              </div>
            </div>
            <Switch
              checked={!!settings.dspEnabled}
              onChange={(dspEnabled) => updateAudioSettings({ dspEnabled })}
              label={settings.dspEnabled ? 'Enabled' : 'Disabled'}
              ariaLabel="Enable DSP pipeline"
            />
          </div>

          {engineInfo && !engineInfo.available && (
            <div className="form-hint">
              The native WavrPulse engine is unavailable. System audio fallback only applies the equaliser; ReplayGain, crossfade and normalisation need WavrPulse.
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Stream format</div>
              <div className="settings-description">
                Change the format played back.
              </div>
            </div>
            <div className="settings-choice-grid">
              {STREAM_FORMATS.map((format) => (
                <Button
                  key={format.value}
                  variant="surface"
                  active={settings.streamFormat === format.value}
                  label={format.label}
                  onClick={() => setStreamFormat(format.value)}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Maximum bitrate</div>
              <div className="settings-description">
                A bitrate ceiling only applies when the server transcodes. Changes reload the current track.
              </div>
            </div>
            <div className="settings-choice-grid">
              {STREAM_BITRATES.map((bitrate) => (
                <Button
                  key={bitrate.value}
                  variant="surface"
                  active={settings.streamBitrate === bitrate.value}
                  label={bitrate.label}
                  onClick={() => setStreamBitrate(bitrate.value)}
                />
              ))}
            </div>
          </div>

          {settings.dspEnabled && (
            <>
              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Parametric equaliser</div>
                  <div className="settings-description">
                    Ten peaking filters with adjustable Q. Presets are starting points and can be fine-tuned per band.
                  </div>
                </div>
                <Switch
                  checked={settings.equalizerEnabled}
                  onChange={(equalizerEnabled) => updateAudioSettings({ equalizerEnabled })}
                  label={settings.equalizerEnabled ? 'Enabled' : 'Disabled'}
                  ariaLabel="Enable equaliser"
                />
              </div>

              {settings.equalizerEnabled && (
                <div className="eq-panel">
                  <div className="eq-presets">
                    {(Object.keys(EQUALIZER_PRESETS) as Array<Exclude<EqualizerPreset, 'custom'>>).map((preset) => (
                      <Button
                        key={preset}
                        variant="surface"
                        active={settings.equalizerPreset === preset}
                        label={preset.charAt(0).toUpperCase() + preset.slice(1)}
                        onClick={() => setEqualizerPreset(preset)}
                      />
                    ))}
                    <Button
                      variant="surface"
                      icon="refresh"
                      label="Reset"
                      onClick={() => setEqualizerPreset('flat')}
                    />
                  </div>
                  <div className="eq-bands">
                    {EQUALIZER_FREQUENCIES.map((frequency, index) => {
                      const gain = Number(settings.equalizerBands?.[index]) || 0;
                      return (
                        <label className="eq-band" key={frequency}>
                          <span className="eq-gain">{gain > 0 ? `+${gain}` : gain}</span>
                          <input
                            className="eq-slider"
                            type="range"
                            min={-12}
                            max={12}
                            step={1}
                            value={gain}
                            onChange={(event) => setEqualizerBand(index, Number(event.target.value))}
                            aria-label={`${frequency} hertz gain`}
                          />
                          <span className="eq-frequency">
                            {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="eq-q-row">
                    <span>Filter Q</span>
                    <input
                      className="slider"
                      type="range"
                      min={0.3}
                      max={3}
                      step={0.05}
                      value={Number(settings.equalizerQ) || 1.05}
                      onChange={(event) =>
                        updateAudioSettings({ equalizerQ: Number(event.target.value) })
                      }
                      aria-label="Equaliser filter Q"
                    />
                    <span>{(Number(settings.equalizerQ) || 1.05).toFixed(2)}</span>
                  </div>
                  <div className="form-hint">
                    Parametric EQ is processed in the WavrPulse engine. Very large boosts can reduce headroom.
                  </div>
                </div>
              )}

              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">ReplayGain</div>
                  <div className="settings-description">
                    Use ReplayGain tags from the file to keep track or album loudness consistent.
                  </div>
                </div>
                <div className="settings-choice-grid">
                  {REPLAY_GAIN_MODES.map((mode) => (
                    <Button
                      key={mode.value}
                      variant="surface"
                      active={(settings.replayGain || 'off') === mode.value}
                      label={mode.label}
                      onClick={() => setReplayGain(mode.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Volume normalisation</div>
                  <div className="settings-description">
                    Apply slow gain correction when files have no ReplayGain data.
                  </div>
                </div>
                <Switch
                  checked={!!settings.normalizeVolume}
                  onChange={(normalizeVolume) => updateAudioSettings({ normalizeVolume })}
                  label={settings.normalizeVolume ? 'Enabled' : 'Disabled'}
                  ariaLabel="Enable volume normalisation"
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Crossfade</div>
                  <div className="settings-description">
                    Blend the end of the current track into the next prepared track.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
                  <input
                    className="slider"
                    type="range"
                    min={0}
                    max={12}
                    step={0.5}
                    value={Number(settings.crossfadeSeconds) || 0}
                    onChange={(event) =>
                      updateAudioSettings({ crossfadeSeconds: Number(event.target.value) })
                    }
                    aria-label="Crossfade duration"
                  />
                  <span style={{ fontSize: 12, color: 'var(--md-sys-color-outline)', width: 40, textAlign: 'right' }}>
                    {Number(settings.crossfadeSeconds) > 0
                      ? `${Number(settings.crossfadeSeconds).toFixed(1)}s`
                      : 'Off'}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Channel mapping</div>
                  <div className="settings-description">
                    Preserve the source layout, force stereo, or prefer surround channels when supported.
                  </div>
                </div>
                <div className="settings-choice-grid">
                  {CHANNEL_MODES.map((mode) => (
                    <Button
                      key={mode.value}
                      variant="surface"
                      active={(settings.channelMode || 'auto') === mode.value}
                      label={mode.label}
                      onClick={() => setChannelMode(mode.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Resampling quality</div>
                  <div className="settings-description">
                    Used when the output device cannot accept the source sample rate.
                  </div>
                </div>
                <div className="settings-choice-grid">
                  {RESAMPLE_QUALITIES.map((quality) => (
                    <Button
                      key={quality.value}
                      variant="surface"
                      active={(settings.resampleQuality || 'auto') === quality.value}
                      label={quality.label}
                      onClick={() => setResampleQuality(quality.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="form-hint">
                DSP runs in the native WavrPulse engine. With DSP disabled WAVR leaves the decoded audio path untouched unless the system shared mode requires conversion.
              </div>
            </>
          )}
        </Card>
      </div>
      <div className="settings-section">
        <SectionHeader title="Servers">
          {null}
        </SectionHeader>
        <Card>
          {settings.servers.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-main">
                <div className="settings-label">No servers configured</div>
                <div className="settings-description">Add a Navidrome or Subsonic-compatible server.</div>
              </div>
              <Button variant="primary" icon="add" label="Add server" onClick={onAddServer} />
            </div>
          ) : (
            <>
              {settings.servers.map((server) => {
                const active = profile?.id === server.id;
                return (
                  <div className="settings-row" key={server.id}>
                    <div className="settings-row-main">
                      <div className="settings-label">
                        {server.name} {active && <Chip selected>Active</Chip>}
                      </div>
                      <div className="settings-description">
                        {server.url} · {server.username}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        variant="surface"
                        active={active}
                        label={active ? 'Connected' : 'Connect'}
                        disabled={busyServerId === server.id}
                        onClick={() => connect(server)}
                      />
                      <Button variant="icon" icon="edit" title="Edit server" onClick={() => onEditServer(server)} />
                      <Button variant="icon" icon="delete" title="Remove server" onClick={() => remove(server)} />
                    </div>
                  </div>
                );
              })}
              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-label">Add another server</div>
                  <div className="settings-description">Profiles are stored locally and can be switched at any time.</div>
                </div>
                <Button variant="surface" icon="add" label="Add server" onClick={onAddServer} />
              </div>
            </>
          )}
          <div className="form-hint" style={{ marginTop: 12 }}>
            <Icon name="lock" size={12} /> Passwords are encrypted using the operating system credential store.
          </div>
        </Card>
      </div>

      {caps && (
        <div className="settings-section">
          <SectionHeader title="Server Info" />
          <Card>
            <div className="settings-row">
              <div className="settings-row-main">
                <div className="settings-label">{profile?.name}</div>
                <div className="settings-description">
                  {info?.version ? `Subsonic API ${info.version}` : 'Version unknown'}
                  {caps.openSubsonic ? ' · OpenSubsonic' : ''}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="settings-section">
        <SectionHeader title="Updates" />
        <Card>
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Update policy</div>
              <div className="settings-description">
                Install every release automatically, or wait for releases marked critical by the update server.
              </div>
            </div>
            <div className="settings-choice-grid">
              <Button
                variant="surface"
                active={(settings.updateMode || 'all') === 'all'}
                label="All updates"
                onClick={() => store.updateSettings({ updateMode: 'all' })}
              />
              <Button
                variant="surface"
                active={settings.updateMode === 'critical'}
                label="Critical only"
                onClick={() => store.updateSettings({ updateMode: 'critical' })}
              />
            </div>
          </div>

          {isLinuxPlatform && (
            <div className="settings-row">
              <div className="settings-row-main">
                <div className="settings-label">Update branch</div>
                <div className="settings-description">
                  Linux builds use the Linux update branch automatically.
                </div>
              </div>
              <Chip selected>Linux</Chip>
            </div>
          )}

          {!isLinuxPlatform && allowedUpdateChannels.length > 1 && (
            <div className="settings-row">
              <div className="settings-row-main">
                <div className="settings-label">Update branch</div>
                <div className="settings-description">
                  Beta is for beta testers, Dev is for alpha testers, and Developer accounts can use every branch.
                </div>
                <div className="form-hint">
                  Signed in as {wavrSyncAccountName || 'a WavrSync tester'}.
                </div>
              </div>
              <div className="settings-choice-grid">
                {allowedUpdateChannels.map((channel) => (
                  <Button
                    key={channel}
                    variant="surface"
                    active={(settings.updateChannel || 'stable') === channel}
                    label={channel === 'stable' ? 'Stable' : channel === 'beta' ? 'Beta' : 'Dev'}
                    onClick={() => store.updateSettings({ updateChannel: channel })}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="settings-row audio-engine-row">
            <div className="settings-row-main">
              <div className="settings-label">Update server URL</div>
              <div className="settings-description">
                The public HTTPS address of the WAVR update server. Leave it as is for the official updates endpoint or enter another supported endpoint.
                <br />
              </div>
              <DangerNotice />
            </div>
            <input
              className="form-input"
              style={{ maxWidth: 340 }}
              value={updateUrlDraft}
              onChange={(event) => setUpdateUrlDraft(event.target.value)}
              onBlur={saveUpdateUrl}
              placeholder="https://update.listenwavr.xyz"
              spellCheck={false}
              autoComplete="url"
              aria-label="Update server URL"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-label">Update status</div>
              <div className="settings-description">{updateSummary}</div>
              {updateStatus?.releaseNotes && (
                <div className="form-hint" style={{ whiteSpace: 'pre-wrap' }}>
                  {updateStatus.releaseNotes}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button
                variant="surface"
                icon="refresh"
                label={updateBusyState ? 'Checking...' : 'Check now'}
                onClick={checkForUpdates}
                disabled={!updateUrlDraft.trim() || updateBusyState}
              />
              {updateStatus?.state === 'available' && (
                <Button
                  variant="primary"
                  icon="download"
                  label="Download"
                  onClick={downloadUpdate}
                  disabled={updateBusyState}
                />
              )}
              {updateStatus?.state === 'downloaded' && (
                <Button
                  variant="primary"
                  icon="download"
                  label="Restart and update"
                  onClick={installUpdate}
                  disabled={updateBusyState}
                />
              )}
            </div>
          </div>

          <div className="form-hint">
            Current version: {APP_VERSION}.
          </div>
        </Card>
      </div>

      <Divider />

      <div className="settings-section">
        <SectionHeader title="About & diagnostics" />
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
            <div className="about-mark">
              <img src={appIcon} alt="" />
            </div>
            <div>
              <div className="settings-label">{APP_NAME} v{APP_VERSION}</div>
              <div className="settings-description">{APP_TAGLINE}</div>
            </div>
          </div>
          <p style={{ color: 'var(--md-sys-color-on-surface-variant)', fontSize: 13, marginTop: 0 }}>
            A desktop music player for Subsonic API servers, built with
            Electron, React and TypeScript.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Button
              variant="surface"
              icon="info"
              label={loadingDiagnostics ? 'Collecting' : 'Show diagnostics'}
              onClick={loadDiagnostics}
              disabled={loadingDiagnostics}
            />
            <Button
              variant="surface"
              icon="delete"
              label="Clear saved queue"
              onClick={() => {
                playback.clearSavedQueue();
                pushToast('Saved queue cleared.');
              }}
            />
          </div>
          {diagnostics && <pre className="settings-code">{diagnostics}</pre>}
        </Card>
      </div>
    </div>
  );
}












