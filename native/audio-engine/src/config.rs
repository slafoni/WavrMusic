use serde::{Deserialize, Serialize};

pub const EQ_FREQUENCIES: [f32; 10] = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
pub const EQ_BAND_COUNT: usize = EQ_FREQUENCIES.len();

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    #[default]
    Shared,
    Exclusive,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReplayGainMode {
    #[default]
    Off,
    Track,
    Album,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelMode {
    #[default]
    Auto,
    Stereo,
    Surround,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResampleQuality {
    #[default]
    Auto,
    High,
    Fast,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EngineConfig {
    pub mode: AudioMode,
    pub device_id: String,
    pub volume: f32,
    pub muted: bool,
    pub dsp_enabled: bool,
    pub eq_enabled: bool,
    pub eq_bands: Vec<f32>,
    pub eq_q: f32,
    pub replay_gain: ReplayGainMode,
    pub normalize_volume: bool,
    pub crossfade_seconds: f32,
    pub channel_mode: ChannelMode,
    pub resample_quality: ResampleQuality,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            mode: AudioMode::Shared,
            device_id: String::new(),
            volume: 0.85,
            muted: false,
            dsp_enabled: false,
            eq_enabled: false,
            eq_bands: vec![0.0; EQ_BAND_COUNT],
            eq_q: 1.05,
            replay_gain: ReplayGainMode::Off,
            normalize_volume: false,
            crossfade_seconds: 0.0,
            channel_mode: ChannelMode::Auto,
            resample_quality: ResampleQuality::Auto,
        }
    }
}

impl EngineConfig {
    pub fn sanitize(&mut self) {
        self.volume = self.volume.clamp(0.0, 1.0);
        self.eq_q = self.eq_q.clamp(0.2, 6.0);
        self.crossfade_seconds = self.crossfade_seconds.clamp(0.0, 20.0);
        if self.eq_bands.len() < EQ_BAND_COUNT {
            self.eq_bands.resize(EQ_BAND_COUNT, 0.0);
        }
        for gain in &mut self.eq_bands {
            *gain = gain.clamp(-12.0, 12.0);
        }
        self.eq_bands.truncate(EQ_BAND_COUNT);
    }

    pub fn eq_preamp_db(&self) -> f32 {
        if !self.dsp_enabled || !self.eq_enabled {
            return 0.0;
        }
        let max_boost = self
            .eq_bands
            .iter()
            .copied()
            .fold(0.0_f32, f32::max)
            .clamp(0.0, 12.0);
        -max_boost
    }
}
