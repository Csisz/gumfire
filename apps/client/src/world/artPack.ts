import { Texture } from 'pixi.js';
import { proceduralArt, proceduralCrust, type RGB, type TerrainArt, type TexImage } from '@gumfire/render';
import { THEMES, type ThemeId } from './themes';
import { maskFromImage, stampPieces, type Piece, type ShapeMask } from './objectMaps';
import type { Hat } from './gumling';

/**
 * The painted art pack (M15 art pass): textures, backdrops, props, Gumling poses and hats made
 * with generative tools and cut out by tools/art/process_pack.py into `public/art`. Everything
 * is optional: a missing file falls back to the generated look, so the game never needs it.
 */
interface Manifest {
  version: number;
  textures: Record<string, string>;
  backdrops: Record<string, string>;
  props: Record<string, string>;
  gumling: Record<string, string>;
  hats: Record<string, string>;
  pieces?: Record<string, string>;
}

export interface ArtPack {
  images: Map<string, HTMLImageElement>;
  manifest: Manifest;
}

export interface GumlingArt {
  poses: Partial<Record<'idle' | 'walk' | 'jump' | 'hurt', Texture>>;
  hats: Partial<Record<Hat, Texture>>;
}

let manifestP: Promise<Manifest | null> | null = null;
const images = new Map<string, HTMLImageElement>();
const loadingImages = new Map<string, Promise<void>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The files a theme needs (backdrop, chunk textures, props) plus the Gumlings and hats. */
function filesFor(m: Manifest, theme: ThemeId): string[] {
  const t = THEMES[theme];
  const tex = [...t.chunks.map((c) => c.tex), t.rock, t.girder];
  const props = [...t.small, ...t.big];
  const kit = t.kit ? [...t.kit.ground, ...t.kit.tall, ...t.kit.ledges] : [];
  return [
    ...kit.map((k) => m.pieces?.[k]),
    m.backdrops?.[theme],
    ...tex.map((k) => m.textures?.[k]),
    ...props.map((k) => m.props?.[k]),
    ...Object.values(m.gumling ?? {}),
    ...Object.values(m.hats ?? {}),
  ].filter((x): x is string => !!x);
}

/**
 * Load what a theme needs from the pack (once per file; later calls share the work). Resolves to
 * null without a pack — the generated look is used then.
 */
export async function loadArtPack(theme: ThemeId = 'frozen', base = 'art/'): Promise<ArtPack | null> {
  manifestP ??= (async () => {
    try {
      const res = await fetch(`${base}manifest.json`);
      return res.ok ? ((await res.json()) as Manifest) : null;
    } catch {
      return null;
    }
  })();
  const manifest = await manifestP;
  if (!manifest) return null;
  await Promise.all(
    filesFor(manifest, theme).map((path) => {
      let p = loadingImages.get(path);
      if (!p) {
        p = loadImage(base + path).then((img) => {
          if (img) images.set(path, img);
        });
        loadingImages.set(path, p);
      }
      return p;
    }),
  );
  return { images, manifest };
}

const img = (pack: ArtPack | null, group: keyof Omit<Manifest, 'version'>, key: string): HTMLImageElement | undefined => {
  const path = pack?.manifest[group]?.[key];
  return path ? pack!.images.get(path) : undefined;
};

/** Pixels of an image (for the terrain painter). */
function texImage(el: HTMLImageElement): TexImage {
  const c = document.createElement('canvas');
  c.width = el.naturalWidth;
  c.height = el.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(el, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

const artCache = new Map<string, TerrainArt>();

/** Terrain look for a theme: painted textures in snack chunks where the pack has them (cached). */
export function terrainArtFor(theme: ThemeId, pack: ArtPack | null): TerrainArt {
  const key = `${theme}:${pack ? 'pack' : 'none'}`;
  let a = artCache.get(key);
  if (!a) artCache.set(key, (a = buildTerrainArt(theme, pack)));
  return a;
}

function buildTerrainArt(theme: ThemeId, pack: ArtPack | null): TerrainArt {
  const def = THEMES[theme];
  const base = def.terrain;
  const art = proceduralArt(base, 2);
  const texCache = new Map<string, TexImage | null>();
  const t = (k: string) => {
    if (!texCache.has(k)) {
      const el = img(pack, 'textures', k);
      texCache.set(k, el ? texImage(el) : null);
    }
    return texCache.get(k)!;
  };
  const outline = base.outline;
  const variants: NonNullable<TerrainArt['variants']> = [];
  def.chunks.forEach((c, i) => {
    const soil = t(c.tex);
    if (!soil) return;
    const crust = c.crust === 'base' ? art.crust : proceduralCrust({ top: hex(c.crust[0]), shade: hex(c.crust[1]), drip: hex(c.crust[2]), outline }, base.frostDepth, 2, 3 + i * 2);
    variants.push({ soil, crust, ...(c.merge ? { merge: true } : {}) });
  });
  if (variants.length) {
    art.variants = variants;
    art.variantCell = def.chunkCell;
    art.soil = variants[0]!.soil;
  }
  const rock = t(def.rock), girder = t(def.girder);
  if (rock) art.rock = rock;
  if (girder) art.girder = girder;
  if (def.shadeDepth) art.shadeDepth = def.shadeDepth;
  return art;
}

const maskCache = new Map<string, ShapeMask>();

/** Pictures and outlines of the objects a theme's maps are built from (none without a kit or pack). */
export function piecesFor(theme: ThemeId, pack: ArtPack | null): { images: Map<string, HTMLImageElement>; masks: Map<string, ShapeMask> } {
  const kit = THEMES[theme].kit;
  const images = new Map<string, HTMLImageElement>(), masks = new Map<string, ShapeMask>();
  if (!kit || !pack) return { images, masks };
  for (const id of new Set([...kit.ground, ...kit.tall, ...kit.ledges])) {
    const el = img(pack, 'pieces', id);
    if (!el) continue;
    images.set(id, el);
    let m = maskCache.get(id);
    if (!m) maskCache.set(id, (m = maskFromImage(id, el)));
    masks.set(id, m);
  }
  return { images, masks };
}

/** Terrain art for an object-built map: each object's picture where it lies. */
export function objectArt(theme: ThemeId, pack: ArtPack | null, pieces: readonly Piece[], W: number, H: number): TerrainArt {
  const base = terrainArtFor(theme, pack);
  const { images, masks } = piecesFor(theme, pack);
  if (!images.size || !pieces.length) return base;
  const top = new Int16Array(W * H).fill(-1);
  stampPieces(pieces, masks, W, H, null, top);
  const pics = new Map<string, TexImage>();
  const list = pieces.map((p) => {
    let t = pics.get(p.shape);
    if (!t) {
      const el = images.get(p.shape);
      t = el ? texImage(el) : { width: 1, height: 1, data: new Uint8ClampedArray(4) };
      pics.set(p.shape, t);
    }
    return { img: t, x: p.x, y: p.y, w: p.w, h: p.h, flip: p.flip };
  });
  return { ...base, shadeDepth: 90, pieces: { top, W, list } };
}

/** The painted backdrop for a theme, if the pack has one. */
export function backdropFor(theme: ThemeId, pack: ArtPack | null): HTMLImageElement | undefined {
  return img(pack, 'backdrops', theme);
}

/** Set-dressing prop images for a theme: small ones stand on the terrain, big ones in the haze. */
export function propsFor(theme: ThemeId, pack: ArtPack | null, size: 'small' | 'big'): HTMLImageElement[] {
  const def = THEMES[theme];
  return (size === 'small' ? def.small : def.big).map((n) => img(pack, 'props', n)).filter((x): x is HTMLImageElement => !!x);
}

let gumlingArt: GumlingArt | null = null;
/** Gumling poses and hats as textures (cached). */
export function gumlingArtFor(pack: ArtPack | null): GumlingArt | null {
  if (!pack) return null;
  if (gumlingArt) return gumlingArt;
  const tex = (el: HTMLImageElement | undefined) => {
    if (!el) return undefined;
    const t = Texture.from(el);
    t.source.scaleMode = 'linear';
    return t;
  };
  const poses: GumlingArt['poses'] = {};
  for (const k of ['idle', 'walk', 'jump', 'hurt'] as const) {
    const t = tex(img(pack, 'gumling', k));
    if (t) poses[k] = t;
  }
  const hats: GumlingArt['hats'] = {};
  for (const k of ['helmet', 'aviator', 'chef', 'bandana', 'miner', 'beret', 'hardhat', 'captain'] as const) {
    const t = tex(img(pack, 'hats', k));
    if (t) hats[k] = t;
  }
  if (!poses.idle) return null;
  gumlingArt = { poses, hats };
  return gumlingArt;
}
