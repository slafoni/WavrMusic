import { useEffect } from 'react';
import { APP_VERSION, WAVRSYNC_DEFAULT_SERVER_URL } from '../../../shared/constants';
import { useSettings } from '../state';
import { wavrSyncHttpBase } from '../services/wavrSyncAccountService';

const INSTANCE_KEY = 'wavr.usage.instance.v1';
const HEARTBEAT_MS = 60 * 1000;

function usageInstanceId(): string {
  try {
    const existing = localStorage.getItem(INSTANCE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(INSTANCE_KEY, id);
    return id;
  } catch {
    return `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function reportUsage(serverUrl: string) {
  const base = wavrSyncHttpBase(serverUrl || WAVRSYNC_DEFAULT_SERVER_URL);
  const platform = (window as any).electronAPI?.platform || '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(`${base}/api/usage/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: usageInstanceId(),
        version: APP_VERSION,
        platform,
      }),
      cache: 'no-store',
      keepalive: true,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function useUsageHeartbeat() {
  const settings = useSettings();
  const serverUrl = settings.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
  const enabled = settings.usageHeartbeatEnabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      reportUsage(serverUrl).catch(() => {
        /* usage reporting is best effort */
      });
    };
    send();
    const timer = window.setInterval(send, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') send();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, serverUrl]);
}
