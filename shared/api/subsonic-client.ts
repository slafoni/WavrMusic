export interface SubsonicClientOptions {
  url: string;
  username: string;
  password?: string;
  token?: string;
  clientName?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface ServerCapabilities {
  version: string | null;
  openSubsonic: boolean;
  supportsLyrics: boolean;
  supportsStarred: boolean;
  supportsPlayQueue: boolean;
  supportsGenres: boolean;
  supportsInternetRadio: boolean;
  supportsTopSongs: boolean;
  operations: Record<string, boolean>;
}

class AbortTimeoutError extends Error {
  constructor() {
    super('Request timed out. The server took too long to respond.');
    this.name = 'AbortTimeoutError';
  }
}

function normalizeUrl(url: string): string {
  let value = url.trim();
  if (!value) return value;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, '');
  return value;
}

function buildRestUrl(baseUrl: string, operation: string): string {
  return `${normalizeUrl(baseUrl)}/rest/${operation}.view`;
}

function randomSalt(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

function buildAuthParams(options: SubsonicClientOptions): Record<string, string> {
  const params: Record<string, string> = {
    u: options.username,
    v: options.apiVersion || '1.16.1',
    c: options.clientName || 'wavr',
    f: 'json',
  };

  if (options.token) {
    params['t'] = options.token;
  } else if (options.password !== undefined) {
    const salt = randomSalt();
    params['s'] = salt;
    params['t'] = md5Hex((options.password || '') + salt);
  }

  return params;
}

function responsePayload(data: any): any {
  if (!data || typeof data !== 'object') return null;
  return data['subsonic-response'] ?? data.subsonic_response ?? null;
}

const ERROR_MESSAGES: Record<number, string> = {
  0: 'The server reported a generic error.',
  10: 'A required parameter is missing.',
  20: 'The client API version is too old for this server.',
  30: 'The server API version is too old for this client.',
  40: 'Wrong username or password.',
  41: 'Token authentication is not supported by this server.',
  50: 'You are not authorised to perform this action.',
  60: 'The server trial period has expired.',
  70: 'The requested item was not found.',
};

function extractError(payload: any): Error {
  const subsonicError = payload?.error;
  const code = Number(subsonicError?.code);
  const message =
    ERROR_MESSAGES[code] ||
    subsonicError?.message ||
    'The server could not complete the request.';
  const error = new Error(message);
  (error as any).code = code;
  (error as any).status = payload?.status;
  return error;
}

function parseJsonSafe(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type ExtraParamValue = string | number | boolean | string[] | number[] | undefined | null;

function toSearchParams(params: Record<string, ExtraParamValue>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(key, String(item));
    } else {
      searchParams.set(key, String(value));
    }
  }
  return searchParams;
}

function compareVersion(a: string | null, b: string): boolean {
  if (!a) return false;
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

export type AlbumListType =
  | 'alphabetical'
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'byYear'
  | 'random'
  | 'newest'
  | 'recent'
  | 'frequent'
  | 'highest'
  | 'starred'
  | 'byGenre';

export class SubsonicClient {
  public url: string;
  public username: string;
  public password?: string;
  public token?: string;
  public clientName: string;
  public apiVersion: string;
  public timeoutMs: number;
  private serverVersion: string | null = null;
  private capabilities: ServerCapabilities | null = null;
  private capabilityProbed = false;

  constructor(options: SubsonicClientOptions) {
    this.url = normalizeUrl(options.url);
    this.username = options.username;
    this.password = options.password;
    this.token = options.token;
    this.clientName = options.clientName || 'wavr';
    this.apiVersion = options.apiVersion || '1.16.1';
    this.timeoutMs = options.timeoutMs || 15000;
  }

  getServerVersion(): string | null {
    return this.serverVersion;
  }

  getCapabilities(): ServerCapabilities | null {
    return this.capabilities;
  }

  isCapabilityProbed(): boolean {
    return this.capabilityProbed;
  }

  private async request<T = any>(
    operation: string,
    extraParams: Record<string, ExtraParamValue> = {},
    options: { method?: 'GET' | 'POST'; timeoutMs?: number } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const auth = buildAuthParams(this);
    const searchParams = toSearchParams(auth);
    const extra = toSearchParams(extraParams);
    for (const [key, value] of extra.entries()) searchParams.append(key, value);

    const method = options.method ?? 'GET';
    const url = buildRestUrl(this.url, operation);

    let response: Response;
    try {
      if (method === 'POST') {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: searchParams.toString(),
          signal: controller.signal,
        });
      } else {
        response = await fetch(`${url}?${searchParams.toString()}`, {
          signal: controller.signal,
        });
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new AbortTimeoutError();
      const message = String(error?.message || error);
      if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
        throw new Error('DNS failure: unable to resolve the server host.');
      }
      if (/ECONNREFUSED/i.test(message)) {
        throw new Error('Connection refused: the server is not accepting connections.');
      }
      if (/certificate|CERT|SSL|TLS/i.test(message)) {
        throw new Error('TLS error: the server certificate could not be verified.');
      }
      if (/Failed to fetch|NetworkError/i.test(message)) {
        throw new Error(
          'Network error: unable to reach the server. Check the URL and your connection.',
        );
      }
      throw new Error(`Network error: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const error = new Error(`Server returned HTTP ${response.status} ${response.statusText}`);
      (error as any).code = response.status;
      (error as any).status = 'http-error';
      throw error;
    }

    const text = await response.text();
    const data = parseJsonSafe(text);
    const payload = responsePayload(data);

    if (!payload) {
      throw new Error('Invalid response from server. Is this a Subsonic-compatible API?');
    }

    if (payload.status === 'failed') {
      throw extractError(payload);
    }

    return payload as T;
  }

  async probeCapabilities(force = false): Promise<ServerCapabilities> {
    if (this.capabilityProbed && !force && this.capabilities) {
      return this.capabilities;
    }

    const ping = await this.request<{ version?: string; openSubsonic?: boolean }>(
      'ping',
      {},
      { timeoutMs: 10000 },
    );

    const version = ping.version || null;
    this.serverVersion = version;

    let openSubsonic = !!ping.openSubsonic;
    let extensionNames: string[] = [];
    try {
      const response = await this.request<any>(
        'getOpenSubsonicExtensions',
        {},
        { timeoutMs: 8000 },
      );
      const extensions = response?.extensions?.extension ?? response?.extensions ?? [];
      extensionNames = Array.isArray(extensions)
        ? extensions.map((entry: any) => (typeof entry === 'string' ? entry : entry?.name || ''))
        : [];
      if (extensionNames.length > 0) openSubsonic = true;
    } catch {
      /* OpenSubsonic extensions are optional. */
    }

    const operations: Record<string, boolean> = {
      ping: true,
      getLicense: true,
      getUser: true,
      getMusicFolders: true,
      getIndexes: true,
      getArtists: compareVersion(version, '1.8.0'),
      getArtist: compareVersion(version, '1.8.0'),
      getArtistInfo2: compareVersion(version, '1.11.0'),
      getAlbum: compareVersion(version, '1.8.0'),
      getAlbumList2: compareVersion(version, '1.8.0'),
      getSong: compareVersion(version, '1.8.0'),
      getGenres: compareVersion(version, '1.9.0'),
      getMusicDirectory: true,
      getStarred2: compareVersion(version, '1.8.0'),
      getRandomSongs: true,
      getSongsByGenre: compareVersion(version, '1.9.0'),
      getNowPlaying: compareVersion(version, '1.0.0'),
      search3: compareVersion(version, '1.8.0'),
      getPlaylists: true,
      getPlaylist: true,
      createPlaylist: true,
      updatePlaylist: true,
      deletePlaylist: true,
      createShare: true,
      star: true,
      unstar: true,
      setRating: true,
      scrobble: compareVersion(version, '1.5.0'),
      getLyrics: compareVersion(version, '1.2.0'),
      getLyricsBySongId: extensionNames.includes('songLyrics'),
      getPlayQueue: compareVersion(version, '1.12.0'),
      savePlayQueue: compareVersion(version, '1.12.0'),
      getTopSongs: compareVersion(version, '1.13.0'),
      getCoverArt: true,
      stream: true,
    };

    const capabilities: ServerCapabilities = {
      version,
      openSubsonic,
      supportsLyrics: !!(operations['getLyrics'] || operations['getLyricsBySongId']),
      supportsStarred: !!operations['getStarred2'],
      supportsPlayQueue: !!(operations['getPlayQueue'] || operations['savePlayQueue']),
      supportsGenres: !!operations['getGenres'],
      supportsInternetRadio: openSubsonic,
      supportsTopSongs: !!operations['getTopSongs'],
      operations,
    };

    this.capabilities = capabilities;
    this.capabilityProbed = true;
    return capabilities;
  }

  getServerInfo() {
    return {
      url: this.url,
      username: this.username,
      clientName: this.clientName,
      apiVersion: this.apiVersion,
      version: this.serverVersion,
      capabilities: this.capabilities,
    };
  }

  async ping() {
    return this.request('ping');
  }

  async getLicense() {
    return this.request('getLicense');
  }

  async getOpenSubsonicExtensions() {
    return this.request('getOpenSubsonicExtensions');
  }

  async getUser() {
    return this.request('getUser');
  }

  async getMusicFolders() {
    return this.request('getMusicFolders');
  }

  async getIndexes() {
    return this.request('getIndexes');
  }

  async getArtists() {
    return this.request('getArtists');
  }

  async getArtist(params: { id: string }) {
    return this.request('getArtist', params);
  }

  async getArtistInfo2(params: { id: string; count?: number; includeNotPresent?: boolean }) {
    return this.request('getArtistInfo2', params);
  }

  async getAlbum(params: { id: string }) {
    return this.request('getAlbum', params);
  }

  async getAlbumList2(
    params: {
      type?: AlbumListType;
      size?: number;
      offset?: number;
      fromYear?: number;
      toYear?: number;
      genre?: string;
    } = {},
  ) {
    return this.request('getAlbumList2', params as Record<string, ExtraParamValue>);
  }

  async getSong(params: { id: string }) {
    return this.request('getSong', params);
  }

  async getGenres() {
    return this.request('getGenres');
  }

  async getMusicDirectory(params: { id: string }) {
    return this.request('getMusicDirectory', params);
  }

  async getStarred2() {
    return this.request('getStarred2');
  }

  async getRandomSongs(
    params: { size?: number; genre?: string; fromYear?: number; toYear?: number } = {},
  ) {
    return this.request('getRandomSongs', params as Record<string, ExtraParamValue>);
  }

  async getSongsByGenre(params: { genre: string; count?: number; offset?: number }) {
    return this.request('getSongsByGenre', params);
  }

  async getNowPlaying() {
    return this.request('getNowPlaying');
  }

  async getTopSongs(params: { artist: string; count?: number }) {
    return this.request('getTopSongs', params);
  }

  async search3(
    params: {
      query: string;
      artistCount?: number;
      albumCount?: number;
      songCount?: number;
      playlistCount?: number;
    } = { query: '' },
  ) {
    return this.request('search3', params);
  }

  async getPlaylists() {
    return this.request('getPlaylists');
  }

  async getPlaylist(params: { id: string }) {
    return this.request('getPlaylist', params);
  }

  async createPlaylist(params: { name: string; songId?: string[] }) {
    return this.request('createPlaylist', params as Record<string, ExtraParamValue>);
  }

  async updatePlaylist(params: {
    playlistId: string;
    name?: string;
    comment?: string;
    public?: boolean;
    songIdToAdd?: string[];
    songIndexToRemove?: number[];
  }) {
    return this.request('updatePlaylist', params as Record<string, ExtraParamValue>);
  }

  async deletePlaylist(params: { id: string }) {
    return this.request('deletePlaylist', params);
  }

  async createShare(params: { id: string[]; description?: string; expires?: number }) {
    return this.request('createShare', params as Record<string, ExtraParamValue>);
  }

  async star(params: { id?: string; albumId?: string; artistId?: string }) {
    return this.request('star', params);
  }

  async unstar(params: { id?: string; albumId?: string; artistId?: string }) {
    return this.request('unstar', params);
  }

  async setRating(params: { id: string; rating: number }) {
    return this.request('setRating', params);
  }

  async getLyrics(params: { artist?: string; title?: string }) {
    return this.request('getLyrics', params);
  }

  async getLyricsBySongId(params: { id: string }) {
    return this.request('getLyricsBySongId', params);
  }

  async scrobble(params: { id: string; time?: number; submission?: boolean }) {
    return this.request('scrobble', params as Record<string, ExtraParamValue>);
  }

  async getPlayQueue() {
    return this.request('getPlayQueue');
  }

  async savePlayQueue(params: {
    id?: string[];
    current?: string;
    position?: number;
  }) {
    return this.request('savePlayQueue', params as Record<string, ExtraParamValue>);
  }
}

export function normalizeServerUrl(url: string): string {
  return normalizeUrl(url);
}

export function isSecure(url: string): boolean {
  return /^https:\/\//i.test(normalizeUrl(url));
}

export function buildStreamUrl(
  options: SubsonicClientOptions,
  songId: string,
  maxBitRate?: number,
  format?: string,
): string {
  const params = buildAuthParams(options);
  const searchParams = toSearchParams(params);
  searchParams.set('id', songId);
  if (maxBitRate) searchParams.set('maxBitRate', String(maxBitRate));
  if (format && format !== 'raw') searchParams.set('format', format);
  return `${normalizeUrl(options.url)}/rest/stream.view?${searchParams.toString()}`;
}

export function buildCoverArtUrl(
  options: SubsonicClientOptions,
  id: string,
  size?: number,
): string {
  const params = buildAuthParams(options);
  const searchParams = toSearchParams(params);
  searchParams.set('id', id);
  if (size) searchParams.set('size', String(size));
  return `${normalizeUrl(options.url)}/rest/getCoverArt.view?${searchParams.toString()}`;
}

/* MD5 (RFC 1321) implemented with typed arrays so it works in the
   renderer and in Node without any external dependency. */
function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function md5Hex(input: string): string {
  const message = utf8Bytes(input);
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message);
  buffer[message.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

  const shift = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      f = (f + a + k[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      const s = shift[i];
      b = (b + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);

  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export { buildAuthParams, md5Hex as _md5HexForTests };

