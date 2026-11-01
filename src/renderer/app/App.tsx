import { useEffect, useRef, useState } from 'react';
import type { ServerProfile, UpdateStatus } from '../../../shared/models';
import {
  PAGE_BACKGROUND_ALL_ID,
  WAVRSYNC_DEFAULT_SERVER_URL,
} from '../../../shared/constants';
import { ThemeProvider, ColourProvider, useTheme } from '../themes';
import {
  StoreProvider,
  store,
  useCurrentTrackId,
  useNavigation,
  useServer,
  useSettings,
} from '../state';
import { connectServer, coverArtUrl, setTrackStarred } from '../services/serverService';
import { useDiscordPresence } from '../hooks/useDiscordPresence';
import { useScrobbler } from '../hooks/useScrobbling';
import { useWavrSyncPlaybackSync, useWavrSyncState } from '../hooks/useWavrSync';
import { useWavrRemoteControl } from '../hooks/useWavrRemote';
import { useWavrProfileSync } from '../hooks/useWavrProfileSync';
import { useUsageHeartbeat } from '../hooks/useUsageHeartbeat';
import { useWavrProfilePublisher } from '../hooks/useWavrProfilePublisher';
import { useWavrSyncSettingsSync } from '../hooks/useWavrSyncSettingsSync';
import { wavrSync } from '../services/wavrSyncService';
import { wavrSyncAccount } from '../services/wavrSyncAccountService';
import { parseWavrSyncInviteCode } from '../../../shared/wavrsync';
import { playback } from '../services/playbackService';
import { pushToast } from '../services/toastService';
import { analyzeCover } from '../themes/themeEngine';
import { isVideoPageBackground } from '../utils/backgroundMedia';
import { NavRail } from '../components/NavRail';
import { FriendsSidebar } from '../components/FriendsSidebar';
import { WavrSyncNotifications } from '../components/WavrSyncNotifications';
import { WindowControls } from '../components/WindowControls';
import { Toaster } from '../components/Toaster';
import { BackgroundVideo } from '../components/BackgroundVideo';
import { ContextMenuHost } from '../components/ContextMenu';
import { MediaDialogHost } from '../components/MediaDialogHost';
import { SmartMixHost } from '../components/SmartMixDialog';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { BottomPlayer } from '../features/player/BottomPlayer';
import { ExpandedPlayer } from '../features/player/ExpandedPlayer';
import { LyricsSidebar } from '../features/player/LyricsSidebar';
import { Home } from '../features/home/Home';
import { Search } from '../features/search/Search';
import { Artists } from '../features/artists/Artists';
import { ArtistDetail } from '../features/artists/ArtistDetail';
import { Albums } from '../features/albums/Albums';
import { AlbumDetail } from '../features/albums/AlbumDetail';
import { AlbumCollection } from '../features/albums/AlbumCollection';
import { Songs } from '../features/songs/Songs';
import { Discover } from '../features/songs/Discover';
import { WavrSync } from '../features/wavrsync/WavrSync';
import { UserProfile } from '../features/profile/UserProfile';
import { Genres } from '../features/genres/Genres';
import { GenreDetail } from '../features/genres/GenreDetail';
import { Playlists } from '../features/playlists/Playlists';
import { PlaylistDetail } from '../features/playlists/PlaylistDetail';
import { Favourites } from '../features/favourites/Favourites';
import { Queue } from '../features/queue/Queue';
import { Settings } from '../features/settings/Settings';
import { LyricsPage } from '../features/lyrics/Lyrics';
import { QueueList } from '../components/QueueList';
import { useQueue } from '../state';
import { ConnectDialog } from './ConnectDialog';
import { go, parseRoute } from './routes';
import appIcon from '../../../assets/icon.png';

const SETTINGS_STORAGE_KEY = 'wavr.settings.v1';

function electronApi(): any {
  return (window as any).electronAPI;
}

function AppShell() {
  const settings = useSettings();
  const server = useServer();
  const navigation = useNavigation();
  const currentTrackId = useCurrentTrackId();
  const theme = useTheme();
  const { queue } = useQueue();
  const wavrSyncState = useWavrSyncState();
  const wavrSyncUrl = settings.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
  useWavrRemoteControl();
  useWavrProfileSync(wavrSyncState);
  useUsageHeartbeat();
  useWavrSyncPlaybackSync(wavrSyncState);
  useWavrProfilePublisher(wavrSyncState, server.profile);
  useDiscordPresence(
    settings.discordRPC,
    settings.discordClientId,
    wavrSyncState.room
      ? {
          roomCode: wavrSyncState.room.code,
          roomName: wavrSyncState.room.name,
          inviteUrl: wavrSyncState.room.inviteUrl,
          participants: wavrSyncState.room.participants.length,
          visibility: wavrSyncState.room.visibility,
        }
      : null,
  );
  useScrobbler(settings.scrobbleEnabled, settings.scrobbleProvider || 'lastfm');
  const [booted, setBooted] = useState(false);
  useWavrSyncSettingsSync(wavrSyncUrl, booted);
  const [connectOpen, setConnectOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingWavrSyncInvite, setPendingWavrSyncInvite] = useState<string | null>(null);
  const bootStarted = useRef(false);
  const lastProfileId = useRef<string | null>(null);
  const lastUpdateNotice = useRef('');
  const lastNonPlayerRoute = useRef('home');
  const contentRef = useRef<HTMLDivElement>(null);

  // Load persisted settings, restore the default server, and restore the queue.
  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;

    const boot = async () => {
      let raw: any = null;
      try {
        const api = electronApi();
        if (api?.readSettings) {
          raw = await api.readSettings();
        } else {
          const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
          if (stored) raw = JSON.parse(stored);
        }
      } catch {
        raw = null;
      }

      if (raw && typeof raw === 'object' && !raw.wavrSyncServerUrl && raw.pulseServerUrl) {
        raw.wavrSyncServerUrl = raw.pulseServerUrl;
      }

      const loaded = {
        ...store.getSettings(),
        ...(raw && typeof raw === 'object' ? raw : {}),
        servers: Array.isArray(raw?.servers) ? raw.servers : [],
      };
      const syncServerUrl = loaded.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
      const restored = await wavrSyncAccount.restoreForBoot(syncServerUrl).catch(() => null);
      const effective = restored
        ? {
            ...loaded,
            ...restored,
            servers: Array.isArray(restored.servers) ? restored.servers : loaded.servers,
          }
        : loaded;
      if (effective.scrobbleProvider !== 'lastfm') effective.scrobbleProvider = 'lastfm';
      store.updateSettings(effective);
      if (Number.isFinite(effective.defaultVolume)) {
        playback.setVolume(effective.defaultVolume);
      }
      playback.applyAudioSettings();

      const profile: ServerProfile | undefined =
        effective.servers.find((entry: ServerProfile) => entry.default) || effective.servers[0];
      if (profile) {
        try {
          await connectServer(profile);
        } catch (reason: any) {
          pushToast(
            reason?.message || `Could not connect to ${profile.name}. Open Settings to retry.`,
            'error',
          );
        }
      }
      setBooted(true);
    };

    boot();
  }, []);

  useEffect(() => {
    if (!booted || settings.wavrSyncAutoConnect === false) return;
    const url = settings.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
    if (!wavrSyncAccount.hasSessionForServer(url)) return;
    if (wavrSync.getState().connection !== 'disconnected') return;
    const accountName = wavrSyncAccount.getSessionForServer(url)?.account.username || '';
    wavrSync.connect(
      url,
      accountName || server.profile?.username || server.profile?.name || 'Listener',
      settings.profileImage,
    );
  }, [
    booted,
    settings.wavrSyncAutoConnect,
    settings.wavrSyncServerUrl,
    server.profile?.id,
    settings.profileImage,
  ]);

  useEffect(() => {
    const api = electronApi();
    const notify = (status: UpdateStatus) => {
      if (status.state !== 'downloaded' || !status.availableVersion) return;
      if (lastUpdateNotice.current === status.availableVersion) return;
      lastUpdateNotice.current = status.availableVersion;
      pushToast(
        `WAVR ${status.availableVersion} is ready. Restart from Settings > Updates.`,
        'success',
      );
    };
    const unsubscribe = api?.onUpdateStatus?.((status: UpdateStatus) => notify(status));
    api?.updateStatus?.()
      .then((status: UpdateStatus | null) => {
        if (status) notify(status);
      })
      .catch(() => {});
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const api = electronApi();
    const unsubscribe = api?.onWavrSyncInvite?.((invite: { code?: string } | string) => {
      const code = parseWavrSyncInviteCode(
        typeof invite === 'string' ? invite : String(invite?.code || ''),
      );
      if (!code) return;
      store.setNavigation(go.wavrsync());
      setPendingWavrSyncInvite(code);
    });
    api?.wavrSyncReady?.();
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!booted || !pendingWavrSyncInvite) return;
    const accountName =
      wavrSyncAccount.getSessionForServer(settings.wavrSyncServerUrl)?.account.username || '';
    const name = accountName || server.profile?.username || server.profile?.name || 'Listener';
    wavrSync.joinRoom(
      pendingWavrSyncInvite,
      settings.wavrSyncServerUrl,
      name,
      settings.profileImage,
    );
    setPendingWavrSyncInvite(null);
  }, [
    booted,
    pendingWavrSyncInvite,
    settings.wavrSyncServerUrl,
    server.profile?.username,
    server.profile?.name,
  ]);

  // Persist settings (encrypted in the main process).
  useEffect(() => {
    if (!booted) return;
    let timer = 0;
    const unsubscribe = store.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const snapshot = store.getSettings();
        const api = electronApi();
        if (api?.writeSettings) {
          api.writeSettings(snapshot).catch(() => {
            /* persistence errors are non-fatal */
          });
        } else {
          try {
            const persisted = {
              ...snapshot,
              lastFmApiSecret: '',
              libreFmApiSecret: '',
            };
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
          } catch {
            /* ignore quota errors */
          }
        }
      }, 450);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [booted]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    return api?.onNavigateHistory?.((direction: 'back' | 'forward') => {
      if (direction === 'back') store.navigateBack();
      else store.navigateForward();
    });
  }, []);

  // Persist the queue, but never the credentials.
  useEffect(() => {
    if (!booted) return;
    let timer = 0;
    let previousQueue = playback.getQueue();
    let previousIndex = playback.getQueueIndex();
    const unsubscribe = store.subscribe(() => {
      const nextQueue = playback.getQueue();
      const nextIndex = playback.getQueueIndex();
      if (nextQueue === previousQueue && nextIndex === previousIndex) return;
      previousQueue = nextQueue;
      previousIndex = nextIndex;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const profile = store.getServerProfile();
        if (store.getSettings().restoreQueue && profile) {
          playback.saveQueueState();
        } else {
          playback.clearSavedQueue();
        }
      }, 1200);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [booted]);

  // Restore or reset the queue when the active server changes.
  useEffect(() => {
    if (!booted) return;
    const profile = server.profile;
    if (!profile || lastProfileId.current === profile.id) return;
    const switched = lastProfileId.current !== null;
    lastProfileId.current = profile.id;
    if (switched) playback.stop();
    if (!store.getSettings().restoreQueue) return;
    const saved = playback.loadQueueState(profile.id);
    if (saved && saved.queue.length > 0) {
      const index = Math.max(0, Math.min(saved.index, saved.queue.length - 1));
      playback.restore(saved.queue[index], saved.queue, index);
    }
  }, [booted, server.profile?.id]);

  useEffect(() => {
    const api = electronApi();
    let mounted = true;
    const sync = async () => {
      try {
        if (api?.isFullscreen) {
          const value = await api.isFullscreen();
          if (mounted) setIsFullscreen(!!value);
        }
      } catch {
        /* fullscreen state is optional */
      }
    };
    sync();
    const unsubscribe = api?.onFullscreenChange?.((value: boolean) => {
      setIsFullscreen(!!value);
    });
    const onFullscreenChange = () => {
      if (!api?.isFullscreen) setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      mounted = false;
      unsubscribe?.();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset['fullscreen'] = isFullscreen ? 'true' : 'false';
  }, [isFullscreen]);

  // Media keys routed from the main process.
  useEffect(() => {
    const api = electronApi();
    if (!api) return;
    api.mediaKeysActive?.();
    api.setMediaKeys?.(true);
    const unsubscribe = api.onMediaCommand?.((command: string) => {
      if (command === 'toggle') playback.playPause();
      else if (command === 'play') playback.resume();
      else if (command === 'pause') playback.pause();
      else if (command === 'next') playback.next(true);
      else if (command === 'prev') playback.prev();
      else if (command === 'stop') playback.pause();
    });
    return () => {
      unsubscribe?.();
      api.setMediaKeys?.(false);
    };
  }, []);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (event.key === 'Escape') {
        if (lyricsOpen) {
          setLyricsOpen(false);
          return;
        }
        if (queueOpen) {
          setQueueOpen(false);
          return;
        }
        if (isFullscreen) {
          event.preventDefault();
          const api = electronApi();
          if (api?.setFullscreen) {
            api.setFullscreen(false).then((value: boolean) => setIsFullscreen(!!value)).catch(() => {});
          } else if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          return;
        }
        const nav = store.getNavigation();
        if (nav === 'player') {
          store.setNavigation(lastNonPlayerRoute.current);
          return;
        }
        if (nav.startsWith('album:')) store.setNavigation(go.albums());
        else if (nav.startsWith('artist:')) store.setNavigation(go.artists());
        else if (nav.startsWith('playlist:')) store.setNavigation(go.playlists());
        else if (nav.startsWith('genre:')) store.setNavigation(go.genres());
        return;
      }

      if (typing) return;

      if (event.code === 'Space') {
        event.preventDefault();
        playback.playPause();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        store.setNavigation(go.search());
        window.setTimeout(() => {
          document.getElementById('global-search-input')?.focus();
        }, 60);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight') {
        event.preventDefault();
        playback.seek(playback.getCurrentTime() + 10);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowLeft') {
        event.preventDefault();
        playback.seek(playback.getCurrentTime() - 10);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowUp') {
        event.preventDefault();
        playback.setVolume(playback.getVolume() + 0.05);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowDown') {
        event.preventDefault();
        playback.setVolume(playback.getVolume() - 0.05);
      } else if (event.key.toLowerCase() === 'q') {
        toggleQueue();
      } else if (event.key.toLowerCase() === 'l') {
        toggleLyrics();
      } else if (event.key.toLowerCase() === 'm') {
        playback.toggleMute();
      } else if (event.key.toLowerCase() === 'f') {
        const track = playback.getCurrentTrack();
        if (track) {
          setTrackStarred(track.id, !track.starred)
            .then(() => pushToast('Favourite updated.'))
            .catch(() => pushToast('Could not update favourite.', 'error'));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [queueOpen, lyricsOpen, isFullscreen]);

  // Dynamic palette from artwork.
  useEffect(() => {
    const track = store.getPlayback().track;
    if (!track?.coverArt) {
      theme.applyArtworkColour('#C8D879');
      return;
    }
    let cancelled = false;
    const url = coverArtUrl(track.coverArt, 320);
    if (!url) return;
    analyzeCover(url)
      .then((colour) => {
        if (!cancelled) theme.applyArtworkColour(colour.accent);
      })
      .catch(() => {
        if (!cancelled) theme.applyArtworkColour('#C8D879');
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrackId]);

  // Window title follows playback.
  useEffect(() => {
    const track = store.getPlayback().track;
    document.title = track ? `${track.title} · ${track.artist} — WAVR` : 'WAVR';
  }, [currentTrackId]);

  // Remember where the listener was before opening the expanded player.
  useEffect(() => {
    if (parseRoute(navigation).page !== 'player') {
      lastNonPlayerRoute.current = navigation;
    }
  }, [navigation]);

  useEffect(() => {
    const content = contentRef.current;
    if (content) content.scrollTop = 0;
  }, [navigation]);

  const route = parseRoute(navigation);
  const pageBackground =
    route.page === 'player'
      ? settings.pageBackgrounds?.[route.page] || ''
      : settings.pageBackgrounds?.[PAGE_BACKGROUND_ALL_ID] ||
        settings.pageBackgrounds?.[route.page] ||
        '';
  const pageBackgroundIsVideo = isVideoPageBackground(pageBackground);
  const closePlayer = () => store.setNavigation(lastNonPlayerRoute.current || go.home());

  const toggleQueue = () => {
    setLyricsOpen(false);
    setQueueOpen((value) => !value);
  };

  const toggleLyrics = () => {
    setQueueOpen(false);
    setLyricsOpen((value) => !value);
  };

  const toggleFriends = () => {
    if (
      wavrSyncState.connection !== 'connected' ||
      !wavrSyncState.features.includes('profiles')
    ) {
      pushToast('Connect to WavrSync to see your friends.', 'info');
      store.setNavigation(go.wavrsync());
      return;
    }
    setQueueOpen(false);
    setLyricsOpen(false);
    store.updateSettings({ friendsSidebarEnabled: settings.friendsSidebarEnabled === false });
  };

  const toggleFullscreen = async () => {
    const api = electronApi();
    if (api?.toggleFullscreen) {
      try {
        const value = await api.toggleFullscreen();
        setIsFullscreen(!!value);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      /* fullscreen can be blocked by the platform */
    }
  };

  const openAddServer = () => {
    setEditingProfile(null);
    setConnectOpen(true);
  };

  const openEditServer = (profile: ServerProfile) => {
    setEditingProfile(profile);
  };

  const closeConnect = () => {
    setEditingProfile(null);
    setConnectOpen(false);
  };

  const onConnected = () => {
    setEditingProfile(null);
    setConnectOpen(false);
    if (!server.profile) store.setNavigation(go.home());
  };

  const renderPage = () => {
    switch (route.page) {
      case 'home':
        return <Home />;
      case 'search':
        return <Search />;
      case 'artists':
        return <Artists />;
      case 'artist':
        return <ArtistDetail id={route.id} />;
      case 'albums':
        return <Albums />;
      case 'album':
        return <AlbumDetail id={route.id} />;
      case 'songs':
        return <Songs />;
      case 'genres':
        return <Genres />;
      case 'genre':
        return <GenreDetail name={route.id} />;
      case 'playlists':
        return <Playlists />;
      case 'playlist':
        return <PlaylistDetail id={route.id} />;
      case 'favourites':
        return <Favourites />;
      case 'queue':
        return <Queue />;
      case 'settings':
        return <Settings onAddServer={openAddServer} onEditServer={openEditServer} />;
      case 'lyrics':
        return <LyricsPage />;
      case 'recently-added':
        return <AlbumCollection title="Recently added" type="newest" subtitle="Newest albums on your server" />;
      case 'recently-played':
        return <AlbumCollection title="Recently played" type="recent" subtitle="Albums you have listened to recently" />;
      case 'most-played':
        return <AlbumCollection title="Most played" type="frequent" subtitle="Your most frequently played albums" />;
      case 'discover':
        return <Discover />;
      case 'wavrsync':
        return <WavrSync />;
      case 'profile':
        return <UserProfile id={route.id} />;
      default:
        return <Home />;
    }
  };

  const connectDialogOpen = connectOpen || !!editingProfile || (booted && !server.profile);

  if (!booted) {
    return (
      <div className="app-frame">
        <div className="boot-window-controls">
          <WindowControls />
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            color: 'var(--md-sys-color-on-surface-variant)',
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 18,
              overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-tertiary))',
              color: 'var(--md-sys-color-on-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 22,
            }}
          >
            <img
              src={appIcon}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div className="loading-block" style={{ padding: 0 }}>
            <span className="spinner" /> Starting WAVR…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <div className="app-body">
        {pageBackground && route.page !== 'player' && (
          <div
            className={`page-custom-background ${pageBackgroundIsVideo ? 'video' : ''}`}
            style={
              pageBackgroundIsVideo
                ? undefined
                : { backgroundImage: `url("${pageBackground}")` }
            }
            aria-hidden="true"
          >
            {pageBackgroundIsVideo && (
              <BackgroundVideo
                className="page-custom-background-video"
                src={pageBackground}
              />
            )}
          </div>
        )}
        <NavRail compact={settings.density === 'compact'} />
        <div className="main-content">
          {route.page !== 'player' && <div className="window-drag-strip" aria-hidden="true" />}
          <div ref={contentRef} className={`content-pad ${settings.density}`}>{renderPage()}</div>
          <BottomPlayer
            onOpenQueue={toggleQueue}
            onToggleLyrics={toggleLyrics}
            onToggleFriends={toggleFriends}
            lyricsOpen={lyricsOpen}
            friendsOpen={
              settings.friendsSidebarEnabled !== false &&
              wavrSyncState.connection === 'connected' &&
              wavrSyncState.features.includes('profiles')
            }
          />
        </div>
        {route.page !== 'player' && <FriendsSidebar />}
      </div>

      {route.page !== 'player' && (
        <div className="window-chrome">
          <WindowControls />
        </div>
      )}

      {route.page === 'player' && (
        <ExpandedPlayer
          onClose={closePlayer}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      )}

      {queueOpen && (
        <>
          <button className="drawer-backdrop" aria-label="Close queue" onClick={() => setQueueOpen(false)} />
          <aside className="queue-drawer open" aria-label="Playback queue">
            <div className="queue-panel-header">
              <div>
                <div className="h3">Queue</div>
                <div className="settings-description">{queue.length} tracks</div>
              </div>
              <Button variant="icon" icon="close" title="Close queue" onClick={() => setQueueOpen(false)} />
            </div>
            <QueueList />
          </aside>
        </>
      )}

      {lyricsOpen && route.page !== 'player' && (
        <LyricsSidebar onClose={() => setLyricsOpen(false)} />
      )}

      <Toaster />
      <WavrSyncNotifications />
      <ContextMenuHost />
      <MediaDialogHost />
      <SmartMixHost />

      <ConnectDialog
        open={connectDialogOpen}
        initial={editingProfile}
        onClose={server.profile ? closeConnect : undefined}
        onConnected={onConnected}
      />
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <ThemeProvider>
        <ColourProvider>
          <AppShell />
        </ColourProvider>
      </ThemeProvider>
    </StoreProvider>
  );
}




