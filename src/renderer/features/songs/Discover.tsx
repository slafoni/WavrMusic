import { useEffect, useState } from 'react';
import { useServer, useSettings, store } from '../../state';
import {
  buildDiscoveryTabs,
  loadDiscovery,
  type DiscoveryResult,
} from '../../services/discoveryService';
import { Button } from '../../components/Button';
import { EmptyState, SectionHeader } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { TrackList } from '../../components/TrackList';
import { go } from '../../app/routes';
import { useScrobbleStatus } from '../../hooks/useScrobbling';

const EMPTY: DiscoveryResult = { groups: [], personalized: false };

export function Discover() {
  const { profile } = useServer();
  const settings = useSettings();
  const { status: lastFmStatus } = useScrobbleStatus(settings.scrobbleEnabled, 'lastfm');
  const lastFmUsername = lastFmStatus?.connected ? (lastFmStatus.username || '').trim() : '';
  const lastFmReady = !!lastFmStatus;
  const [result, setResult] = useState<DiscoveryResult>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      return;
    }
    if (!lastFmReady) {
      setLoading(true);
      return;
    }
    if (!lastFmUsername) {
      setResult(EMPTY);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    loadDiscovery(lastFmUsername, reloadKey > 0)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || 'Could not load recommendations.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, lastFmReady, lastFmUsername, reloadKey]);

  useEffect(() => {
    if (activeTab !== 'all' && !result.groups.some((group) => group.id === activeTab)) {
      setActiveTab('all');
    }
  }, [result.groups, activeTab]);

  const tabs = buildDiscoveryTabs(result.groups);
  const visibleGroups =
    activeTab === 'all'
      ? result.groups
      : result.groups.filter((group) => group.id === activeTab);

  if (!profile) {
    return (
      <EmptyState
        icon={<Icon name="cloud_off" size={64} />}
        title="No server connected"
        subtitle="Connect to a server to discover music."
      />
    );
  }

  if (!lastFmReady) {
    return (
      <div className="loading-block"><span className="spinner" /> Checking Last.fm...</div>
    );
  }

  if (!lastFmUsername) {
    return (
      <EmptyState
        icon={<Icon name="music_note" size={64} />}
        title="Connect Last.fm to discover"
        subtitle="Discover only recommends music from the listening history of the Last.fm account you sign in with."
        action={
          <Button
            variant="primary"
            icon="open_in_new"
            label="Open Last.fm settings"
            onClick={() => store.setNavigation(go.settings())}
          />
        }
      />
    );
  }

  return (
    <div className="page discover-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Discover</h1>
          <div className="page-subtitle">
            {result.personalized
              ? `Based on ${lastFmUsername}'s Last.fm listening history`
              : 'Last.fm-based recommendations'}
          </div>
        </div>
        <div className="page-actions">
          <Button
            variant="surface"
            icon="settings"
            label="Discovery settings"
            onClick={() => store.setNavigation(go.settings())}
          />
          <Button
            variant="primary"
            icon="shuffle"
            label="New selection"
            onClick={() => setReloadKey((key) => key + 1)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-block"><span className="spinner" /> Finding music...</div>
      ) : error ? (
        <EmptyState
          icon={<Icon name="error" size={56} />}
          title="Could not load recommendations"
          subtitle={error}
          action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        />
      ) : (
        <>
          {result.warning && (
            <div className="discovery-notice">
              <Icon name="info" size={18} />
              <span>{result.warning}</span>
              <Button
                variant="surface"
                icon="settings"
                label="Open settings"
                onClick={() => store.setNavigation(go.settings())}
              />
            </div>
          )}

          {result.groups.length > 0 ? (
            <>
              {tabs.length > 0 && (
                <div className="discovery-tabbar" role="tablist" aria-label="Discovery recommendations">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      className={`discovery-tab ${activeTab === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <span>{tab.label}</span>
                      {tab.id === 'all' && (
                        <span className="discovery-tab-count">{tab.groupIds.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="discovery-sections" role="tabpanel">
                {visibleGroups.map((group) => (
                  <section className="home-section discovery-section" key={group.id}>
                    <SectionHeader title={group.title} />
                    {group.subtitle && <div className="discovery-section-subtitle">{group.subtitle}</div>}
                    <TrackList
                      tracks={group.tracks}
                      showHeader={false}
                      showAlbum={false}
                      showIndex={false}
                    />
                  </section>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Icon name="auto_awesome" size={56} />}
              title="No recommendations yet"
              subtitle="Listen to more music on Last.fm or add matching tracks to your library, then try again."
              action={<Button variant="surface" icon="refresh" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
            />
          )}
        </>
      )}
    </div>
  );
}
