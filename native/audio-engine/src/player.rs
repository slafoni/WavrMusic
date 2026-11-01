use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use crossbeam_channel::{Receiver as CrossbeamReceiver, Sender as CrossbeamSender, TryRecvError};

use crate::config::{AudioMode, ChannelMode, EngineConfig, ReplayGainMode, ResampleQuality};
use crate::decode::TrackSource;
use crate::dsp::{map_channels, replay_gain_linear, soft_limit, Equalizer, Normalizer};
use crate::output::{open_output, OutputClient, OutputFormat, OutputSample};
use crate::resample::Resampler;

pub enum PlayerCommand {
    Pause,
    Resume,
    Seek(f64),
    SetVolume { volume: f32, muted: bool },
    SetConfig(Box<EngineConfig>),
    NextReady(Box<TrackSource>),
    CancelNext,
    Stop,
}

#[derive(Clone, Debug)]
pub enum PlayerEvent {
    State {
        state: &'static str,
        position: f64,
        track_id: Option<String>,
    },
    Position {
        track_id: String,
        queue_index: i64,
        position: f64,
        duration: f64,
    },
    TrackChanged {
        track_id: String,
        queue_index: i64,
        duration: f64,
        position: f64,
    },
    Ended {
        track_id: String,
        queue_index: i64,
    },
    Output {
        effective_mode: AudioMode,
        device_name: String,
        sample_rate: u32,
        channels: usize,
        sample: OutputSample,
        used_iaudioclient3: bool,
        warnings: Vec<String>,
    },
    Error {
        message: String,
        track_id: Option<String>,
    },
}

pub struct PlayerHandle {
    pub commands: CrossbeamSender<PlayerCommand>,
    pub thread: JoinHandle<()>,
}

pub fn spawn_player(
    track: TrackSource,
    config: EngineConfig,
    autoplay: bool,
    events: Sender<PlayerEvent>,
) -> PlayerHandle {
    let (commands, command_rx) = crossbeam_channel::unbounded();
    let thread = thread::Builder::new()
        .name("wavr-pulse-player".into())
        .spawn(move || {
            if let Err(error) = run_player(track, config, autoplay, command_rx, &events) {
                let _ = events.send(PlayerEvent::Error {
                    message: format!("{error:#}"),
                    track_id: None,
                });
            }
        })
        .expect("spawn WavrPulse player thread");
    PlayerHandle { commands, thread }
}

struct RenderTrack {
    source: TrackSource,
    output_rate: u32,
    output_channels: usize,
    eq: Equalizer,
    normalizer: Normalizer,
    resampler: Option<Resampler>,
    replay_gain_linear: f32,
    dsp_enabled: bool,
    limiter: bool,
    source_eof: bool,
    resampler_finished: bool,
    quality: ResampleQuality,
}

impl RenderTrack {
    fn new(
        source: TrackSource,
        output_format: &OutputFormat,
        config: &EngineConfig,
    ) -> Result<Self> {
        if source.sample_rate == 0 || source.channels == 0 {
            bail!("The decoded audio has no usable sample format.");
        }
        let mut eq = Equalizer::new(source.sample_rate, source.channels);
        eq.configure(config);
        let has_replay_gain = config.dsp_enabled
            && config.replay_gain != ReplayGainMode::Off
            && source.replay_gain.selected(config.replay_gain).is_some();
        let mut normalizer = Normalizer::new(output_format.sample_rate, output_format.channels);
        normalizer.configure(
            config.dsp_enabled && config.normalize_volume && !has_replay_gain,
            output_format.sample_rate,
            output_format.channels,
        );
        let resampler = Resampler::new(
            source.sample_rate,
            output_format.sample_rate,
            output_format.channels,
            config.resample_quality,
        )?;
        let dsp_enabled = config.dsp_enabled;
        let replay_gain = if dsp_enabled {
            source
                .replay_gain
                .selected(config.replay_gain)
                .map(|(gain, peak)| replay_gain_linear(gain, peak))
                .unwrap_or(1.0)
        } else {
            1.0
        };
        Ok(Self {
            source,
            output_rate: output_format.sample_rate,
            output_channels: output_format.channels,
            eq,
            normalizer,
            resampler,
            replay_gain_linear: replay_gain,
            dsp_enabled,
            limiter: dsp_enabled
                && (config.eq_enabled
                    || config.normalize_volume
                    || config.replay_gain != ReplayGainMode::Off),
            source_eof: false,
            resampler_finished: false,
            quality: config.resample_quality,
        })
    }

    fn configure(&mut self, config: &EngineConfig) -> Result<()> {
        self.eq.configure(config);
        let has_replay_gain = config.dsp_enabled
            && config.replay_gain != ReplayGainMode::Off
            && self.source.replay_gain.selected(config.replay_gain).is_some();
        self.normalizer.configure(
            config.dsp_enabled && config.normalize_volume && !has_replay_gain,
            self.output_rate,
            self.output_channels,
        );
        self.dsp_enabled = config.dsp_enabled;
        self.replay_gain_linear = if self.dsp_enabled {
            self.source
                .replay_gain
                .selected(config.replay_gain)
                .map(|(gain, peak)| replay_gain_linear(gain, peak))
                .unwrap_or(1.0)
        } else {
            1.0
        };
        self.limiter = self.dsp_enabled
            && (config.eq_enabled
                || config.normalize_volume
                || config.replay_gain != ReplayGainMode::Off);
        if self.quality != config.resample_quality {
            self.quality = config.resample_quality;
            self.resampler = Resampler::new(
                self.source.sample_rate,
                self.output_rate,
                self.output_channels,
                self.quality,
            )?;
            self.resampler_finished = false;
        }
        if config.channel_mode == ChannelMode::Stereo {
            // Output channel count is fixed when the device is opened.
        }
        Ok(())
    }

    fn track_id(&self) -> &str {
        &self.source.track_id
    }

    fn queue_index(&self) -> i64 {
        self.source.queue_index
    }

    fn duration(&self) -> f64 {
        self.source.duration
    }

    fn position(&self) -> f64 {
        self.source.position()
    }

    fn remaining(&self) -> f64 {
        self.source.remaining_seconds()
    }

    fn seek(&mut self, position: f64, config: &EngineConfig) -> Result<f64> {
        let actual = self.source.seek(position)?;
        self.eq = Equalizer::new(self.source.sample_rate, self.source.channels);
        self.eq.configure(config);
        let has_replay_gain = config.dsp_enabled
            && config.replay_gain != ReplayGainMode::Off
            && self.source.replay_gain.selected(config.replay_gain).is_some();
        self.normalizer = Normalizer::new(self.output_rate, self.output_channels);
        self.normalizer.configure(
            config.dsp_enabled && config.normalize_volume && !has_replay_gain,
            self.output_rate,
            self.output_channels,
        );
        self.resampler = Resampler::new(
            self.source.sample_rate,
            self.output_rate,
            self.output_channels,
            self.quality,
        )?;
        self.replay_gain_linear = if config.dsp_enabled {
            self.source
                .replay_gain
                .selected(config.replay_gain)
                .map(|(gain, peak)| replay_gain_linear(gain, peak))
                .unwrap_or(1.0)
        } else {
            1.0
        };
        self.source_eof = false;
        self.resampler_finished = false;
        Ok(actual)
    }

    fn set_queue_index(&mut self, queue_index: i64) {
        self.source.set_queue_index(queue_index);
    }

    fn finished(&self) -> bool {
        self.source_eof
            && self
                .resampler
                .as_ref()
                .map(|resampler| resampler.available_frames() == 0)
                .unwrap_or(true)
    }

    fn pull(&mut self, frames: usize) -> Vec<f32> {
        if frames == 0 {
            return Vec::new();
        }
        let mut output = Vec::with_capacity(frames * self.output_channels);
        if let Some(mut resampler) = self.resampler.take() {
            loop {
                let available = resampler.available_frames();
                let wanted = frames - output.len() / self.output_channels;
                if available >= wanted || self.source_eof {
                    let take = wanted.min(available);
                    if take > 0 {
                        output.extend(resampler.take(take));
                    }
                    if output.len() / self.output_channels >= frames {
                        break;
                    }
                    if self.source_eof && resampler.available_frames() == 0 {
                        break;
                    }
                }
                if self.source_eof {
                    if !self.resampler_finished {
                        resampler.finish();
                        self.resampler_finished = true;
                        continue;
                    }
                    break;
                }
                let (mut chunk, ended) = self.source.read_interleaved(1024);
                if chunk.is_empty() && !ended {
                    break;
                }
                self.process_source(&mut chunk);
                let mapped = map_channels(
                    &chunk,
                    self.source.channels,
                    self.output_channels,
                    false,
                );
                resampler.feed(&mapped);
                if ended {
                    self.source_eof = true;
                }
            }
            self.resampler = Some(resampler);
        } else {
            while output.len() / self.output_channels < frames && !self.source_eof {
                let wanted = frames - output.len() / self.output_channels;
                let (mut chunk, ended) = self.source.read_interleaved(wanted.max(1024));
                if chunk.is_empty() && !ended {
                    break;
                }
                self.process_source(&mut chunk);
                output.extend(map_channels(
                    &chunk,
                    self.source.channels,
                    self.output_channels,
                    false,
                ));
                if ended {
                    self.source_eof = true;
                }
            }
            let wanted_samples = frames * self.output_channels;
            if output.len() > wanted_samples {
                output.truncate(wanted_samples);
            }
        }
        if self.dsp_enabled {
            self.normalizer.process(&mut output);
            if self.limiter {
                soft_limit(&mut output);
            }
        }
        output
    }

    fn process_source(&mut self, samples: &mut [f32]) {
        if self.dsp_enabled {
            self.eq.process(samples);
            if self.replay_gain_linear != 1.0 {
                for sample in samples.iter_mut() {
                    *sample *= self.replay_gain_linear;
                }
            }
        }
    }
}

struct FadeState {
    old: RenderTrack,
    total_frames: u64,
    frames_done: u64,
}

fn run_player(
    source: TrackSource,
    mut config: EngineConfig,
    autoplay: bool,
    commands: CrossbeamReceiver<PlayerCommand>,
    events: &Sender<PlayerEvent>,
) -> Result<()> {
    let output = open_output(&config, source.sample_rate, source.channels, source.source_bits)?;
    let mut output = output;
    events.send(PlayerEvent::Output {
        effective_mode: output.effective_mode,
        device_name: output.device_name.clone(),
        sample_rate: output.format.sample_rate,
        channels: output.format.channels,
        sample: output.format.sample,
        used_iaudioclient3: output.used_iaudioclient3,
        warnings: output.warnings.clone(),
    }).ok();

    let mut current = RenderTrack::new(source, &output.format, &config)?;
    let mut next: Option<RenderTrack> = None;
    let mut fade: Option<FadeState> = None;
    let mut volume = config.volume;
    let mut muted = config.muted;
    let mut paused = !autoplay;
    let mut was_playing = false;
    let mut last_position_emit = Instant::now();
    let position_emit_interval = Duration::from_millis(100);
    let channels = output.format.channels;
    let output_rate = output.format.sample_rate as f64;

    let notify_state = |state: &'static str, track: &RenderTrack| {
        let _ = events.send(PlayerEvent::State {
            state,
            position: track.position(),
            track_id: Some(track.track_id().to_string()),
        });
    };
    let track_position_event = |track: &RenderTrack| PlayerEvent::Position {
        track_id: track.track_id().to_string(),
        queue_index: track.queue_index(),
        position: track.position(),
        duration: track.duration(),
    };

    if !paused {
        prefill(&mut output)?;
        output.start_stream()?;
        was_playing = true;
        notify_state("playing", &current);
    } else {
        prefill(&mut output)?;
        output.start_stream()?;
        notify_state("paused", &current);
    }

    loop {
        if paused {
            match commands.recv_timeout(Duration::from_millis(60)) {
                Ok(command) => {
                    if handle_command(
                        command,
                        &mut output,
                        &mut current,
                        &mut next,
                        &mut fade,
                        &mut config,
                        &mut volume,
                        &mut muted,
                        &mut paused,
                        &mut was_playing,
                        events,
                    )? {
                        return Ok(());
                    }
                }
                Err(_) => {}
            }
            continue;
        }

        if let Err(error) = output.wait_for_event(10) {
            let _ = events.send(PlayerEvent::Error {
                message: error.to_string(),
                track_id: Some(current.track_id().to_string()),
            });
            break;
        }

        loop {
            match commands.try_recv() {
                Ok(command) => {
                    if handle_command(
                        command,
                        &mut output,
                        &mut current,
                        &mut next,
                        &mut fade,
                        &mut config,
                        &mut volume,
                        &mut muted,
                        &mut paused,
                        &mut was_playing,
                        events,
                    )? {
                        return Ok(());
                    }
                    if paused {
                        break;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Ok(()),
            }
        }
        if paused {
            continue;
        }

        if fade.is_none() {
            if let Some(candidate) = next.as_ref() {
                let crossfade = config.crossfade_seconds as f64;
                let remaining = current.remaining();
                if crossfade > 0.0
                    && config.dsp_enabled
                    && remaining <= crossfade
                    && remaining > 0.0
                    && candidate.duration() > 0.0
                {
                    let total_seconds = crossfade.min(remaining).min(candidate.duration());
                    let total_frames = (total_seconds * output_rate).round() as u64;
                    if total_frames > 0 {
                        let replacement = next.take().expect("prepared next track");
                        let old = std::mem::replace(&mut current, replacement);
                        current.set_queue_index(current.queue_index());
                        fade = Some(FadeState {
                            old,
                            total_frames,
                            frames_done: 0,
                        });
                        let _ = events.send(PlayerEvent::TrackChanged {
                            track_id: current.track_id().to_string(),
                            queue_index: current.queue_index(),
                            duration: current.duration(),
                            position: current.position(),
                        });
                        let _ = events.send(track_position_event(&current));
                    }
                }
            }
        }

        let available = output.available_frames().unwrap_or(0);
        if available == 0 {
            thread::sleep(Duration::from_millis(1));
            continue;
        }

        let mut samples = vec![0.0_f32; available * channels];
        let mut current_samples = current.pull(available);
        if fade.is_none() && current.finished() {
            if let Some(mut replacement) = next.take() {
                let rendered_frames = (current_samples.len() / channels).min(available);
                let remaining_frames = available - rendered_frames;
                if remaining_frames > 0 {
                    current_samples.extend(replacement.pull(remaining_frames));
                }
                let previous = std::mem::replace(&mut current, replacement);
                current.set_queue_index(current.queue_index());
                drop(previous);
                let _ = events.send(PlayerEvent::TrackChanged {
                    track_id: current.track_id().to_string(),
                    queue_index: current.queue_index(),
                    duration: current.duration(),
                    position: current.position(),
                });
                let _ = events.send(track_position_event(&current));
            }
        }
        pad_samples(&mut current_samples, available * channels);
        if let Some(state) = fade.as_mut() {
            let mut old_samples = state.old.pull(available);
            pad_samples(&mut old_samples, available * channels);
            let progress = (state.frames_done as f32 / state.total_frames.max(1) as f32)
                .clamp(0.0, 1.0);
            let fade_out = (progress * std::f32::consts::FRAC_PI_2).cos();
            let fade_in = (progress * std::f32::consts::FRAC_PI_2).sin();
            for index in 0..samples.len() {
                samples[index] = current_samples[index] * fade_in
                    + old_samples[index] * fade_out;
            }
            state.frames_done = state
                .frames_done
                .saturating_add(available as u64)
                .min(state.total_frames);
        } else {
            samples.copy_from_slice(&current_samples);
        }

        let gain = if muted { 0.0 } else { volume };
        if gain != 1.0 {
            for sample in &mut samples {
                *sample *= gain;
            }
        }

        if let Err(error) = output.write_frames(available, &samples) {
            let _ = events.send(PlayerEvent::Error {
                message: error.to_string(),
                track_id: Some(current.track_id().to_string()),
            });
            break;
        }

        if let Some(state) = fade.as_ref() {
            if state.frames_done >= state.total_frames || state.old.finished() {
                fade = None;
            }
        }

        if last_position_emit.elapsed() >= position_emit_interval {
            last_position_emit = Instant::now();
            let _ = events.send(track_position_event(&current));
        }

        if current.finished() {
            if let Some(state) = fade.take() {
                drop(state.old);
            }
            let _ = events.send(PlayerEvent::Ended {
                track_id: current.track_id().to_string(),
                queue_index: current.queue_index(),
            });
            output.stop_stream();
            notify_state("ended", &current);
            break;
        }
    }

    output.stop_stream();
    if was_playing {
        notify_state("stopped", &current);
    }
    Ok(())
}

fn prefill(output: &mut OutputClient) -> Result<()> {
    let available = output.available_frames()?;
    if available == 0 {
        return Ok(());
    }
    let silence = vec![0.0_f32; available * output.format.channels];
    output
        .write_frames(available, &silence)
        .map_err(|error| anyhow::anyhow!("Could not prime the audio buffer: {error}"))?;
    Ok(())
}

fn pad_samples(samples: &mut Vec<f32>, target: usize) {
    if samples.len() < target {
        samples.resize(target, 0.0);
    } else if samples.len() > target {
        samples.truncate(target);
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_command(
    command: PlayerCommand,
    output: &mut OutputClient,
    current: &mut RenderTrack,
    next: &mut Option<RenderTrack>,
    fade: &mut Option<FadeState>,
    config: &mut EngineConfig,
    volume: &mut f32,
    muted: &mut bool,
    paused: &mut bool,
    was_playing: &mut bool,
    events: &Sender<PlayerEvent>,
) -> Result<bool> {
    match command {
        PlayerCommand::Pause => {
            if !*paused {
                output.reset_stream();
                *paused = true;
                *was_playing = false;
                let _ = events.send(PlayerEvent::State {
                    state: "paused",
                    position: current.position(),
                    track_id: Some(current.track_id().to_string()),
                });
            }
        }
        PlayerCommand::Resume => {
            if *paused {
                prefill(output)?;
                output.start_stream().ok();
                *paused = false;
                *was_playing = true;
                let _ = events.send(PlayerEvent::State {
                    state: "playing",
                    position: current.position(),
                    track_id: Some(current.track_id().to_string()),
                });
            }
        }
        PlayerCommand::Seek(position) => {
            if fade.is_some() {
                if let Some(state) = fade.take() {
                    *current = state.old;
                }
            }
            let was_active = !*paused;
            if was_active {
                output.stop_stream();
            }
            let actual = current.seek(position, config)?;
            output.reset_stream();
            prefill(output)?;
            if was_active {
                output.start_stream().ok();
            }
            let _ = events.send(PlayerEvent::State {
                state: if was_active { "playing" } else { "paused" },
                position: actual,
                track_id: Some(current.track_id().to_string()),
            });
            let _ = events.send(PlayerEvent::Position {
                track_id: current.track_id().to_string(),
                queue_index: current.queue_index(),
                position: actual,
                duration: current.duration(),
            });
        }
        PlayerCommand::SetVolume {
            volume: new_volume,
            muted: new_muted,
        } => {
            *volume = new_volume.clamp(0.0, 1.0);
            *muted = new_muted;
        }
        PlayerCommand::SetConfig(new_config) => {
            *config = *new_config;
            current.configure(config)?;
            if let Some(track) = next.as_mut() {
                track.configure(config)?;
            }
        }
        PlayerCommand::NextReady(track) => {
            *next = Some(RenderTrack::new(*track, &output.format, config)?);
        }
        PlayerCommand::CancelNext => {
            *next = None;
        }
        PlayerCommand::Stop => {
            output.stop_stream();
            *paused = true;
            *was_playing = false;
            let _ = events.send(PlayerEvent::State {
                state: "stopped",
                position: current.position(),
                track_id: Some(current.track_id().to_string()),
            });
            return Ok(true);
        }
    }
    Ok(false)
}
