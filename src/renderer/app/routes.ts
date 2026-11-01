export interface ParsedRoute {
  page: string;
  id: string;
}

export function route(page: string, id?: string): string {
  return id ? `${page}:${encodeURIComponent(id)}` : page;
}

export function parseRoute(navigation: string): ParsedRoute {
  const separator = navigation.indexOf(':');
  if (separator === -1) return { page: navigation, id: '' };
  const page = navigation.slice(0, separator);
  let id = navigation.slice(separator + 1);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  return { page, id };
}

export const go = {
  home: () => 'home',
  search: () => 'search',
  artists: () => 'artists',
  artist: (id: string) => route('artist', id),
  albums: () => 'albums',
  album: (id: string) => route('album', id),
  songs: () => 'songs',
  genres: () => 'genres',
  genre: (name: string) => route('genre', name),
  playlists: () => 'playlists',
  playlist: (id: string) => route('playlist', id),
  favourites: () => 'favourites',
  queue: () => 'queue',
  settings: () => 'settings',
  lyrics: () => 'lyrics',
  player: () => 'player',
  recentlyPlayed: () => 'recently-played',
  recentlyAdded: () => 'recently-added',
  mostPlayed: () => 'most-played',
  discover: () => 'discover',
  wavrsync: () => 'wavrsync',
  profile: (id: string) => route('profile', id),
};
