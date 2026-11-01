import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Track } from '../../../shared/models';
import { coverArtUrl, createPlaylist } from '../services/serverService';
import {
  buildSmartMix,
  type SmartMixResult,
  type SmartMixRule,
  type SmartMixSeed,
} from '../services/smartMixService';
import { pushToast } from '../services/toastService';
import { Artwork } from './Artwork';
import { Button } from './Button';
import { Chip } from './Card';
import { Icon } from './Icon';

type SmartMixListener = (seed: SmartMixSeed | null) => void;

let mixListener: SmartMixListener | null = null;

export function openSmartMix(seed: SmartMixSeed) {
  mixListener?.(seed);
}

function defaultName(seed: SmartMixSeed): string {
  return seed.kind === 'track'
    ? `${seed.track.title} mix`
    : `${seed.playlist.name} mix`;
}

function seedDescription(seed: SmartMixSeed): string {
  return seed.kind === 'track'
    ? `${seed.track.title} — ${seed.track.artist}`
    : `Playlist — ${seed.playlist.name}`;
}

function trackReason(track: Track, sharedTags: string[], rule: SmartMixRule): string {
  const parts: string[] = [];
  if (track.bpm) parts.push(`${track.bpm} BPM`);
  if (sharedTags.length) parts.push(sharedTags.slice(0, 3).join(', '));
  if (!parts.length && rule === 'tempo') parts.push('No BPM metadata');
  return parts.join(' · ');
}

export function SmartMixHost() {
  const [seed, setSeed] = useState<SmartMixSeed | null>(null);
  const [rule, setRule] = useState<SmartMixRule>('similar');
  const [result, setResult] = useState<SmartMixResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    mixListener = (next) => {
      setSeed(next);
      setResult(null);
      setError('');
      setSaved(false);
      setRule('similar');
      setName(next ? defaultName(next) : '');
    };
    return () => {
      if (mixListener) mixListener = null;
    };
  }, []);

  if (!seed) return null;

  const generate = async (nextRule = rule) => {
    setLoading(true);
    setError('');
    setSaved(false);
    setRule(nextRule);
    try {
      const next = await buildSmartMix(seed, nextRule, 24);
      setResult(next);
      if (!name.trim()) setName(defaultName(seed));
    } catch (reason: any) {
      setResult(null);
      setError(reason?.message || 'Could not build this mix.');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!result?.tracks.length || !name.trim()) return;
    setSaving(true);
    try {
      await createPlaylist(name.trim(), result.tracks.map((track) => track.id));
      setSaved(true);
      pushToast(`Saved "${name.trim()}" with ${result.tracks.length} tracks.`, 'success');
    } catch (reason: any) {
      pushToast(reason?.message || 'Could not save the playlist.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSeed(null)}>
      <div className="dialog smart-mix-dialog" role="dialog" aria-modal="true" aria-label="Last.fm smart mix">
        <div className="dialog-header">
          <div>
            <div className="dialog-title">Last.fm smart mix</div>
            <div className="settings-description">{seedDescription(seed)}</div>
          </div>
          <Button variant="icon" icon="close" title="Close" onClick={() => setSeed(null)} />
        </div>
        <div className="dialog-body">
          <div className="form-hint">
            Similar tracks and community tags come from Last.fm. Matches are checked against your library. Tempo ordering uses BPM from your server; Last.fm does not provide energy scores.
          </div>

          <div className="smart-mix-rules" role="radiogroup" aria-label="Mix rule">
            <Button
              variant="surface"
              active={rule === 'similar'}
              icon="auto_awesome"
              label="Similar tracks"
              onClick={() => setRule('similar')}
            />
            <Button
              variant="surface"
              active={rule === 'tempo'}
              icon="trending_up"
              label="Low → high tempo"
              onClick={() => setRule('tempo')}
            />
            <Button
              variant="primary"
              icon={result ? 'refresh' : 'auto_awesome'}
              label={loading ? 'Building...' : result ? 'Refresh mix' : 'Generate mix'}
              onClick={() => generate()}
              disabled={loading}
            />
          </div>

          {loading ? (
            <div className="loading-block"><span className="spinner" /> Finding similar tracks...</div>
          ) : error ? (
            <div className="smart-mix-error">
              <Icon name="error" size={18} />
              <span>{error}</span>
            </div>
          ) : result ? (
            <>
              {result.sharedTags.length > 0 && (
                <div className="smart-mix-tags">
                  {result.sharedTags.map((tag) => <Chip key={tag}>{tag}</Chip>)}
                </div>
              )}
              {result.warning && (
                <div className="smart-mix-warning">
                  <Icon name="info" size={17} />
                  <span>{result.warning}</span>
                </div>
              )}
              <div className="smart-mix-summary">
                {result.matched} matched · {result.seedTracks} seed{result.seedTracks === 1 ? '' : 's'}
              </div>
              <div className="smart-mix-list">
                {result.candidates.map((candidate, index) => (
                  <div className="smart-mix-row" key={`${candidate.track.id}-${index}`}>
                    <span className="smart-mix-index">{index + 1}</span>
                    <Artwork
                      src={coverArtUrl(candidate.track.coverArt || candidate.track.albumCover, 80) || null}
                      size={36}
                      radius="small"
                      alt={candidate.track.title}
                    />
                    <span className="smart-mix-copy">
                      <strong>{candidate.track.title}</strong>
                      <small>{candidate.track.artist}</small>
                    </span>
                    <span className="smart-mix-reason">
                      {trackReason(candidate.track, candidate.sharedTags, rule)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="smart-mix-save">
                <input
                  className="form-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Playlist name"
                  aria-label="Playlist name"
                />
                <Button
                  variant="primary"
                  icon="playlist_add"
                  label={saved ? 'Saved' : saving ? 'Saving...' : 'Save snapshot'}
                  onClick={save}
                  disabled={saving || saved || !result.tracks.length || !name.trim()}
                />
              </div>
            </>
          ) : (
            <div className="profile-empty">
              Choose a rule and generate a mix. WAVR will report when Last.fm cannot supply enough matching tracks.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
