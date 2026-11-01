use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result};

use super::{linux_alsa, linux_pipewire};
use super::{DeviceList, OutputFormat};
use crate::config::{AudioMode, EngineConfig};

static FORCE_ALSA: AtomicBool = AtomicBool::new(false);

enum Backend {
    Pipewire(linux_pipewire::OutputClient),
    Alsa(linux_alsa::OutputClient),
}

pub struct OutputClient {
    inner: Backend,
    pub format: OutputFormat,
    pub device_name: String,
    pub effective_mode: AudioMode,
    pub used_iaudioclient3: bool,
    pub warnings: Vec<String>,
}

impl OutputClient {
    fn from_pipewire(client: linux_pipewire::OutputClient) -> Self {
        Self {
            format: client.format.clone(),
            device_name: client.device_name.clone(),
            effective_mode: client.effective_mode,
            used_iaudioclient3: client.used_iaudioclient3,
            warnings: client.warnings.clone(),
            inner: Backend::Pipewire(client),
        }
    }

    fn from_alsa(client: linux_alsa::OutputClient) -> Self {
        Self {
            format: client.format.clone(),
            device_name: client.device_name.clone(),
            effective_mode: client.effective_mode,
            used_iaudioclient3: client.used_iaudioclient3,
            warnings: client.warnings.clone(),
            inner: Backend::Alsa(client),
        }
    }

    pub fn available_frames(&self) -> Result<usize> {
        match &self.inner {
            Backend::Pipewire(client) => client.available_frames(),
            Backend::Alsa(client) => client.available_frames(),
        }
    }

    pub fn wait_for_event(&mut self, timeout_ms: u64) -> Result<()> {
        match &mut self.inner {
            Backend::Pipewire(client) => client.wait_for_event(timeout_ms),
            Backend::Alsa(client) => client.wait_for_event(timeout_ms),
        }
    }

    pub fn start_stream(&mut self) -> Result<()> {
        match &mut self.inner {
            Backend::Pipewire(client) => client.start_stream(),
            Backend::Alsa(client) => client.start_stream(),
        }
    }

    pub fn stop_stream(&mut self) {
        match &mut self.inner {
            Backend::Pipewire(client) => client.stop_stream(),
            Backend::Alsa(client) => client.stop_stream(),
        }
    }

    pub fn reset_stream(&mut self) {
        match &mut self.inner {
            Backend::Pipewire(client) => client.reset_stream(),
            Backend::Alsa(client) => client.reset_stream(),
        }
    }

    pub fn write_frames(&mut self, frames: usize, samples: &[f32]) -> Result<()> {
        match &mut self.inner {
            Backend::Pipewire(client) => client.write_frames(frames, samples),
            Backend::Alsa(client) => client.write_frames(frames, samples),
        }
    }
}

pub fn initialize() {
    linux_pipewire::initialize();
    linux_alsa::initialize();
}

pub fn list_output_devices() -> Result<DeviceList> {
    if FORCE_ALSA.load(Ordering::Relaxed) {
        return linux_alsa::list_output_devices()
            .or_else(|_| linux_pipewire::list_output_devices());
    }
    linux_pipewire::list_output_devices()
        .or_else(|_| linux_alsa::list_output_devices())
}

pub fn open_output(
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
    source_bits: u32,
) -> Result<OutputClient> {
    if FORCE_ALSA.load(Ordering::Relaxed) {
        let mut client = linux_alsa::open_output(
            config,
            source_rate,
            source_channels,
            source_bits,
        )
        .context("ALSA audio is unavailable; PipeWire fallback is disabled until WAVR restarts")?;
        client
            .warnings
            .push("Using the ALSA fallback for the rest of this session.".into());
        return Ok(OutputClient::from_alsa(client));
    }

    match linux_pipewire::open_output(config, source_rate, source_channels, source_bits) {
        Ok(client) => Ok(OutputClient::from_pipewire(client)),
        Err(pipewire_error) => {
            let mut client = linux_alsa::open_output(
                config,
                source_rate,
                source_channels,
                source_bits,
            )
            .with_context(|| {
                format!("PipeWire failed ({pipewire_error:#}); ALSA fallback also failed")
            })?;
            FORCE_ALSA.store(true, Ordering::Relaxed);
            client.warnings.push(format!(
                "PipeWire unavailable; permanently using the ALSA fallback until WAVR restarts. {pipewire_error:#}"
            ));
            Ok(OutputClient::from_alsa(client))
        }
    }
}
