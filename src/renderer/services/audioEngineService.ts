import type { AppSettings } from '../../../shared/models';

export interface AudioEngineDevice {
  id: string;
  name: string;
  isDefault: boolean;
  channels?: number;
  sampleRate?: number;
}

export interface AudioEngineInfo {
  available: boolean;
  platform: string;
  version?: string;
  path?: string;
  reason?: string;
}

export interface AudioEngineOutput {
  mode: 'shared' | 'exclusive';
  deviceName: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  usedAudioClient3: boolean;
  warnings?: string[];
}

export interface AudioEngineEvent {
  event: string;
  trackId?: string;
  queueIndex?: number;
  state?: string;
  position?: number;
  duration?: number;
  message?: string;
  mode?: string;
  deviceName?: string;
  sampleRate?: number;
  channels?: number;
  sampleFormat?: string;
  usedAudioClient3?: boolean;
  warnings?: string[];
  platform?: string;
  version?: string;
  arch?: string;
  [key: string]: unknown;
}

interface SidecarConfig {
  mode: 'shared' | 'exclusive';
  deviceId: string;
  volume: number;
  muted: boolean;
  dspEnabled: boolean;
  eqEnabled: boolean;
  eqBands: number[];
  eqQ: number;
  replayGain: 'off' | 'track' | 'album';
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  channelMode: 'auto' | 'stereo' | 'surround';
  resampleQuality: 'auto' | 'high' | 'fast';
}

export interface AudioEnginePlayPayload {
  url: string;
  trackId: string;
  queueIndex: number;
  position?: number;
  autoplay?: boolean;
  config: SidecarConfig;
}

function api(): any {
  return (window as any).electronAPI;
}

export function isAudioEngineSupported(): boolean {
  const platform = api()?.platform;
  return (
    (platform === 'win32' || platform === 'linux') &&
    typeof api()?.audioEnginePlay === 'function'
  );
}

export async function getAudioEngineInfo(): Promise<AudioEngineInfo> {
  if (!isAudioEngineSupported()) {
    return {
      available: false,
      platform: api()?.platform || 'unknown',
      reason: 'WavrPulse is only available on Windows and Linux.',
    };
  }
  try {
    return await api().audioEngineInfo();
  } catch (error: any) {
    return {
      available: false,
      platform: api()?.platform || 'unknown',
      reason: error?.message || 'The WavrPulse audio engine is unavailable.',
    };
  }
}

export async function getAudioEngineDevices(): Promise<AudioEngineDevice[]> {
  if (!isAudioEngineSupported()) return [];
  const response = await api().audioEngineDevices();
  return Array.isArray(response?.devices) ? response.devices : [];
}

export function buildAudioEngineConfig(
  settings: AppSettings,
  volume: number,
  muted: boolean,
): SidecarConfig {
  const dsp = !!settings.dspEnabled;
  const platform = api()?.platform;
  return {
    mode:
      platform !== 'linux' && settings.audioEngine === 'wasapi-exclusive'
        ? 'exclusive'
        : 'shared',
    deviceId: settings.audioDeviceId || '',
    volume,
    muted,
    dspEnabled: dsp,
    eqEnabled: dsp && !!settings.equalizerEnabled,
    eqBands: Array.isArray(settings.equalizerBands) ? settings.equalizerBands : [],
    eqQ: Number(settings.equalizerQ) || 1.05,
    replayGain: dsp ? settings.replayGain || 'off' : 'off',
    normalizeVolume: dsp && !!settings.normalizeVolume,
    crossfadeSeconds: dsp ? Number(settings.crossfadeSeconds) || 0 : 0,
    channelMode: settings.channelMode || 'auto',
    resampleQuality: settings.resampleQuality || 'auto',
  };
}

export async function playWithAudioEngine(payload: AudioEnginePlayPayload): Promise<void> {
  await api().audioEnginePlay(payload);
}

export async function prepareAudioEngineNext(payload: {
  url: string;
  trackId: string;
  queueIndex: number;
}): Promise<void> {
  await api().audioEngineCommand('prepareNext', payload);
}

export async function configureAudioEngine(config: SidecarConfig): Promise<void> {
  await api().audioEngineCommand('configure', { config });
}

export async function pauseAudioEngine(): Promise<void> {
  await api().audioEngineCommand('pause', {});
}

export async function resumeAudioEngine(): Promise<void> {
  await api().audioEngineCommand('resume', {});
}

export async function stopAudioEngine(): Promise<void> {
  await api().audioEngineCommand('stop', {});
}

export async function seekAudioEngine(position: number): Promise<void> {
  await api().audioEngineCommand('seek', { position });
}

export async function setAudioEngineVolume(volume: number, muted: boolean): Promise<void> {
  await api().audioEngineCommand('volume', { volume, muted });
}

export async function cancelAudioEngineNext(): Promise<void> {
  await api().audioEngineCommand('cancelNext', {});
}

export function onAudioEngineEvent(
  callback: (event: AudioEngineEvent) => void,
): () => void {
  const subscribe = api()?.onAudioEngineEvent;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe(callback);
}
