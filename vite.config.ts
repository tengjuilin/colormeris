// Vite builds the three pages; Vitest (same config) runs the colocated *.test.ts files.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  // Relative asset URLs, so the build works under the GitHub Pages project path.
  base: './',
  server: { port: 8000, strictPort: true, host: '127.0.0.1' },
  preview: { port: 8000, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        extract: resolve(root, 'extract.html'),
        colormaps: resolve(root, 'colormaps.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
