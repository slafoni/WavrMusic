use serde::Serialize;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
mod linux_alsa;
#[cfg(target_os = "linux")]
mod linux_pipewire;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::{initialize, list_output_devices, open_output, OutputClient};
#[cfg(windows)]
pub use windows::{initialize, list_output_devices, open_output, OutputClient};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub channels: Option<u16>,
    pub sample_rate: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceList {
    pub devices: Vec<DeviceInfo>,
    pub default_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputSample {
    Float32,
    Int16,
    Int24,
    Int24In32,
    Int32,
}

#[derive(Clone, Debug)]
pub struct OutputFormat {
    pub sample_rate: u32,
    pub channels: usize,
    pub sample: OutputSample,
    pub bits_per_sample: u16,
}
