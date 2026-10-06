import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/**
 * Link previews want absolute addresses: SITE_URL (or Vercel's own production address) makes
 * the og:image absolute at build time; without one it stays relative.
 */
function absoluteLinks(): Plugin {
  const env = process.env;
  const site = env.SITE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return {
    name: 'gumfire-absolute-links',
    transformIndexHtml: (html) => (site ? html.replace('content="og.jpg"', `content="${site.replace(/\/+$/, '')}/og.jpg"`) : html),
  };
}

// Maps and art live in the sandbox's public folder (shared with the dev playground).
export default defineConfig({
  base: './',
  publicDir: '../sandbox/public',
  server: { port: 5174, host: true },
  preview: { port: 4174 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  define: {
    __GUMFIRE_VERSION__: JSON.stringify(version),
    __GUMFIRE_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [absoluteLinks()],
});
