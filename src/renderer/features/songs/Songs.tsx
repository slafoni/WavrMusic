import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../../../shared/models';
import { useServer } from '../../state';
import { fetchRandomSongs, searchLibrary } from '../../services/serverService';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { TrackList } from '../../components/TrackList';

export function Songs() {
  const { profile } = useServer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    setSearched(false);
    fetchRandomSongs(100)
      .then((result) => {
        if (!cancelled && requestRef.current === requestId) setTracks(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load songs.');
      })
      .finally(() => {
        if (!cancelled && requestRef.current === requestId) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, reloadKey]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const requestId = ++requestRef.current;
    setSearched(true);
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await searchLibrary(trimmed);
        if (requestRef.current === requestId) setTracks(result.songs);
      } catch (reason: any) {
        if (requestRef.current === requestId) {
          setTracks([]);
          setError(reason?.message || 'Search failed.');
        }
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!query.trim() && searched) {
      setSearched(false);
      setReloadKey((key) => key + 1);
    }
  }, [query, searched]);

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse songs."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Songs</h1>
          <div className="page-subtitle">
            {query.trim() ? `Results for “${query.trim()}”` : 'A random selection from your library'}
          </div>
        </div>
        <div className="page-actions">
          <Button
            variant="surface"
            icon="refresh"
            label="Shuffle selection"
            onClick={() => {
              setQuery('');
              setReloadKey((key) => key + 1);
            }}
          />
        </div>
      </div>

      <div className="search-field" style={{ maxWidth: 560, marginBottom: 22 }}>
        <span className="search-icon"><Icon name="search" size={18} /></span>
        <input
          className="search-input"
          placeholder="Filter songs by title, artist, or album…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter songs"
        />
        {query && (
          <Button
            variant="icon"
            icon="close"
            title="Clear filter"
            style={{ position: 'absolute', right: 4, top: 2 }}
            onClick={() => setQuery('')}
          />
        )}
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading songs…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load songs"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : (
        <TrackList
          tracks={tracks}
          emptyMessage={query.trim() ? `No songs matched “${query.trim()}”.` : 'This library has no songs.'}
        />
      )}
    </div>
  );
}
