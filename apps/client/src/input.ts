import { Btn, type InputFrame } from '@gumfire/sim';

/**
 * Keyboard → one 16-bit input frame per sim tick (the only thing replays and the network carry).
 * Every key press reaches the sim as its own edge: a tap shorter than a tick still shows for one
 * tick, and two quick presses become two edges with a released tick between them.
 */
const BINDINGS: Array<[number, string[]]> = [
  [Btn.Left, ['ArrowLeft']],
  [Btn.Right, ['ArrowRight']],
  [Btn.Up, ['ArrowUp']],
  [Btn.Down, ['ArrowDown']],
  [Btn.Jump, ['Enter', 'NumpadEnter']],
  [Btn.Fire, ['Space']],
  [Btn.Alt, ['KeyB']],
  [Btn.Fuse1, ['Digit1']],
  [Btn.Fuse2, ['Digit2']],
  [Btn.Fuse3, ['Digit3']],
  [Btn.Fuse4, ['Digit4']],
  [Btn.Fuse5, ['Digit5']],
  [Btn.EndTurn, ['Backspace']],
];

export const GAME_KEYS = new Set(BINDINGS.flatMap(([, keys]) => keys).concat(['Tab', 'KeyQ', 'KeyE']));

export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pending = new Map<string, number>();
  private lastTick = new Set<string>();
  private thisTick = new Set<string>();
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (!e.repeat) this.pending.set(e.code, (this.pending.get(e.code) ?? 0) + 1);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.clear());
  }

  clear(): void {
    this.held.clear();
    this.pending.clear();
  }

  private down(code: string): boolean {
    const n = this.pending.get(code) ?? 0;
    if (n > 0) {
      if (this.lastTick.has(code)) return false; // insert a released tick → a fresh edge
      this.pending.set(code, n - 1);
      this.thisTick.add(code);
      return true;
    }
    if (this.held.has(code)) {
      this.thisTick.add(code);
      return true;
    }
    return false;
  }

  /** Build this tick's frame. Call exactly once per sim tick. */
  frame(): InputFrame {
    this.thisTick = new Set();
    let f = 0;
    for (const [btn, keys] of BINDINGS) if (keys.some((k) => this.down(k))) f |= btn;
    this.lastTick = this.thisTick;
    return f;
  }
}
