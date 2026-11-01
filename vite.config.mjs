import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = process.cwd();

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src/renderer'),
      '@services': path.resolve(root, 'src/renderer/services'),
      '@state': path.resolve(root, 'src/renderer/state'),
      '@components': path.resolve(root, 'src/renderer/components'),
      '@hooks': path.resolve(root, 'src/renderer/hooks'),
      '@utils': path.resolve(root, 'src/renderer/utils'),
      '@styles': path.resolve(root, 'src/renderer/styles'),
      '@themes': path.resolve(root, 'src/renderer/themes'),
      '@shared': path.resolve(root, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
