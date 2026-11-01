import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Album, Artist, Track } from '../../../../shared/models';
import { store, usePlayback, useQueue, useServer, useSettings } from '../../state';
import { useWavrSyncState } from '../../hooks/useWavrSync';
import { useWavrSyncAccountName } from '../../hooks/useWavrSyncAccount';
import {
  coverArtUrl,
  fetchAlbum,
  fetchAlbums,
  fetchRandomSongs,
  fetchStarred,
  setAlbumStarred,
} from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { analyzeCover } from '../../themes/themeEngine';
import { Artwork } from '../../components/Artwork';
import { Button } from '../../components/Button';
import { EmptyState, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { MediaCard } from '../../components/MediaCard';
import { showAlbumMenu, showArtistMenu, showTrackMenu } from '../../services/mediaActions';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { openTrackDetails } from '../../components/MediaDialogHost';
import { DeveloperBadge } from '../../components/DeveloperBadge';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';

interface HomeData {
  newest: Album[];
  recent: Album[];
  frequent: Album[];
  starredAlbums: Album[];
  rotationArtists: Artist[];
  madeForYou: Track[];
  rediscover: Album[];
}

const EMPTY: HomeData = {
  newest: [],
  recent: [],
  frequent: [],
  starredAlbums: [],
  rotationArtists: [],
  madeForYou: [],
  rediscover: [],
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function topGenre(albums: Album[]): string | undefined {
  const counts = new Map<string, number>();
  for (const album of albums) {
    if (!album.genre) continue;
    counts.set(album.genre, (counts.get(album.genre) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function rotationFromAlbums(albums: Album[]): Artist[] {
  const artists = new Map<string, Artist>();
  for (const album of albums) {
    const key = album.artistId || album.artist;
    const existing = artists.get(key);
    if (existing) {
      existing.albumCount = (existing.albumCount || 0) + 1;
      if (!existing.coverArt) existing.coverArt = album.coverArt;
    } else {
      artists.set(key, {
        id: album.artistId || '',
        name: album.artist,
        albumCount: 1,
        coverArt: album.coverArt,
      });
    }
  }
  return [...artists.values()].slice(0, 10);
}

function useHeroPalette(coverArt?: string | null): { accent: string; accent2: string } {
  const [palette, setPalette] = useState({ accent: '#C8D879', accent2: '#D8E99A' });
  useEffect(() => {
    let cancelled = false;
    const url = coverArtUrl(coverArt || undefined, 400);
    if (!url) {
      setPalette({ accent: '#C8D879', accent2: '#D8E99A' });
      return;
    }
    analyzeCover(url)
      .then((colour) => {
        if (!cancelled) setPalette({ accent: colour.accent, accent2: colour.accent2 });
      })
      .catch(() => {
        if (!cancelled) setPalette({ accent: '#C8D879', accent2: '#D8E99A' });
      });
    return () => {
      cancelled = true;
    };
  }, [coverArt]);
  return palette;
}

function SeeAll({ onClick, label = 'See all' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="see-all" onClick={onClick}>
      {label}
      <Icon name="chevron_right" size={16} />
    </button>
  );
}

function Shelf({ children }: { children: ReactNode }) {
  return (
    <div className="shelf">
      <div className="shelf-track">{children}</div>
    </div>
  );
}

function JumpBackIn() {
  const { track, status, currentTime, duration } = usePlayback();
  const { queue, index } = useQueue();
  if (!track) return null;
  const playing = status === 'playing' || status === 'buffering';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <section className="home-section resume-section" aria-label="Jump back in">
      <SectionHeader title="Jump Back In">
        <SeeAll onClick={() => store.setNavigation(go.queue())} label="Open queue" />
      </SectionHeader>
      <div
        className="resume-card"
        onContextMenu={(event) => showTrackMenu(event, track)}
      >
        <div className="resume-card-main">
          <Artwork
            src={coverArtUrl(track.coverArt || track.albumCover, 120) || null}
            size={64}
            radius="medium"
            alt={track.album}
          />
          <div className="resume-card-info">
            <div className="resume-eyebrow">Resume listening</div>
            <button
              type="button"
              className="resume-title link-button"
              title={track.title}
              onClick={() => openTrackDetails(track)}
            >
              {track.title}
            </button>
            <div className="resume-meta">
              <button
                type="button"
                className="link-button"
                disabled={!track.artistId}
                onClick={() => {
                  if (track.artistId) store.setNavigation(go.artist(track.artistId));
                }}
              >
                {track.artist}
              </button>
              <span> / </span>
              <button
                type="button"
                className="link-button muted"
                disabled={!track.albumId}
                onClick={() => {
                  if (track.albumId) store.setNavigation(go.album(track.albumId));
                }}
              >
                {track.album}
              </button>
              {queue.length > 0 && index >= 0 ? ` / ${index + 1} of ${queue.length}` : ''}
            </div>
            <div className="resume-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="resume-position">
          {duration > 0 ? `${Math.floor(currentTime / 60)}:${String(Math.floor(currentTime % 60)).padStart(2, '0')} / ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : ''}
        </div>
        <div className="resume-card-actions">
          <Button
            variant="play"
            icon={playing ? 'pause' : 'play_arrow'}
            title={playing ? 'Pause' : 'Play'}
            onClick={() => playback.playPause()}
          />
          <Button
            variant="surface"
            icon="open_in_new"
            label="Open player"
            onClick={() => store.setNavigation(go.player())}
          />
        </div>
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="page home-page">
      <div className="home-profile-header">
        <div className="home-profile-center">
          <div className="skeleton home-profile-avatar-skeleton" />
          <div className="skeleton skeleton-heading" style={{ width: 230, height: 32 }} />
          <div className="skeleton" style={{ width: 130, height: 14, marginTop: 8 }} />
        </div>
      </div>
      <div className="skeleton skeleton-hero" />
      {[1, 2, 3].map((row) => (
        <div key={row}>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton-shelf">
            {[1, 2, 3, 4, 5, 6].map((card) => (
              <div key={card} className="skeleton skeleton-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const { profile } = useServer();
  const { profileImage } = useSettings();
  const wavrSyncState = useWavrSyncState();
  const wavrSyncAccountName = useWavrSyncAccountName(wavrSyncState.serverUrl);
  const displayName =
    wavrSyncAccountName ||
    wavrSyncState.profiles[wavrSyncState.userId]?.name ||
    profile?.username ||
    profile?.name ||
    'Listener';
  const [data, setData] = useState<HomeData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [heroAlbum, setHeroAlbum] = useState<Album | null>(null);
  const [heroContext, setHeroContext] = useState('Recently played');
  const palette = useHeroPalette(heroAlbum?.coverArt);

  useEffect(() => {
    if (!profile) {
      setData(EMPTY);
      setHeroAlbum(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setHeroAlbum(null);

    const load = async () => {
      const [newestResult, recentResult, frequentResult, starredResult] = await Promise.allSettled([
        fetchAlbums('newest', 14),
        fetchAlbums('recent', 14),
        fetchAlbums('frequent', 14),
        fetchStarred(),
      ]);
      if (cancelled) return;

      const newest = newestResult.status === 'fulfilled' ? newestResult.value : [];
      const recent = recentResult.status === 'fulfilled' ? recentResult.value : [];
      const frequent = frequentResult.status === 'fulfilled' ? frequentResult.value : [];
      const starred = starredResult.status === 'fulfilled'
        ? starredResult.value
        : { songs: [], albums: [], artists: [] };

      const hero = recent[0] || newest[0] || starred.albums[0] || frequent[0] || null;
      const genre = topGenre([...starred.albums, ...frequent]);

      let madeForYou: Track[] = [];
      try {
        madeForYou = await fetchRandomSongs(18, genre);
      } catch {
        madeForYou = [];
      }
      if (!madeForYou.length && genre) {
        try {
          madeForYou = await fetchRandomSongs(18);
        } catch {
          madeForYou = [];
        }
      }
      if (cancelled) return;

      const heroId = hero?.id;
      const newestSection = newest.filter((album) => album.id !== heroId).slice(0, 10);
      const newestIds = new Set(newestSection.map((album) => album.id));
      const recentPool = recent.filter((album) => album.id !== heroId);
      const recentFiltered = recentPool.filter((album) => !newestIds.has(album.id));
      const recentSection = (recentFiltered.length >= 3 ? recentFiltered : recentPool).slice(0, 10);
      const recentIds = new Set(recentSection.map((album) => album.id));
      const frequentPool = frequent.filter((album) => album.id !== heroId);
      const frequentFiltered = frequentPool.filter(
        (album) => !newestIds.has(album.id) && !recentIds.has(album.id),
      );
      const frequentSection = (frequentFiltered.length >= 3 ? frequentFiltered : frequentPool).slice(0, 10);
      const visibleIds = new Set([
        ...newestSection.map((album) => album.id),
        ...recentSection.map((album) => album.id),
        ...frequentSection.map((album) => album.id),
      ]);
      const rediscover = starred.albums
        .filter(
          (album) =>
            album.id !== heroId &&
            !visibleIds.has(album.id) &&
            album.year &&
            album.year < new Date().getFullYear() - 1,
        )
        .sort((a, b) => (a.year || 0) - (b.year || 0))
        .slice(0, 8);

      if (cancelled) return;
      setHeroAlbum(hero);
      setHeroContext(
        recent.length && hero?.id === recent[0]?.id
          ? 'Recently played'
          : newest.length && hero?.id === newest[0]?.id
            ? 'New in your library'
            : starred.albums.length && hero?.id === starred.albums[0]?.id
              ? 'From your favourites'
              : 'Popular in your library',
      );
      setData({
        newest: newestSection,
        recent: recentSection,
        frequent: frequentSection,
        starredAlbums: starred.albums,
        rotationArtists: rotationFromAlbums(frequent),
        madeForYou: madeForYou.filter((track, index, all) => all.findIndex((entry) => entry.id === track.id) === index),
        rediscover,
      });
      setLoading(false);
    };

    load().catch(() => {
      if (cancelled) return;
      setFailed(true);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey]);

  const playAlbum = useCallback(async (album: Album, shuffle = false) => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.setShuffle(shuffle);
      playback.playQueue(detail.songs, shuffle ? Math.floor(Math.random() * detail.songs.length) : 0);
    } catch (error: any) {
      pushToast(error?.message || 'Could not start album playback.', 'error');
    }
  }, []);

  const queueAlbum = useCallback(async (album: Album) => {
    try {
      const detail = await fetchAlbum(album.id);
      if (!detail?.songs.length) {
        pushToast('This album has no playable tracks.', 'error');
        return;
      }
      playback.addToQueue(detail.songs);
      pushToast(`Added "${album.name}" to the queue.`, 'success');
    } catch (error: any) {
      pushToast(error?.message || 'Could not add the album to the queue.', 'error');
    }
  }, []);

  const toggleAlbumStar = useCallback(async (album: Album, next: boolean) => {
    try {
      await setAlbumStarred(album.id, next);
      pushToast(next ? 'Added to favourites.' : 'Removed from favourites.', 'success');
    } catch {
      pushToast('Could not update favourite.', 'error');
      throw new Error('favourite failed');
    }
  }, []);

  const playRandomAlbum = useCallback(async () => {
    try {
      const [album] = await fetchAlbums('random', 1);
      if (!album) throw new Error('No album found.');
      await playAlbum(album, true);
      pushToast(`Playing "${album.name}".`, 'success');
    } catch (error: any) {
      pushToast(error?.message || 'Could not choose a random album.', 'error');
    }
  }, [playAlbum]);

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Add a Navidrome or Subsonic-compatible server to start listening."
      />
    );
  }

  if (loading) return <HomeSkeleton />;

  const anything =
    !!heroAlbum ||
    data.newest.length > 0 ||
    data.recent.length > 0 ||
    data.frequent.length > 0 ||
    data.rotationArtists.length > 0 ||
    data.madeForYou.length > 0 ||
    data.rediscover.length > 0;

  if (failed || !anything) {
    return (
      <div className="page">
        <EmptyState
          icon={<Icon name="library_music" size={64} />}
          title={failed ? 'Your library could not be loaded' : 'Your library is empty'}
          subtitle={
            failed
              ? 'Check the server connection and try again.'
              : 'WAVR could not find albums or artists on this server yet. Try scanning your library, then refresh.'
          }
          action={<Button variant="primary" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      </div>
    );
  }

  const heroStyle = {
    '--hero-a': palette.accent,
    '--hero-b': palette.accent2,
  } as CSSProperties;

  return (
    <div className="page home-page">
      <div className="home-profile-header">
        <div className="home-profile-center">
          <ProfileAvatar
            src={profileImage}
            name={displayName}
            size={88}
            className="home-profile-avatar"
          />
          <h1 className="home-profile-greeting">{greeting()}</h1>
          <div className="home-profile-username" title={displayName}>
            @{displayName}
            <DeveloperBadge badges={wavrSyncState.profiles[wavrSyncState.userId]?.badges} />
          </div>
          <div className="home-profile-context">Streaming from {profile.name}</div>
        </div>
        <div className="home-header-actions">
          <Button
            variant="surface"
            icon="person"
            label="My profile"
            onClick={() => store.setNavigation(go.profile(wavrSyncState.userId))}
          />
          <Button variant="surface" icon="shuffle" label="Random album" onClick={playRandomAlbum} />
          <Button variant="icon" icon="refresh" title="Refresh home" onClick={() => setReloadKey((key) => key + 1)} />
        </div>
      </div>

      {heroAlbum && (
        <section
          className="home-hero"
          style={heroStyle}
          aria-label="Featured album"
          onContextMenu={(event) => showAlbumMenu(event, heroAlbum)}
        >
          <div className="home-hero-art">
            <Artwork
              src={coverArtUrl(heroAlbum.coverArt, 400) || null}
              size={176}
              radius="none"
              alt={heroAlbum.name}
            />
          </div>
          <div className="home-hero-copy">
            <div className="hero-eyebrow">{heroContext}</div>
            <button
              type="button"
              className="hero-title link-button"
              title={heroAlbum.name}
              onClick={() => store.setNavigation(go.album(heroAlbum.id))}
            >
              {heroAlbum.name}
            </button>
            <div className="hero-meta">
              <button
                type="button"
                className="link-button"
                disabled={!heroAlbum.artistId}
                onClick={() => {
                  if (heroAlbum.artistId) store.setNavigation(go.artist(heroAlbum.artistId));
                }}
              >
                {heroAlbum.artist}
              </button>
              {heroAlbum.year ? ` / ${heroAlbum.year}` : ''}
              {heroAlbum.songCount ? ` / ${heroAlbum.songCount} tracks` : ''}
              {heroAlbum.genre ? ` / ${heroAlbum.genre}` : ''}
            </div>
            <div className="hero-actions">
              <Button variant="primary" icon="play_arrow" label="Play" onClick={() => playAlbum(heroAlbum)} />
              <Button variant="surface" icon="shuffle" label="Shuffle" onClick={() => playAlbum(heroAlbum, true)} />
            </div>
          </div>
        </section>
      )}

      <JumpBackIn />

      {data.newest.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Recently Added">
            <SeeAll onClick={() => store.setNavigation(go.recentlyAdded())} />
          </SectionHeader>
          <Shelf>
            {data.newest.map((album) => (
              <MediaCard
                key={album.id}
                title={album.name}
                subtitle={album.artist}
                coverArt={album.coverArt}
                starred={album.starred}
                onClick={() => store.setNavigation(go.album(album.id))}
                onPlay={() => playAlbum(album)}
                onQueue={() => queueAlbum(album)}
                onToggleStar={(next) => toggleAlbumStar(album, next)}
                onSubtitleClick={album.artistId ? () => store.setNavigation(go.artist(album.artistId!)) : undefined}
                onContextMenu={(event) => showAlbumMenu(event, album)}
              />
            ))}
          </Shelf>
        </section>
      )}

      {data.rotationArtists.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Your Rotation">
            <SeeAll onClick={() => store.setNavigation(go.artists())} />
          </SectionHeader>
          <Shelf>
            {data.rotationArtists.map((artist) => (
              <MediaCard
                key={artist.id || artist.name}
                title={artist.name}
                subtitle={`${artist.albumCount || 0} album${artist.albumCount === 1 ? '' : 's'}`}
                coverArt={artist.coverArt}
                round
                fallbackIcon="person"
                onClick={() => store.setNavigation(artist.id ? go.artist(artist.id) : go.artists())}
                onContextMenu={(event) => showArtistMenu(event, artist)}
              />
            ))}
          </Shelf>
        </section>
      )}

      {data.madeForYou.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Made for You">
            <SeeAll onClick={() => store.setNavigation(go.discover())} label="Explore mix" />
          </SectionHeader>
          <div className="home-track-panel">
            <TrackList
              tracks={data.madeForYou.slice(0, 6)}
              showHeader={false}
              showAlbum={false}
              showIndex={false}
            />
          </div>
        </section>
      )}

      {data.rediscover.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Rediscover">
            <SeeAll onClick={() => store.setNavigation(go.favourites())} />
          </SectionHeader>
          <Shelf>
            {data.rediscover.map((album) => (
              <MediaCard
                key={album.id}
                title={album.name}
                subtitle={album.artist}
                coverArt={album.coverArt}
                badge={album.year ? String(album.year) : undefined}
                starred={album.starred}
                onClick={() => store.setNavigation(go.album(album.id))}
                onPlay={() => playAlbum(album)}
                onQueue={() => queueAlbum(album)}
                onToggleStar={(next) => toggleAlbumStar(album, next)}
                onSubtitleClick={album.artistId ? () => store.setNavigation(go.artist(album.artistId!)) : undefined}
                onContextMenu={(event) => showAlbumMenu(event, album)}
              />
            ))}
          </Shelf>
        </section>
      )}

      {data.recent.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Recently Played">
            <SeeAll onClick={() => store.setNavigation(go.recentlyPlayed())} />
          </SectionHeader>
          <Shelf>
            {data.recent.map((album) => (
              <MediaCard
                key={album.id}
                title={album.name}
                subtitle={album.artist}
                coverArt={album.coverArt}
                starred={album.starred}
                onClick={() => store.setNavigation(go.album(album.id))}
                onPlay={() => playAlbum(album)}
                onQueue={() => queueAlbum(album)}
                onToggleStar={(next) => toggleAlbumStar(album, next)}
                onSubtitleClick={album.artistId ? () => store.setNavigation(go.artist(album.artistId!)) : undefined}
                onContextMenu={(event) => showAlbumMenu(event, album)}
              />
            ))}
          </Shelf>
        </section>
      )}

      {data.frequent.length > 0 && (
        <section className="home-section">
          <SectionHeader title="Most Played">
            <SeeAll onClick={() => store.setNavigation(go.mostPlayed())} />
          </SectionHeader>
          <Shelf>
            {data.frequent.map((album) => (
              <MediaCard
                key={album.id}
                title={album.name}
                subtitle={album.artist}
                coverArt={album.coverArt}
                starred={album.starred}
                onClick={() => store.setNavigation(go.album(album.id))}
                onPlay={() => playAlbum(album)}
                onQueue={() => queueAlbum(album)}
                onToggleStar={(next) => toggleAlbumStar(album, next)}
                onSubtitleClick={album.artistId ? () => store.setNavigation(go.artist(album.artistId!)) : undefined}
                onContextMenu={(event) => showAlbumMenu(event, album)}
              />
            ))}
          </Shelf>
        </section>
      )}
    </div>
  );
}

