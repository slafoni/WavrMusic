import { useEffect } from 'react';
import { go } from '../app/routes';
import { store } from '../state';
import { useWavrSyncState } from '../hooks/useWavrSync';
import { wavrSync } from '../services/wavrSyncService';
import { Button } from './Button';
import { Icon } from './Icon';
import { ProfileAvatar } from './ProfileAvatar';

export function WavrSyncNotifications() {
  const state = useWavrSyncState();
  const ownProfile = state.profiles[state.userId];
  const incoming = ownProfile?.incomingFriendRequests || [];
  const invites = state.roomInvites.filter((invite) => invite.expiresAt > Date.now());
  const enabled =
    state.connection === 'connected' &&
    state.features.includes('profiles') &&
    (incoming.length > 0 || invites.length > 0);

  useEffect(() => {
    if (!enabled) return;
    for (const id of incoming) {
      if (!state.profiles[id]) wavrSync.requestProfile(id);
    }
    for (const invite of invites) {
      if (!state.profiles[invite.fromId]) wavrSync.requestProfile(invite.fromId);
    }
  }, [enabled, incoming.join('|'), invites.map((invite) => invite.fromId).join('|'), state.profiles]);

  if (!enabled) return null;

  const notifications = [
    ...invites.slice(0, 3).map((invite) => {
      const profile = state.profiles[invite.fromId];
      const name = profile?.name || invite.fromName || 'A WavrSync friend';
      return (
        <div className="wavrsync-notification" key={`invite-${invite.id}`}>
          <div className="wavrsync-notification-head">
            <ProfileAvatar src={profile?.avatar || invite.fromAvatar} name={name} size={34} />
            <div className="wavrsync-notification-copy">
              <strong>{name} invited you to a room</strong>
              <small>{invite.roomName}</small>
            </div>
          </div>
          <div className="wavrsync-notification-actions">
            <Button
              variant="primary"
              icon="login"
              label="Join room"
              onClick={() => {
                wavrSync.acceptRoomInvite(invite.id);
                store.setNavigation(go.wavrsync());
              }}
            />
            <Button
              variant="surface"
              icon="close"
              label="Decline"
              onClick={() => wavrSync.declineRoomInvite(invite.id)}
            />
          </div>
        </div>
      );
    }),
    ...incoming.slice(0, 3).map((id) => {
      const profile = state.profiles[id];
      const name = profile?.name || 'A WavrSync listener';
      return (
        <div className="wavrsync-notification" key={`friend-${id}`}>
          <div className="wavrsync-notification-head">
            <span className="wavrsync-notification-icon"><Icon name="person_add" size={19} /></span>
            <ProfileAvatar src={profile?.avatar} name={name} size={34} />
            <div className="wavrsync-notification-copy">
              <strong>{name} wants to be friends</strong>
              <small>WavrSync friend request</small>
            </div>
          </div>
          <div className="wavrsync-notification-actions">
            <Button
              variant="primary"
              icon="check"
              label="Accept"
              onClick={() => wavrSync.setFriend(id, 'accept')}
            />
            <Button
              variant="surface"
              icon="close"
              label="Decline"
              onClick={() => wavrSync.setFriend(id, 'decline')}
            />
          </div>
        </div>
      );
    }),
  ].slice(0, 4);

  return (
    <div className="wavrsync-notification-host" role="status" aria-live="polite">
      {notifications}
    </div>
  );
}
