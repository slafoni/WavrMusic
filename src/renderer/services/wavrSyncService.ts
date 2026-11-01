import type {
  WavrSyncControlMode,
  WavrSyncPlaybackStatus,
  WavrSyncProfile,
  WavrSyncProfileInput,
  WavrSyncProfileSummary,
  WavrSyncRoom,
  WavrSyncRoomInvite,
  WavrSyncRoomSummary,
  WavrSyncVisibility,
  Track,
} from '../../../shared/models';
import {
  WAVRSYNC_PROTOCOL_VERSION,
  normalizeWavrSyncServerUrl,
  type WavrRemoteCommand,
  type WavrRemotePlayback,
  type WavrSyncClientMessage,
  type WavrSyncServerMessage,
} from '../../../shared/wavrsync';
import { wavrSyncAccount } from './wavrSyncAccountService';

const USER_STORAGE_KEY = 'wavr.wavrsync.userId';

export type WavrSyncConnection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WavrSyncState {
  connection: WavrSyncConnection;
  serverUrl: string;
  userId: string;
  displayName: string;
  avatar: string;
  room: WavrSyncRoom | null;
  rooms: WavrSyncRoomSummary[];
  roomInvites: WavrSyncRoomInvite[];
  profiles: Record<string, WavrSyncProfile>;
  profileSearch: WavrSyncProfileSummary[];
  features: string[];
  error: string;
  clockOffset: number;
}

type Listener = (state: WavrSyncState) => void;

function storedUserId(): string {
  try {
    const existing =
      localStorage.getItem(USER_STORAGE_KEY) ||
      localStorage.getItem('wavr.wavrSync.userId') ||
      localStorage.getItem('wavr.pulse.userId');
    if (existing) {
      localStorage.setItem(USER_STORAGE_KEY, existing);
      return existing;
    }
  } catch {
    /* ignore */
  }
  const id = createUserId();
  try {
    localStorage.setItem(USER_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

function createUserId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

class WavrSyncService {
  private socket: WebSocket | null = null;
  private state: WavrSyncState = {
    connection: 'disconnected',
    serverUrl: '',
    userId: storedUserId(),
    displayName: 'Listener',
    avatar: '',
    room: null,
    rooms: [],
    roomInvites: [],
    profiles: {},
    profileSearch: [],
    features: [],
    error: '',
    clockOffset: 0,
  };
  private listeners = new Set<Listener>();
  private remoteListeners = new Set<(command: WavrRemoteCommand) => void>();
  private manualClose = true;
  private joinedCode = '';
  private reconnectAttempt = 0;
  private reconnectTimer = 0;
  private heartbeatTimer = 0;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRemoteCommand(listener: (command: WavrRemoteCommand) => void) {
    this.remoteListeners.add(listener);
    return () => {
      this.remoteListeners.delete(listener);
    };
  }

  sendRemoteState(playback: WavrRemotePlayback) {
    this.send({ type: 'remoteState', playback });
  }

  getState(): WavrSyncState {
    return this.state;
  }

  connect(serverUrl: string, displayName: string, avatar = '') {
    const url = normalizeWavrSyncServerUrl(serverUrl);
    const name = String(displayName || '').trim() || 'Listener';
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) &&
      this.state.serverUrl === url
    ) {
      this.state = { ...this.state, displayName: name, avatar };
      this.emit();
      return;
    }
    const previousUrl = this.state.serverUrl;
    if (this.socket) {
      this.manualClose = true;
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.manualClose = false;
    this.reconnectAttempt = 0;
    if (previousUrl !== url) this.joinedCode = '';
    this.state = {
      ...this.state,
      connection: 'connecting',
      serverUrl: url,
      displayName: name,
      avatar,
      room: previousUrl === url ? this.state.room : null,
      rooms: previousUrl === url ? this.state.rooms : [],
      roomInvites: previousUrl === url ? this.state.roomInvites : [],
      profiles: previousUrl === url ? this.state.profiles : {},
      profileSearch: previousUrl === url ? this.state.profileSearch : [],
      features: previousUrl === url ? this.state.features : [],
      error: '',
    };
    this.emit();
    this.openSocket();
  }

  joinRoom(code: string, serverUrl: string, displayName: string, avatar = '') {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(normalizedCode)) {
      this.setError('That invite code is not valid.');
      return;
    }
    const url = normalizeWavrSyncServerUrl(serverUrl);
    const name = String(displayName || '').trim() || 'Listener';
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.state.connection === 'connected' &&
      this.state.serverUrl === url
    ) {
      this.joinedCode = normalizedCode;
      this.state = { ...this.state, displayName: name, avatar };
      this.emit();
      this.send({ type: 'join', code: normalizedCode, avatar });
      return;
    }
    this.connect(url, name, avatar);
    this.joinedCode = normalizedCode;
  }

  createRoom(options: {
    name: string;
    controlMode: WavrSyncControlMode;
    visibility: WavrSyncVisibility;
    libraryUrl?: string;
    libraryName?: string;
  }) {
    this.send({
      type: 'create',
      name: options.name,
      controlMode: options.controlMode,
      visibility: options.visibility,
      libraryUrl: options.libraryUrl,
      libraryName: options.libraryName,
      avatar: this.state.avatar,
    });
  }

  leaveRoom() {
    if (this.state.connection === 'connected') this.send({ type: 'leave' });
    this.joinedCode = '';
    this.state = { ...this.state, room: null, error: '' };
    this.emit();
  }

  disconnect() {
    this.manualClose = true;
    this.joinedCode = '';
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.state = {
      ...this.state,
      connection: 'disconnected',
      room: null,
      rooms: [],
      roomInvites: [],
      profileSearch: [],
      features: [],
      error: '',
    };
    this.emit();
  }

  resetGuestIdentity() {
    this.disconnect();
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.state = { ...this.state, userId: createUserId() };
    this.emit();
  }

  listRooms() {
    this.send({ type: 'listRooms' });
  }

  setControlMode(controlMode: WavrSyncControlMode) {
    this.send({ type: 'controlMode', controlMode });
  }

  setVisibility(visibility: WavrSyncVisibility) {
    if (!this.hasFeature('roomVisibility')) return;
    this.send({ type: 'visibility', visibility });
  }

  hasFeature(feature: string): boolean {
    return this.state.features.includes(feature);
  }

  publishProfile(profile: WavrSyncProfileInput) {
    if (!this.hasFeature('profiles')) return;
    this.send({ type: 'publishProfile', profile });
  }

  requestProfile(userId: string) {
    if (!userId || !this.hasFeature('profiles')) return;
    this.send({ type: 'getProfile', userId });
  }

  setFriend(userId: string, action: 'request' | 'accept' | 'decline' | 'remove') {
    if (!userId || !this.hasFeature('profiles')) return;
    this.send({ type: 'friend', action, userId });
  }

  inviteToRoom(userId: string) {
    if (!userId || !this.hasFeature('roomInvites')) return;
    this.send({ type: 'inviteToRoom', userId });
  }

  acceptRoomInvite(inviteId: string) {
    const invite = this.state.roomInvites.find((entry) => entry.id === inviteId);
    if (!invite) return;
    this.state = {
      ...this.state,
      roomInvites: this.state.roomInvites.filter((entry) => entry.id !== inviteId),
    };
    this.emit();
    this.send({ type: 'roomInviteResponse', inviteId, accepted: true });
    this.joinRoom(invite.code, this.state.serverUrl, this.state.displayName, this.state.avatar);
  }

  declineRoomInvite(inviteId: string) {
    const invite = this.state.roomInvites.find((entry) => entry.id === inviteId);
    if (!invite) return;
    this.state = {
      ...this.state,
      roomInvites: this.state.roomInvites.filter((entry) => entry.id !== inviteId),
    };
    this.emit();
    this.send({ type: 'roomInviteResponse', inviteId, accepted: false });
  }

  searchProfiles(query: string) {
    if (!this.hasFeature('profileSearch')) return;
    this.send({ type: 'searchProfiles', query });
  }

  clearProfileSearch() {
    if (this.state.profileSearch.length === 0) return;
    this.state = { ...this.state, profileSearch: [] };
    this.emit();
  }

  transferHost(userId: string) {
    this.send({ type: 'transferHost', userId });
  }

  kick(userId: string) {
    this.send({ type: 'kick', userId });
  }

  sendQueue(queue: Track[], currentIndex: number) {
    if (!this.canControl()) return;
    this.send({ type: 'setQueue', queue, currentIndex });
  }

  sendPlayback(status: WavrSyncPlaybackStatus, position: number, currentIndex: number) {
    if (!this.canControl()) return;
    this.send({ type: 'playback', status, position, currentIndex });
  }

  canControl(): boolean {
    const room = this.state.room;
    if (!room || this.state.connection !== 'connected') return false;
    return room.controlMode === 'everyone' || room.hostId === this.state.userId;
  }

  isHost(): boolean {
    return !!this.state.room && this.state.room.hostId === this.state.userId;
  }

  clearError() {
    if (!this.state.error) return;
    this.state = { ...this.state, error: '' };
    this.emit();
  }

  private openSocket() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    const url = this.state.serverUrl;
    if (!url) return;
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.send({
          type: 'hello',
          userId: this.state.userId,
          name: this.state.displayName,
          avatar: this.state.avatar,
          token: wavrSyncAccount.getSessionForServer(this.state.serverUrl)?.token,
        });
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        this.handleMessage(event.data);
      };
      socket.onerror = () => {
        if (this.socket !== socket) return;
        this.state = { ...this.state, error: 'Could not reach the WavrSync server.' };
        this.emit();
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.stopHeartbeat();
        if (this.manualClose) {
          this.state = { ...this.state, connection: 'disconnected' };
          this.emit();
          return;
        }
        this.state = { ...this.state, connection: 'reconnecting' };
        this.emit();
        this.scheduleReconnect();
      };
    } catch (error: any) {
      this.state = {
        ...this.state,
        connection: 'disconnected',
        error: error?.message || 'Could not open the WavrSync connection.',
      };
      this.emit();
    }
  }

  private scheduleReconnect() {
    if (this.manualClose || this.reconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      if (this.manualClose) return;
      this.state = { ...this.state, connection: 'connecting' };
      this.emit();
      this.openSocket();
    }, delay);
  }

  private handleMessage(raw: unknown) {
    let message: WavrSyncServerMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'welcome') {
      if (
        message.protocolVersion < 1 ||
        message.protocolVersion > WAVRSYNC_PROTOCOL_VERSION
      ) {
        this.setError('WavrSync server protocol version is not supported.');
        return;
      }
      const features = Array.isArray(message.features) ? message.features : [];
      if (
        message.authenticated === false &&
        features.includes('accounts') &&
        wavrSyncAccount.getSessionForServer(this.state.serverUrl)
      ) {
        void wavrSyncAccount.logout(this.state.serverUrl);
      }
      this.state = {
        ...this.state,
        connection: 'connected',
        userId: message.userId || this.state.userId,
        clockOffset: Number(message.serverTime) - Date.now(),
        features,
        error: '',
      };
      this.reconnectAttempt = 0;
      try {
        localStorage.setItem(USER_STORAGE_KEY, this.state.userId);
      } catch {
        /* ignore */
      }
      this.emit();
      this.send({ type: 'listRooms' });
      if (message.authenticated) this.send({ type: 'remoteReady' });
      if (this.joinedCode) this.send({ type: 'join', code: this.joinedCode, avatar: this.state.avatar });
      this.startHeartbeat();
      return;
    }
    if (message.type === 'room') {
      this.state = {
        ...this.state,
        connection: 'connected',
        room: message.room,
        error: '',
      };
      this.joinedCode = message.room.code;
      this.emit();
      return;
    }
    if (message.type === 'left') {
      this.state = { ...this.state, room: null };
      this.joinedCode = '';
      this.emit();
      return;
    }
    if (message.type === 'rooms') {
      this.state = { ...this.state, rooms: message.rooms || [] };
      this.emit();
      return;
    }
    if (message.type === 'profile') {
      const profile = message.profile;
      if (!profile?.id) return;
      this.state = {
        ...this.state,
        profiles: {
          ...this.state.profiles,
          [profile.id]: profile,
        },
      };
      this.emit();
      return;
    }
    if (message.type === 'profileSearch') {
      this.state = {
        ...this.state,
        profileSearch: Array.isArray(message.profiles) ? message.profiles : [],
      };
      this.emit();
      return;
    }
    if (message.type === 'roomInvite') {
      const invite = message.invite;
      if (!invite?.id || invite.expiresAt <= Date.now()) return;
      if (this.state.roomInvites.some((entry) => entry.id === invite.id)) return;
      this.state = {
        ...this.state,
        roomInvites: [...this.state.roomInvites, invite],
      };
      this.emit();
      return;
    }
    if (message.type === 'roomInviteSent') {
      return;
    }
    if (message.type === 'roomInviteResponse') {
      return;
    }
    if (message.type === 'pong') {
      this.state = {
        ...this.state,
        clockOffset: Number(message.serverTime) - Date.now(),
      };
      return;
    }
    if (message.type === 'remoteCommand') {
      const command = {
        command: message.command,
        volume: message.volume,
        muted: message.muted,
      } satisfies WavrRemoteCommand;
      for (const listener of this.remoteListeners) listener(command);
      return;
    }
    if (message.type === 'kicked') {
      this.state = {
        ...this.state,
        room: null,
        error: message.reason || 'You left the WavrSync room.',
      };
      this.joinedCode = '';
      this.emit();
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'room_not_found') {
        this.joinedCode = '';
        this.state = { ...this.state, room: null };
      }
      this.setError(message.message || 'The WavrSync server rejected that request.');
    }
  }

  private setError(message: string) {
    this.state = { ...this.state, error: message };
    this.emit();
  }

  private send(message: WavrSyncClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      /* socket will reconnect */
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;
  }

  private clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
  }

  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const wavrSync = new WavrSyncService();
