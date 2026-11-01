import { Client, StatusDisplayType } from '@xhayper/discord-rpc';
import { ActivityType } from 'discord-api-types/v10';
import { LASTFM_API_KEY, LASTFM_API_URL } from '../../shared/constants';

export interface DiscordWavrSyncActivity {
  roomCode: string;
  roomName: string;
  inviteUrl: string;
  participants: number;
  visibility: 'private' | 'public';
}

export type DiscordPlaybackStatus = 'playing' | 'buffering' | 'paused' | 'loading';

export interface DiscordActivityPayload {
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  playbackStatus?: DiscordPlaybackStatus;
  currentTime: number;
  duration: number;
  updatedAt?: number;
  artworkUrl?: string;
  artworkFetchUrl?: string;
  wavrSync?: DiscordWavrSyncActivity;
}

export interface DiscordRpcStatus {
  state: 'disabled' | 'connecting' | 'ready' | 'error';
  message?: string;
}

let client: Client | null = null;
let clientId = '';
let enabled = false;
let ready = false;
let latest: DiscordActivityPayload | null = null;
let statusHandler: ((status: DiscordRpcStatus) => void) | null = null;
let lastConfigKey = '';
let activityRevision = 0;

const ARTWORK_UPLOAD_TTL_MS = 2.5 * 60 * 60 * 1000;
const LASTFM_ARTWORK_TTL_MS = 12 * 60 * 60 * 1000;
const artworkUploadCache = new Map<string, { url: string; at: number }>();
const artworkUploadRequests = new Map<string, Promise<string>>();
const lastFmArtworkCache = new Map<string, { url: string; at: number }>();
const lastFmArtworkRequests = new Map<string, Promise<string>>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearDiscordRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleDiscordRetry() {
  if (!enabled || !clientId || retryTimer || client) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!enabled || !clientId) return;
    void configureDiscordRpc(enabled, clientId, statusHandler || (() => {})).catch(() => {});
  }, 15000);
  retryTimer.unref?.();
}

function report(status: DiscordRpcStatus) {
  statusHandler?.(status);
}

async function destroyClient() {
  const current = client;
  client = null;
  ready = false;
  if (current) {
    try {
      await current.destroy();
    } catch {
      /* ignore shutdown failures */
    }
  }
}

export function activityFor(payload: DiscordActivityPayload) {
  const playbackStatus = payload.playbackStatus || (payload.isPlaying ? 'playing' : 'paused');
  const playing = playbackStatus === 'playing';
  const updatedAt =
    Number.isFinite(payload.updatedAt) && Number(payload.updatedAt) > 0
      ? Number(payload.updatedAt)
      : Date.now();
  const elapsed = playing ? Math.max(0, (Date.now() - updatedAt) / 1000) : 0;
  const position = Math.max(0, payload.currentTime + elapsed);
  const now = Date.now();
  const wavrSync = payload.wavrSync?.visibility === 'public' ? payload.wavrSync : null;
  return {
    type: ActivityType.Listening,
    statusDisplayType: StatusDisplayType.NAME,
    details: payload.title.slice(0, 128),
    state: payload.artist.slice(0, 128),
    ...(playing
      ? {
          startTimestamp: new Date(now - position * 1000),
          ...(payload.duration > 0
            ? { endTimestamp: new Date(now + Math.max(0, payload.duration - position) * 1000) }
            : {}),
        }
      : {}),
    ...(payload.artworkUrl
      ? {
          largeImageKey: payload.artworkUrl,
          largeImageUrl: payload.artworkUrl,
          largeImageText: (payload.album || payload.title).slice(0, 128),
        }
      : {}),
    ...(wavrSync
      ? {
          party: {
            id: `wavr-wavrsync-${wavrSync.roomCode}`,
            size: [Math.max(1, wavrSync.participants), 10] as [number, number],
          },
        }
      : {}),
    ...(wavrSync && /^https:\/\//i.test(wavrSync.inviteUrl)
      ? {
          buttons: [
            {
              label: `Join ${wavrSync.roomName}`.slice(0, 32),
              url: wavrSync.inviteUrl,
            },
          ],
        }
      : {}),
  };
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

async function fetchLastFmArtwork(payload: DiscordActivityPayload): Promise<string> {
  const artist = String(payload.artist || '').trim();
  const title = String(payload.title || '').trim();
  if (!artist || !title) return '';
  const key = `${artist.toLowerCase()}|${title.toLowerCase()}|${String(payload.album || '').toLowerCase()}`;
  const cached = lastFmArtworkCache.get(key);
  if (cached && Date.now() - cached.at < LASTFM_ARTWORK_TTL_MS) return cached.url;
  const pending = lastFmArtworkRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const query = new URLSearchParams({
        method: 'track.getInfo',
        api_key: LASTFM_API_KEY,
        artist,
        track: title,
        format: 'json',
        autocorrect: '1',
      });
      if (payload.album) query.set('album', payload.album);
      const response = await fetch(`${LASTFM_API_URL}?${query.toString()}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return '';
      const data = await response.json();
      if (data?.error) return '';
      const images = asArray(data?.track?.album?.image)
        .map((image: any) => ({
          url: String(image?.['#text'] || '').trim(),
          size: String(image?.size || '').toLowerCase(),
        }))
        .filter((image) => {
          if (!/^https:\/\//i.test(image.url)) return false;
          return !/2a96cbd8b46e442fc41c2b86b821562f|default_album/i.test(image.url);
        });
      const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
      let url = '';
      for (const size of order) {
        const match = images.find((image) => image.size === size);
        if (match) {
          url = match.url;
          break;
        }
      }
      if (!url && images.length) url = images[0].url;
      if (url) lastFmArtworkCache.set(key, { url, at: Date.now() });
      return url;
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
      lastFmArtworkRequests.delete(key);
    }
  })();

  lastFmArtworkRequests.set(key, request);
  return request;
}

async function uploadArtwork(sourceUrl: string): Promise<string> {
  if (!sourceUrl) return '';
  const cached = artworkUploadCache.get(sourceUrl);
  if (cached && Date.now() - cached.at < ARTWORK_UPLOAD_TTL_MS) return cached.url;
  const pending = artworkUploadRequests.get(sourceUrl);
  if (pending) return pending;

  const request = (async () => {
    try {
      const imageResponse = await fetch(sourceUrl, {
        headers: { accept: 'image/*' },
        cache: 'no-store',
      });
      if (!imageResponse.ok) return '';
      const contentType = String(imageResponse.headers.get('content-type') || '');
      if (!/^image\//i.test(contentType)) return '';
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      if (!buffer.length || buffer.length > 8 * 1024 * 1024) return '';
      const extension = /png/i.test(contentType)
        ? 'png'
        : /webp/i.test(contentType)
          ? 'webp'
          : /gif/i.test(contentType)
            ? 'gif'
            : 'jpg';
      const form = new FormData();
      form.append('files[]', new Blob([buffer], { type: contentType }), `cover.${extension}`);
      const uploadResponse = await fetch('https://uguu.se/upload', {
        method: 'POST',
        headers: { 'User-Agent': 'WAVR Discord RPC' },
        body: form,
      });
      if (!uploadResponse.ok) return '';
      const payload = await uploadResponse.json();
      const url = String(payload?.files?.[0]?.url || '');
      if (!url) return '';
      artworkUploadCache.set(sourceUrl, { url, at: Date.now() });
      return url;
    } catch {
      return '';
    } finally {
      artworkUploadRequests.delete(sourceUrl);
    }
  })();

  artworkUploadRequests.set(sourceUrl, request);
  return request;
}

async function publishActivity(payload: DiscordActivityPayload) {
  const revision = ++activityRevision;
  if (!client || !ready || latest !== payload) return;
  const primaryArtwork = payload.artworkUrl || '';
  try {
    await client.user?.setActivity(activityFor({ ...payload, artworkUrl: primaryArtwork || undefined }));
  } catch {
    report({ state: 'error', message: 'Discord rejected the activity.' });
    return;
  }
  if (primaryArtwork) return;
  const artworkUrl =
    (await fetchLastFmArtwork(payload)) || (await uploadArtwork(payload.artworkFetchUrl || ''));
  if (!artworkUrl || revision !== activityRevision || latest !== payload || !client || !ready) {
    return;
  }
  try {
    await client.user?.setActivity(activityFor({ ...payload, artworkUrl }));
  } catch {
    /* keep the text-only activity */
  }
}

export async function configureDiscordRpc(
  nextEnabled: boolean,
  nextClientId: string,
  onStatus: (status: DiscordRpcStatus) => void,
) {
  statusHandler = onStatus;
  const id = nextClientId.trim();
  enabled = !!nextEnabled;
  clientId = id;

  const configKey = `${enabled}|${id}`;
  if (!enabled || !id) {
    clearDiscordRetry();
    await destroyClient();
    lastConfigKey = configKey;
    report({ state: 'disabled', message: enabled ? 'Discord application ID is missing.' : undefined });
    return;
  }

  clearDiscordRetry();
  if (client) {
    if (ready && clientId === id) return;
    if (lastConfigKey === configKey) return;
  }

  lastConfigKey = configKey;
  await destroyClient();
  report({ state: 'connecting' });

  try {
    client = new Client({ clientId: id, transport: { type: 'ipc' } });
    client.on('ready', () => {
      ready = true;
      clearDiscordRetry();
      report({ state: 'ready' });
      if (latest) void publishActivity(latest);
    });
    client.on('disconnected', () => {
      ready = false;
      report({ state: 'error', message: 'Discord disconnected. Retrying...' });
      const disconnected = client;
      client = null;
      disconnected?.destroy().catch(() => {});
      scheduleDiscordRetry();
    });
    await client.login();
  } catch (reason: any) {
    ready = false;
    report({ state: 'error', message: reason?.message || 'Discord is not running.' });
    await destroyClient();
    scheduleDiscordRetry();
  }
}

export function getDiscordRpcStatus(): DiscordRpcStatus {
  if (!enabled) return { state: 'disabled' };
  if (ready) return { state: 'ready' };
  if (client) return { state: 'connecting' };
  return { state: 'error', message: 'Discord is not connected. Retrying...' };
}

export function updateDiscordActivity(payload: DiscordActivityPayload | null) {
  latest = payload;
  activityRevision += 1;
  if (!client || !ready) return;
  try {
    if (!payload) {
      client.user?.clearActivity().catch(() => {});
      return;
    }
    void publishActivity(payload);
  } catch {
    report({ state: 'error', message: 'Discord activity could not be updated.' });
  }
}

export async function shutdownDiscordRpc() {
  enabled = false;
  latest = null;
  clearDiscordRetry();
  await destroyClient();
}


