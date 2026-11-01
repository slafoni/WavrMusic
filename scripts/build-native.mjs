import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'native', 'audio-engine');
const outputDir = path.join(root, 'native', 'bin');

fs.mkdirSync(outputDir, { recursive: true });

if (process.platform !== 'win32' && process.platform !== 'linux') {
  console.log('Skipping WavrPulse build: unsupported platform.');
  process.exit(0);
}

const outputName = process.platform === 'win32' ? 'WavrPulse.exe' : 'wavr-pulse';
const builtName = process.platform === 'win32' ? 'wavr-pulse.exe' : 'wavr-pulse';
const existing = path.join(outputDir, outputName);
const cargo = spawnSync('cargo', ['--version'], {
  cwd: project,
  stdio: 'ignore',
  env: process.env,
});
if (cargo.error || cargo.status !== 0) {
  if (fs.existsSync(existing)) {
    console.warn(`Cargo is unavailable; using the existing ${outputName} binary.`);
    process.exit(0);
  }
  console.error(`Cargo is unavailable and no prebuilt ${outputName} engine exists.`);
  console.error(`Install Rust or place ${outputName} in native/bin.`);
  process.exit(1);
}

const result = spawnSync('cargo', ['build', '--release', '--manifest-path', 'Cargo.toml'], {
  cwd: project,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('Could not run cargo. Install Rust and retry.');
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const binary = path.join(project, 'target', 'release', builtName);
if (!fs.existsSync(binary)) {
  console.error(`WavrPulse binary not found at ${binary}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
const destination = path.join(outputDir, outputName);
fs.copyFileSync(binary, destination);
if (process.platform === 'linux') {
  fs.chmodSync(destination, 0o755);
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const library = path.join(root, 'native', 'linux-libs', arch, 'libpipewire-0.3.so.0');
  if (fs.existsSync(library)) {
    fs.copyFileSync(library, path.join(outputDir, 'libpipewire-0.3.so.0'));
  }
}
const legacy = path.join(
  outputDir,
  process.platform === 'win32' ? 'wavr-audio-engine.exe' : 'wavr-audio-engine',
);
if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
console.log(`Copied ${outputName} to native/bin`);
