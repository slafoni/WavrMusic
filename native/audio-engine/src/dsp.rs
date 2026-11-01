use std::f32::consts::PI;

use crate::config::{EngineConfig, EQ_BAND_COUNT, EQ_FREQUENCIES};

#[derive(Clone, Copy, Debug, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn peaking(sample_rate: f32, frequency: f32, q: f32, gain_db: f32) -> Self {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * frequency.min(sample_rate * 0.45) / sample_rate;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(0.1));
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos_w0) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos_w0) / a0,
            a2: (1.0 - alpha / a) / a0,
            ..Self::default()
        }
    }

    fn process(&mut self, sample: f32) -> f32 {
        let output = self.b0 * sample + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = sample;
        self.y2 = self.y1;
        self.y1 = output;
        output
    }

}

pub struct Equalizer {
    sample_rate: u32,
    channels: usize,
    q: f32,
    gains: [f32; EQ_BAND_COUNT],
    filters: Vec<[Biquad; EQ_BAND_COUNT]>,
    enabled: bool,
    preamp: f32,
}

impl Equalizer {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let mut eq = Self {
            sample_rate,
            channels: channels.max(1),
            q: 1.05,
            gains: [0.0; EQ_BAND_COUNT],
            filters: Vec::new(),
            enabled: false,
            preamp: 1.0,
        };
        eq.rebuild();
        eq
    }

    pub fn configure(&mut self, config: &EngineConfig) {
        let new_enabled = config.dsp_enabled && config.eq_enabled;
        let mut new_gains = [0.0_f32; EQ_BAND_COUNT];
        for (index, value) in config.eq_bands.iter().take(EQ_BAND_COUNT).enumerate() {
            new_gains[index] = value.clamp(-12.0, 12.0);
        }
        let changed = new_enabled != self.enabled
            || (config.eq_q - self.q).abs() > 0.001
            || new_gains
                .iter()
                .zip(self.gains.iter())
                .any(|(a, b)| (*a - *b).abs() > 0.001);
        self.enabled = new_enabled;
        self.q = config.eq_q;
        self.gains = new_gains;
        self.preamp = 10.0_f32.powf(config.eq_preamp_db() / 20.0);
        if changed {
            self.rebuild();
        }
    }

    fn rebuild(&mut self) {
        self.filters = (0..self.channels)
            .map(|_| {
                std::array::from_fn(|index| {
                    Biquad::peaking(
                        self.sample_rate as f32,
                        EQ_FREQUENCIES[index],
                        self.q,
                        self.gains[index],
                    )
                })
            })
            .collect();
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if !self.enabled || self.channels == 0 {
            return;
        }
        for frame in samples.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                let filters = &mut self.filters[channel];
                let mut value = *sample * self.preamp;
                for filter in filters.iter_mut() {
                    value = filter.process(value);
                }
                *sample = value;
            }
        }
    }
}

pub struct Normalizer {
    sample_rate: u32,
    channels: usize,
    enabled: bool,
    window_frames: u32,
    window_count: u32,
    sum_squares: f64,
    gain: f32,
    target_rms: f32,
}

impl Normalizer {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        Self {
            sample_rate,
            channels: channels.max(1),
            enabled: false,
            window_frames: (sample_rate / 20).max(1),
            window_count: 0,
            sum_squares: 0.0,
            gain: 1.0,
            target_rms: 10.0_f32.powf(-18.0 / 20.0),
        }
    }

    pub fn configure(&mut self, enabled: bool, sample_rate: u32, channels: usize) {
        if sample_rate != self.sample_rate || channels != self.channels {
            self.sample_rate = sample_rate;
            self.channels = channels.max(1);
            self.window_frames = (sample_rate / 20).max(1);
            self.window_count = 0;
            self.sum_squares = 0.0;
        }
        self.enabled = enabled;
        if !enabled {
            self.gain = 1.0;
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        if !self.enabled || self.channels == 0 {
            return;
        }
        let channel_scale = 1.0 / (self.channels as f64);
        for frame in samples.chunks_exact_mut(self.channels) {
            let mut frame_sum = 0.0_f64;
            for sample in frame.iter() {
                frame_sum += (*sample as f64) * (*sample as f64);
            }
            self.sum_squares += frame_sum * channel_scale;
            self.window_count += 1;
            if self.window_count >= self.window_frames {
                let rms = (self.sum_squares / self.window_count as f64).sqrt() as f32;
                if rms > 0.000001 {
                    let target_gain = (self.target_rms / rms).clamp(0.2, 5.0);
                    let smoothing = if target_gain < self.gain { 0.18 } else { 0.035 };
                    self.gain += (target_gain - self.gain) * smoothing;
                }
                self.window_count = 0;
                self.sum_squares = 0.0;
            }
            for sample in frame.iter_mut() {
                *sample *= self.gain;
            }
        }
    }
}

pub fn replay_gain_linear(gain_db: f32, peak: Option<f32>) -> f32 {
    let mut gain = 10.0_f32.powf(gain_db / 20.0);
    if let Some(peak) = peak {
        if peak > 0.0 {
            gain = gain.min(0.999 / peak);
        }
    }
    gain.clamp(0.05, 8.0)
}

pub fn soft_limit(samples: &mut [f32]) {
    for sample in samples {
        let value = *sample;
        if value > 0.98 {
            *sample = 0.98 + (value - 0.98).tanh() * 0.019;
        } else if value < -0.98 {
            *sample = -0.98 + (value + 0.98).tanh() * 0.019;
        }
    }
}

pub fn map_channels(
    input: &[f32],
    source_channels: usize,
    output_channels: usize,
    force_stereo: bool,
) -> Vec<f32> {
    if source_channels == 0 || output_channels == 0 || input.is_empty() {
        return Vec::new();
    }
    let source_channels = source_channels.max(1);
    if source_channels == output_channels && !force_stereo {
        return input.to_vec();
    }
    if source_channels == output_channels {
        return input.to_vec();
    }
    let frames = input.len() / source_channels;
    let mut output = vec![0.0_f32; frames * output_channels];

    if source_channels == 1 {
        for frame in 0..frames {
            let mono = input[frame];
            if output_channels == 1 {
                output[frame] = mono;
            } else {
                output[frame * output_channels] = mono;
                output[frame * output_channels + 1] = mono;
            }
        }
        return output;
    }

    if output_channels == 1 {
        let scale = 1.0 / (source_channels as f32).sqrt();
        for frame in 0..frames {
            let mut sum = 0.0;
            for channel in 0..source_channels {
                sum += input[frame * source_channels + channel];
            }
            output[frame] = sum * scale;
        }
        return output;
    }

    if output_channels == 2 {
        for frame in 0..frames {
            let src = &input[frame * source_channels..(frame + 1) * source_channels];
            let (left, right) = downmix_to_stereo(src, source_channels);
            output[frame * 2] = left;
            output[frame * 2 + 1] = right;
        }
        return output;
    }

    for frame in 0..frames {
        let src = &input[frame * source_channels..(frame + 1) * source_channels];
        let (left, right) = downmix_to_stereo(src, source_channels);
        let base = frame * output_channels;
        output[base] = left;
        output[base + 1] = right;
        if output_channels > 2 {
            output[base + 2] = (left + right) * 0.5;
        }
        if output_channels > 3 {
            output[base + 3] = 0.0;
        }
        let mut channel = 4;
        while channel < output_channels {
            let source = if channel % 2 == 0 { left } else { right };
            output[base + channel] = source * 0.32;
            channel += 1;
        }
    }
    output
}

fn downmix_to_stereo(source: &[f32], channels: usize) -> (f32, f32) {
    if channels == 1 {
        return (source[0], source[0]);
    }
    let left = source[0];
    let right = source[1];
    match channels {
        2 => (left, right),
        3 => {
            let center = source[2] * 0.707;
            (left + center, right + center)
        }
        4 => (left + source[2] * 0.707, right + source[3] * 0.707),
        5 => {
            let center = source[2] * 0.707;
            (
                left + center + source[3] * 0.707,
                right + center + source[4] * 0.707,
            )
        }
        6 => {
            let center = source[2] * 0.707;
            let lfe = source[3] * 0.35;
            (
                left + center + lfe + source[4] * 0.707,
                right + center + lfe + source[5] * 0.707,
            )
        }
        7 => {
            let center = source[2] * 0.707;
            let lfe = source[3] * 0.35;
            let rear_center = source[4] * 0.5;
            (
                left + center + lfe + source[5] * 0.707 + rear_center,
                right + center + lfe + source[6] * 0.707 + rear_center,
            )
        }
        _ => {
            let center = source[2] * 0.707;
            let lfe = source[3] * 0.35;
            let left_surround = source[4] + source.get(6).copied().unwrap_or(0.0);
            let right_surround = source[5] + source.get(7).copied().unwrap_or(0.0);
            (
                left + center + lfe + left_surround * 0.5,
                right + center + lfe + right_surround * 0.5,
            )
        }
    }
}
