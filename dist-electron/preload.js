"use strict";

// src/preload/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  minimizeWindow: () => import_electron.ipcRenderer.send("window-minimize"),
  maximizeWindow: () => import_electron.ipcRenderer.send("window-maximize"),
  closeWindow: () => import_electron.ipcRenderer.send("window-close"),
  isMaximized: () => import_electron.ipcRenderer.invoke("window-is-maximized"),
  isFullscreen: () => import_electron.ipcRenderer.invoke("window-is-fullscreen"),
  setFullscreen: (value) => import_electron.ipcRenderer.invoke("window-set-fullscreen", value),
  toggleFullscreen: () => import_electron.ipcRenderer.invoke("window-toggle-fullscreen"),
  onFullscreenChange: (callback) => {
    const handler = (_event, fullscreen) => callback(fullscreen);
    import_electron.ipcRenderer.on("fullscreen-changed", handler);
    return () => import_electron.ipcRenderer.removeListener("fullscreen-changed", handler);
  },
  readSettings: () => import_electron.ipcRenderer.invoke("read-settings"),
  writeSettings: (settings) => import_electron.ipcRenderer.invoke("write-settings", settings),
  testConnection: (profile) => import_electron.ipcRenderer.invoke("test-connection", profile),
  pickDirectory: () => import_electron.ipcRenderer.invoke("pick-directory"),
  pickPageBackground: () => import_electron.ipcRenderer.invoke("pick-page-background"),
  deletePageBackground: (url) => import_electron.ipcRenderer.invoke("delete-page-background", url),
  copyText: (text) => import_electron.ipcRenderer.invoke("copy-text", text),
  getDiagnostics: () => import_electron.ipcRenderer.invoke("get-diagnostics"),
  restartApp: () => import_electron.ipcRenderer.send("restart-app"),
  setTrayOnClose: (enabled) => import_electron.ipcRenderer.send("set-tray-on-close", enabled),
  openExternal: (url) => import_electron.ipcRenderer.send("open-external", url),
  mediaProxyUrl: (url) => `wavr-media://art?url=${encodeURIComponent(url)}`,
  onWindowVisibility: (callback) => {
    const handler = (_event, visible) => callback(visible);
    import_electron.ipcRenderer.on("window-visibility", handler);
    return () => import_electron.ipcRenderer.removeListener("window-visibility", handler);
  },
  setZoomFactor: (factor) => {
    try {
      import_electron.webFrame.setZoomFactor(factor);
    } catch {
    }
  },
  getZoomFactor: () => {
    try {
      return import_electron.webFrame.getZoomFactor();
    } catch {
      return 1;
    }
  },
  onMediaCommand: (callback) => {
    const handler = (_event, cmd) => callback(cmd);
    import_electron.ipcRenderer.on("media-command", handler);
    return () => import_electron.ipcRenderer.removeListener("media-command", handler);
  },
  onNavigateHistory: (callback) => {
    const handler = (_event, direction) => callback(direction);
    import_electron.ipcRenderer.on("navigate-history", handler);
    return () => import_electron.ipcRenderer.removeListener("navigate-history", handler);
  },
  setMediaKeys: (enabled) => import_electron.ipcRenderer.send("set-media-keys", enabled),
  mediaKeysActive: () => import_electron.ipcRenderer.send("media-keys-active"),
  toggleMiniWindow: () => import_electron.ipcRenderer.invoke("toggle-mini-window"),
  updateDiscordActivity: (payload) => import_electron.ipcRenderer.send("discord-activity", payload),
  clearDiscordActivity: () => import_electron.ipcRenderer.send("discord-clear"),
  getDiscordStatus: () => import_electron.ipcRenderer.invoke("discord-status"),
  onDiscordStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    import_electron.ipcRenderer.on("discord-status", handler);
    return () => import_electron.ipcRenderer.removeListener("discord-status", handler);
  },
  scrobbleStatus: () => import_electron.ipcRenderer.invoke("scrobble-status"),
  scrobbleConnect: (provider) => import_electron.ipcRenderer.invoke("scrobble-connect", provider),
  scrobbleDisconnect: () => import_electron.ipcRenderer.invoke("scrobble-disconnect"),
  scrobbleNowPlaying: (track) => import_electron.ipcRenderer.send("scrobble-now-playing", track),
  scrobbleSubmit: (track) => import_electron.ipcRenderer.send("scrobble-submit", track),
  onScrobbleStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    import_electron.ipcRenderer.on("scrobble-status", handler);
    return () => import_electron.ipcRenderer.removeListener("scrobble-status", handler);
  },
  onWavrSyncInvite: (callback) => {
    const handler = (_event, invite) => callback(invite);
    import_electron.ipcRenderer.on("wavrsync-invite", handler);
    return () => import_electron.ipcRenderer.removeListener("wavrsync-invite", handler);
  },
  wavrSyncReady: () => import_electron.ipcRenderer.send("wavrsync-renderer-ready"),
  updateStatus: () => import_electron.ipcRenderer.invoke("update-status"),
  checkForUpdates: () => import_electron.ipcRenderer.invoke("update-check"),
  downloadUpdate: () => import_electron.ipcRenderer.invoke("update-download"),
  installUpdate: () => import_electron.ipcRenderer.invoke("update-install"),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    import_electron.ipcRenderer.on("update-status", handler);
    return () => import_electron.ipcRenderer.removeListener("update-status", handler);
  },
  audioEngineInfo: () => import_electron.ipcRenderer.invoke("audio-engine-info"),
  youtubeAuthStatus: () => import_electron.ipcRenderer.invoke("youtube-auth-status"),
  youtubeAuthConnect: () => import_electron.ipcRenderer.invoke("youtube-auth-connect"),
  youtubeAuthDisconnect: () => import_electron.ipcRenderer.invoke("youtube-auth-disconnect"),
  fanartArtistBanner: (payload) => import_electron.ipcRenderer.invoke("fanart-artist-banner", payload),
  youtubeVideoSearch: (query, artist = "", title = "") => import_electron.ipcRenderer.invoke("youtube-video-search", query, artist, title),
  youtubeVideoCache: (videoId) => import_electron.ipcRenderer.invoke("youtube-video-cache", videoId),
  youtubeVideoIntro: (videoId) => import_electron.ipcRenderer.invoke("youtube-video-intro", videoId),
  youtubeCustomVideo: (url) => import_electron.ipcRenderer.invoke("youtube-custom-video", url),
  youtubeCacheClear: () => import_electron.ipcRenderer.invoke("youtube-cache-clear"),
  audioEngineDevices: () => import_electron.ipcRenderer.invoke("audio-engine-devices"),
  audioEnginePlay: (payload) => import_electron.ipcRenderer.invoke("audio-engine-play", payload),
  audioEngineCommand: (command, payload) => import_electron.ipcRenderer.invoke("audio-engine-command", command, payload),
  onAudioEngineEvent: (callback) => {
    const handler = (_event, event) => callback(event);
    import_electron.ipcRenderer.on("audio-engine-event", handler);
    return () => import_electron.ipcRenderer.removeListener("audio-engine-event", handler);
  }
});
//# sourceMappingURL=preload.js.map
