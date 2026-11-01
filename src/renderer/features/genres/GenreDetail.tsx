import { useEffect, useState } from 'react';
import type { Track } from '../../../../shared/models';
import { store, useServer } from '../../state';
import { fetchSongsByGenre } from '../../services/serverService';
import { playback } from '../../services/playbackService';
import { pushToast } from '../../services/toastService';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';

export function GenreDetail({ name }: { name: string }) {
  const { profile } = useServer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile || !name) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSongsByGenre(name, 300)
      .then((result) => {
        if (!cancelled) setTracks(result);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load this genre.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, name]);

  const play = (shuffle: boolean) => {
    if (!tracks.length) return;
    playback.setShuffle(shuffle);
    playback.playQueue(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0);
  };

  const back = (
    <Button variant="icon" icon="arrow_back" title="Back to genres" onClick={() => store.setNavigation(go.genres())} />
  );

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to browse genres."
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 16 }}>
        {back}
      </div>

      <div className="page-header">
        <div>
          <div className="detail-kicker">Genre</div>
          <h1 className="page-title">{name}</h1>
          <div className="page-subtitle">{tracks.length} songs</div>
        </div>
        <div className="page-actions">
          <Button variant="primary" icon="play_arrow" label="Play" onClick={() => play(false)} disabled={!tracks.length} />
          <Button variant="surface" icon="shuffle" label="Shuffle" onClick={() => play(true)} disabled={!tracks.length} />
          <Button
            variant="surface"
            icon="queue_music"
            label="Queue"
            disabled={!tracks.length}
            onClick={() => {
              playback.addToQueue(tracks);
              pushToast(`Added ${tracks.length} songs to the queue.`, 'success');
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Loading songs…</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load genre"
          subtitle={error}
        />
      ) : (
        <TrackList tracks={tracks} emptyMessage="No songs were found for this genre." />
      )}
    </div>
  );
}
