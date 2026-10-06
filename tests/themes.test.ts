import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_IDS, themeOf } from '../apps/client/src/world/themes';
import { PIECE_TRAITS } from '../apps/client/src/world/pieceTraits';

const ART = join(dirname(fileURLToPath(import.meta.url)), '../apps/sandbox/public/art');
const manifest = JSON.parse(readFileSync(join(ART, 'manifest.json'), 'utf8')) as Record<string, Record<string, string>>;

describe('map themes', () => {
  it('every theme finds its backdrop, chunk textures and props in the art pack', () => {
    expect(THEME_IDS).toEqual(['frozen', 'picnic', 'toys', 'garage', 'bath']);
    for (const id of THEME_IDS) {
      const t = THEMES[id];
      expect(t.id).toBe(id);
      const files = [manifest.backdrops![id], ...[...t.chunks.map((c) => c.tex), t.rock, t.girder].map((k) => manifest.textures![k]), ...[...t.small, ...t.big].map((k) => manifest.props![k])];
      for (const f of files) {
        expect(f, `${id}: missing in the manifest`).toBeTruthy();
        expect(existsSync(join(ART, f!)), `${id}: ${f} missing`).toBe(true);
      }
      expect(t.chunks.length).toBeGreaterThanOrEqual(3);
      // every theme builds its maps from its own objects, each painted and described
      expect(t.kit, `${id}: no object kit`).toBeTruthy();
      for (const k of new Set([...t.kit!.ground, ...t.kit!.tall, ...t.kit!.ledges])) {
        expect(manifest.pieces![k], `${id}: ${k} not painted`).toBeTruthy();
        expect(existsSync(join(ART, manifest.pieces![k]!)), `${id}: ${k} file missing`).toBe(true);
        expect(PIECE_TRAITS[k], `${id}: ${k} has no material`).toBeTruthy();
      }
    }
  });

  it('unknown theme ids fall back to the first theme', () => {
    expect(themeOf('garage')).toBe('garage');
    expect(themeOf('moon')).toBe('frozen');
    expect(themeOf(undefined)).toBe('frozen');
  });
});
