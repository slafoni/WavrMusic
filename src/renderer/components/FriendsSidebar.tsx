import { useEffect } from 'react';
import type { WavrSyncProfile } from '../../../shared/models';
import { go } from '../app/routes';
import { store, useSettings } from '../state';
import { useWavrSyncState } from '../hooks/useWavrSync';
import { wavrSync } from '../services/wavrSyncService';
import { coverArtUrl } from '../services/serverService';
import { pushToast } from '../services/toastService';
import { showContextMenu } from './ContextMenu';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { DeveloperBadge } from './DeveloperBadge';
import { Icon } from './Icon';
import { ProfileAvatar } from './ProfileAvatar';

function friendStatus(friend: WavrSyncProfile | undefined): string {
  if (!friend) return 'Loading...';
  if (!friend.online) return 'Offline';
  if (friend.currentTrack) {
    return `${friend.currentTrack.title} - ${friend.currentTrack.artist}`;
  }
  return 'Online';
}

export function FriendsSidebar() {
  const settings = useSettings();
  const state = useWavrSyncState();
  const ownProfile = state.profiles[state.userId];
  const friendIds = ownProfile?.friends || [];
  const incomingIds = ownProfile?.incomingFriendRequests || [];
  const outgoingIds = ownProfile?.outgoingFriendRequests || [];
  const enabled =
    settings.friendsSidebarEnabled !== false &&
    state.connection === 'connected' &&
    state.features.includes('profiles');

  useEffect(() => {
    if (!enabled) return;
    if (!state.profiles[state.userId]) wavrSync.requestProfile(state.userId);
    for (const id of [...friendIds, ...incomingIds, ...outgoingIds]) {
      if (!state.profiles[id]) wavrSync.requestProfile(id);
    }
  }, [
    enabled,
    state.userId,
    friendIds.join('|'),
    incomingIds.join('|'),
    outgoingIds.join('|'),
    state.profiles,
  ]);

  if (!enabled) return null;

  const friends = friendIds
    .map((id) => ({ id, profile: state.profiles[id] }))
    .sort((left, right) => {
      const online = Number(!!right.profile?.online) - Number(!!left.profile?.online);
      if (online !== 0) return online;
      return (left.profile?.name || '').localeCompare(right.profile?.name || '');
    });

  const disable = () => store.updateSettings({ friendsSidebarEnabled: false });
  const openProfile = (id: string) => store.setNavigation(go.profile(id));
  const invite = (id: string, name: string) => {
    if (!state.room) {
      pushToast('Join or create a WavrSync room before inviting a friend.', 'info');
      return;
    }
    wavrSync.inviteToRoom(id);
    pushToast(`Room invite sent to ${name}.`, 'success');
  };

  return (
    <aside className="friends-sidebar" aria-label="WavrSync friends">
      <div className="friends-sidebar-header">
        <div>
          <div className="friends-sidebar-title">
            <Icon name="people" size={19} />
            Friends
          </div>
          <div className="friends-sidebar-subtitle">
            {friends.filter((friend) => friend.profile?.online).length} online / {friends.length} friends
          </div>
        </div>
        <Button
          variant="icon"
          icon="close"
          title="Hide friends bar"
          onClick={disable}
        />
      </div>

      {incomingIds.length > 0 && (
        <section className="friends-sidebar-section">
          <div className="friends-sidebar-label">Friend requests</div>
          <div className="friends-request-list">
            {incomingIds.map((id) => {
              const profile = state.profiles[id];
              const name = profile?.name || 'WavrSync listener';
              return (
                <div className="friend-request" key={id}>
                  <button
                    type="button"
                    className="friend-request-main"
                    onClick={() => openProfile(id)}
                  >
                    <ProfileAvatar src={profile?.avatar} name={name} size={32} />
                    <span>
                      <strong>{name}</strong>
                      <small>Wants to be friends</small>
                    </span>
                  </button>
                  <div className="friend-request-actions">
                    <Button
                      variant="icon"
                      icon="check"
                      title={`Accept ${name}'s friend request`}
                      onClick={() => wavrSync.setFriend(id, 'accept')}
                    />
                    <Button
                      variant="icon"
                      icon="close"
                      title={`Decline ${name}'s friend request`}
                      onClick={() => wavrSync.setFriend(id, 'decline')}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {outgoingIds.length > 0 && (
        <section className="friends-sidebar-section">
          <div className="friends-sidebar-label">Awaiting acceptance</div>
          {outgoingIds.map((id) => {
            const profile = state.profiles[id];
            const name = profile?.name || 'WavrSync listener';
            return (
              <div className="friend-outgoing" key={id}>
                <button type="button" className="friend-outgoing-main" onClick={() => openProfile(id)}>
                  <ProfileAvatar src={profile?.avatar} name={name} size={26} />
                  <span>{name}</span>
                </button>
                <Button
                  variant="icon"
                  icon="close"
                  title={`Cancel friend request to ${name}`}
                  onClick={() => wavrSync.setFriend(id, 'remove')}
                />
              </div>
            );
          })}
        </section>
      )}

      <section className="friends-sidebar-section friends-list-section">
        <div className="friends-sidebar-label">Listening now</div>
        {friends.length === 0 ? (
          <div className="friends-empty">
            <Icon name="people" size={26} />
            <span>No friends yet. Open a profile and send a friend request.</span>
          </div>
        ) : (
          <div className="friends-list">
            {friends.map(({ id, profile }) => {
              const name = profile?.name || 'WavrSync listener';
              const track = profile?.online ? profile.currentTrack : null;
              return (
                <button
                  type="button"
                  key={id}
                  className="friend-row"
                  onClick={() => openProfile(id)}
                  onContextMenu={(event) =>
                    showContextMenu(event, [
                      {
                        label: state.room ? `Invite to ${state.room.name}` : 'Invite to WavrSync room',
                        icon: 'group_add',
                        disabled: !state.room,
                        onClick: () => invite(id, name),
                      },
                      {
                        label: 'View profile',
                        icon: 'person',
                        onClick: () => openProfile(id),
                      },
                      { separator: true },
                      {
                        label: 'Remove friend',
                        icon: 'person_remove',
                        danger: true,
                        onClick: () => wavrSync.setFriend(id, 'remove'),
                      },
                    ])
                  }
                >
                  <span className="friend-row-avatar">
                    <ProfileAvatar src={profile?.avatar} name={name} size={38} />
                    <span className={`friends-online-dot ${profile?.online ? 'online' : ''}`} />
                  </span>
                  <span className="friend-row-copy">
                    <strong>
                      {name}
                      <DeveloperBadge badges={profile?.badges} />
                    </strong>
                    <small className={track ? 'playing' : ''}>{friendStatus(profile)}</small>
                  </span>
                  {track ? (
                    <Artwork
                      src={coverArtUrl(track.coverArt || track.albumCover, 64)}
                      size={34}
                      radius="small"
                      alt={track.title}
                    />
                  ) : (
                    <Icon name="chevron_right" size={17} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="friends-sidebar-footer">
        <Button
          variant="surface"
          icon="sync"
          label="Open WavrSync"
          onClick={() => store.setNavigation(go.wavrsync())}
        />
      </div>
    </aside>
  );
}
