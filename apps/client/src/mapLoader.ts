import { classifyMaskPixel, type MapSpec } from '@gumfire/sim';

/**
 * Loads a map mask (PNG) + metadata (JSON) from /maps and converts it to the sim's
 * material array. Decoding happens here, in the client: the simulation never does I/O.
 */
export interface MapMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  waterY: number;
  theme: string;
}

export interface LoadedMap {
  meta: MapMeta;
  spec: MapSpec;
  decodeMs: number;
}

const BASE = `${import.meta.env.BASE_URL}maps/`;

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}: HTTP ${r.status}`);
  return r;
}

export async function loadMapIndex(): Promise<string[]> {
  return (await (await fetchOk(`${BASE}index.json`)).json()) as string[];
}

export async function loadMap(id: string): Promise<LoadedMap> {
  const meta = (await (await fetchOk(`${BASE}${id}.json`)).json()) as MapMeta;
  const blob = await (await fetchOk(`${BASE}${id}.png`)).blob();
  const t0 = performance.now();
  // No premultiply and no colour-space conversion: we need the exact mask colours.
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (bmp.width !== meta.width || bmp.height !== meta.height) {
    throw new Error(`Map ${id}: PNG is ${bmp.width}×${bmp.height}, metadata says ${meta.width}×${meta.height}`);
  }
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, meta.width, meta.height).data;
  const mat = new Uint8Array(meta.width * meta.height);
  for (let i = 0, p = 0; i < mat.length; i++, p += 4) {
    mat[i] = classifyMaskPixel(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, rgba[p + 3]!);
  }
  return {
    meta,
    spec: { width: meta.width, height: meta.height, mat, waterY: meta.waterY },
    decodeMs: performance.now() - t0,
  };
}
