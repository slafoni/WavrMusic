import { useEffect, useRef, useState } from 'react';
import type { Album, Artist, Playlist, Track } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { useWavrSyncState } from '../../hooks/useWavrSync';
import { wavrSync } from '../../services/wavrSyncService';
import {
  fetchAlbum,
  fetchPlaylist,
  searchLibrary,
  setAlbumStarred,
} from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { showAlbumMenu, showArtistMenu } from '../../services/mediaActions';
import { Button } from '../../components/Button';
import { EmptyState, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { MediaCard } from '../../components/MediaCard';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { DeveloperBadge } from '../../components/DeveloperBadge';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';

interface Results {
  artists: Artist[];
  albums: Album[];
  songs: Track[];
  playlists: Playlist[];
}

const EMPTY: Results = { artists: [], albums: [], songs: [], playlists: [] };

export function Search() {
  const { profile } = useServer();
  const wavrSyncState = useWavrSyncState();
  const profileSearchSupported =
    wavrSyncState.connection === 'connected' &&
    wavrSyncState.features.includes('profileSearch');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestRef.current += 1;
      setResults(EMPTY);
      setLoading(false);
      setError('');
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchLibrary(trimmed);
        if (requestRef.current === requestId) setResults(result);
      } catch (reason: any) {
        if (requestRef.current === requestId) {
          setResults(EMPTY);
          setError(reason?.message || 'Search failed.');
        }
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, retryKey]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!profileSearchSupported) return;
    wavrSync.clearProfileSearch();
    if (!trimmed) return;
    const timer = window.setTimeout(() => wavrSync.searchProfiles(trimmed), 250);
    return () => window.clearTimeout(timer);
  }, [query, profileSearchSupported]);

  const profileResults =
    query.trim() && profileSearchSupported ? wavrSyncState.profileSearch : [];

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to search your library."
      />
    );
  }

  const total =
    results.artists.length +
    results.albums.length +
    results.songs.length +
    results.playlists.length +
    profileResults.length;
  const trimmed = query.trim();

  const playAlbum = async (album: Album) => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.setShuffle(false);
      playback.playQueue(detail.songs, 0);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not start album playback.', 'error');
    }
  };

  const queueAlbum = async (album: Album) => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.addToQueue(detail.songs);
      pushToast(`Added "${album.name}" to the queue.`, 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not add the album to the queue.', 'error');
    }
  };

  const toggleAlbumStar = async (album: Album, next: boolean) => {
    try {
      await setAlbumStarred(album.id, next);
    } catch {
      pushToast('Could not update favourite.', 'error');
      throw new Error('favourite failed');
    }
  };

  const playPlaylist = async (playlist: Playlist) => {
    try {
      const detail = await fetchPlaylist(playlist.id);
      if (!detail?.songs.length) {
        pushToast('This playlist is empty.', 'error');
        return;
      }
      playback.setShuffle(false);
      playback.playQueue(detail.songs, 0);
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not start the playlist.', 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Search</h1>
          <div className="page-subtitle">Find tracks, artists, albums, playlists and Wavr profiles</div>
        </div>
      </div>

      <div className="search-field" style={{ maxWidth: 760, marginBottom: 28 }}>
        <span className="search-icon"><Icon name="search" size={18} /></span>
        <input
          id="global-search-input"
          className="search-input"
          placeholder="Search..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
          spellCheck={false}
          aria-label="Search your library"
        />
        {query && (
          <Button
            variant="icon"
            icon="close"
            title="Clear search"
            style={{ position: 'absolute', right: 2, top: 2 }}
            onClick={() => setQuery('')}
          />
        )}
      </div>

      {wavrSyncState.connection === 'connected' &&
        wavrSyncState.features.includes('profiles') &&
        !profileSearchSupported && (
          <div className="form-hint" style={{ marginTop: -14, marginBottom: 20 }}>
            Profile search needs the latest WavrSync server update.
          </div>
        )}

      {!trimmed ? (
        <EmptyState
          icon={<Icon name="search" size={56} />}
          title="Search your library"
          subtitle="Start typing to search songs, artists, albums, playlists and WavrSync profiles. Press Ctrl+K anywhere to jump here."
        />
      ) : loading ? (
        <div className="search-loading" aria-busy="true">
          <div className="skeleton skeleton-heading" />
          <div className="grid">
            {[1, 2, 3, 4, 5, 6].map((card) => (
              <div key={card} className="skeleton skeleton-card" />
            ))}
          </div>
        </div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Search failed"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setRetryKey((key) => key + 1)} />}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={<Icon name="search_off" size={56} />}
          title="No results"
          subtitle={`Nothing matched "${trimmed}".`}
        />
      ) : (
        <>
          <div className="page-subtitle" style={{ marginBottom: 18 }} aria-live="polite">
            {total} result{total === 1 ? '' : 's'} for "{trimmed}"
          </div>

          {profileResults.length > 0 && (
            <section className="home-section">
              <SectionHeader title="WavrSync profiles" />
              <div className="search-profile-results">
                {profileResults.map((result) => (
                  <button
                    type="button"
                    key={result.id}
                    className="search-profile-result"
                    onClick={() => store.setNavigation(go.profile(result.id))}
                  >
                    <ProfileAvatar src={result.avatar} name={result.name} size={44} />
                    <span className="search-profile-copy">
                      <strong>
                        {result.name}
                        <DeveloperBadge badges={result.badges} />
                      </strong>
                      {result.tags.length > 0 && <small>{result.tags.join(' - ')}</small>}
                    </span>
                    <Icon name="chevron_right" size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.songs.length > 0 && (
            <section className="home-section">
              <SectionHeader title="Songs" />
              <TrackList tracks={results.songs} />
            </section>
          )}

          {results.artists.length > 0 && (
            <section className="home-section">
              <SectionHeader title="Artists" />
              <div className="grid">
                {results.artists.map((artist) => (
                  <MediaCard
                    key={artist.id}
                    title={artist.name}
                    subtitle={`${artist.albumCount ?? 0} albums`}
                    coverArt={artist.coverArt}
                    round
                    fallbackIcon="person"
                    onClick={() => store.setNavigation(go.artist(artist.id))}
                    onContextMenu={(event) => showArtistMenu(event, artist)}
                  />
                ))}
              </div>
            </section>
          )}

          {results.albums.length > 0 && (
            <section className="home-section">
              <SectionHeader title="Albums" />
              <div className="grid">
                {results.albums.map((album) => (
                  <MediaCard
                    key={album.id}
                    title={album.name}
                    subtitle={album.artist}
                    coverArt={album.coverArt}
                    starred={album.starred}
                    onClick={() => store.setNavigation(go.album(album.id))}
                    onSubtitleClick={
                      album.artistId
                        ? () => store.setNavigation(go.artist(album.artistId!))
                        : undefined
                    }
                    onPlay={() => playAlbum(album)}
                    onQueue={() => queueAlbum(album)}
                    onToggleStar={(next) => toggleAlbumStar(album, next)}
                    onContextMenu={(event) => showAlbumMenu(event, album)}
                  />
                ))}
              </div>
            </section>
          )}

          {results.playlists.length > 0 && (
            <section className="home-section">
              <SectionHeader title="Playlists" />
              <div className="grid">
                {results.playlists.map((playlist) => (
                  <MediaCard
                    key={playlist.id}
                    title={playlist.name}
                    subtitle={`${playlist.songCount ?? 0} tracks`}
                    coverArt={playlist.coverArt}
                    fallbackIcon="playlist_play"
                    onClick={() => store.setNavigation(go.playlist(playlist.id))}
                    onPlay={() => playPlaylist(playlist)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

