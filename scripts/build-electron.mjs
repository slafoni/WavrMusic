import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(root, 'dist-electron/main.js'),
});

await build({
  ...common,
  entryPoints: [path.join(root, 'src/preload/preload.ts')],
  outfile: path.join(root, 'dist-electron/preload.js'),
});
