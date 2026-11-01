import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  isFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
  setFullscreen: (value: boolean) => ipcRenderer.invoke('window-set-fullscreen', value),
  toggleFullscreen: () => ipcRenderer.invoke('window-toggle-fullscreen'),
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
    const handler = (_event: unknown, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on('fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('fullscreen-changed', handler);
  },
  readSettings: () => ipcRenderer.invoke('read-settings'),
  writeSettings: (settings: unknown) => ipcRenderer.invoke('write-settings', settings),
  testConnection: (profile: unknown) => ipcRenderer.invoke('test-connection', profile),
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  pickPageBackground: () => ipcRenderer.invoke('pick-page-background'),
  deletePageBackground: (url: string) => ipcRenderer.invoke('delete-page-background', url),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  restartApp: () => ipcRenderer.send('restart-app'),
  setTrayOnClose: (enabled: boolean) => ipcRenderer.send('set-tray-on-close', enabled),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  mediaProxyUrl: (url: string) => `wavr-media://art?url=${encodeURIComponent(url)}`,
  onWindowVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_event: unknown, visible: boolean) => callback(visible);
    ipcRenderer.on('window-visibility', handler);
    return () => ipcRenderer.removeListener('window-visibility', handler);
  },
  setZoomFactor: (factor: number) => {
    try {
      webFrame.setZoomFactor(factor);
    } catch {
      /* ignore */
    }
  },
  getZoomFactor: () => {
    try {
      return webFrame.getZoomFactor();
    } catch {
      return 1.0;
    }
  },
  onMediaCommand: (callback: (cmd: string) => void) => {
    const handler = (_event: unknown, cmd: string) => callback(cmd);
    ipcRenderer.on('media-command', handler);
    return () => ipcRenderer.removeListener('media-command', handler);
  },
  onNavigateHistory: (callback: (direction: 'back' | 'forward') => void) => {
    const handler = (_event: unknown, direction: 'back' | 'forward') => callback(direction);
    ipcRenderer.on('navigate-history', handler);
    return () => ipcRenderer.removeListener('navigate-history', handler);
  },
  setMediaKeys: (enabled: boolean) => ipcRenderer.send('set-media-keys', enabled),
  mediaKeysActive: () => ipcRenderer.send('media-keys-active'),
  toggleMiniWindow: () => ipcRenderer.invoke('toggle-mini-window'),
  updateDiscordActivity: (payload: unknown) => ipcRenderer.send('discord-activity', payload),
  clearDiscordActivity: () => ipcRenderer.send('discord-clear'),
  getDiscordStatus: () => ipcRenderer.invoke('discord-status'),
  onDiscordStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('discord-status', handler);
    return () => ipcRenderer.removeListener('discord-status', handler);
  },
  scrobbleStatus: () => ipcRenderer.invoke('scrobble-status'),
  scrobbleConnect: (provider: string) => ipcRenderer.invoke('scrobble-connect', provider),
  scrobbleDisconnect: () => ipcRenderer.invoke('scrobble-disconnect'),
  scrobbleNowPlaying: (track: unknown) => ipcRenderer.send('scrobble-now-playing', track),
  scrobbleSubmit: (track: unknown) => ipcRenderer.send('scrobble-submit', track),
  onScrobbleStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('scrobble-status', handler);
    return () => ipcRenderer.removeListener('scrobble-status', handler);
  },
  onWavrSyncInvite: (callback: (invite: unknown) => void) => {
    const handler = (_event: unknown, invite: unknown) => callback(invite);
    ipcRenderer.on('wavrsync-invite', handler);
    return () => ipcRenderer.removeListener('wavrsync-invite', handler);
  },
  wavrSyncReady: () => ipcRenderer.send('wavrsync-renderer-ready'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  audioEngineInfo: () => ipcRenderer.invoke('audio-engine-info'),
  youtubeAuthStatus: () => ipcRenderer.invoke('youtube-auth-status'),
  youtubeAuthConnect: () => ipcRenderer.invoke('youtube-auth-connect'),
  youtubeAuthDisconnect: () => ipcRenderer.invoke('youtube-auth-disconnect'),
  fanartArtistBanner: (payload: unknown) => ipcRenderer.invoke('fanart-artist-banner', payload),
  youtubeVideoSearch: (query: string, artist = '', title = '') => ipcRenderer.invoke('youtube-video-search', query, artist, title),
  youtubeVideoCache: (videoId: string) => ipcRenderer.invoke('youtube-video-cache', videoId),
  youtubeVideoIntro: (videoId: string) => ipcRenderer.invoke('youtube-video-intro', videoId),
  youtubeCustomVideo: (url: string) => ipcRenderer.invoke('youtube-custom-video', url),
  youtubeCacheClear: () => ipcRenderer.invoke('youtube-cache-clear'),
  audioEngineDevices: () => ipcRenderer.invoke('audio-engine-devices'),
  audioEnginePlay: (payload: unknown) => ipcRenderer.invoke('audio-engine-play', payload),
  audioEngineCommand: (command: string, payload: unknown) =>
    ipcRenderer.invoke('audio-engine-command', command, payload),
  onAudioEngineEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, event: unknown) => callback(event);
    ipcRenderer.on('audio-engine-event', handler);
    return () => ipcRenderer.removeListener('audio-engine-event', handler);
  },
});



