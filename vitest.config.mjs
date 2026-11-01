import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = process.cwd();

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.js',
    include: ['tests/**/*.test.{js,ts,tsx,mjs}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src/renderer'),
      '@services': path.resolve(root, 'src/renderer/services'),
      '@state': path.resolve(root, 'src/renderer/state'),
      '@shared': path.resolve(root, 'shared'),
    },
  },
});
