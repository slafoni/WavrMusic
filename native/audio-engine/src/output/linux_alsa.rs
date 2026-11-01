use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, SampleFormat, SizedSample, Stream, StreamConfig};

use crate::config::{AudioMode, EngineConfig};
use super::{DeviceInfo, DeviceList, OutputFormat, OutputSample};

const TARGET_FRAMES: usize = 2048;
const CAPACITY_FRAMES: usize = 8192;

type SampleQueue = Arc<Mutex<VecDeque<f32>>>;

pub fn initialize() {}

pub struct OutputClient {
    stream: Stream,
    queue: SampleQueue,
    capacity_samples: usize,
    channels: usize,
    pub format: OutputFormat,
    pub device_name: String,
    pub effective_mode: AudioMode,
    pub used_iaudioclient3: bool,
    pub warnings: Vec<String>,
}

impl OutputClient {
    pub fn available_frames(&self) -> Result<usize> {
        let queued = self
            .queue
            .lock()
            .map_err(|_| anyhow::anyhow!("The ALSA audio buffer is unavailable."))?
            .len();
        let free = self.capacity_samples.saturating_sub(queued);
        Ok(free.min(TARGET_FRAMES * self.channels) / self.channels)
    }

    pub fn wait_for_event(&mut self, _timeout_ms: u64) -> Result<()> {
        thread::sleep(Duration::from_millis(2));
        Ok(())
    }

    pub fn start_stream(&mut self) -> Result<()> {
        self.stream
            .play()
            .context("Could not start ALSA playback.")?;
        Ok(())
    }

    pub fn stop_stream(&mut self) {
        self.stream.pause().ok();
    }

    pub fn reset_stream(&mut self) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.clear();
        }
    }

    pub fn write_frames(&mut self, frames: usize, samples: &[f32]) -> Result<()> {
        let wanted = frames * self.channels;
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| anyhow::anyhow!("The ALSA audio buffer is unavailable."))?;
        if queue.len() + wanted > self.capacity_samples {
            bail!("The ALSA audio output buffer overflowed.");
        }
        queue.extend(samples.iter().copied().take(wanted));
        Ok(())
    }
}

pub fn list_output_devices() -> Result<DeviceList> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let output_devices = host
        .output_devices()
        .context("Could not enumerate ALSA audio devices.")?;
    let mut devices = Vec::new();
    for device in output_devices {
        let Ok(name) = device.name() else { continue };
        let supported = device.default_output_config().ok();
        let is_default = default_name.as_deref() == Some(name.as_str());
        devices.push(DeviceInfo {
            id: name.clone(),
            name,
            is_default,
            channels: supported.as_ref().map(|config| config.channels()),
            sample_rate: supported.map(|config| config.sample_rate().0),
        });
    }
    if devices.is_empty() {
        bail!("No ALSA audio output device is available.");
    }
    Ok(DeviceList {
        devices,
        default_id: default_name,
    })
}

pub fn open_output(
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
    source_bits: u32,
) -> Result<OutputClient> {
    let _ = (source_rate, source_channels, source_bits);
    let host = cpal::default_host();
    let device = resolve_device(&host, &config.device_id)?;
    let device_name = device
        .name()
        .unwrap_or_else(|_| "Audio output".to_string());
    let supported = device
        .default_output_config()
        .context("Could not read the default ALSA audio output format.")?;
    let sample_format = supported.sample_format();
    let stream_config = supported.config();
    let channels = stream_config.channels as usize;
    let capacity_samples = CAPACITY_FRAMES * channels;
    let queue = Arc::new(Mutex::new(VecDeque::with_capacity(capacity_samples)));
    let stream = build_stream(sample_format, &device, &stream_config, queue.clone())?;
    stream
        .pause()
        .context("Could not prepare the ALSA audio output stream.")?;
    let mut warnings = Vec::new();
    if config.mode == AudioMode::Exclusive {
        warnings.push(
            "Exclusive output is not supported by the ALSA fallback; using the system shared mix."
                .into(),
        );
    }
    Ok(OutputClient {
        stream,
        queue,
        capacity_samples,
        channels,
        format: OutputFormat {
            sample_rate: stream_config.sample_rate.0,
            channels,
            sample: OutputSample::Float32,
            bits_per_sample: 32,
        },
        device_name,
        effective_mode: AudioMode::Shared,
        used_iaudioclient3: false,
        warnings,
    })
}

fn resolve_device(host: &cpal::Host, device_id: &str) -> Result<Device> {
    if !device_id.trim().is_empty() {
        if let Ok(devices) = host.output_devices() {
            for device in devices {
                if device.name().ok().as_deref() == Some(device_id) {
                    return Ok(device);
                }
            }
        }
    }
    host.default_output_device()
        .context("No ALSA audio output device is available.")
}

fn build_stream(
    sample_format: SampleFormat,
    device: &Device,
    config: &StreamConfig,
    queue: SampleQueue,
) -> Result<Stream> {
    match sample_format {
        SampleFormat::F32 => build_stream_with::<f32>(device, config, queue),
        SampleFormat::I16 => build_stream_with::<i16>(device, config, queue),
        SampleFormat::U16 => build_stream_with::<u16>(device, config, queue),
        SampleFormat::I32 => build_stream_with::<i32>(device, config, queue),
        SampleFormat::F64 => build_stream_with::<f64>(device, config, queue),
        other => bail!("Unsupported ALSA audio sample format: {other:?}."),
    }
}

fn build_stream_with<T>(
    device: &Device,
    config: &StreamConfig,
    queue: SampleQueue,
) -> Result<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let mut queue = queue
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                for sample in data.iter_mut() {
                    let value = queue.pop_front().unwrap_or(0.0);
                    *sample = T::from_sample(value);
                }
            },
            move |error| eprintln!("WavrPulse ALSA audio stream error: {error}"),
            None,
        )
        .context("Could not open the ALSA audio output stream.")
}
