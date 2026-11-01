const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const binDirectory = path.join(context.appOutDir, 'resources', 'bin');
  if (!fs.existsSync(binDirectory)) return;
  const remove = (name) => {
    try {
      fs.rmSync(path.join(binDirectory, name), { force: true });
    } catch {
      /* ignore missing files */
    }
  };
  if (context.electronPlatformName === 'linux') {
    remove('WavrPulse.exe');
    remove('wavr-pulse.exe');
    const arch = context.arch === 3 ? 'arm64' : 'x64';
    if (arch === 'arm64') {
      const arm64Sidecar = path.join(binDirectory, 'wavr-pulse-arm64');
      if (fs.existsSync(arm64Sidecar)) {
        fs.copyFileSync(arm64Sidecar, path.join(binDirectory, 'wavr-pulse'));
      }
    }
    remove('wavr-pulse-arm64');
    try {
      fs.chmodSync(path.join(binDirectory, 'wavr-pulse'), 0o755);
    } catch {
      /* ignore missing sidecar */
    }
    const library = path.join(
      context.packager.projectDir,
      'native',
      'linux-libs',
      arch,
      'libpipewire-0.3.so.0',
    );
    if (fs.existsSync(library)) {
      fs.copyFileSync(library, path.join(binDirectory, 'libpipewire-0.3.so.0'));
    }
  } else if (context.electronPlatformName === 'win32') {
    remove('wavr-pulse');
    remove('wavr-pulse-arm64');
    remove('WavrPulse');
    remove('libpipewire-0.3.so.0');
  }
};
