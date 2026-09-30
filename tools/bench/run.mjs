// Bundles a bench entry with Vite (rolldown) into one scope, then runs it in Node.
import { build } from 'vite';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
const entry = process.argv[2];
const outDir = join(dirname(fileURLToPath(import.meta.url)), '.out');
await build({ logLevel: 'warn', configFile: false, build: { ssr: entry, outDir, emptyOutDir: true, minify: false, target: 'node22', rollupOptions: { output: { entryFileNames: '[name].mjs' } } } });
await import(pathToFileURL(join(outDir, basename(entry).replace(/\.ts$/, '.mjs'))).href);
