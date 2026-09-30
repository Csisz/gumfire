/**
 * Commands: tick-stamped structured input that does not fit in the 16-bit button frame —
 * e.g. a target point for placed weapons (M9) or sandbox debug edits (M2). They travel with
 * the input stream and are stored in replays, so everything they cause is reproducible.
 * All fields are integers (whole pixels).
 */
export type SimCommand =
  | { type: 'debugCarve'; x: number; y: number; r: number }
  | { type: 'debugTunnel'; x0: number; y0: number; x1: number; y1: number; r: number }
  | { type: 'debugGirder'; x: number; y: number; w: number; h: number }
  /** Spawn a test body at pixel (x, y) with velocity (vx, vy) in subpixels/tick. */
  | { type: 'debugSpawn'; x: number; y: number; vx: number; vy: number; r: number };

/** A command applied at the start of simulation tick `tick` (1-based, the tick being computed). */
export interface TimedCommand {
  tick: number;
  cmd: SimCommand;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const COORD = 1 << 16;

/** Validate untrusted command data (network, replay files). Returns null if invalid. */
export function sanitizeCommand(c: unknown): SimCommand | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const coords = (...keys: string[]) => keys.every((k) => isInt(o[k]) && inRange(o[k] as number, -COORD, COORD));
  switch (o.type) {
    case 'debugCarve':
      if (!coords('x', 'y') || !isInt(o.r) || !inRange(o.r, 1, 200)) return null;
      return { type: 'debugCarve', x: o.x as number, y: o.y as number, r: o.r };
    case 'debugTunnel':
      if (!coords('x0', 'y0', 'x1', 'y1') || !isInt(o.r) || !inRange(o.r, 1, 60)) return null;
      if (Math.abs((o.x1 as number) - (o.x0 as number)) > 2048 || Math.abs((o.y1 as number) - (o.y0 as number)) > 2048) return null;
      return { type: 'debugTunnel', x0: o.x0 as number, y0: o.y0 as number, x1: o.x1 as number, y1: o.y1 as number, r: o.r };
    case 'debugGirder':
      if (!coords('x', 'y') || !isInt(o.w) || !isInt(o.h) || !inRange(o.w, 1, 512) || !inRange(o.h, 1, 64)) return null;
      return { type: 'debugGirder', x: o.x as number, y: o.y as number, w: o.w, h: o.h };
    case 'debugSpawn': {
      const v = (k: string) => isInt(o[k]) && inRange(o[k] as number, -8192, 8192);
      if (!coords('x', 'y') || !v('vx') || !v('vy') || !isInt(o.r) || !inRange(o.r, 3, 24)) return null;
      return { type: 'debugSpawn', x: o.x as number, y: o.y as number, vx: o.vx as number, vy: o.vy as number, r: o.r };
    }
    default:
      return null;
  }
}
