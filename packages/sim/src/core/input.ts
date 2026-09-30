/**
 * One input frame per tick: a 16-bit button bitmask. This is the only thing sent
 * over the network and stored in replays (ADR-005).
 */

export const Btn = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Jump: 1 << 4,
  Fire: 1 << 5,
  Alt: 1 << 6,
  Fuse1: 1 << 7,
  Fuse2: 1 << 8,
  Fuse3: 1 << 9,
  Fuse4: 1 << 10,
  Fuse5: 1 << 11,
  EndTurn: 1 << 12,
} as const;

export type ButtonName = keyof typeof Btn;
export type InputFrame = number;

export const EMPTY_INPUT: InputFrame = 0;
export const INPUT_MASK = 0xffff;

export function isDown(frame: InputFrame, btn: number): boolean {
  return (frame & btn) !== 0;
}

/** Button went from up (previous tick) to down (this tick). */
export function pressed(prev: InputFrame, cur: InputFrame, btn: number): boolean {
  return (cur & btn) !== 0 && (prev & btn) === 0;
}

export function sanitizeInput(frame: number): InputFrame {
  return (frame | 0) & INPUT_MASK;
}
