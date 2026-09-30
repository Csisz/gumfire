import { defineConfig } from 'vite';

// Maps are shared with the sandbox until content gets its own map pipeline (M11).
export default defineConfig({
  base: './',
  publicDir: '../sandbox/public',
  server: { port: 5174, host: true },
  preview: { port: 4174 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
