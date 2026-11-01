/* Playback engine: native WavrPulse with HTMLMediaElement fallback. */

import { store } from '../state';
import { streamUrl, directCoverArtUrl, scrobbleTrack } from './serverService';
import { EQUALIZER_FREQUENCIES } from '../../../shared/constants';
import { pushToast } from './toastService';
import {
  buildAudioEngineConfig,
  cancelAudioEngineNext,
  configureAudioEngine,
  isAudioEngineSupported,
  onAudioEngineEvent,
  pauseAudioEngine,
  playWithAudioEngine,
  prepareAudioEngineNext,
  resumeAudioEngine,
  seekAudioEngine,
  setAudioEngineVolume,
  stopAudioEngine,
} from './audioEngineService';
import type { AudioEngineEvent, AudioEngineOutput } from './audioEngineService';
import type { AppSettings, PlaybackState, Track } from '../../../shared/models';

type Status = PlaybackState['status'];

const QUEUE_STORAGE_KEY = 'wavr.queue.v1';

class PlaybackService {
  private audio: HTMLAudioElement;
  private queue: Track[] = [];
  private index = -1;
  private status: Status = 'idle';
  private volume = 0.85;
  private muted = false;
  private shuffle = false;
  private repeat: 'off' | 'one' | 'all' = 'off';
  private lastProgressWrite = 0;
  private startedAt = 0;
  private seekInFlight = false;
  private mediaSessionReady = false;
  private lastMediaPositionUpdate = 0;
  private audioContext: AudioContext | null = null;
  private equalizerFilters: BiquadFilterNode[] = [];
  private equalizerPreamp: GainNode | null = null;
  private equalizerEnabled = false;
  private equalizerBands: number[] = Array(EQUALIZER_FREQUENCIES.length).fill(0);
  private nativeActive = false;
  private nativeTrackId: string | null = null;
  private nativePosition = 0;
  private nativeDuration = 0;
  private nativePlayerReady = false;
  private engineUnavailable = false;
  private prepareNextTimer = 0;
  private nativeConfigTimer = 0;
  private nativeRequest = 0;
  private nativeNextKey: string | null = null;
  private nativeOutput: AudioEngineOutput | null = null;
  private unsubscribeEngine: (() => void) | null = null;
  private browserFallbackNotified = false;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = this.volume;
    this.audio.muted = this.muted;
    this.bindAudio();
    this.bindMediaSession();
    this.unsubscribeEngine = onAudioEngineEvent((event) => this.handleAudioEngineEvent(event));
  }

  private bindAudio() {
    const audio = this.audio;
    const enforceVolume = () => {
      if (Math.abs(audio.volume - this.volume) > 0.001) audio.volume = this.volume;
      if (audio.muted !== this.muted) audio.muted = this.muted;
    };
    audio.addEventListener('volumechange', enforceVolume);
    audio.addEventListener('loadedmetadata', enforceVolume);
    audio.addEventListener('playing', enforceVolume);

    audio.addEventListener('loadstart', () => {
      if (!this.nativeActive) this.setStatus('loading');
    });

    audio.addEventListener('playing', () => {
      if (this.nativeActive) return;
      this.setStatus('playing');
      this.startedAt = Date.now();
    });

    audio.addEventListener('play', () => {
      if (this.nativeActive) return;
      if (this.status !== 'playing') this.setStatus('playing');
    });

    audio.addEventListener('pause', () => {
      if (this.nativeActive) return;
      if (this.status === 'ended' || this.status === 'failed' || this.status === 'idle') return;
      this.setStatus('paused');
    });

    audio.addEventListener('waiting', () => {
      if (!this.nativeActive) this.setStatus('buffering');
    });
    audio.addEventListener('stalled', () => {
      if (!this.nativeActive) this.setStatus('buffering');
    });

    audio.addEventListener('canplay', () => {
      if (this.nativeActive) return;
      if (this.status === 'loading' || this.status === 'buffering') {
        if (audio.paused) this.setStatus('paused');
        else this.setStatus('playing');
      }
    });

    audio.addEventListener('timeupdate', () => {
      if (this.nativeActive) return;
      const now = performance.now();
      if (now - this.lastProgressWrite < 200) return;
      this.lastProgressWrite = now;
      store.setProgress(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
      this.updateMediaPosition(audio.currentTime, audio.duration);
    });

    audio.addEventListener('durationchange', () => {
      if (this.nativeActive) return;
      store.setProgress(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
      this.updateMediaPosition(audio.currentTime, audio.duration);
    });

    audio.addEventListener('seeking', () => {
      if (this.nativeActive) return;
      if (!this.seekInFlight) this.setStatus('seeking');
    });

    audio.addEventListener('seeked', () => {
      if (this.nativeActive) return;
      this.seekInFlight = false;
      if (this.status === 'seeking') {
        this.setStatus(audio.paused ? 'paused' : 'playing');
      }
    });

    audio.addEventListener('ended', () => {
      if (!this.nativeActive) this.handleTrackEnded();
    });

    audio.addEventListener('error', () => {
      if (this.nativeActive) return;
      const code = this.audio.error?.code;
      let message = 'Playback failed.';
      if (code === 1) message = 'Playback was aborted.';
      else if (code === 2) message = 'A network error interrupted playback.';
      else if (code === 3) message = 'This track could not be decoded.';
      else if (code === 4) message = 'This track format is not supported or the stream is unavailable.';
      this.fail(message);
    });
  }

  private bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const safe = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* action unsupported */
      }
    };
    safe('play', () => this.resume());
    safe('pause', () => this.pause());
    safe('nexttrack', () => this.next(true));
    safe('previoustrack', () => this.prev());
    safe('seekbackward', (details) => this.seek(this.getCurrentTime() - (details.seekOffset || 10)));
    safe('seekforward', (details) => this.seek(this.getCurrentTime() + (details.seekOffset || 10)));
    safe('seekto', (details) => this.seek(details.seekTime || 0));
    this.mediaSessionReady = true;
  }

  private ensureEqualizerGraph() {
    if (this.audioContext) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    try {
      const context = new Ctor();
      const source = context.createMediaElementSource(this.audio);
      const preamp = context.createGain();
      preamp.gain.value = 1;
      let previous: AudioNode = preamp;
      source.connect(preamp);
      this.equalizerFilters = EQUALIZER_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1.05;
        filter.gain.value = 0;
        previous.connect(filter);
        previous = filter;
        return filter;
      });
      previous.connect(context.destination);
      this.audioContext = context;
      this.equalizerPreamp = preamp;
      this.applyEqualizerGains();
    } catch {
      /* Web Audio is optional; direct element playback stays available. */
    }
  }

  private applyEqualizerGains() {
    if (!this.audioContext) return;
    this.equalizerFilters.forEach((filter, index) => {
      const value = this.equalizerEnabled ? this.equalizerBands[index] ?? 0 : 0;
      filter.gain.value = Math.max(-12, Math.min(12, Number(value) || 0));
    });
    if (this.equalizerPreamp) {
      const maxBoost = this.equalizerEnabled
        ? Math.max(0, ...this.equalizerBands.map((value) => Math.max(0, Math.min(12, Number(value) || 0))))
        : 0;
      this.equalizerPreamp.gain.value = maxBoost > 0 ? Math.pow(10, -maxBoost / 20) : 1;
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  applyAudioSettings() {
    const settings = store.getSettings();
    this.equalizerEnabled = !!settings.dspEnabled && !!settings.equalizerEnabled;
    this.equalizerBands = Array.isArray(settings.equalizerBands)
      ? EQUALIZER_FREQUENCIES.map((_, index) => Number(settings.equalizerBands[index]) || 0)
      : Array(EQUALIZER_FREQUENCIES.length).fill(0);
    if (this.nativeActive) {
      this.scheduleNativeConfig();
      return;
    }
    if (settings.dspEnabled && this.equalizerEnabled) this.ensureEqualizerGraph();
    this.applyEqualizerGains();
  }

  reloadCurrent() {
    if (this.index < 0 || this.index >= this.queue.length) return;
    const position = this.getCurrentTime();
    const autoplay = this.status === 'playing' || this.status === 'buffering' || this.status === 'seeking';
    this.loadIndex(this.index, autoplay, position);
  }

  getAudioEngineOutput(): AudioEngineOutput | null {
    return this.nativeOutput;
  }

  isUsingAudioEngine(): boolean {
    return this.nativeActive;
  }

  resetAudioEngineFailure() {
    this.engineUnavailable = false;
  }

  private isNativeMode(_settings: AppSettings): boolean {
    return isAudioEngineSupported() && !this.engineUnavailable;
  }

  private startBrowser(url: string, autoplay: boolean, startPosition = 0) {
    this.nativeRequest += 1;
    this.nativeActive = false;
    this.nativePlayerReady = false;
    this.nativeTrackId = null;
    this.audio.volume = this.volume;
    this.audio.muted = this.muted;
    this.audio.src = url;
    this.audio.load();
    if (startPosition > 0) {
      const restore = () => {
        try {
          this.audio.currentTime = startPosition;
        } catch {
          /* ignore */
        }
      };
      this.audio.addEventListener('loadedmetadata', restore, { once: true });
    }
    if (autoplay) {
      if (store.getSettings().dspEnabled && this.equalizerEnabled) this.ensureEqualizerGraph();
      this.audioContext?.resume().catch(() => {});
      this.audio.play().catch((error: any) => {
        if (error?.name === 'NotAllowedError') {
          this.setStatus('paused');
        } else {
          this.fail(error?.message || 'Unable to start playback.');
        }
      });
    } else {
      this.setStatus('paused');
    }
  }

  private async startNative(
    index: number,
    track: Track,
    url: string,
    autoplay: boolean,
    startPosition: number,
  ) {
    const requestId = ++this.nativeRequest;
    this.nativeActive = true;
    this.nativePlayerReady = false;
    this.nativeTrackId = track.id;
    this.nativePosition = startPosition;
    this.nativeDuration = track.duration || 0;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.setStatus('loading');
    store.setProgress(startPosition, this.nativeDuration);
    const settings = store.getSettings();
    try {
      await playWithAudioEngine({
        url,
        trackId: track.id,
        queueIndex: index,
        position: startPosition,
        autoplay,
        config: buildAudioEngineConfig(settings, this.volume, this.muted),
      });
    } catch (error: any) {
      if (requestId !== this.nativeRequest || this.nativeTrackId !== track.id) return;
      this.fallbackToBrowser(
        error?.message || 'WavrPulse is unavailable. Switching to system audio.',
      );
    }
  }

  private scheduleNativeConfig() {
    window.clearTimeout(this.nativeConfigTimer);
    this.nativeConfigTimer = window.setTimeout(() => {
      if (!this.nativeActive) return;
      const settings = store.getSettings();
      configureAudioEngine(buildAudioEngineConfig(settings, this.volume, this.muted)).catch(() => {});
      this.schedulePrepareNext();
    }, 80);
  }

  private schedulePrepareNext() {
    window.clearTimeout(this.prepareNextTimer);
    if (!this.nativeActive || !this.nativePlayerReady || this.engineUnavailable) return;
    const settings = store.getSettings();
    const nextIndex = this.nextTrackIndex();
    if (nextIndex === null) {
      this.nativeNextKey = null;
      cancelAudioEngineNext().catch(() => {});
      return;
    }
    const nextTrack = this.queue[nextIndex];
    if (!nextTrack) return;
    const key = `${this.nativeTrackId}|${nextTrack.id}|${nextIndex}`;
    if (this.nativeNextKey === key) return;
    const url = streamUrl(nextTrack.id, settings.streamBitrate, settings.streamFormat);
    this.prepareNextTimer = window.setTimeout(() => {
      if (!this.nativeActive || !this.nativePlayerReady) return;
      prepareAudioEngineNext({
        url,
        trackId: nextTrack.id,
        queueIndex: nextIndex,
      })
        .then(() => {
          this.nativeNextKey = key;
        })
        .catch(() => {
          this.nativeNextKey = null;
        });
    }, 250);
  }

  private nextTrackIndex(): number | null {
    if (!this.queue.length) return null;
    if (this.shuffle) {
      if (this.queue.length === 1) return 0;
      let nextIndex = this.index;
      while (nextIndex === this.index) {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      }
      return nextIndex;
    }
    if (this.index + 1 < this.queue.length) return this.index + 1;
    if (this.repeat === 'all') return 0;
    if (this.repeat === 'one') return this.index;
    return null;
  }

  private handleAudioEngineEvent(event: AudioEngineEvent) {
    const type = String(event.event || '');
    const eventTrackId = typeof event.trackId === 'string' ? event.trackId : null;
    if (type === 'engineExit') {
      if (this.nativeActive) {
        this.fallbackToBrowser(String(event.message || 'WavrPulse stopped.'));
      }
      return;
    }
    if (type === 'output') {
      this.nativeOutput = {
        mode: event.mode === 'exclusive' ? 'exclusive' : 'shared',
        deviceName: String(event.deviceName || 'Audio output'),
        sampleRate: Number(event.sampleRate) || 0,
        channels: Number(event.channels) || 0,
        sampleFormat: String(event.sampleFormat || ''),
        usedAudioClient3: !!event.usedAudioClient3,
      };
      return;
    }
    if (type === 'warning') {
      const message = String(event.message || '');
      if (message) pushToast(message, 'info');
      return;
    }
    if (type === 'nextError') {
      this.nativeNextKey = null;
      const settings = store.getSettings();
      if (settings.dspEnabled && Number(settings.crossfadeSeconds) > 0) {
        const message = String(event.message || 'Crossfade is unavailable for the next track.');
        pushToast(message, 'info');
      }
      return;
    }
    if (type === 'trackChanged') {
      this.handleNativeTrackChanged(event);
      return;
    }
    if (!this.nativeActive) return;
    if (eventTrackId && this.nativeTrackId && eventTrackId !== this.nativeTrackId) return;

    if (type === 'state') {
      const state = String(event.state || '');
      if (Number.isFinite(Number(event.position))) {
        this.nativePosition = Number(event.position);
        store.setProgress(this.nativePosition, this.nativeDuration);
      }
      if (state === 'loading') {
        this.nativePlayerReady = false;
        this.setStatus('loading');
      } else if (state === 'playing') {
        this.nativePlayerReady = true;
        this.setStatus('playing');
        if (!this.startedAt) this.startedAt = Date.now();
        this.schedulePrepareNext();
      } else if (state === 'paused') {
        this.setStatus('paused');
      } else if (state === 'seeking') {
        this.setStatus('seeking');
      }
      return;
    }
    if (type === 'position') {
      this.nativePosition = Number(event.position) || 0;
      this.nativeDuration = Number(event.duration) || this.nativeDuration;
      store.setProgress(this.nativePosition, this.nativeDuration);
      this.updateMediaPosition(this.nativePosition, this.nativeDuration);
      return;
    }
    if (type === 'ended') {
      if (eventTrackId && eventTrackId === this.nativeTrackId) {
        this.nativePlayerReady = false;
        this.handleTrackEnded();
      }
      return;
    }
    if (type === 'error') {
      if (eventTrackId && eventTrackId === this.nativeTrackId) {
        this.fallbackToBrowser(String(event.message || 'WavrPulse could not play this track.'));
      }
    }
  }

  private handleNativeTrackChanged(event: AudioEngineEvent) {
    if (!this.nativeActive) return;
    const trackId = String(event.trackId || '');
    const queueIndex = Number(event.queueIndex);
    let index = -1;
    if (Number.isInteger(queueIndex) && this.queue[queueIndex]?.id === trackId) {
      index = queueIndex;
    } else {
      index = this.queue.findIndex((track) => track.id === trackId);
    }
    if (index < 0) return;
    this.scrobbleIfNeeded();
    this.nativeNextKey = null;
    this.index = index;
    const track = this.queue[index];
    this.nativeTrackId = track.id;
    this.nativePosition = Number(event.position) || 0;
    this.nativeDuration = Number(event.duration) || track.duration || 0;
    this.nativePlayerReady = true;
    store.setQueueIndex(index);
    store.setTrack(track, 'playing');
    store.setProgress(this.nativePosition, this.nativeDuration);
    this.updateMediaSession(track);
    this.startedAt = Date.now();
    this.setStatus('playing');
    this.schedulePrepareNext();
  }

  private updateMediaSession(track: Track | null) {
    if (!this.mediaSessionReady || !('mediaSession' in navigator)) return;
    try {
      if (!track) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      const artworkUrl = directCoverArtUrl(track.coverArt, 512);
      const artwork = artworkUrl
        ? [{ src: artworkUrl, sizes: '512x512' }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork,
      });
      this.updateMediaPosition(this.getCurrentTime(), this.getDuration() || track.duration || 0);
    } catch {
      /* ignore */
    }
  }

  private updateMediaPosition(position: number, duration: number) {
    if (!this.mediaSessionReady || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    const now = performance.now();
    if (now - this.lastMediaPositionUpdate < 1000) return;
    this.lastMediaPositionUpdate = now;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(duration, position)),
      });
    } catch {
      /* position reporting is optional */
    }
  }

  private setStatus(status: Status) {
    if (this.status === status) return;
    this.status = status;
    store.setPlaybackStatus(status);
    if (this.mediaSessionReady && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState =
          status === 'playing' || status === 'buffering'
            ? 'playing'
            : status === 'paused'
              ? 'paused'
              : 'none';
      } catch {
        /* ignore */
      }
    }
  }

  private fail(message: string) {
    if (this.status === 'failed') return;
    this.setStatus('failed');
    store.setPlayback({ error: message });
    pushToast(message, 'error');
  }

  private fallbackToBrowser(message: string) {
    const track = this.getCurrentTrack();
    if (!track) {
      this.fail(message);
      return;
    }
    const settings = store.getSettings();
    const url = streamUrl(track.id, settings.streamBitrate, settings.streamFormat);
    const autoplay =
      this.status === 'playing'
      || this.status === 'loading'
      || this.status === 'buffering'
      || this.status === 'seeking';
    const position = this.nativeActive ? this.nativePosition : this.getCurrentTime();
    this.engineUnavailable = true;
    this.nativeActive = false;
    this.nativePlayerReady = false;
    this.nativeTrackId = null;
    this.nativeNextKey = null;
    store.setPlayback({ error: null });
    if (!this.browserFallbackNotified) {
      this.browserFallbackNotified = true;
      pushToast('WavrPulse is unavailable. Using system audio.', 'info');
    }
    this.startBrowser(url, autoplay, position);
  }

  private handleTrackEnded() {
    this.scrobbleIfNeeded();
    if (this.repeat === 'one') {
      if (this.nativeActive) {
        this.loadIndex(this.index, true, 0);
        return;
      }
      this.audio.currentTime = 0;
      this.audio.play().catch(() => this.setStatus('paused'));
      return;
    }
    const nextIndex = this.index + 1;
    if (nextIndex < this.queue.length) {
      this.playIndex(nextIndex, true);
      return;
    }
    if (this.repeat === 'all' && this.queue.length > 0) {
      this.playIndex(0, true);
      return;
    }
    this.setStatus('ended');
    const duration = this.getDuration();
    store.setProgress(duration, duration);
  }

  private scrobbleIfNeeded() {
    const track = this.getCurrentTrack();
    if (!track || !this.startedAt) return;
    const listenedSeconds = (Date.now() - this.startedAt) / 1000;
    const duration = this.getDuration() || track.duration || 0;
    const threshold = Math.min(duration > 0 ? duration * 0.5 : 240, 240);
    if (listenedSeconds >= threshold) {
      scrobbleTrack(track.id, true);
    }
    this.startedAt = 0;
  }

  getStatus(): Status {
    return this.status;
  }

  getCurrentTrack(): Track | null {
    return this.index >= 0 && this.index < this.queue.length ? this.queue[this.index] : null;
  }

  getQueue(): Track[] {
    return this.queue;
  }

  getQueueIndex(): number {
    return this.index;
  }

  getCurrentTime(): number {
    return this.nativeActive ? this.nativePosition : this.audio.currentTime || 0;
  }

  getDuration(): number {
    if (this.nativeActive) return this.nativeDuration;
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  getShuffle(): boolean {
    return this.shuffle;
  }

  getRepeat(): 'off' | 'one' | 'all' {
    return this.repeat;
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.audio.volume = this.volume;
    if (this.volume > 0 && this.muted) this.setMuted(false);
    if (this.nativeActive) {
      setAudioEngineVolume(this.volume, this.muted).catch(() => {});
    }
    store.setPlayback({ volume: this.volume });
    store.updateSettings({ defaultVolume: this.volume });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.audio.muted = muted;
    if (this.nativeActive) {
      setAudioEngineVolume(this.volume, this.muted).catch(() => {});
    }
    store.setPlayback({ muted });
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  setShuffle(shuffle: boolean) {
    this.shuffle = shuffle;
    store.setPlayback({ shuffle });
    if (this.nativeActive) this.schedulePrepareNext();
  }

  setRepeat(repeat: 'off' | 'one' | 'all') {
    this.repeat = repeat;
    store.setPlayback({ repeat });
    if (this.nativeActive) this.schedulePrepareNext();
  }

  seek(seconds: number) {
    const duration = this.getDuration();
    const target = Math.max(0, Math.min(duration > 0 ? duration : seconds, seconds));
    this.seekInFlight = true;
    this.setStatus('seeking');
    if (this.nativeActive) {
      this.nativePosition = target;
      store.setProgress(target, duration);
      seekAudioEngine(target).catch(() => {});
      return;
    }
    try {
      this.audio.currentTime = target;
    } catch {
      /* ignore invalid seek */
    }
    store.setProgress(target, duration);
    this.updateMediaPosition(target, duration);
  }

  pause() {
    if (this.nativeActive) {
      pauseAudioEngine().catch(() => {});
      this.setStatus('paused');
      return;
    }
    this.audio.pause();
  }

  resume() {
    if (!this.getCurrentTrack()) return;
    if (this.status === 'ended') {
      this.replay();
      return;
    }
    if (this.nativeActive) {
      resumeAudioEngine()
        .then(() => {
          this.setStatus('playing');
          this.startedAt = Date.now();
        })
        .catch(() => {
          this.engineUnavailable = true;
          this.nativeActive = false;
          this.nativePlayerReady = false;
          this.nativeTrackId = null;
          this.fail('WavrPulse could not resume playback.');
        });
      return;
    }
    if (isAudioEngineSupported() && !this.engineUnavailable) {
      if (this.index >= 0 && this.index < this.queue.length) {
        this.loadIndex(this.index, true, this.getCurrentTime());
      }
      return;
    }
    if (this.equalizerEnabled) this.ensureEqualizerGraph();
    this.audioContext?.resume().catch(() => {});
    this.audio.play().catch(() => this.setStatus('paused'));
  }

  playPause() {
    if (this.status === 'playing' || this.status === 'buffering') {
      this.pause();
    } else if (this.status === 'ended') {
      this.replay();
    } else {
      this.resume();
    }
  }

  replay() {
    if (this.index < 0 || this.index >= this.queue.length) return;
    this.loadIndex(this.index, true, 0);
  }

  stop() {
    this.nativeRequest += 1;
    this.nativeNextKey = null;
    window.clearTimeout(this.prepareNextTimer);
    if (this.nativeActive) {
      stopAudioEngine().catch(() => {});
    }
    this.nativeActive = false;
    this.nativePlayerReady = false;
    this.nativeTrackId = null;
    this.nativePosition = 0;
    this.nativeDuration = 0;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.startedAt = 0;
    this.index = -1;
    store.setPlayback({
      status: 'idle',
      track: null,
      currentTime: 0,
      duration: 0,
      error: null,
    });
    store.setQueueIndex(-1);
    this.updateMediaSession(null);
  }

  private loadIndex(index: number, autoplay: boolean, startPosition = 0) {
    if (index < 0 || index >= this.queue.length) return;
    window.clearTimeout(this.prepareNextTimer);
    this.nativeNextKey = null;
    const track = this.queue[index];
    this.index = index;
    store.setQueueIndex(index);
    store.setTrack(track, 'loading');
    store.setPlayback({ duration: track.duration || 0 });
    this.updateMediaSession(track);

    const settings = store.getSettings();
    const url = streamUrl(track.id, settings.streamBitrate, settings.streamFormat);
    if (this.isNativeMode(settings)) {
      void this.startNative(index, track, url, autoplay, startPosition);
      return;
    }
    if (this.nativeActive) stopAudioEngine().catch(() => {});
    this.startBrowser(url, autoplay, startPosition);
  }

  playQueue(tracks: Track[], startIndex = 0, autoplay = true) {
    if (!tracks.length) return;
    this.queue = [...tracks];
    this.index = -1;
    store.setQueue(this.queue, -1);
    this.loadIndex(Math.max(0, Math.min(startIndex, tracks.length - 1)), autoplay);
  }

  playTrackNow(track: Track) {
    const existing = this.queue.findIndex((entry) => entry.id === track.id);
    if (existing >= 0) {
      this.loadIndex(existing, true);
      return;
    }
    this.queue = [...this.queue, track];
    this.index = this.queue.length - 1;
    store.setQueue(this.queue, this.index);
    this.loadIndex(this.index, true);
  }

  addToQueue(tracks: Track[]) {
    if (!tracks.length) return;
    this.queue = [...this.queue, ...tracks];
    store.setQueue(this.queue, this.index);
    store.setQueueIndex(this.index);
    if (this.nativeActive) this.schedulePrepareNext();
  }

  playNext(track: Track) {
    const insertAt = this.index + 1;
    this.queue = [...this.queue.slice(0, insertAt), track, ...this.queue.slice(insertAt)];
    store.setQueue(this.queue, this.index);
    if (this.nativeActive) this.schedulePrepareNext();
  }

  removeFromQueue(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    const removedCurrent = index === this.index;
    this.queue = this.queue.filter((_, i) => i !== index);
    if (index < this.index) this.index -= 1;
    if (removedCurrent) {
      if (this.queue.length === 0) {
        this.stop();
        return;
      }
      this.index = Math.min(this.index, this.queue.length - 1);
      store.setQueue(this.queue, this.index);
      this.loadIndex(this.index, this.status === 'playing' || this.status === 'buffering');
      return;
    }
    store.setQueue(this.queue, this.index);
    if (this.nativeActive) this.schedulePrepareNext();
  }

  moveInQueue(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= this.queue.length ||
      to >= this.queue.length
    ) {
      return;
    }
    const copy = [...this.queue];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    this.queue = copy;
    if (this.index === from) this.index = to;
    else if (from < this.index && to >= this.index) this.index -= 1;
    else if (from > this.index && to <= this.index) this.index += 1;
    store.setQueue(this.queue, this.index);
    if (this.nativeActive) this.schedulePrepareNext();
  }

  clearQueue() {
    const current = this.getCurrentTrack();
    if (current) {
      this.queue = [current];
      this.index = 0;
      store.setQueue(this.queue, 0);
      if (this.nativeActive) this.schedulePrepareNext();
    } else {
      this.queue = [];
      this.index = -1;
      store.setQueue([], -1);
    }
  }

  next(manual = true) {
    if (this.queue.length === 0) return;
    if (this.shuffle) {
      if (this.queue.length === 1) {
        this.playIndex(0, true);
        return;
      }
      let nextIndex = this.index;
      while (nextIndex === this.index) {
        nextIndex = Math.floor(Math.random() * this.queue.length);
      }
      this.playIndex(nextIndex, true);
      return;
    }
    const nextIndex = this.index + 1;
    if (nextIndex < this.queue.length) {
      this.playIndex(nextIndex, true);
      return;
    }
    if (this.repeat === 'all' || !manual) {
      this.playIndex(0, true);
      return;
    }
    this.pause();
    this.seek(0);
    this.setStatus('ended');
  }

  prev() {
    if (this.queue.length === 0) return;
    if (this.getCurrentTime() > 3) {
      this.seek(0);
      return;
    }
    const prevIndex = this.index - 1;
    if (prevIndex >= 0) {
      this.playIndex(prevIndex, true);
      return;
    }
    if (this.repeat === 'all') this.playIndex(this.queue.length - 1, true);
    else this.seek(0);
  }

  private playIndex(index: number, autoplay: boolean) {
    this.loadIndex(index, autoplay);
  }

  playAt(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.loadIndex(index, true);
  }

  restore(track: Track, queue: Track[], index: number) {
    this.queue = queue.length ? queue : [track];
    this.index = Math.max(0, Math.min(index, this.queue.length - 1));
    store.setQueue(this.queue, this.index);
    this.loadIndex(this.index, false);
  }

  saveQueueState() {
    try {
      const profile = store.getServerProfile();
      if (!profile) return;
      const payload = {
        profileId: profile.id,
        queue: this.queue,
        index: this.index,
        savedAt: Date.now(),
      };
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota errors */
    }
  }

  loadQueueState(profileId: string): { queue: Track[]; index: number } | null {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.profileId !== profileId || !Array.isArray(parsed.queue)) return null;
      return { queue: parsed.queue, index: Number(parsed.index) || 0 };
    } catch {
      return null;
    }
  }

  clearSavedQueue() {
    try {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const playback = new PlaybackService();






