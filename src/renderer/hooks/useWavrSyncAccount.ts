import { useEffect, useState } from 'react';
import type { WavrSyncAccountSession } from '../../../shared/models';
import { normalizeWavrSyncServerUrl } from '../../../shared/wavrsync';
import { wavrSyncAccount } from '../services/wavrSyncAccountService';

export function useWavrSyncAccount(serverUrl: string): WavrSyncAccountSession | null {
  const normalized = normalizeWavrSyncServerUrl(serverUrl);
  const [session, setSession] = useState<WavrSyncAccountSession | null>(
    () => wavrSyncAccount.getSessionForServer(normalized),
  );

  useEffect(() => {
    const update = () => setSession(wavrSyncAccount.getSessionForServer(normalized));
    update();
    return wavrSyncAccount.subscribe(update);
  }, [normalized]);

  return session;
}

export function useWavrSyncAccountName(serverUrl: string, fallback = ''): string {
  return useWavrSyncAccount(serverUrl)?.account.username || fallback;
}
