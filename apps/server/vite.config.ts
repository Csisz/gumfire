import { defineConfig } from 'vite';

// The server is bundled into one file (dist/server.mjs); only `ws` stays an npm dependency.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { external: ['ws'], output: { entryFileNames: 'server.mjs' } },
  },
});
