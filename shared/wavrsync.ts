import type {
  WavrSyncControlMode,
  WavrSyncPlayback,
  WavrSyncPlaybackStatus,
  WavrSyncProfile,
  WavrSyncProfileInput,
  WavrSyncProfileSummary,
  WavrSyncRoom,
  WavrSyncRoomInvite,
  WavrSyncRoomSummary,
  WavrSyncVisibility,
  Track,
} from './models';

export const WAVRSYNC_PROTOCOL_VERSION = 2;
export const WAVRSYNC_DEFAULT_SERVER_URL = 'wss://sync.listenwavr.xyz';
export const WAVRSYNC_MAX_QUEUE = 500;
export const WAVRSYNC_DRIFT_LIMIT_SECONDS = 12;

export interface WavrRemotePlayback {
  status: WavrSyncPlaybackStatus;
  track: {
    id: string;
    title: string;
    artist: string;
    album: string;
    coverArt: string;
  } | null;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
}

export interface WavrRemoteCommand {
  command: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'volume' | 'mute';
  volume?: number;
  muted?: boolean;
}

export type WavrSyncClientMessage =
  | { type: 'hello'; userId?: string; name: string; avatar?: string; token?: string }
  | {
      type: 'create';
      name: string;
      controlMode: WavrSyncControlMode;
      visibility: WavrSyncVisibility;
      libraryUrl?: string;
      libraryName?: string;
      avatar?: string;
    }
  | { type: 'join'; code: string; avatar?: string }
  | { type: 'leave' }
  | { type: 'publishProfile'; profile: WavrSyncProfileInput }
  | { type: 'getProfile'; userId: string }
  | { type: 'friend'; action: 'request' | 'accept' | 'decline' | 'remove'; userId: string }
  | { type: 'searchProfiles'; query: string }
  | { type: 'inviteToRoom'; userId: string }
  | { type: 'roomInviteResponse'; inviteId: string; accepted: boolean }
  | { type: 'setQueue'; queue: Track[]; currentIndex: number }
  | {
      type: 'playback';
      status: WavrSyncPlayback['status'];
      position: number;
      currentIndex: number;
    }
  | { type: 'controlMode'; controlMode: WavrSyncControlMode }
  | { type: 'visibility'; visibility: WavrSyncVisibility }
  | { type: 'transferHost'; userId: string }
  | { type: 'kick'; userId: string }
  | { type: 'listRooms' }
  | { type: 'remoteReady' }
  | { type: 'remoteState'; playback: WavrRemotePlayback }
  | { type: 'ping' };

export type WavrSyncServerMessage =
  | {
      type: 'welcome';
      userId: string;
      accountId?: string;
      authenticated?: boolean;
      protocolVersion: number;
      serverTime: number;
      features?: string[];
    }
  | { type: 'room'; room: WavrSyncRoom }
  | { type: 'left' }
  | { type: 'rooms'; rooms: WavrSyncRoomSummary[] }
  | { type: 'profile'; profile: WavrSyncProfile }
  | { type: 'profileSearch'; profiles: WavrSyncProfileSummary[] }
  | { type: 'roomInvite'; invite: WavrSyncRoomInvite }
  | { type: 'roomInviteSent'; invite: WavrSyncRoomInvite }
  | { type: 'roomInviteResponse'; inviteId: string; accepted: boolean; byName: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; serverTime: number }
  | { type: 'remoteReady'; serverTime: number }
  | ({ type: 'remoteCommand' } & WavrRemoteCommand)
  | { type: 'kicked'; code: string; reason: string };

export function normalizeWavrSyncServerUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return WAVRSYNC_DEFAULT_SERVER_URL;
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `ws://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return WAVRSYNC_DEFAULT_SERVER_URL;
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return WAVRSYNC_DEFAULT_SERVER_URL;
  }
}

export function parseWavrSyncInviteCode(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-z0-9]{4,12}$/i.test(raw)) return raw.toUpperCase();
  try {
    const url = new URL(raw);
    let parts: string[] = [];
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'wavr:' && (host === 'wavrsync' || host === 'pulse')) {
      parts = url.pathname.split('/').filter(Boolean);
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      parts = url.pathname.split('/').filter(Boolean);
    }
    const joinIndex = parts.findIndex((part) => part.toLowerCase() === 'join');
    if (joinIndex >= 0) parts = parts.slice(joinIndex + 1);
    else parts = [];
    const code = parts[0] || '';
    return /^[a-z0-9]{4,12}$/i.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function wavrSyncExpectedPosition(
  playback: WavrSyncPlayback,
  now = Date.now(),
  clockOffset = 0,
): number {
  const base = Math.max(0, Number(playback.position) || 0);
  if (playback.status !== 'playing') return base;
  const elapsed = Math.max(0, (now + clockOffset - playback.updatedAt) / 1000);
  return base + elapsed;
}

export function wavrSyncQueueKey(queue: Track[], currentIndex: number): string {
  return `${queue.map((track) => track.id).join('|')}::${currentIndex}`;
}

