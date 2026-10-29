// Vite builds the three pages; Vitest (same config) runs the colocated *.test.ts(x) files.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  // Relative asset URLs, so the build works under the GitHub Pages project path.
  base: './',
  plugins: [react()],
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
    // Component tests opt into jsdom with `// @vitest-environment jsdom` on their first line.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
