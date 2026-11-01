use std::collections::VecDeque;

use anyhow::{Context, Result};
use rubato::{
    Resampler as RubatoResampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};

use crate::config::ResampleQuality;

pub struct Resampler {
    inner: SincFixedIn<f32>,
    channels: usize,
    input: VecDeque<f32>,
    output: VecDeque<f32>,
    flushed: bool,
}

impl Resampler {
    pub fn new(
        source_rate: u32,
        output_rate: u32,
        channels: usize,
        quality: ResampleQuality,
    ) -> Result<Option<Self>> {
        if source_rate == output_rate {
            return Ok(None);
        }
        let (sinc_len, oversampling_factor) = match quality {
            ResampleQuality::Fast => (128, 128),
            ResampleQuality::Auto => (192, 192),
            ResampleQuality::High => (256, 256),
        };
        let parameters = SincInterpolationParameters {
            sinc_len,
            f_cutoff: 0.95,
            oversampling_factor,
            interpolation: SincInterpolationType::Linear,
            window: WindowFunction::BlackmanHarris2,
        };
        let inner = SincFixedIn::<f32>::new(
            output_rate as f64 / source_rate as f64,
            1.0,
            parameters,
            1024,
            channels.max(1),
        )
        .context("Could not initialise the high-quality resampler.")?;
        Ok(Some(Self {
            inner,
            channels: channels.max(1),
            input: VecDeque::new(),
            output: VecDeque::new(),
            flushed: false,
        }))
    }

    pub fn feed(&mut self, interleaved: &[f32]) {
        self.input.extend(interleaved.iter().copied());
        self.process_available(false);
    }

    pub fn finish(&mut self) {
        if self.flushed {
            return;
        }
        self.process_available(true);
        self.flushed = true;
    }

    pub fn available_frames(&self) -> usize {
        self.output.len() / self.channels
    }

    pub fn take(&mut self, frames: usize) -> Vec<f32> {
        let samples = (frames * self.channels).min(self.output.len());
        let mut output = Vec::with_capacity(samples);
        for _ in 0..samples {
            if let Some(sample) = self.output.pop_front() {
                output.push(sample);
            }
        }
        output
    }

    fn process_available(&mut self, flush: bool) {
        let chunk_frames = self.inner.input_frames_next();
        let chunk_samples = chunk_frames * self.channels;
        loop {
            if self.input.len() < chunk_samples {
                break;
            }
            let planar = self.split_planar(chunk_samples);
            match self.inner.process(&planar, None) {
                Ok(rendered) => self.append_planar(rendered),
                Err(_) => {
                    self.input.clear();
                    break;
                }
            }
        }
        if flush && !self.input.is_empty() {
            let planar = self.split_planar_partial();
            if let Ok(rendered) = self.inner.process_partial(Some(&planar), None) {
                self.append_planar(rendered);
            }
            self.input.clear();
            if let Ok(rendered) = self.inner.process_partial::<Vec<f32>>(None, None) {
                self.append_planar(rendered);
            }
        }
    }

    fn split_planar(&mut self, samples: usize) -> Vec<Vec<f32>> {
        let mut planar = vec![Vec::with_capacity(samples / self.channels); self.channels];
        for frame in 0..samples / self.channels {
            for channel in 0..self.channels {
                planar[channel].push(self.input.pop_front().unwrap_or(0.0));
            }
            let _ = frame;
        }
        planar
    }

    fn split_planar_partial(&mut self) -> Vec<Vec<f32>> {
        let frames = self.input.len() / self.channels;
        let mut planar = vec![Vec::with_capacity(frames); self.channels];
        for _ in 0..frames {
            for channel in 0..self.channels {
                planar[channel].push(self.input.pop_front().unwrap_or(0.0));
            }
        }
        planar
    }

    fn append_planar(&mut self, planar: Vec<Vec<f32>>) {
        let frames = planar.first().map(|channel| channel.len()).unwrap_or(0);
        for frame in 0..frames {
            for channel in &planar {
                self.output
                    .push_back(channel.get(frame).copied().unwrap_or(0.0));
            }
        }
    }
}
