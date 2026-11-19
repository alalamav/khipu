import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built app can be served from any folder.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // three.js and Tone.js are most of the bundle, and the piece needs both before it can do
    // anything, so it is left as one file of about 1.1 MB (290 kB gzipped).
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
