import { useEffect } from 'react';
import { useSettings } from '../state';
import { useWavrSyncAccount } from './useWavrSyncAccount';
import { wavrSyncAccount } from '../services/wavrSyncAccountService';
import { normalizeWavrSyncServerUrl } from '../../../shared/wavrsync';
import { pushToast } from '../services/toastService';

export function useWavrSyncSettingsSync(serverUrl: string, active: boolean) {
  const settings = useSettings();
  const session = useWavrSyncAccount(serverUrl);

  useEffect(() => {
    if (!active || !session || settings.wavrSyncSettingsSync === false) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      wavrSyncAccount
        .uploadSettings(normalizeWavrSyncServerUrl(serverUrl), settings)
        .catch((reason: any) => {
          if (!cancelled && reason?.message) {
            pushToast(`Could not sync settings: ${reason.message}`, 'error');
          }
        });
    }, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, session?.token, serverUrl, settings]);
}
