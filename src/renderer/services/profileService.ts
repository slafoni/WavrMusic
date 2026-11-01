import type {
  Album,
  AppSettings,
  Artist,
  Playlist,
  ServerProfile,
  Track,
  WavrSyncProfileInput,
} from '../../../shared/models';
import { store } from '../state';
import {
  fetchAlbum,
  fetchAlbums,
  fetchArtists,
  fetchPlaylists,
  fetchRandomSongs,
  fetchStarred,
} from './serverService';

function topArtistsFromAlbums(albums: Album[]): Artist[] {
  const artists = new Map<string, Artist>();
  for (const album of albums) {
    const key = album.artistId || album.artist.toLowerCase();
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
  return [...artists.values()].sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0));
}

function topArtistsFromSongs(songs: Track[]): Artist[] {
  const artists = new Map<string, Artist & { plays: number }>();
  for (const song of songs) {
    const key = song.artistId || song.artist.toLowerCase();
    const existing = artists.get(key);
    if (existing) {
      existing.plays += song.playCount || 0;
      if (!existing.coverArt) existing.coverArt = song.coverArt || song.albumCover;
    } else {
      artists.set(key, {
        id: song.artistId || '',
        name: song.artist,
        albumCount: 0,
        coverArt: song.coverArt || song.albumCover,
        plays: song.playCount || 0,
      });
    }
  }
  return [...artists.values()]
    .filter((artist) => artist.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .map(({ plays: _plays, ...artist }) => artist);
}

function ownedPlaylists(playlists: Playlist[], username: string): Playlist[] {
  const key = username.toLowerCase();
  return playlists.filter((playlist) => playlist.owner?.toLowerCase() === key);
}

export async function collectProfileSnapshot(
  profile: ServerProfile,
  settings: AppSettings,
): Promise<WavrSyncProfileInput> {
  const [starredResult, frequentResult, randomResult, playlistsResult, artistsResult] =
    await Promise.allSettled([
      fetchStarred(),
      fetchAlbums('frequent', 24),
      fetchRandomSongs(60),
      fetchPlaylists(),
      fetchArtists(),
    ]);

  const starred =
    starredResult.status === 'fulfilled'
      ? starredResult.value
      : { songs: [] as Track[], albums: [] as Album[], artists: [] as Artist[] };
  const frequent = frequentResult.status === 'fulfilled' ? frequentResult.value : [];
  const random = randomResult.status === 'fulfilled' ? randomResult.value : [];
  const playlists = playlistsResult.status === 'fulfilled' ? playlistsResult.value : [];
  const artists = artistsResult.status === 'fulfilled' ? artistsResult.value : [];

  const frequentDetails = await Promise.allSettled(
    frequent.slice(0, 12).map((album) => fetchAlbum(album.id)),
  );
  const frequentSongs = frequentDetails.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? result.value.songs : [],
  );
  const songPool = [...frequentSongs, ...random];
  const seenSongs = new Set<string>();
  const topSongs = songPool
    .filter((song) => {
      if (seenSongs.has(song.id)) return false;
      seenSongs.add(song.id);
      return true;
    })
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 8);

  const albumArtists = topArtistsFromAlbums(frequent);
  const songArtists = topArtistsFromSongs(frequentSongs);
  const topArtists = (songArtists.length ? songArtists : albumArtists.length ? albumArtists : artists).slice(0, 8);

  return {
    name: profile.username || profile.name,
    avatar: settings.profileImage,
    banner: settings.profileBanner || '',
    tags: Array.isArray(settings.profileTags) ? settings.profileTags : [],
    currentTrack: store.getPlayback().track,
    topSongs,
    topArtists,
    favoriteSongs: starred.songs.slice(0, 8),
    favoriteArtists: starred.artists.slice(0, 8),
    favoriteAlbums: starred.albums.slice(0, 8),
    playlists: ownedPlaylists(playlists, profile.username).slice(0, 8),
  };
}
