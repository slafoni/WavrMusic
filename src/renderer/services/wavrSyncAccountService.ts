import type {
  AppSettings,
  WavrSyncAccountConfig,
  WavrSyncAccountSession,
  WavrSyncEncryptedSettings,
} from '../../../shared/models';
import { normalizeWavrSyncServerUrl } from '../../../shared/wavrsync';

const SESSION_KEY = 'wavr.wavrsync.account.session.v1';
const CRYPTO_KEY = 'wavr.wavrsync.account.key.v1';
const ITERATIONS = 180000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface StoredCryptoKey {
  serverUrl: string;
  accountId: string;
  salt: string;
  key: string;
}

type Listener = () => void;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is optional */
  }
}

export function wavrSyncHttpBase(serverUrl: string): string {
  const normalized = normalizeWavrSyncServerUrl(serverUrl);
  return normalized.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/+$/, '');
}

async function request<T>(
  serverUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${wavrSyncHttpBase(serverUrl)}${path}`, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(String(payload?.error || `WavrSync account request failed (${response.status}).`));
    }
    return payload as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function deriveKey(password: string, saltBase64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltBase64),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function importKey(rawBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(rawBase64),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function exportKey(key: CryptoKey): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

async function encryptSettings(
  settings: AppSettings,
  key: CryptoKey,
  salt: string,
  version: number,
): Promise<WavrSyncEncryptedSettings> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(settings)),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
    salt,
    iv: bytesToBase64(iv),
    version,
  };
}

async function decryptSettings(
  encrypted: WavrSyncEncryptedSettings,
  key: CryptoKey,
): Promise<AppSettings> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
    key,
    base64ToBytes(encrypted.ciphertext),
  );
  const parsed = JSON.parse(decoder.decode(plain));
  if (!parsed || typeof parsed !== 'object') throw new Error('The synced settings backup is invalid.');
  return parsed as AppSettings;
}

class WavrSyncAccountService {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  getSession(): WavrSyncAccountSession | null {
    const session = readJson<WavrSyncAccountSession>(SESSION_KEY);
    return session?.token && session?.account?.id ? session : null;
  }

  getSessionForServer(serverUrl: string): WavrSyncAccountSession | null {
    const session = this.getSession();
    if (!session) return null;
    return session.serverUrl === normalizeWavrSyncServerUrl(serverUrl) ? session : null;
  }

  hasSessionForServer(serverUrl: string): boolean {
    return !!this.getSessionForServer(serverUrl);
  }

  private getStoredKey(serverUrl: string, accountId: string): StoredCryptoKey | null {
    const stored = readJson<StoredCryptoKey>(CRYPTO_KEY);
    if (!stored?.key || !stored.salt) return null;
    if (stored.serverUrl !== normalizeWavrSyncServerUrl(serverUrl)) return null;
    if (stored.accountId !== accountId) return null;
    return stored;
  }

  private saveSession(session: WavrSyncAccountSession, key: StoredCryptoKey) {
    writeJson(SESSION_KEY, session);
    writeJson(CRYPTO_KEY, key);
    this.emit();
  }

  async config(serverUrl: string): Promise<WavrSyncAccountConfig> {
    return request<WavrSyncAccountConfig>(serverUrl, '/api/account/config');
  }

  async register(
    serverUrl: string,
    username: string,
    password: string,
    inviteCode: string,
    localSettings: AppSettings,
  ): Promise<WavrSyncAccountSession> {
    const normalized = normalizeWavrSyncServerUrl(serverUrl);
    const payload = await request<{
      account: WavrSyncAccountSession['account'];
      token: string;
      settings: WavrSyncEncryptedSettings | null;
    }>(normalized, '/api/account/register', {
      method: 'POST',
      body: {
        username,
        password,
        inviteCode: inviteCode.trim() || undefined,
      },
    });
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await deriveKey(password, salt);
    const encrypted = await encryptSettings(localSettings, key, salt, 1);
    await request(normalized, '/api/account/settings', {
      method: 'PUT',
      token: payload.token,
      body: encrypted,
    });
    const session: WavrSyncAccountSession = {
      serverUrl: normalized,
      token: payload.token,
      account: payload.account,
    };
    this.saveSession(session, {
      serverUrl: normalized,
      accountId: payload.account.id,
      salt,
      key: await exportKey(key),
    });
    return session;
  }

  async login(
    serverUrl: string,
    username: string,
    password: string,
    localSettings: AppSettings,
  ): Promise<{ session: WavrSyncAccountSession; importedSettings: AppSettings | null }> {
    const normalized = normalizeWavrSyncServerUrl(serverUrl);
    const payload = await request<{
      account: WavrSyncAccountSession['account'];
      token: string;
      settings: WavrSyncEncryptedSettings | null;
    }>(normalized, '/api/account/login', {
      method: 'POST',
      body: { username, password },
    });
    let importedSettings: AppSettings | null = null;
    let salt = payload.settings?.salt || '';
    let key: CryptoKey;
    if (payload.settings) {
      key = await deriveKey(password, payload.settings.salt);
      importedSettings = await decryptSettings(payload.settings, key);
    } else {
      salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
      key = await deriveKey(password, salt);
      const encrypted = await encryptSettings(
        localSettings,
        key,
        salt,
        Math.max(1, (payload.account.settingsVersion || 0) + 1),
      );
      await request(normalized, '/api/account/settings', {
        method: 'PUT',
        token: payload.token,
        body: encrypted,
      });
    }
    const session: WavrSyncAccountSession = {
      serverUrl: normalized,
      token: payload.token,
      account: payload.account,
    };
    this.saveSession(session, {
      serverUrl: normalized,
      accountId: payload.account.id,
      salt,
      key: await exportKey(key),
    });
    return { session, importedSettings };
  }

  async changeUsername(serverUrl: string, username: string): Promise<WavrSyncAccountSession> {
    const session = this.getSessionForServer(serverUrl);
    if (!session) throw new Error('Sign in to WavrSync first.');
    const payload = await request<{
      account: WavrSyncAccountSession['account'];
      profile: unknown;
    }>(session.serverUrl, '/api/account/username', {
      method: 'PUT',
      token: session.token,
      body: { username },
    });
    const next: WavrSyncAccountSession = {
      ...session,
      account: payload.account,
    };
    writeJson(SESSION_KEY, next);
    this.emit();
    return next;
  }

  syncUsernameFromProfile(serverUrl: string, profile: { id: string; name: string } | null): boolean {
    const session = this.getSessionForServer(serverUrl);
    if (!session || !profile?.id || profile.id !== session.account.id || !profile.name) return false;
    if (profile.name === session.account.username) return false;
    const next: WavrSyncAccountSession = {
      ...session,
      account: { ...session.account, username: profile.name },
    };
    writeJson(SESSION_KEY, next);
    this.emit();
    return true;
  }

  async uploadSettings(serverUrl: string, settings: AppSettings): Promise<boolean> {
    const session = this.getSessionForServer(serverUrl);
    if (!session) return false;
    const stored = this.getStoredKey(serverUrl, session.account.id);
    if (!stored) return false;
    const key = await importKey(stored.key);
    const encrypted = await encryptSettings(
      settings,
      key,
      stored.salt,
      Math.max(1, (session.account.settingsVersion || 0) + 1),
    );
    const result = await request<{ settings: WavrSyncEncryptedSettings }>(
      session.serverUrl,
      '/api/account/settings',
      { method: 'PUT', token: session.token, body: encrypted },
    );
    const next: WavrSyncAccountSession = {
      ...session,
      account: {
        ...session.account,
        settingsVersion: result.settings.version,
        settingsUpdatedAt: result.settings.updatedAt || Date.now(),
      },
    };
    writeJson(SESSION_KEY, next);
    this.emit();
    return true;
  }

  async downloadSettings(serverUrl: string, password = ''): Promise<AppSettings | null> {
    const session = this.getSessionForServer(serverUrl);
    if (!session) throw new Error('Sign in to WavrSync first.');
    const payload = await request<{ settings: WavrSyncEncryptedSettings | null }>(
      session.serverUrl,
      '/api/account/me',
      { token: session.token },
    );
    if (!payload.settings) return null;
    const stored = this.getStoredKey(serverUrl, session.account.id);
    const key = password
      ? await deriveKey(password, payload.settings.salt)
      : stored
        ? await importKey(stored.key)
        : null;
    if (!key) throw new Error('The local settings key is unavailable. Sign in again.');
    return decryptSettings(payload.settings, key);
  }

  async restoreForBoot(serverUrl: string): Promise<AppSettings | null> {
    const session = this.getSessionForServer(serverUrl);
    if (!session) return null;
    try {
      return await this.downloadSettings(serverUrl);
    } catch {
      return null;
    }
  }

  async logout(serverUrl?: string): Promise<void> {
    const session = serverUrl ? this.getSessionForServer(serverUrl) : this.getSession();
    writeJson(SESSION_KEY, null);
    writeJson(CRYPTO_KEY, null);
    this.emit();
    if (!session) return;
    void request(session.serverUrl, '/api/account/logout', {
      method: 'POST',
      token: session.token,
    }).catch(() => {
      /* local logout already completed */
    });
  }
}

export const wavrSyncAccount = new WavrSyncAccountService();




