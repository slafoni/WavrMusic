import { useEffect } from 'react';
import type { ServerProfile } from '../../../shared/models';
import { store, useSettings } from '../state';
import { wavrSync, type WavrSyncState } from '../services/wavrSyncService';
import { wavrSyncAccount } from '../services/wavrSyncAccountService';
import { collectProfileSnapshot } from '../services/profileService';

export function useWavrProfilePublisher(
  state: WavrSyncState,
  profile: ServerProfile | null,
) {
  const settings = useSettings();
  const tagKey = Array.isArray(settings.profileTags) ? settings.profileTags.join('|') : '';
  const wavrSyncName =
    wavrSyncAccount.getSessionForServer(state.serverUrl)?.account.username || '';

  useEffect(() => {
    if (state.connection !== 'connected' || !profile || !wavrSync.hasFeature('profiles')) return;
    let cancelled = false;
    const publish = async () => {
      try {
        const snapshot = await collectProfileSnapshot(profile, settings);
        if (!cancelled) {
          wavrSync.publishProfile({ ...snapshot, name: wavrSyncName || snapshot.name });
        }
      } catch {
        if (!cancelled) {
          wavrSync.publishProfile({
            name: wavrSyncName || profile.username || profile.name,
            avatar: settings.profileImage,
            banner: settings.profileBanner || '',
            tags: settings.profileTags || [],
            currentTrack: store.getPlayback().track,
          });
        }
      }
    };
    void publish();
    const refreshTimer = window.setInterval(() => void publish(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [
    state.connection,
    state.serverUrl,
    wavrSyncName,
    profile?.id,
    profile?.username,
    settings.profileImage,
    settings.profileBanner,
    tagKey,
  ]);

  useEffect(() => {
    if (state.connection !== 'connected' || !wavrSync.hasFeature('profiles')) return;
    let lastKey = '';
    let timer = 0;
    const publishTrack = () => {
      const playback = store.getPlayback();
      const key = `${playback.track?.id || ''}|${playback.status}`;
      if (key === lastKey) return;
      lastKey = key;
      wavrSync.publishProfile({ currentTrack: playback.track });
    };
    publishTrack();
    const unsubscribe = store.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(publishTrack, 500);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [state.connection]);
}
