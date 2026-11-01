import { useEffect, useState } from 'react';
import type { Artist, Playlist } from '../../../../shared/models';
import { store } from '../../state';
import { useWavrSyncState } from '../../hooks/useWavrSync';
import { wavrSync } from '../../services/wavrSyncService';
import { coverArtUrl } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { showArtistMenu } from '../../services/mediaActions';
import { go } from '../../app/routes';
import { AlbumCard } from '../../components/AlbumCard';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { Card, Chip, EmptyState, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { DeveloperBadge } from '../../components/DeveloperBadge';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { TrackList } from '../../components/TrackList';

function ArtistRow({ artist }: { artist: Artist }) {
  const open = artist.id
    ? () => store.setNavigation(go.artist(artist.id!))
    : undefined;
  return (
    <button
      type="button"
      className="profile-artist-row"
      onClick={open}
      onContextMenu={(event) => showArtistMenu(event, artist)}
      disabled={!open}
    >
      <Artwork src={coverArtUrl(artist.coverArt, 80)} size={44} radius="full" alt={artist.name} />
      <span>
        <strong>{artist.name}</strong>
        {artist.albumCount ? <small>{artist.albumCount} album{artist.albumCount === 1 ? '' : 's'}</small> : null}
      </span>
      {open && <Icon name="chevron_right" size={18} />}
    </button>
  );
}

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  return (
    <button
      type="button"
      className="profile-artist-row"
      onClick={() => store.setNavigation(go.playlist(playlist.id))}
    >
      <span className="profile-playlist-icon"><Icon name="playlist_play" size={22} /></span>
      <span>
        <strong>{playlist.name}</strong>
        <small>
          {playlist.songCount ? `${playlist.songCount} songs` : 'Playlist'}
          {playlist.owner ? ` - ${playlist.owner}` : ''}
        </small>
      </span>
      <Icon name="chevron_right" size={18} />
    </button>
  );
}

export function UserProfile({ id }: { id: string }) {
  const state = useWavrSyncState();
  const profile = id ? state.profiles[id] : null;
  const ownProfile = state.profiles[state.userId] || null;
  const isSelf = !!id && id === state.userId;
  const isFriend = !!id && !!ownProfile?.friends.includes(id);
  const hasIncomingRequest = !!id && !!ownProfile?.incomingFriendRequests?.includes(id);
  const hasOutgoingRequest = !!id && !!ownProfile?.outgoingFriendRequests?.includes(id);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (profile) {
      setExpired(false);
      return;
    }
    const timer = window.setTimeout(() => setExpired(true), 6000);
    return () => window.clearTimeout(timer);
  }, [profile, id]);

  useEffect(() => {
    if (state.connection !== 'connected' || !id || !state.features.includes('profiles')) return;
    wavrSync.requestProfile(id);
  }, [state.connection, id, state.features.includes('profiles')]);

  useEffect(() => {
    if (!profile || state.connection !== 'connected' || !state.features.includes('profiles')) return;
    for (const friendId of profile.friends) {
      if (!state.profiles[friendId]) wavrSync.requestProfile(friendId);
    }
  }, [profile?.friends.join('|'), state.connection, state.profiles, state.features.includes('profiles')]);

  if (state.connection !== 'connected') {
    return (
      <EmptyState
        icon={<Icon name="sync" size={56} />}
        title="Connect to WavrSync"
        subtitle="User profiles are provided by the WavrSync server."
        action={
          <Button
            variant="primary"
            icon="sync"
            label="Open WavrSync"
            onClick={() => store.setNavigation(go.wavrsync())}
          />
        }
      />
    );
  }

  if (!state.features.includes('profiles')) {
    return (
      <EmptyState
        icon={<Icon name="warning" size={56} />}
        title="WavrSync server update required"
        subtitle="Deploy the latest wavrsync-server to enable shared profiles, avatars, friends, banners, and profile statistics."
      />
    );
  }

  if (!profile) {
    if (expired) {
      return (
        <EmptyState
          icon={<Icon name="person" size={56} />}
          title="Profile unavailable"
          subtitle="This listener has not shared a WavrSync profile yet."
        />
      );
    }
    return <div className="loading-block"><span className="spinner" /> Loading profile...</div>;
  }

  const requestFriend = () => {
    if (!id || isSelf) return;
    wavrSync.setFriend(id, 'request');
  };

  const removeFriend = () => {
    if (!id || isSelf) return;
    wavrSync.setFriend(id, 'remove');
  };

  const acceptFriend = () => {
    if (!id || isSelf) return;
    wavrSync.setFriend(id, 'accept');
  };

  const declineFriend = () => {
    if (!id || isSelf) return;
    wavrSync.setFriend(id, 'decline');
  };

  return (
    <div className="page profile-page">
      <section className="profile-hero">
        <div
          className={`profile-banner ${profile.banner ? 'has-image' : ''}`}
          style={profile.banner ? { backgroundImage: `url("${profile.banner}")` } : undefined}
        />
        <div className="profile-hero-content">
          <ProfileAvatar
            src={profile.avatar}
            name={profile.name}
            size={112}
            className="profile-hero-avatar"
          />
          <div className="profile-hero-copy">
            <h1 className="profile-name">
              {profile.name}
              <DeveloperBadge badges={profile.badges} />
            </h1>
            {profile.tags.length > 0 && (
              <div className="profile-tags">
                {profile.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}
              </div>
            )}
            {profile.bio && <div className="profile-bio">{profile.bio}</div>}
          </div>
          <div className="profile-actions">
            {!isSelf && isFriend && (
              <Button
                variant="surface"
                icon="person_remove"
                label="Remove friend"
                onClick={removeFriend}
              />
            )}
            {!isSelf && !isFriend && hasIncomingRequest && (
              <>
                <Button
                  variant="primary"
                  icon="check"
                  label="Accept request"
                  onClick={acceptFriend}
                />
                <Button
                  variant="surface"
                  icon="close"
                  label="Decline"
                  onClick={declineFriend}
                />
              </>
            )}
            {!isSelf && !isFriend && !hasIncomingRequest && hasOutgoingRequest && (
              <Button
                variant="surface"
                icon="close"
                label="Cancel request"
                onClick={removeFriend}
              />
            )}
            {!isSelf && !isFriend && !hasIncomingRequest && !hasOutgoingRequest && (
              <Button
                variant="primary"
                icon="person_add"
                label="Add friend"
                onClick={requestFriend}
              />
            )}
            {isSelf && (
              <Button
                variant="surface"
                icon="settings"
                label="Edit profile"
                onClick={() => store.setNavigation(go.settings())}
              />
            )}
          </div>
        </div>
      </section>

      {profile.currentTrack && (
        <Card className="profile-now-card">
          <SectionHeader title="Currently listening" />
          <div className="profile-now">
            <Artwork
              src={coverArtUrl(profile.currentTrack.coverArt || profile.currentTrack.albumCover, 160)}
              size={64}
              radius="medium"
              alt={profile.currentTrack.title}
            />
            <div>
              <button
                type="button"
                className="settings-label link-button"
                onClick={() => openTrackDetails(profile.currentTrack!)}
              >
                {profile.currentTrack.title}
              </button>
              <div className="settings-description">
                <button
                  type="button"
                  className="link-button"
                  disabled={!profile.currentTrack.artistId}
                  onClick={() => {
                    if (profile.currentTrack?.artistId) {
                      store.setNavigation(go.artist(profile.currentTrack.artistId));
                    }
                  }}
                >
                  {profile.currentTrack.artist}
                </button>
                {profile.currentTrack.album && (
                  <>
                    <span> / </span>
                    <button
                      type="button"
                      className="link-button muted"
                      disabled={!profile.currentTrack.albumId}
                      onClick={() => {
                        if (profile.currentTrack?.albumId) {
                          store.setNavigation(go.album(profile.currentTrack.albumId));
                        }
                      }}
                    >
                      {profile.currentTrack.album}
                    </button>
                  </>
                )}
              </div>
            </div>
            <Button
              variant="play"
              icon="play_arrow"
              title="Play this track"
              onClick={() => playback.playTrackNow(profile.currentTrack!)}
            />
          </div>
        </Card>
      )}

      <div className="profile-grid">
        <Card>
          <SectionHeader title="Most listened songs">
            <span className="profile-section-hint">By play count</span>
          </SectionHeader>
          {profile.topSongs.length ? (
            <TrackList tracks={profile.topSongs} showAlbum={false} showIndex={false} showHeader={false} />
          ) : (
            <div className="profile-empty">No listening history shared yet.</div>
          )}
        </Card>
        <Card>
          <SectionHeader title="Favourite songs" />
          {profile.favoriteSongs.length ? (
            <TrackList tracks={profile.favoriteSongs} showAlbum={false} showIndex={false} showHeader={false} />
          ) : (
            <div className="profile-empty">No favourite songs yet.</div>
          )}
        </Card>
        <Card>
          <SectionHeader title="Most listened artists">
            <span className="profile-section-hint">By play count</span>
          </SectionHeader>
          {profile.topArtists.length ? (
            profile.topArtists.map((artist) => <ArtistRow key={`${artist.id}-${artist.name}`} artist={artist} />)
          ) : (
            <div className="profile-empty">No artist history shared yet.</div>
          )}
        </Card>
        <Card>
          <SectionHeader title="Favourite artists" />
          {profile.favoriteArtists.length ? (
            profile.favoriteArtists.map((artist) => <ArtistRow key={`${artist.id}-${artist.name}`} artist={artist} />)
          ) : (
            <div className="profile-empty">No favourite artists yet.</div>
          )}
        </Card>
      </div>

      <section className="settings-section">
        <SectionHeader title="Favourite albums" />
        {profile.favoriteAlbums.length ? (
          <div className="grid">
            {profile.favoriteAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        ) : (
          <Card><div className="profile-empty">No favourite albums yet.</div></Card>
        )}
      </section>

      <div className="profile-grid">
        <Card>
          <SectionHeader title="Created playlists">
            <span className="profile-section-hint">Owned by {profile.name}</span>
          </SectionHeader>
          {profile.playlists.length ? (
            profile.playlists.map((playlist) => (
              <PlaylistRow key={playlist.id} playlist={playlist} />
            ))
          ) : (
            <div className="profile-empty">No playlists shared yet.</div>
          )}
        </Card>
        <Card>
          <SectionHeader title={`Friends (${profile.friends.length})`} />
          {profile.friends.length ? (
            <div className="profile-friends">
              {profile.friends.map((friendId) => {
                const friend = state.profiles[friendId];
                return (
                  <button
                    type="button"
                    key={friendId}
                    className="profile-friend"
                    onClick={() => store.setNavigation(go.profile(friendId))}
                  >
                    <ProfileAvatar src={friend?.avatar} name={friend?.name || 'Listener'} size={38} />
                    <span>
                      <strong>
                        {friend?.name || 'WavrSync listener'}
                        <DeveloperBadge badges={friend?.badges} />
                      </strong>
                      <small>Friend</small>
                    </span>
                    <Icon name="chevron_right" size={18} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="profile-empty">No friends added yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

