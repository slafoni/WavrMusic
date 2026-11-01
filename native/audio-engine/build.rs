use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=../../package.json");
    let package_path = Path::new("../../package.json");
    let version = fs::read_to_string(package_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("version").and_then(|entry| entry.as_str()).map(str::to_owned))
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    println!("cargo:rustc-env=WAVR_APP_VERSION={version}");
}
