mod config;
mod decode;
mod dsp;
mod output;
mod player;
mod resample;

use std::io::{self, BufRead, Write};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;

use anyhow::{Context, Result};
use crossbeam_channel::{unbounded, Sender};
use serde_json::{json, Value};

use crate::config::EngineConfig;
use crate::decode::{download_track, TrackSource};
use crate::output::{initialize, list_output_devices};
use crate::player::{spawn_player, PlayerCommand, PlayerEvent};

static OUTPUT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

enum Inbound {
    Command(Value),
    Loaded {
        generation: u64,
        autoplay: bool,
        source: Box<TrackSource>,
    },
    LoadFailed {
        generation: u64,
        track_id: String,
        message: String,
    },
    NextLoaded {
        generation: u64,
        source: Box<TrackSource>,
    },
    NextFailed {
        generation: u64,
        track_id: String,
        message: String,
    },
    Player {
        generation: u64,
        event: PlayerEvent,
    },
    InputClosed,
}

struct PlayerSlot {
    commands: crossbeam_channel::Sender<PlayerCommand>,
}

struct Controller {
    config: EngineConfig,
    inbound: Sender<Inbound>,
    generation: u64,
    next_generation: u64,
    player: Option<PlayerSlot>,
    current_track_id: Option<String>,
    current_queue_index: i64,
}

fn main() -> Result<()> {
    initialize();
    let (inbound_tx, inbound_rx) = unbounded::<Inbound>();
    emit(json!({
        "event": "ready",
        "version": env!("WAVR_APP_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    }));

    let stdin_tx = inbound_tx.clone();
    thread::Builder::new()
        .name("wavr-engine-stdin".into())
        .spawn(move || {
            let stdin = io::stdin();
            for line in stdin.lock().lines() {
                let Ok(line) = line else { break };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(command) => {
                        if stdin_tx.send(Inbound::Command(command)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        emit(json!({
                            "event": "error",
                            "message": format!("Invalid engine command: {error}"),
                        }));
                    }
                }
            }
            let _ = stdin_tx.send(Inbound::InputClosed);
        })
        .context("Could not start the WavrPulse input thread.")?;

    let mut controller = Controller {
        config: EngineConfig::default(),
        inbound: inbound_tx,
        generation: 0,
        next_generation: 0,
        player: None,
        current_track_id: None,
        current_queue_index: -1,
    };
    controller.run(inbound_rx);
    Ok(())
}

impl Controller {
    fn run(&mut self, inbound: crossbeam_channel::Receiver<Inbound>) {
        while let Ok(message) = inbound.recv() {
            match message {
                Inbound::Command(command) => {
                    if self.handle_command(command) {
                        break;
                    }
                }
                Inbound::Loaded {
                    generation,
                    autoplay,
                    source,
                } => {
                    if generation != self.generation {
                        continue;
                    }
                    self.start_player(*source, autoplay, generation);
                }
                Inbound::LoadFailed {
                    generation,
                    track_id,
                    message,
                } => {
                    if generation != self.generation {
                        continue;
                    }
                    self.player = None;
                    let _ = emit(json!({
                        "event": "state",
                        "state": "failed",
                        "trackId": track_id,
                        "position": 0.0,
                    }));
                    let _ = emit(json!({
                        "event": "error",
                        "message": message,
                        "trackId": track_id,
                    }));
                }
                Inbound::NextLoaded { generation, source } => {
                    if generation != self.next_generation {
                        continue;
                    }
                    if let Some(player) = &self.player {
                        let _ = player.commands.send(PlayerCommand::NextReady(source));
                    }
                }
                Inbound::NextFailed {
                    generation,
                    track_id,
                    message,
                } => {
                    if generation != self.next_generation {
                        continue;
                    }
                    let _ = emit(json!({
                        "event": "nextError",
                        "message": message,
                        "trackId": track_id,
                    }));
                }
                Inbound::Player { generation, event } => {
                    if generation != self.generation {
                        continue;
                    }
                    self.handle_player_event(event);
                }
                Inbound::InputClosed => {
                    self.stop_player();
                    break;
                }
            }
        }
    }

    fn handle_command(&mut self, command: Value) -> bool {
        let id = command.get("id").and_then(Value::as_u64);
        let name = command.get("command").and_then(Value::as_str).unwrap_or("");
        match name {
            "devices" => match list_output_devices() {
                Ok(devices) => respond_ok(id, Some(json!(devices))),
                Err(error) => respond_error(id, &format!("{error:#}")),
            },
            "play" => {
                let url = command.get("url").and_then(Value::as_str).unwrap_or("");
                let track_id = command
                    .get("trackId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if url.is_empty() || track_id.is_empty() {
                    respond_error(id, "A stream URL and track ID are required.");
                    return false;
                }
                let queue_index = command
                    .get("queueIndex")
                    .and_then(Value::as_i64)
                    .unwrap_or(-1);
                let position = command
                    .get("position")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .max(0.0);
                let autoplay = command
                    .get("autoplay")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                if let Some(config) = command.get("config") {
                    if let Ok(mut parsed) = serde_json::from_value::<EngineConfig>(config.clone()) {
                        parsed.sanitize();
                        self.config = parsed;
                    }
                }
                self.stop_player();
                self.generation = self.generation.wrapping_add(1);
                self.next_generation = self.next_generation.wrapping_add(1);
                self.current_track_id = Some(track_id.clone());
                self.current_queue_index = queue_index;
                let generation = self.generation;
                let _ = emit(json!({
                    "event": "state",
                    "state": "loading",
                    "trackId": track_id,
                    "position": position,
                }));
                respond_ok(id, None);
                self.load_track(
                    url.to_string(),
                    track_id,
                    queue_index,
                    position,
                    generation,
                    autoplay,
                    false,
                );
            }
            "prepareNext" => {
                let Some(player) = &self.player else {
                    respond_error(id, "Nothing is playing.");
                    return false;
                };
                let url = command.get("url").and_then(Value::as_str).unwrap_or("");
                let track_id = command
                    .get("trackId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if url.is_empty() || track_id.is_empty() {
                    respond_error(id, "A stream URL and track ID are required.");
                    return false;
                }
                self.next_generation = self.next_generation.wrapping_add(1);
                let generation = self.next_generation;
                let queue_index = command
                    .get("queueIndex")
                    .and_then(Value::as_i64)
                    .unwrap_or(-1);
                let _ = player;
                respond_ok(id, None);
                self.load_track(url.to_string(), track_id, queue_index, 0.0, generation, false, true);
            }
            "pause" => self.command_player(id, PlayerCommand::Pause, "Nothing is playing."),
            "resume" => self.command_player(id, PlayerCommand::Resume, "Nothing is playing."),
            "stop" => {
                self.stop_player();
                respond_ok(id, None);
            }
            "seek" => {
                let position = command
                    .get("position")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .max(0.0);
                self.command_player(id, PlayerCommand::Seek(position), "Nothing is playing.");
            }
            "volume" => {
                let volume = command
                    .get("volume")
                    .and_then(Value::as_f64)
                    .unwrap_or(self.config.volume as f64) as f32;
                let muted = command
                    .get("muted")
                    .and_then(Value::as_bool)
                    .unwrap_or(self.config.muted);
                self.config.volume = volume.clamp(0.0, 1.0);
                self.config.muted = muted;
                self.command_player(
                    id,
                    PlayerCommand::SetVolume {
                        volume: self.config.volume,
                        muted,
                    },
                    "Nothing is playing.",
                );
            }
            "configure" => {
                if let Some(config) = command.get("config") {
                    match serde_json::from_value::<EngineConfig>(config.clone()) {
                        Ok(mut parsed) => {
                            parsed.sanitize();
                            self.config = parsed;
                            if let Some(player) = &self.player {
                                let _ = player
                                    .commands
                                    .send(PlayerCommand::SetConfig(Box::new(self.config.clone())));
                            }
                            respond_ok(id, None);
                        }
                        Err(error) => respond_error(id, &format!("Invalid engine config: {error}")),
                    }
                } else {
                    respond_error(id, "Missing engine config.");
                }
            }
            "cancelNext" => {
                self.next_generation = self.next_generation.wrapping_add(1);
                if let Some(player) = &self.player {
                    let _ = player.commands.send(PlayerCommand::CancelNext);
                }
                respond_ok(id, None);
            }
            "status" => {
                respond_ok(
                    id,
                    Some(json!({
                        "playing": self.player.is_some(),
                        "trackId": self.current_track_id,
                        "queueIndex": self.current_queue_index,
                    })),
                );
            }
            "shutdown" => {
                self.stop_player();
                respond_ok(id, None);
                return true;
            }
            "" => respond_error(id, "Missing command."),
            other => respond_error(id, &format!("Unknown engine command: {other}")),
        }
        false
    }

    fn command_player(
        &mut self,
        id: Option<u64>,
        command: PlayerCommand,
        missing: &str,
    ) {
        if let Some(player) = &self.player {
            let _ = player.commands.send(command);
            respond_ok(id, None);
        } else {
            respond_error(id, missing);
        }
    }

    fn stop_player(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.next_generation = self.next_generation.wrapping_add(1);
        if let Some(player) = self.player.take() {
            let _ = player.commands.send(PlayerCommand::Stop);
        }
    }

    fn start_player(&mut self, source: TrackSource, autoplay: bool, generation: u64) {
        let (event_tx, event_rx) = mpsc::channel::<PlayerEvent>();
        let inbound = self.inbound.clone();
        let forwarder = thread::Builder::new()
            .name("wavr-engine-events".into())
            .spawn(move || {
                while let Ok(event) = event_rx.recv() {
                    if inbound
                        .send(Inbound::Player {
                            generation,
                            event,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            });
        if forwarder.is_err() {
            let _ = emit(json!({
                "event": "error",
                "message": "Could not start the audio event forwarder.",
            }));
            return;
        }
        self.current_track_id = Some(source.track_id.clone());
        self.current_queue_index = source.queue_index;
        let player = spawn_player(source, self.config.clone(), autoplay, event_tx);
        self.player = Some(PlayerSlot {
            commands: player.commands,
        });
        let _ = player.thread;
    }

    fn load_track(
        &self,
        url: String,
        track_id: String,
        queue_index: i64,
        position: f64,
        generation: u64,
        autoplay: bool,
        next: bool,
    ) {
        let inbound = self.inbound.clone();
        thread::Builder::new()
            .name(if next { "wavr-engine-next" } else { "wavr-engine-load" }.into())
            .spawn(move || {
                let hint = extension_from_url(&url);
                let result = (|| -> Result<TrackSource> {
                    let temp = download_track(&url)?;
                    TrackSource::open(temp, hint, track_id.clone(), queue_index, position)
                })();
                match result {
                    Ok(source) => {
                        let _ = inbound.send(if next {
                            Inbound::NextLoaded {
                                generation,
                                source: Box::new(source),
                            }
                        } else {
                            Inbound::Loaded {
                                generation,
                                autoplay,
                                source: Box::new(source),
                            }
                        });
                    }
                    Err(error) => {
                        let message = format!("{error:#}");
                        let _ = inbound.send(if next {
                            Inbound::NextFailed {
                                generation,
                                track_id,
                                message,
                            }
                        } else {
                            Inbound::LoadFailed {
                                generation,
                                track_id,
                                message,
                            }
                        });
                    }
                }
            })
            .ok();
    }

    fn handle_player_event(&mut self, event: PlayerEvent) {
        match &event {
            PlayerEvent::State {
                state,
                position,
                track_id,
            } => {
                let _ = emit(json!({
                    "event": "state",
                    "state": state,
                    "position": position,
                    "trackId": track_id,
                }));
                if *state == "ended" || *state == "stopped" || *state == "failed" {
                    self.player = None;
                }
            }
            PlayerEvent::Position {
                track_id,
                queue_index,
                position,
                duration,
            } => {
                let _ = emit(json!({
                    "event": "position",
                    "trackId": track_id,
                    "queueIndex": queue_index,
                    "position": position,
                    "duration": duration,
                }));
            }
            PlayerEvent::TrackChanged {
                track_id,
                queue_index,
                duration,
                position,
            } => {
                self.current_track_id = Some(track_id.clone());
                self.current_queue_index = *queue_index;
                self.next_generation = self.next_generation.wrapping_add(1);
                let _ = emit(json!({
                    "event": "trackChanged",
                    "trackId": track_id,
                    "queueIndex": queue_index,
                    "duration": duration,
                    "position": position,
                }));
            }
            PlayerEvent::Ended {
                track_id,
                queue_index,
            } => {
                let _ = emit(json!({
                    "event": "ended",
                    "trackId": track_id,
                    "queueIndex": queue_index,
                }));
                self.player = None;
            }
            PlayerEvent::Output {
                effective_mode,
                device_name,
                sample_rate,
                channels,
                sample,
                used_iaudioclient3,
                warnings,
            } => {
                let _ = emit(json!({
                    "event": "output",
                    "mode": effective_mode,
                    "deviceName": device_name,
                    "sampleRate": sample_rate,
                    "channels": channels,
                    "sampleFormat": sample,
                    "usedAudioClient3": used_iaudioclient3,
                    "warnings": warnings,
                }));
                for warning in warnings {
                    let _ = emit(json!({
                        "event": "warning",
                        "message": warning,
                    }));
                }
            }
            PlayerEvent::Error { message, track_id } => {
                let _ = emit(json!({
                    "event": "error",
                    "message": message,
                    "trackId": track_id,
                }));
                self.player = None;
            }
        }
    }
}

fn extension_from_url(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let name = parsed.path_segments()?.last()?;
    let extension = name.rsplit_once('.')?.1;
    if extension.len() <= 5 {
        Some(extension.to_ascii_lowercase())
    } else {
        None
    }
}

fn emit(value: Value) {
    let lock = OUTPUT_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    if serde_json::to_writer(&mut handle, &value).is_ok() {
        let _ = handle.write_all(b"\n");
        let _ = handle.flush();
    }
}

fn respond_ok(id: Option<u64>, data: Option<Value>) {
    let Some(id) = id else { return };
    let mut response = json!({ "event": "response", "id": id, "ok": true });
    if let Some(data) = data {
        response["data"] = data;
    }
    let _ = emit(response);
}

fn respond_error(id: Option<u64>, message: &str) {
    let Some(id) = id else { return };
    let _ = emit(json!({
        "event": "response",
        "id": id,
        "ok": false,
        "error": message,
    }));
}
