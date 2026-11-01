use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration as StdDuration;

use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTag};
use symphonia::core::units::Time;
use tempfile::TempPath;

use crate::config::ReplayGainMode;

#[derive(Clone, Debug, Default)]
pub struct ReplayGain {
    pub track_gain_db: Option<f32>,
    pub track_peak: Option<f32>,
    pub album_gain_db: Option<f32>,
    pub album_peak: Option<f32>,
}

impl ReplayGain {
    pub fn selected(&self, mode: ReplayGainMode) -> Option<(f32, Option<f32>)> {
        match mode {
            ReplayGainMode::Off => None,
            ReplayGainMode::Track => self
                .track_gain_db
                .map(|gain| (gain, self.track_peak))
                .or_else(|| self.album_gain_db.map(|gain| (gain, self.album_peak))),
            ReplayGainMode::Album => self
                .album_gain_db
                .map(|gain| (gain, self.album_peak))
                .or_else(|| self.track_gain_db.map(|gain| (gain, self.track_peak))),
        }
    }
}

pub struct TrackSource {
    pub track_id: String,
    pub queue_index: i64,
    pub sample_rate: u32,
    pub channels: usize,
    pub source_bits: u32,
    pub duration: f64,
    pub replay_gain: ReplayGain,
    _temp: TempPath,
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    stream_track_id: u32,
    pending: VecDeque<f32>,
    decoded_frames: u64,
    eof: bool,
    time_base: Option<symphonia::core::units::TimeBase>,
    start_ts: i64,
    base_position: f64,
}

pub fn download_track(url: &str) -> Result<TempPath> {
    let client = Client::builder()
            .user_agent(format!("WavrPulse/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(StdDuration::from_secs(15))
        .timeout(StdDuration::from_secs(300))
        .build()
        .context("Could not create the audio download client.")?;
    let mut response = client
        .get(url)
        .send()
        .context("Could not reach the audio stream.")?
        .error_for_status()
        .context("The audio stream returned an error.")?;
    if let Some(kind) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        let value = kind.to_str().unwrap_or_default();
        if value.starts_with("text/") || value.contains("json") {
            bail!("The server did not return an audio stream.");
        }
    }
    let mut temp = tempfile::NamedTempFile::new().context("Could not create an audio cache file.")?;
    std::io::copy(&mut response, &mut temp).context("The audio stream was interrupted.")?;
    temp.flush().context("Could not finish the audio cache file.")?;
    let temp_path = temp.into_temp_path();
    if std::fs::metadata(&temp_path).map(|meta| meta.len() == 0).unwrap_or(true) {
        bail!("The audio cache file is empty.");
    }
    Ok(temp_path)
}

impl TrackSource {
    pub fn open(
        temp: TempPath,
        hint: Option<String>,
        track_id: String,
        queue_index: i64,
        start_position: f64,
    ) -> Result<Self> {
        let path: PathBuf = temp.to_path_buf();
        let file = File::open(&path).context("Could not open the cached audio file.")?;
        let media_source = MediaSourceStream::new(Box::new(file), Default::default());
        let mut probe_hint = Hint::new();
        if let Some(extension) = hint {
            let extension = extension.trim_start_matches('.').to_ascii_lowercase();
            if !extension.is_empty() {
                probe_hint.with_extension(&extension);
            }
        }
        if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
            probe_hint.with_extension(extension);
        }

        let mut format = symphonia::default::get_probe()
            .probe(
                &probe_hint,
                media_source,
                FormatOptions::default(),
                MetadataOptions::default(),
            )
            .context("This audio format is not supported by the WASAPI engine.")?;
        let track = format
            .default_track(TrackType::Audio)
            .context("The stream does not contain an audio track.")?;
        let stream_track_id = track.id;
        let time_base = track.time_base;
        let start_ts = track.start_ts.get();
        let duration = track
            .time_base
            .zip(track.duration)
            .and_then(|(base, duration)| base.calc_duration(duration))
            .map(|time| time.as_secs_f64())
            .unwrap_or(0.0);
        let codec_params = track
            .codec_params
            .as_ref()
            .and_then(|params| params.audio())
            .context("The audio codec parameters are missing.")?
            .clone();
        let source_bits = codec_params.bits_per_sample.unwrap_or(0);
        let codec_sample_rate = codec_params.sample_rate.unwrap_or(0);
        let codec_channels = codec_params
            .channels
            .as_ref()
            .map(|channels| channels.count())
            .unwrap_or(0);
        let mut decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&codec_params, &AudioDecoderOptions::default())
            .context("The audio codec is not supported by the WASAPI engine.")?;

        if start_position > 0.0 {
            let time = Time::try_from_secs_f64(start_position).unwrap_or(Time::ZERO);
            if format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Time {
                        time,
                        track_id: Some(stream_track_id),
                    },
                )
                .is_ok()
            {
                decoder.reset();
            }
        }

        let replay_gain = read_replay_gain(&mut format);
        let mut source = Self {
            track_id,
            queue_index,
            sample_rate: codec_sample_rate,
            channels: codec_channels,
            source_bits,
            duration,
            replay_gain,
            _temp: temp,
            format,
            decoder,
            stream_track_id,
            pending: VecDeque::new(),
            decoded_frames: 0,
            eof: false,
            time_base,
            start_ts,
            base_position: start_position.max(0.0),
        };
        while source.sample_rate == 0 || source.channels == 0 || source.pending.is_empty() {
            if !source.decode_next_packet()? {
                break;
            }
        }
        Ok(source)
    }

    pub fn position(&self) -> f64 {
        if self.sample_rate == 0 {
            return self.base_position;
        }
        self.base_position + self.decoded_frames as f64 / self.sample_rate as f64
    }

    pub fn remaining_seconds(&self) -> f64 {
        if self.duration <= 0.0 {
            return f64::INFINITY;
        }
        (self.duration - self.position()).max(0.0)
    }

    pub fn seek(&mut self, position: f64) -> Result<f64> {
        let target = position.max(0.0);
        let time = Time::try_from_secs_f64(target).unwrap_or(Time::ZERO);
        match self.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(self.stream_track_id),
            },
        ) {
            Ok(seeked) => {
                self.base_position = seeked
                    .actual_ts
                    .get()
                    .checked_sub(self.start_ts)
                    .and_then(|ticks| {
                        self.time_base
                            .and_then(|base| base.calc_time(symphonia::core::units::Timestamp::new(ticks)))
                    })
                    .map(|time| time.as_secs_f64())
                    .unwrap_or(target);
            }
            Err(_) => {
                self.base_position = target;
            }
        }
        self.decoder.reset();
        self.pending.clear();
        self.decoded_frames = 0;
        self.eof = false;
        while self.pending.is_empty() && !self.eof {
            self.decode_next_packet()?;
        }
        Ok(self.base_position)
    }

    pub fn read_interleaved(&mut self, max_frames: usize) -> (Vec<f32>, bool) {
        if self.channels == 0 {
            return (Vec::new(), true);
        }
        let wanted = max_frames.max(1) * self.channels;
        while self.pending.len() < wanted && !self.eof {
            if !self.decode_next_packet().unwrap_or(false) {
                break;
            }
        }
        let take = wanted.min(self.pending.len() / self.channels * self.channels);
        let mut output = Vec::with_capacity(take);
        for _ in 0..take {
            if let Some(sample) = self.pending.pop_front() {
                output.push(sample);
            }
        }
        self.decoded_frames += (take / self.channels) as u64;
        let ended = self.eof && self.pending.is_empty();
        (output, ended)
    }

    pub fn set_queue_index(&mut self, queue_index: i64) {
        self.queue_index = queue_index;
    }

    fn decode_next_packet(&mut self) -> Result<bool> {
        if self.eof {
            return Ok(false);
        }
        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => {
                    self.eof = true;
                    return Ok(false);
                }
                Err(SymphoniaError::ResetRequired) => {
                    self.eof = true;
                    return Ok(false);
                }
                Err(SymphoniaError::IoError(_)) => {
                    self.eof = true;
                    return Ok(false);
                }
                Err(error) => return Err(error.into()),
            };
            if packet.track_id != self.stream_track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(buffer) => {
                    if self.sample_rate == 0 {
                        self.sample_rate = buffer.spec().rate();
                    }
                    if self.channels == 0 {
                        self.channels = buffer.spec().channels().count();
                    }
                    if self.source_bits == 0 {
                        self.source_bits = 32;
                    }
                    let mut samples = vec![0.0_f32; buffer.samples_interleaved()];
                    buffer.copy_to_slice_interleaved(&mut samples);
                    self.pending.extend(samples);
                    return Ok(true);
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(SymphoniaError::IoError(_)) => {
                    self.eof = true;
                    return Ok(false);
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
}


fn read_replay_gain(format: &mut Box<dyn FormatReader>) -> ReplayGain {
    let mut result = ReplayGain::default();
    let mut metadata = format.metadata();
    while !metadata.is_latest() {
        metadata.pop();
    }
    if let Some(revision) = metadata.current() {
        for tag in &revision.media.tags {
            let Some(standard) = &tag.std else {
                continue;
            };
            match standard {
                StandardTag::ReplayGainTrackGain(value) => {
                    result.track_gain_db = parse_gain(value);
                }
                StandardTag::ReplayGainTrackPeak(value) => {
                    result.track_peak = value.parse::<f32>().ok().filter(|peak| *peak > 0.0);
                }
                StandardTag::ReplayGainAlbumGain(value) => {
                    result.album_gain_db = parse_gain(value);
                }
                StandardTag::ReplayGainAlbumPeak(value) => {
                    result.album_peak = value.parse::<f32>().ok().filter(|peak| *peak > 0.0);
                }
                _ => {}
            }
        }
    }
    result
}

fn parse_gain(value: &str) -> Option<f32> {
    value
        .trim()
        .trim_end_matches(|c: char| c.eq_ignore_ascii_case(&'d') || c.eq_ignore_ascii_case(&'b'))
        .trim()
        .parse::<f32>()
        .ok()
        .filter(|gain| gain.is_finite())
}
