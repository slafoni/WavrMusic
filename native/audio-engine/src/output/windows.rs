use anyhow::{anyhow, bail, Context, Result};
use wasapi::{
    AudioClient, AudioRenderClient, Device, DeviceEnumerator, Direction, Handle, SampleType, ShareMode,
    StreamMode, TimingMode, WaveFormat, initialize_mta,
};

use crate::config::{AudioMode, ChannelMode, EngineConfig};
use super::{DeviceInfo, DeviceList, OutputFormat, OutputSample};

pub fn initialize() {
    let _ = initialize_mta();
}

pub struct OutputClient {
    pub audio_client: AudioClient,
    pub render_client: AudioRenderClient,
    pub event: Handle,
    pub format: OutputFormat,
    pub device_name: String,
    pub effective_mode: AudioMode,
    pub used_iaudioclient3: bool,
    pub warnings: Vec<String>,
}

impl OutputClient {
    pub fn available_frames(&self) -> Result<usize> {
        Ok(self.audio_client.get_available_space_in_frames()? as usize)
    }

    pub fn wait_for_event(&mut self, timeout_ms: u64) -> Result<()> {
        match self.event.wait_for_event(timeout_ms.min(u32::MAX as u64) as u32) {
            Ok(()) => Ok(()),
            Err(wasapi::WasapiError::EventTimeout) => Ok(()),
            Err(error) => Err(anyhow!("The audio device stopped responding: {error}")),
        }
    }

    pub fn start_stream(&mut self) -> Result<()> {
        self.audio_client
            .start_stream()
            .context("Could not start WASAPI playback.")?;
        Ok(())
    }

    pub fn stop_stream(&mut self) {
        self.audio_client.stop_stream().ok();
    }

    pub fn reset_stream(&mut self) {
        self.audio_client.reset_stream().ok();
    }

    pub fn write_frames(&mut self, frames: usize, samples: &[f32]) -> Result<()> {
        let bytes = render_frames(&self.format, samples, frames);
        self.render_client
            .write_to_device(frames, &bytes, None)
            .context("Could not write audio to the device.")?;
        Ok(())
    }
}

pub fn list_output_devices() -> Result<DeviceList> {
    let _ = initialize_mta();
    let enumerator = DeviceEnumerator::new().context("Could not open the Windows audio device list.")?;
    let default = enumerator.get_default_device(&Direction::Render).ok();
    let default_id = default
        .as_ref()
        .and_then(|device| device.get_id().ok());
    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .context("Could not enumerate Windows audio devices.")?;
    let mut devices = Vec::new();
    for device in &collection {
        let Ok(device) = device else { continue };
        let Ok(id) = device.get_id() else { continue };
        let name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Audio output".to_string());
        let (channels, sample_rate) = device
            .get_iaudioclient()
            .ok()
            .and_then(|client| client.get_mixformat().ok())
            .map(|format| (Some(format.get_nchannels()), Some(format.get_samplespersec())))
            .unwrap_or((None, None));
        devices.push(DeviceInfo {
            is_default: default_id.as_deref() == Some(id.as_str()),
            id,
            name,
            channels,
            sample_rate,
        });
    }
    Ok(DeviceList {
        devices,
        default_id,
    })
}

pub fn open_output(
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
    source_bits: u32,
) -> Result<OutputClient> {
    let _ = initialize_mta();
    let enumerator = DeviceEnumerator::new().context("Could not open the Windows audio device list.")?;
    let mut warnings = Vec::new();
    let device = resolve_device(&enumerator, &config.device_id, &mut warnings)?;
    let requested_mode = config.mode;
    if requested_mode == AudioMode::Exclusive {
        match open_exclusive(&device, config, source_rate, source_channels, source_bits) {
            Ok(mut output) => {
                output.warnings.append(&mut warnings);
                return Ok(output);
            }
            Err(error) => {
                warnings.push(format!(
                    "WASAPI exclusive mode is unavailable on this device; using shared mode. {error}"
                ));
            }
        }
    }

    let mut output = open_shared(&device, config, source_rate, source_channels)?;
    output.effective_mode = AudioMode::Shared;
    output.warnings.append(&mut warnings);
    Ok(output)
}

fn resolve_device(
    enumerator: &DeviceEnumerator,
    device_id: &str,
    warnings: &mut Vec<String>,
) -> Result<Device> {
    if !device_id.trim().is_empty() {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .context("Could not enumerate Windows audio devices.")?;
        for device in &collection {
            let Ok(device) = device else { continue };
            if device.get_id().ok().as_deref() == Some(device_id) {
                return Ok(device);
            }
        }
        warnings.push("The selected output device was not found; using the default device.".into());
    }
    enumerator
        .get_default_device(&Direction::Render)
        .context("No Windows audio output device is available.")
}

fn open_shared(
    device: &Device,
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
) -> Result<OutputClient> {
    let mut audio_client = device
        .get_iaudioclient()
        .context("Could not open the Windows shared audio client.")?;
    let mix_format = audio_client
        .get_mixformat()
        .context("Could not read the Windows audio mix format.")?;
    let mix_rate = mix_format.get_samplespersec();
    let mix_channels = mix_format.get_nchannels() as usize;
    let target_channels = match config.channel_mode {
        ChannelMode::Stereo => 2,
        ChannelMode::Surround => source_channels.max(2),
        ChannelMode::Auto => mix_channels.max(2),
    };
    let desired = WaveFormat::new(32, 32, &SampleType::Float, mix_rate as usize, target_channels, None);
    let (autoconvert, selected_format) = match audio_client.is_supported(&desired, &ShareMode::Shared) {
        Ok(None) => (false, desired.clone()),
        Ok(Some(_)) => (true, desired.clone()),
        Err(_) => (true, desired.clone()),
    };
    let (default_period, min_period) = audio_client
        .get_device_period()
        .context("Could not read the shared audio period.")?;
    let _ = source_rate;

    let mut used_iaudioclient3 = false;
    let same_as_mix = selected_format.get_samplespersec() == mix_rate
        && selected_format.get_nchannels() as usize == mix_channels
        && autoconvert == false;
    if same_as_mix {
        if let Ok(periods) = audio_client.get_shared_mode_engine_period(&selected_format) {
            let period = periods
                .min
                .max(periods.fundamental)
                .clamp(periods.min, periods.max);
            if audio_client
                .initialize_shared_audio_stream(&selected_format, TimingMode::Events, period)
                .is_ok()
            {
                used_iaudioclient3 = true;
            }
        }
    }
    if !used_iaudioclient3 {
        let mode = StreamMode::EventsShared {
            autoconvert,
            buffer_duration_hns: default_period.max(min_period),
        };
        audio_client
            .initialize_client(&selected_format, &Direction::Render, &mode)
            .context("Could not initialise shared-mode playback.")?;
    }
    let event = audio_client
        .set_get_eventhandle()
        .context("Could not create the shared audio event.")?;
    let render_client = audio_client
        .get_audiorenderclient()
        .context("Could not create the shared audio render client.")?;
    let format = format_from_wave(&selected_format)?;
    Ok(OutputClient {
        audio_client,
        render_client,
        event,
        format,
        device_name: device
            .get_friendlyname()
            .unwrap_or_else(|_| "Audio output".to_string()),
        effective_mode: AudioMode::Shared,
        used_iaudioclient3,
        warnings: Vec::new(),
    })
}

fn open_exclusive(
    device: &Device,
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
    source_bits: u32,
) -> Result<OutputClient> {
    let mut audio_client = device
        .get_iaudioclient()
        .context("Could not open the Windows exclusive audio client.")?;
    let mix = audio_client.get_mixformat().ok();
    let target_channels = match config.channel_mode {
        ChannelMode::Stereo => 2,
        ChannelMode::Surround => source_channels.max(2),
        ChannelMode::Auto => source_channels.max(2),
    };
    let mut rates = vec![source_rate];
    if let Some(mix) = &mix {
        rates.push(mix.get_samplespersec());
    }
    rates.extend([96000, 88200, 48000, 44100, 192000, 384000, 176400, 352800]);
    rates.retain(|rate| *rate > 0);
    let mut unique_rates = Vec::new();
    for rate in rates {
        if !unique_rates.contains(&rate) { unique_rates.push(rate); }
    }
    let rates = unique_rates;
    let mut channel_options = vec![target_channels];
    if target_channels != 2 {
        channel_options.push(2);
    }
    if target_channels < 6 {
        channel_options.push(6);
    }
    channel_options.dedup();
    let formats: &[(usize, usize, SampleType)] = match source_bits {
        16 => &[(16, 16, SampleType::Int), (24, 32, SampleType::Int), (24, 24, SampleType::Int), (32, 32, SampleType::Int), (32, 32, SampleType::Float)],
        24 => &[(24, 24, SampleType::Int), (24, 32, SampleType::Int), (32, 32, SampleType::Int), (16, 16, SampleType::Int), (32, 32, SampleType::Float)],
        32 => &[(32, 32, SampleType::Int), (24, 32, SampleType::Int), (24, 24, SampleType::Int), (16, 16, SampleType::Int), (32, 32, SampleType::Float)],
        _ => &[(32, 32, SampleType::Float), (32, 32, SampleType::Int), (24, 32, SampleType::Int), (24, 24, SampleType::Int), (16, 16, SampleType::Int)],
    };
    let mut selected: Option<WaveFormat> = None;
    'outer: for channels in channel_options {
        for rate in &rates {
            for (store_bits, valid_bits, sample_type) in formats {
                let candidate = WaveFormat::new(
                    *store_bits,
                    *valid_bits,
                    sample_type,
                    *rate as usize,
                    channels,
                    None,
                );
                if let Ok(supported) = audio_client.is_supported_exclusive_with_quirks(&candidate) {
                    selected = Some(supported);
                    break 'outer;
                }
            }
        }
    }
    let selected_format = selected.ok_or_else(|| {
        anyhow!("No supported exclusive-mode sample format was found. The device may be in use.")
    })?;
    let (default_period, min_period) = audio_client
        .get_device_period()
        .context("Could not read the exclusive audio period.")?;
    let desired_period = audio_client
        .calculate_aligned_period_near(default_period.max(min_period), Some(128), &selected_format)
        .unwrap_or(default_period.max(min_period));
    let mode = StreamMode::EventsExclusive {
        period_hns: desired_period,
    };
    audio_client
        .initialize_client(&selected_format, &Direction::Render, &mode)
        .context("Could not initialise exclusive-mode playback. Another application may own the device.")?;
    let event = audio_client
        .set_get_eventhandle()
        .context("Could not create the exclusive audio event.")?;
    let render_client = audio_client
        .get_audiorenderclient()
        .context("Could not create the exclusive audio render client.")?;
    let format = format_from_wave(&selected_format)?;
    Ok(OutputClient {
        audio_client,
        render_client,
        event,
        format,
        device_name: device
            .get_friendlyname()
            .unwrap_or_else(|_| "Audio output".to_string()),
        effective_mode: AudioMode::Exclusive,
        used_iaudioclient3: false,
        warnings: Vec::new(),
    })
}

fn format_from_wave(wave: &WaveFormat) -> Result<OutputFormat> {
    let sample = match wave.get_subformat()? {
        SampleType::Float => match wave.get_bitspersample() {
            32 => OutputSample::Float32,
            bits => bail!("Unsupported float sample width: {bits} bits."),
        },
        SampleType::Int => match (wave.get_bitspersample(), wave.get_validbitspersample()) {
            (16, _) => OutputSample::Int16,
            (24, _) => OutputSample::Int24,
            (32, 24) => OutputSample::Int24In32,
            (32, _) => OutputSample::Int32,
            (bits, _) => bail!("Unsupported integer sample width: {bits} bits."),
        },
    };
    Ok(OutputFormat {
        sample_rate: wave.get_samplespersec(),
        channels: wave.get_nchannels() as usize,
        sample,
        bits_per_sample: wave.get_bitspersample(),
    })
}

fn render_frames(format: &OutputFormat, samples: &[f32], frames: usize) -> Vec<u8> {
    let channels = format.channels.max(1);
    let mut output = vec![0u8; frames * channels * (format.bits_per_sample as usize / 8).max(1)];
    let mut offset = 0;
    for index in 0..frames * channels {
        let sample = samples.get(index).copied().unwrap_or(0.0).clamp(-1.0, 1.0);
        match format.sample {
            OutputSample::Float32 => {
                output[offset..offset + 4].copy_from_slice(&sample.to_le_bytes());
                offset += 4;
            }
            OutputSample::Int16 => {
                let value = (sample * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i16;
                output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
                offset += 2;
            }
            OutputSample::Int24 => {
                let value = (sample * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
                output[offset] = value as u8;
                output[offset + 1] = (value >> 8) as u8;
                output[offset + 2] = (value >> 16) as u8;
                offset += 3;
            }
            OutputSample::Int24In32 => {
                let value =
                    ((sample * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32) << 8;
                output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
                offset += 4;
            }
            OutputSample::Int32 => {
                let value = (sample as f64 * 2_147_483_648.0)
                    .round()
                    .clamp(-2_147_483_648.0, 2_147_483_647.0) as i32;
                output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
                offset += 4;
            }
        }
    }
    output.truncate(offset);
    output
}
