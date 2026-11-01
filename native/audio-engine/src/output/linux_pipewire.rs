use std::collections::VecDeque;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::spa::pod::Pod;
use pw::spa::utils::Direction;
use pw::stream::{StreamBox, StreamFlags, StreamState};

use crate::config::{AudioMode, EngineConfig};
use super::{DeviceInfo, DeviceList, OutputFormat, OutputSample};

const TARGET_FRAMES: usize = 2048;
const CAPACITY_FRAMES: usize = 8192;
const CHANNELS: usize = 2;

type SampleQueue = Arc<Mutex<VecDeque<f32>>>;
type ErrorSlot = Arc<Mutex<Option<String>>>;

enum PipewireCommand {
    Start,
    Pause,
    Shutdown,
}

pub fn initialize() {
    pw::init();
}

pub struct OutputClient {
    queue: SampleQueue,
    capacity_samples: usize,
    channels: usize,
    errors: ErrorSlot,
    commands: mpsc::Sender<PipewireCommand>,
    thread: Option<JoinHandle<()>>,
    pub format: OutputFormat,
    pub device_name: String,
    pub effective_mode: AudioMode,
    pub used_iaudioclient3: bool,
    pub warnings: Vec<String>,
}

impl OutputClient {
    pub fn available_frames(&self) -> Result<usize> {
        self.check_error()?;
        let queued = self
            .queue
            .lock()
            .map_err(|_| anyhow!("The PipeWire audio buffer is unavailable."))?
            .len();
        let free = self.capacity_samples.saturating_sub(queued);
        Ok(free.min(TARGET_FRAMES * self.channels) / self.channels)
    }

    pub fn wait_for_event(&mut self, _timeout_ms: u64) -> Result<()> {
        thread::sleep(Duration::from_millis(2));
        Ok(())
    }

    pub fn start_stream(&mut self) -> Result<()> {
        self.commands
            .send(PipewireCommand::Start)
            .map_err(|_| anyhow!("The PipeWire audio thread is not running."))
    }

    pub fn stop_stream(&mut self) {
        self.commands.send(PipewireCommand::Pause).ok();
    }

    pub fn reset_stream(&mut self) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.clear();
        }
    }

    pub fn write_frames(&mut self, frames: usize, samples: &[f32]) -> Result<()> {
        self.check_error()?;
        let wanted = frames * self.channels;
        let mut queue = self
            .queue
            .lock()
            .map_err(|_| anyhow!("The PipeWire audio buffer is unavailable."))?;
        if queue.len() + wanted > self.capacity_samples {
            bail!("The PipeWire audio output buffer overflowed.");
        }
        queue.extend(samples.iter().copied().take(wanted));
        Ok(())
    }

    fn check_error(&self) -> Result<()> {
        let error = self
            .errors
            .lock()
            .ok()
            .and_then(|slot| slot.clone());
        if let Some(error) = error {
            bail!("PipeWire playback failed: {error}");
        }
        Ok(())
    }
}

impl Drop for OutputClient {
    fn drop(&mut self) {
        self.commands.send(PipewireCommand::Shutdown).ok();
        if let Some(handle) = self.thread.take() {
            handle.join().ok();
        }
    }
}

pub fn list_output_devices() -> Result<DeviceList> {
    Ok(DeviceList {
        devices: vec![DeviceInfo {
            id: "pipewire:default".into(),
            name: "System default (PipeWire)".into(),
            is_default: true,
            channels: Some(CHANNELS as u16),
            sample_rate: Some(48000),
        }],
        default_id: Some("pipewire:default".into()),
    })
}

pub fn open_output(
    config: &EngineConfig,
    source_rate: u32,
    source_channels: usize,
    source_bits: u32,
) -> Result<OutputClient> {
    let _ = (source_channels, source_bits);
    let sample_rate = if source_rate > 0 { source_rate } else { 48000 };
    let channels = CHANNELS;
    let capacity_samples = CAPACITY_FRAMES * channels;
    let queue: SampleQueue = Arc::new(Mutex::new(VecDeque::with_capacity(capacity_samples)));
    let errors: ErrorSlot = Arc::new(Mutex::new(None));
    let (command_tx, command_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread_queue = queue.clone();
    let thread_errors = errors.clone();
    let thread = thread::Builder::new()
        .name("wavr-pipewire".into())
        .spawn(move || {
            run_pipewire(
                thread_queue,
                thread_errors,
                sample_rate,
                channels,
                command_rx,
                ready_tx,
            );
        })
        .context("Could not start the PipeWire output thread.")?;

    match ready_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => {}
        Ok(Err(message)) => {
            thread.join().ok();
            bail!("{message}");
        }
        Err(error) => {
            command_tx.send(PipewireCommand::Shutdown).ok();
            thread.join().ok();
            bail!("PipeWire did not start in time: {error}");
        }
    }

    let mut warnings = Vec::new();
    if config.mode == AudioMode::Exclusive {
        warnings.push(
            "Exclusive output is not supported by the PipeWire backend; WAVR is using the system shared mix."
                .into(),
        );
    }

    Ok(OutputClient {
        queue,
        capacity_samples,
        channels,
        errors,
        commands: command_tx,
        thread: Some(thread),
        format: OutputFormat {
            sample_rate,
            channels,
            sample: OutputSample::Float32,
            bits_per_sample: 32,
        },
        device_name: "PipeWire output".into(),
        effective_mode: AudioMode::Shared,
        used_iaudioclient3: false,
        warnings,
    })
}

fn run_pipewire(
    queue: SampleQueue,
    errors: ErrorSlot,
    sample_rate: u32,
    channels: usize,
    commands: mpsc::Receiver<PipewireCommand>,
    ready: mpsc::Sender<Result<(), String>>,
) {
    let result = (|| -> Result<()> {
        let thread_loop = unsafe { pw::thread_loop::ThreadLoopBox::new(Some("wavr-pulse"), None) }?;
        let context;
        let core;
        let stream;
        let listener;
        {
            let _lock = thread_loop.lock();
            context = pw::context::ContextBox::new(thread_loop.loop_(), None)?;
            core = context.connect(None)?;
            stream = StreamBox::new(
                &core,
                "wavr-pulse",
                properties! {
                    *pw::keys::MEDIA_TYPE => "Audio",
                    *pw::keys::MEDIA_ROLE => "Music",
                    *pw::keys::MEDIA_CATEGORY => "Playback",
                    *pw::keys::MEDIA_NAME => "WAVR",
                    *pw::keys::AUDIO_CHANNELS => "2",
                    *pw::keys::NODE_NAME => "wavr-pulse",
                    *pw::keys::NODE_DESCRIPTION => "WAVR playback",
                },
            )?;
            let callback_queue = queue.clone();
            let callback_errors = errors.clone();
            listener = stream
                .add_local_listener_with_user_data(())
                .state_changed(move |_stream, _data, _old, new| {
                    if let StreamState::Error(message) = new {
                        if let Ok(mut slot) = callback_errors.lock() {
                            *slot = Some(message);
                        }
                    }
                })
                .process(move |stream, _data| {
                    let Some(mut buffer) = stream.dequeue_buffer() else {
                        return;
                    };
                    let datas = buffer.datas_mut();
                    if datas.is_empty() {
                        return;
                    }
                    let data = &mut datas[0];
                    let stride = std::mem::size_of::<f32>() * CHANNELS;
                    let Some(slice) = data.data() else {
                        return;
                    };
                    let frames = slice.len() / stride;
                    let mut queue = callback_queue
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    for frame in slice.chunks_exact_mut(stride) {
                        let left = queue.pop_front().unwrap_or(0.0);
                        let right = queue.pop_front().unwrap_or(0.0);
                        frame[0..4].copy_from_slice(&left.to_le_bytes());
                        frame[4..8].copy_from_slice(&right.to_le_bytes());
                    }
                    drop(queue);
                    let chunk = data.chunk_mut();
                    *chunk.offset_mut() = 0;
                    *chunk.stride_mut() = stride as _;
                    *chunk.size_mut() = (stride * frames) as _;
                })
                .register()?;

            let mut audio_info = spa::param::audio::AudioInfoRaw::new();
            audio_info.set_format(spa::param::audio::AudioFormat::F32LE);
            audio_info.set_rate(sample_rate);
            audio_info.set_channels(channels as u32);
            let mut position = [0; spa::param::audio::MAX_CHANNELS];
            position[0] = spa_sys::SPA_AUDIO_CHANNEL_FL;
            position[1] = spa_sys::SPA_AUDIO_CHANNEL_FR;
            audio_info.set_position(position);

            let values: Vec<u8> = spa::pod::serialize::PodSerializer::serialize(
                std::io::Cursor::new(Vec::new()),
                &spa::pod::Value::Object(spa::pod::Object {
                    type_: spa_sys::SPA_TYPE_OBJECT_Format,
                    id: spa_sys::SPA_PARAM_EnumFormat,
                    properties: audio_info.into(),
                }),
            )
            .map_err(|error| anyhow!("Could not build the PipeWire audio format: {error}"))?
            .0
            .into_inner();
            let pod = Pod::from_bytes(&values)
                .context("Could not create the PipeWire audio format parameter.")?;
            let mut params = [pod];

            stream.connect(
                Direction::Output,
                None,
                StreamFlags::AUTOCONNECT
                    | StreamFlags::MAP_BUFFERS
                    | StreamFlags::RT_PROCESS
                    | StreamFlags::INACTIVE,
                &mut params,
            )?;
        }

        thread_loop.start();
        ready.send(Ok(())).ok();

        loop {
            match commands.recv() {
                Ok(PipewireCommand::Start) => {
                    let _lock = thread_loop.lock();
                    if let Err(error) = stream.set_active(true) {
                        set_error(&errors, error.to_string());
                    }
                }
                Ok(PipewireCommand::Pause) => {
                    let _lock = thread_loop.lock();
                    if let Err(error) = stream.set_active(false) {
                        set_error(&errors, error.to_string());
                    }
                }
                Ok(PipewireCommand::Shutdown) | Err(_) => break,
            }
        }

        {
            let _lock = thread_loop.lock();
            stream.disconnect().ok();
            drop(listener);
            drop(stream);
            drop(core);
            drop(context);
        }
        thread_loop.stop();
        drop(thread_loop);
        Ok(())
    })();

    if let Err(error) = result {
        ready.send(Err(format!("{error:#}"))).ok();
    }
}

fn set_error(errors: &ErrorSlot, message: String) {
    if let Ok(mut slot) = errors.lock() {
        *slot = Some(message);
    }
}
