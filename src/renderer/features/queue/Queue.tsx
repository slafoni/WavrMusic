import { useQueue } from '../../state';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { QueueList } from '../../components/QueueList';
import { store } from '../../state';
import { go } from '../../app/routes';

export function Queue() {
  const { queue, index } = useQueue();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Queue</h1>
          <div className="page-subtitle">
            {queue.length} track{queue.length === 1 ? '' : 's'}
            {index >= 0 && index < queue.length ? ` · playing track ${index + 1}` : ''}
          </div>
        </div>
        <div className="page-actions">
          <Button variant="surface" icon="home" label="Browse library" onClick={() => store.setNavigation(go.home())} />
        </div>
      </div>

      {queue.length === 0 ? (
        <EmptyState
          icon={<Icon name="queue_music" size={64} />}
          title="Queue is empty"
          subtitle="Play songs, albums or playlists and they will appear here."
          action={<Button variant="primary" icon="home" label="Browse library" onClick={() => store.setNavigation(go.home())} />}
        />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <QueueList showActions />
        </div>
      )}
    </div>
  );
}
