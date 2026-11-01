import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { AppSettings } from '../../shared/models';
import { buildAudioEngineConfig } from '../../src/renderer/services/audioEngineService';

function settings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('WavrPulse engine configuration', () => {
  it('keeps DSP disabled by default', () => {
    const config = buildAudioEngineConfig(settings(), 0.7, false);
    expect(config.mode).toBe('shared');
    expect(config.volume).toBe(0.7);
    expect(config.muted).toBe(false);
    expect(config.dspEnabled).toBe(false);
    expect(config.eqEnabled).toBe(false);
    expect(config.replayGain).toBe('off');
    expect(config.normalizeVolume).toBe(false);
    expect(config.crossfadeSeconds).toBe(0);
  });

  it('maps exclusive and DSP settings into the native engine config', () => {
    const config = buildAudioEngineConfig(
      settings({
        audioEngine: 'wasapi-exclusive',
        audioDeviceId: 'device-1',
        dspEnabled: true,
        equalizerEnabled: true,
        equalizerBands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        equalizerQ: 1.4,
        replayGain: 'album',
        normalizeVolume: true,
        crossfadeSeconds: 4,
        channelMode: 'surround',
        resampleQuality: 'high',
      }),
      0.5,
      true,
    );
    expect(config.mode).toBe('exclusive');
    expect(config.deviceId).toBe('device-1');
    expect(config.dspEnabled).toBe(true);
    expect(config.eqEnabled).toBe(true);
    expect(config.eqQ).toBe(1.4);
    expect(config.eqBands).toHaveLength(10);
    expect(config.replayGain).toBe('album');
    expect(config.normalizeVolume).toBe(true);
    expect(config.crossfadeSeconds).toBe(4);
    expect(config.channelMode).toBe('surround');
    expect(config.resampleQuality).toBe('high');
    expect(config.muted).toBe(true);
  });

  it('suppresses DSP settings when the pipeline is disabled', () => {
    const config = buildAudioEngineConfig(
      settings({
        dspEnabled: false,
        equalizerEnabled: true,
        replayGain: 'track',
        normalizeVolume: true,
        crossfadeSeconds: 8,
      }),
      1,
      false,
    );
    expect(config.eqEnabled).toBe(false);
    expect(config.replayGain).toBe('off');
    expect(config.normalizeVolume).toBe(false);
    expect(config.crossfadeSeconds).toBe(0);
  });
});
