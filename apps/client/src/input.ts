import { Btn, type InputFrame } from '@gumfire/sim';
import { DEFAULT_KEYS, type Action } from './settings';

/**
 * Keyboard → one 16-bit input frame per sim tick (the only thing replays and the network carry).
 * Every key press reaches the sim as its own edge: a tap shorter than a tick still shows for one
 * tick, and two quick presses become two edges with a released tick between them.
 * Bindings come from the options (remappable, M14); the fuse keys stay on 1–5.
 */
const FIXED: Array<[number, string[]]> = [
  [Btn.Fuse1, ['Digit1']],
  [Btn.Fuse2, ['Digit2']],
  [Btn.Fuse3, ['Digit3']],
  [Btn.Fuse4, ['Digit4']],
  [Btn.Fuse5, ['Digit5']],
];
const ACTION_BTN: Partial<Record<Action, number>> = {
  left: Btn.Left,
  right: Btn.Right,
  up: Btn.Up,
  down: Btn.Down,
  jump: Btn.Jump,
  fire: Btn.Fire,
  bounce: Btn.Alt,
  endTurn: Btn.EndTurn,
};

export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pending = new Map<string, number>();
  private lastTick = new Set<string>();
  private thisTick = new Set<string>();
  private bindings: Array<[number, string[]]> = [];
  private gameKeys = new Set<string>();
  keys: Record<Action, string> = { ...DEFAULT_KEYS };
  enabled = true;
  /** Hold-to-toggle charging: while the active Gumling charges, Fire stays held until tapped again. */
  holdToggle = false;
  /** Set by the client each tick before `frame()`: is the active Gumling winding up a throw? */
  charging = false;

  constructor(target: Window = window) {
    this.setKeys(this.keys);
    target.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (this.gameKeys.has(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (!e.repeat) this.pending.set(e.code, (this.pending.get(e.code) ?? 0) + 1);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.clear());
  }

  setKeys(keys: Record<Action, string>): void {
    this.keys = { ...keys };
    this.bindings = FIXED.slice();
    for (const [a, btn] of Object.entries(ACTION_BTN) as Array<[Action, number]>) {
      const codes = [keys[a]];
      if (a === 'jump' && keys.jump === 'Enter') codes.push('NumpadEnter');
      this.bindings.push([btn, codes]);
    }
    this.gameKeys = new Set(this.bindings.flatMap(([, k]) => k).concat([keys.prevWeapon, keys.nextWeapon, keys.panel]));
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
    for (const [btn, keys] of this.bindings) {
      if (btn === Btn.Fire && this.holdToggle && this.charging) {
        // charging: a fresh tap lets go (and is used up); otherwise Fire counts as held
        const code = keys[0]!;
        if ((this.pending.get(code) ?? 0) > 0) {
          this.pending.set(code, 0);
          continue;
        }
        f |= btn;
        continue;
      }
      if (keys.some((k) => this.down(k))) f |= btn;
    }
    this.lastTick = this.thisTick;
    return f;
  }
}
