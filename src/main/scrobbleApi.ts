import crypto from 'crypto';
import type { ScrobbleTrack } from '../../shared/models';
import { normalizeScrobbleTrack } from '../../shared/scrobble';

export type ScrobbleParams = Record<string, string | number | undefined>;

export function createScrobbleSignature(params: ScrobbleParams, secret: string): string {
  const data = Object.keys(params)
    .filter((key) => key !== 'format' && key !== 'callback' && key !== 'api_sig')
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort()
    .map((key) => `${key}${String(params[key])}`)
    .join('');
  return crypto.createHash('md5').update(`${data}${secret}`, 'utf8').digest('hex');
}

export function buildScrobbleRequest(
  method: string,
  apiKey: string,
  secret: string,
  sessionKey: string,
  extra: ScrobbleParams = {},
): Record<string, string> {
  const unsigned: ScrobbleParams = {
    ...extra,
    method,
    api_key: apiKey,
    format: 'json',
    ...(sessionKey ? { sk: sessionKey } : {}),
  };
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(unsigned)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      params[key] = String(value);
    }
  }
  params['api_sig'] = createScrobbleSignature(unsigned, secret);
  return params;
}

export function scrobbleTrackParams(track: ScrobbleTrack, timestamp?: number): ScrobbleParams {
  const normalized = normalizeScrobbleTrack({
    ...track,
    timestamp: timestamp ?? track.timestamp,
  });
  return {
    artist: normalized.artist,
    track: normalized.title,
    album: normalized.album,
    duration: normalized.duration,
    trackNumber: normalized.trackNumber,
    timestamp: normalized.timestamp,
  };
}
