import { useState } from 'react';
import type {
  WavrSyncControlMode,
  WavrSyncPlaybackStatus,
  WavrSyncVisibility,
} from '../../../../shared/models';
import {
  WAVRSYNC_DEFAULT_SERVER_URL,
  formatDuration,
} from '../../../../shared/constants';
import {
  parseWavrSyncInviteCode,
} from '../../../../shared/wavrsync';
import { store, useServer, useSettings } from '../../state';
import { go } from '../../app/routes';
import { useWavrSyncState } from '../../hooks/useWavrSync';
import { useWavrSyncAccount } from '../../hooks/useWavrSyncAccount';
import { WavrSyncAccountCard, WavrSyncAccountGate } from './WavrSyncAccount';
import { wavrSync } from '../../services/wavrSyncService';
import { playback } from '../../services/playbackService';
import { coverArtUrl } from '../../services/serverService';
import { pushToast } from '../../services/toastService';
import { copyText } from '../../services/clipboardService';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { Card, Chip, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { DeveloperBadge } from '../../components/DeveloperBadge';
import { openTrackDetails } from '../../components/MediaDialogHost';

function electronApi(): any {
  return (window as any).electronAPI;
}

function libraryKey(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

function playbackStatus(): WavrSyncPlaybackStatus {
  const current = store.getPlayback();
  if (
    current.status === 'playing' ||
    current.status === 'loading' ||
    current.status === 'buffering' ||
    current.status === 'seeking'
  ) {
    return 'playing';
  }
  return current.track ? 'paused' : 'idle';
}

function connectionLabel(connection: ReturnType<typeof useWavrSyncState>['connection']) {
  if (connection === 'connected') return 'Connected';
  if (connection === 'connecting') return 'Connecting';
  if (connection === 'reconnecting') return 'Reconnecting';
  return 'Offline';
}

export function WavrSync() {
  const settings = useSettings();
  const { profile } = useServer();
  const state = useWavrSyncState();
  const serverUrl = settings.wavrSyncServerUrl || WAVRSYNC_DEFAULT_SERVER_URL;
  const account = useWavrSyncAccount(serverUrl);
  const [roomName, setRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [controlMode, setControlMode] = useState<WavrSyncControlMode>('host');
  const [visibility, setVisibility] = useState<WavrSyncVisibility>('private');

  const listenerName =
    account?.account.username || state.displayName || profile?.username || profile?.name || 'Listener';
  const room = state.room;
  const connected = state.connection === 'connected';
  const profilesSupported = state.features.includes('profiles');
  const visibilitySupported = state.features.includes('roomVisibility');
  const canControl =
    !!room && connected && (room.controlMode === 'everyone' || room.hostId === state.userId);
  const isHost = !!room && room.hostId === state.userId;
  const currentTrack = room && room.currentIndex >= 0 ? room.queue[room.currentIndex] : null;
  const libraryMismatch = !!(
    room?.libraryUrl &&
    profile?.url &&
    libraryKey(room.libraryUrl) !== libraryKey(profile.url)
  );
  const inviteValue = room?.inviteUrl || room?.code || '';

  const connect = () => {
    wavrSync.connect(serverUrl, listenerName, settings.profileImage);
  };

  const createRoom = () => {
    if (!roomName.trim()) {
      pushToast('Give the WavrSync room a name.', 'error');
      return;
    }
    wavrSync.createRoom({
      name: roomName.trim(),
      controlMode,
      visibility,
      libraryUrl: profile?.url,
      libraryName: profile?.name,
    });
  };

  const joinRoom = (codeValue = joinCode) => {
    const code = parseWavrSyncInviteCode(codeValue);
    if (!code) {
      pushToast('Enter a valid WavrSync room code or invite link.', 'error');
      return;
    }
    wavrSync.joinRoom(code, serverUrl, listenerName, settings.profileImage);
    setJoinCode(code);
  };

  const copyInvite = async () => {
    if (!room) return;
    const value = room.inviteUrl || room.code;
    const copied = await copyText(value);
    pushToast(copied ? 'WavrSync invite copied.' : `Invite: ${value}`, copied ? 'success' : 'info');
  };

  const openInvite = () => {
    if (!room) return;
    if (/^https?:\/\//i.test(room.inviteUrl)) {
      electronApi()?.openExternal?.(room.inviteUrl);
      return;
    }
    void copyInvite();
  };

  const syncMyQueue = () => {
    if (!room) return;
    const queue = playback.getQueue();
    const index = playback.getQueueIndex();
    if (!queue.length || index < 0) {
      pushToast('Start something in your player first.', 'info');
      return;
    }
    wavrSync.sendQueue(queue, index);
    wavrSync.sendPlayback(playbackStatus(), playback.getCurrentTime(), index);
    pushToast('Your queue is now shared with the room.', 'success');
  };

  const togglePlayback = () => {
    if (!room || !currentTrack) return;
    const sameTrack = playback.getCurrentTrack()?.id === currentTrack.id;
    if (!sameTrack) {
      playback.playQueue(room.queue, room.currentIndex, room.playback.status === 'playing');
      return;
    }
    if (room.playback.status === 'playing') playback.pause();
    else playback.resume();
  };

  const playRoomTrack = (index: number) => {
    if (!room || !canControl) return;
    wavrSync.sendQueue(room.queue, index);
    wavrSync.sendPlayback('playing', 0, index);
    playback.playQueue(room.queue, index, true);
  };

  const moveRoomTrack = (index: number, direction: -1 | 1) => {
    if (!room || !canControl) return;
    const target = index + direction;
    if (target < 0 || target >= room.queue.length) return;
    const queue = [...room.queue];
    [queue[index], queue[target]] = [queue[target], queue[index]];
    let currentIndex = room.currentIndex;
    if (currentIndex === index) currentIndex = target;
    else if (currentIndex === target) currentIndex = index;
    wavrSync.sendQueue(queue, currentIndex);
  };

  const removeRoomTrack = (index: number) => {
    if (!room || !canControl) return;
    const queue = room.queue.filter((_, queueIndex) => queueIndex !== index);
    let currentIndex = room.currentIndex;
    if (index < currentIndex) currentIndex -= 1;
    if (index === room.currentIndex) currentIndex = Math.min(currentIndex, queue.length - 1);
    wavrSync.sendQueue(queue, currentIndex);
  };

  if (!account) {
    return (
      <WavrSyncAccountGate
        serverUrl={serverUrl}
        onAuthenticated={() => {
          wavrSync.disconnect();
          wavrSync.connect(serverUrl, listenerName, settings.profileImage);
        }}
      />
    );
  }

  return (
    <div className="page wavrsync-page">
      <div className="page-header wavrsync-page-header">
        <div className="wavrsync-page-title">
          <span className="wavrsync-page-mark"><Icon name="sync" size={24} /></span>
          <div>
            <h1 className="page-title">WavrSync</h1>
            <div className="page-subtitle">Listen together, in sync.</div>
          </div>
        </div>
        <div className="wavrsync-page-status">
          <span className={`wavrsync-status-dot ${connectionLabel(state.connection).toLowerCase()}`} />
          <Chip selected={connected}>{connectionLabel(state.connection)}</Chip>
        </div>
      </div>

      <WavrSyncAccountCard serverUrl={serverUrl} session={account} />

      {state.error && (
        <div className="wavrsync-error" role="alert">
          <Icon name="warning" size={18} />
          <span>{state.error}</span>
          <Button
            variant="icon"
            icon="close"
            title="Dismiss"
            onClick={() => wavrSync.clearError()}
          />
        </div>
      )}

      {connected && (!profilesSupported || !visibilitySupported) && (
        <div className="wavrsync-inline-warning">
          <Icon name="warning" size={18} />
          This WavrSync server is outdated. Deploy the latest wavrsync-server to enable shared profiles, avatars, friends, and room visibility changes.
        </div>
      )}

      {!room && (
        <div className="wavrsync-lobby">
          {/* <Card className="wavrsync-connection-card">
            <div className="wavrsync-connection-head">
              <span className={`wavrsync-status-dot ${connectionLabel(state.connection).toLowerCase()}`} />
              <div>
                <div className="settings-label">WavrSync server</div>
                <div className="settings-description">
                  {connected
                    ? 'Connected to your shared-listening backend.'
                    : 'Set the server URL in Settings, then connect.'}
                </div>
              </div>
            </div>
            <div className="wavrsync-connect-controls">
              <div className="wavrsync-server-address" title={serverUrl}>{serverUrl}</div>
              {connected ? (
                <>
                  <Button variant="surface" icon="refresh" label="Refresh" onClick={() => wavrSync.listRooms()} />
                  <Button variant="surface" icon="cloud_off" label="Disconnect" onClick={() => wavrSync.disconnect()} />
                </>
              ) : (
                <Button
                  variant="primary"
                  icon="cloud"
                  label={state.connection === 'connecting' || state.connection === 'reconnecting' ? 'Connecting...' : 'Connect'}
                  onClick={connect}
                  disabled={state.connection === 'connecting' || state.connection === 'reconnecting'}
                />
              )}
              <Button
                variant="surface"
                icon="settings"
                label="Change server"
                onClick={() => store.setNavigation(go.settings())}
              />
            </div>
          </Card> */}

          <Card className="wavrsync-action-card">
            <div className="wavrsync-lobby-panel">
              <div className="wavrsync-panel-heading">
                <span className="wavrsync-panel-icon"><Icon name="radio" size={21} /></span>
                <div>
                  <div className="settings-label">Create a room</div>
                  <div className="settings-description">Start a session.</div>
                </div>
              </div>
              <label className="wavrsync-field">
                <span>Room name</span>
                <input
                  className="form-input"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder="Friday night listening"
                  maxLength={80}
                />
              </label>
              <div className="wavrsync-field">
                <span>Playback control</span>
                <div className="settings-choice-grid">
                  <Button
                    variant="surface"
                    active={controlMode === 'host'}
                    label="Host only"
                    onClick={() => setControlMode('host')}
                  />
                  <Button
                    variant="surface"
                    active={controlMode === 'everyone'}
                    label="Everyone"
                    onClick={() => setControlMode('everyone')}
                  />
                </div>
              </div>
              <div className="wavrsync-field">
                <span>Visibility</span>
                <div className="settings-choice-grid">
                  <Button
                    variant="surface"
                    active={visibility === 'private'}
                    label="Private"
                    onClick={() => setVisibility('private')}
                  />
                  <Button
                    variant="surface"
                    active={visibility === 'public'}
                    label="Public"
                    onClick={() => setVisibility('public')}
                  />
                </div>
              </div>
              <Button
                variant="primary"
                icon="add"
                label="Create room"
                onClick={createRoom}
                disabled={!connected}
              />
              {!connected && (
                <div className="form-hint">Connect to a WavrSync server before creating a room.</div>
              )}
            </div>

            <div className="wavrsync-panel-divider" />

            <div className="wavrsync-lobby-panel">
              <div className="wavrsync-panel-heading">
                <span className="wavrsync-panel-icon"><Icon name="login" size={21} /></span>
                <div>
                  <div className="settings-label">Join a room</div>
                  <div className="settings-description">Use an invite code or link from another listener.</div>
                </div>
              </div>
              <label className="wavrsync-field">
                <span>Invite code or link</span>
                <input
                  className="form-input"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="ABC123 or wavr://wavrsync/join/ABC123"
                  spellCheck={false}
                />
              </label>
              <div className="wavrsync-join-note">
                <Icon name="info" size={16} />
                <span>Everyone should be connected to the same Subsonic library for playback to match.</span>
              </div>
              <Button
                variant="surface"
                icon="login"
                label="Join room"
                onClick={() => joinRoom()}
                disabled={!joinCode.trim()}
              />
            </div>
          </Card>

          <Card className="wavrsync-public-card">
            <SectionHeader title="Public rooms">
              <Button
                variant="icon"
                icon="refresh"
                title="Refresh public rooms"
                onClick={() => {
                  if (!connected) connect();
                  else wavrSync.listRooms();
                }}
              />
            </SectionHeader>
            {state.rooms.length === 0 ? (
              <div className="wavrsync-empty-row">
                <Icon name="radio" size={28} />
                <span>No public rooms yet. Create one or join with an invite code.</span>
              </div>
            ) : (
              <div className="wavrsync-public-list">
                {state.rooms.map((publicRoom) => (
                  <button
                    key={publicRoom.code}
                    type="button"
                    className="wavrsync-public-room"
                    onClick={() => joinRoom(publicRoom.code)}
                  >
                    <span className="wavrsync-public-icon"><Icon name="radio" size={19} /></span>
                    <span className="wavrsync-public-main">
                      <strong>{publicRoom.name}</strong>
                      <small>
                        {publicRoom.hostName} - {publicRoom.participants} listener{publicRoom.participants === 1 ? '' : 's'}
                        {publicRoom.libraryName ? ` - ${publicRoom.libraryName}` : ''}
                      </small>
                    </span>
                    <span className="wavrsync-public-track">
                      {publicRoom.trackTitle || 'Waiting for music'}
                      {publicRoom.trackArtist ? ` - ${publicRoom.trackArtist}` : ''}
                    </span>
                    <Icon name="chevron_right" size={18} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {room && (
        <div className="wavrsync-room-view">
          <Card className="wavrsync-room-hero">
            <div className="wavrsync-room-hero-top">
              <div className="wavrsync-room-hero-main">
                <span className="wavrsync-room-mark"><Icon name="sync" size={27} /></span>
                <div className="wavrsync-room-copy">
                  <div className="wavrsync-room-eyebrow">
                    {room.visibility === 'public' ? 'Public WavrSync room' : 'Private WavrSync room'}
                  </div>
                  <h2 className="wavrsync-room-name">{room.name}</h2>
                  <div className="wavrsync-room-subline">
                    Hosted by {room.participants.find((entry) => entry.isHost)?.name || 'the room host'}
                  </div>
                </div>
              </div>
              <div className="wavrsync-room-actions">
                <Button variant="primary" icon="content_copy" label="Copy invite" onClick={copyInvite} />
                <Button variant="surface" icon="logout" label="Leave room" onClick={() => wavrSync.leaveRoom()} />
              </div>
            </div>
            <div className="wavrsync-room-meta">
              <div>
                <span>Room code</span>
                <strong>{room.code}</strong>
              </div>
              <div>
                <span>Listeners</span>
                <strong>{room.participants.length}</strong>
              </div>
              <div>
                <span>Control</span>
                <strong>{room.controlMode === 'everyone' ? 'Everyone' : 'Host only'}</strong>
              </div>
              <div>
                <span>Library</span>
                <strong>{room.libraryName || profile?.name || 'Local library'}</strong>
              </div>
            </div>
            {libraryMismatch && (
              <div className="wavrsync-inline-warning">
                <Icon name="warning" size={18} />
                This room uses {room.libraryName || room.libraryUrl}. Your active library is {profile?.name}. Tracks may not match.
              </div>
            )}
          </Card>

          <div className="wavrsync-room-grid">
            <div className="wavrsync-room-main">
              <Card className="wavrsync-now-card">
                <SectionHeader title="Now playing" />
                <div className="wavrsync-now-playing">
                  <Artwork
                    src={currentTrack ? coverArtUrl(currentTrack.coverArt || currentTrack.albumCover, 220) : null}
                    size={96}
                    radius="large"
                    alt={currentTrack?.title || 'Nothing playing'}
                  />
                  <div className="wavrsync-now-copy">
                    {currentTrack ? (
                      <button
                        type="button"
                        className="wavrsync-now-title link-button"
                        onClick={() => openTrackDetails(currentTrack)}
                      >
                        {currentTrack.title}
                      </button>
                    ) : (
                      <div className="wavrsync-now-title">Nothing playing</div>
                    )}
                    <div className="settings-description">
                      {currentTrack ? (
                        <>
                          <button
                            type="button"
                            className="link-button"
                            disabled={!currentTrack.artistId}
                            onClick={() => {
                              if (currentTrack.artistId) {
                                store.setNavigation(go.artist(currentTrack.artistId));
                              }
                            }}
                          >
                            {currentTrack.artist}
                          </button>
                          {currentTrack.album && (
                            <>
                              <span> / </span>
                              <button
                                type="button"
                                className="link-button muted"
                                disabled={!currentTrack.albumId}
                                onClick={() => {
                                  if (currentTrack.albumId) {
                                    store.setNavigation(go.album(currentTrack.albumId));
                                  }
                                }}
                              >
                                {currentTrack.album}
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        'Queue a track to start the room.'
                      )}
                    </div>
                    <div className="wavrsync-now-status">
                      <Chip selected={room.playback.status === 'playing'}>
                        {room.playback.status === 'playing' ? 'Playing' : room.playback.status === 'paused' ? 'Paused' : 'Idle'}
                      </Chip>
                      {currentTrack && <span>{formatDuration(currentTrack.duration)}</span>}
                    </div>
                  </div>
                  {canControl && (
                    <div className="wavrsync-now-actions">
                      <Button
                        variant="play"
                        icon={room.playback.status === 'playing' ? 'pause' : 'play_arrow'}
                        title={room.playback.status === 'playing' ? 'Pause room' : 'Play room'}
                        onClick={togglePlayback}
                        disabled={!currentTrack}
                      />
                      <Button variant="surface" icon="queue_music" label="Share my queue" onClick={syncMyQueue} />
                    </div>
                  )}
                </div>
              </Card>

              <Card className="wavrsync-queue-card">
                <SectionHeader title={`Room queue${room.queue.length ? ` (${room.queue.length})` : ''}`} />
                {room.queue.length === 0 ? (
                  <div className="wavrsync-empty-row">
                    <Icon name="queue_music" size={28} />
                    <span>{canControl ? 'Play something, then share your queue with the room.' : 'The host has not started a queue yet.'}</span>
                  </div>
                ) : (
                  <div className="wavrsync-queue">
                    {room.queue.map((track, index) => (
                      <div
                        key={`${track.id}-${index}`}
                        className={`wavrsync-queue-track ${index === room.currentIndex ? 'current' : ''}`}
                      >
                        <span className="wavrsync-queue-index">
                          {index === room.currentIndex ? <Icon name="play_arrow" size={14} /> : index + 1}
                        </span>
                        <Artwork
                          src={coverArtUrl(track.coverArt || track.albumCover, 64)}
                          size={38}
                          radius="small"
                          alt={track.title}
                        />
                        <span className="wavrsync-queue-copy">
                          <button
                            type="button"
                            className="link-button title"
                            onClick={() => openTrackDetails(track)}
                          >
                            {track.title}
                          </button>
                          <button
                            type="button"
                            className="link-button muted"
                            disabled={!track.artistId}
                            onClick={() => {
                              if (track.artistId) store.setNavigation(go.artist(track.artistId));
                            }}
                          >
                            {track.artist}
                          </button>
                        </span>
                        <span className="wavrsync-queue-time">{formatDuration(track.duration)}</span>
                        {canControl && (
                          <div className="wavrsync-queue-actions">
                            <Button
                              variant="icon"
                              icon="play_arrow"
                              title={`Play ${track.title} now`}
                              onClick={() => playRoomTrack(index)}
                            />
                            <Button
                              variant="icon"
                              icon="arrow_upward"
                              title={`Move ${track.title} up`}
                              onClick={() => moveRoomTrack(index, -1)}
                              disabled={index === 0}
                            />
                            <Button
                              variant="icon"
                              icon="arrow_downward"
                              title={`Move ${track.title} down`}
                              onClick={() => moveRoomTrack(index, 1)}
                              disabled={index === room.queue.length - 1}
                            />
                            <Button
                              variant="danger"
                              icon="delete"
                              title={`Remove ${track.title} from the room queue`}
                              onClick={() => removeRoomTrack(index)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <aside className="wavrsync-room-side">
              <Card className="wavrsync-invite-card">
                <SectionHeader title="Invite listeners" />
                <div className="wavrsync-invite-code">{room.code}</div>
                <div className="settings-description">
                  Share the code or link. WavrSync will open the room automatically.
                </div>
                <div className="wavrsync-invite-url" title={inviteValue}>{inviteValue}</div>
                <div className="wavrsync-invite-actions">
                  <Button variant="surface" icon="content_copy" label="Copy" onClick={copyInvite} />
                  {room.inviteUrl && (
                    <Button variant="surface" icon="open_in_new" label="Open page" onClick={openInvite} />
                  )}
                </div>
                <div className="form-hint">
                  Discord adds a join button when the WavrSync server has a public HTTPS address.
                </div>
              </Card>

              <Card>
                <SectionHeader title={`Listeners (${room.participants.length})`} />
                <div className="wavrsync-participants">
                  {room.participants.map((participant) => (
                    <div className="wavrsync-participant" key={participant.id}>
                      <ProfileAvatar
                        src={participant.avatar}
                        name={participant.name}
                        size={34}
                        className={`wavrsync-participant-avatar ${participant.isHost ? 'host' : ''}`}
                      />
                      <span className="wavrsync-participant-copy">
                        <strong>
                          {participant.name}
                          <DeveloperBadge badges={participant.badges} />
                        </strong>
                        <small>{participant.isHost ? 'Host' : participant.id === state.userId ? 'You' : 'Listener'}</small>
                      </span>
                      {profilesSupported && (
                        <Button
                          variant="icon"
                          icon="person"
                          title={`View ${participant.name}'s profile`}
                          onClick={() => store.setNavigation(go.profile(participant.id))}
                        />
                      )}
                      {isHost && participant.id !== state.userId && (
                        <>
                          <Button
                            variant="icon"
                            icon="person_add"
                            title={`Make ${participant.name} host`}
                            onClick={() => wavrSync.transferHost(participant.id)}
                          />
                          <Button
                            variant="danger"
                            icon="person_remove"
                            title={`Remove ${participant.name}`}
                            onClick={() => wavrSync.kick(participant.id)}
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              {isHost && (
                <Card>
                  <SectionHeader title="Host controls" />
                  <div className="wavrsync-control-block">
                    <div>
                      <div className="settings-label">Playback control</div>
                      <div className="settings-description">
                        Keep control with the host, or let every listener change the queue and playback.
                      </div>
                    </div>
                    <div className="settings-choice-grid">
                      <Button
                        variant="surface"
                        active={room.controlMode === 'host'}
                        label="Host"
                        onClick={() => wavrSync.setControlMode('host')}
                      />
                      <Button
                        variant="surface"
                        active={room.controlMode === 'everyone'}
                        label="Everyone"
                        onClick={() => wavrSync.setControlMode('everyone')}
                      />
                    </div>
                  </div>
                  <div className="wavrsync-control-block">
                    <div>
                      <div className="settings-label">Room visibility</div>
                      <div className="settings-description">
                        {visibilitySupported
                          ? 'Public rooms appear in the WavrSync room browser. Private rooms require an invite code.'
                          : 'Update the WavrSync server to change room visibility after creation.'}
                      </div>
                    </div>
                    {visibilitySupported && (
                      <div className="settings-choice-grid">
                        <Button
                          variant="surface"
                          active={room.visibility === 'private'}
                          label="Private"
                          onClick={() => wavrSync.setVisibility('private')}
                        />
                        <Button
                          variant="surface"
                          active={room.visibility === 'public'}
                          label="Public"
                          onClick={() => wavrSync.setVisibility('public')}
                        />
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}



