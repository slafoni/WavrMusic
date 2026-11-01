import { useEffect } from 'react';
import { store, useSettings } from '../state';
import type { WavrSyncState } from '../services/wavrSyncService';
import { wavrSyncAccount } from '../services/wavrSyncAccountService';

export function useWavrProfileSync(state: WavrSyncState) {
  const settings = useSettings();
  const profile = state.profiles[state.userId];

  useEffect(() => {
    if (state.connection !== 'connected' || !state.serverUrl || !profile?.name) return;
    wavrSyncAccount.syncUsernameFromProfile(state.serverUrl, profile);
  }, [state.connection, state.serverUrl, profile?.id, profile?.name]);

  useEffect(() => {
    if (state.connection !== 'connected' || !profile) return;
    const patch: { profileImage?: string; profileBanner?: string } = {};
    if (profile.avatar && profile.avatar !== settings.profileImage) {
      patch.profileImage = profile.avatar;
    }
    if (profile.banner && profile.banner !== settings.profileBanner) {
      patch.profileBanner = profile.banner;
    }
    if (Object.keys(patch).length) store.updateSettings(patch);
  }, [
    state.connection,
    profile?.updatedAt,
    profile?.avatar,
    profile?.banner,
    settings.profileImage,
    settings.profileBanner,
  ]);
}
