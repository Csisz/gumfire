import { Texture } from 'pixi.js';
import { ICONS } from '../hud';

/**
 * Weapon pictures for Gumlings to hold: the HUD's vector icons rasterised once into textures
 * (48 px, crisp at the held size even when zoomed in). Loading is asynchronous; until an icon is
 * ready the hand is simply empty.
 */
const cache = new Map<string, Texture | null>();

export function heldTexture(id: string): Texture | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  cache.set(id, null);
  const svg = ICONS[id];
  if (!svg) return null;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    c.getContext('2d')!.drawImage(img, 0, 0, 96, 96);
    const t = Texture.from(c);
    t.source.scaleMode = 'linear';
    cache.set(id, t);
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" '))}`;
  return null;
}
