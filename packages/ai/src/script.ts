import { Btn, CHAR, type InputFrame, type SimCommand } from '@gumfire/sim';

/**
 * A plan is played back as a script: one input frame (and optional commands) per tick, exactly
 * what a player's keyboard would produce. The sim never knows an AI is playing, so AI turns are
 * recorded and replayed like any other (ADR-005).
 */
export interface Step {
  input: InputFrame;
  cmds?: SimCommand[];
}
export type Script = Step[];

export const AIM_UNIT = CHAR.aimStep; // one aim tap
const FUSE_BTN = [Btn.Fuse1, Btn.Fuse2, Btn.Fuse3, Btn.Fuse4, Btn.Fuse5] as const;

/** One tick of the sim's aim rule (character.ts): held keys accelerate after a while. */
function aimTick(a: number, held: number, dir: number): { a: number; held: number } {
  if (dir === 0) return { a, held: 0 };
  const h = held + 1;
  const stepA = h > CHAR.aimFastAfter ? CHAR.aimStepFast : CHAR.aimStep;
  return { a: Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, a + dir * stepA)), held: h };
}

/**
 * Frames that move the aim from `from` towards `to`: hold the key while whole steps fit, then
 * single taps. Returns the frames and the aim they really reach (the sim's own arithmetic).
 */
export function aimSteps(from: number, to: number): { steps: Step[]; aim: number } {
  const steps: Step[] = [];
  let a = from, held = 0;
  const dir = to > from ? 1 : -1;
  const btn = dir > 0 ? Btn.Up : Btn.Down;
  // hold
  for (let guard = 0; guard < 200; guard++) {
    const next = held + 1 > CHAR.aimFastAfter ? CHAR.aimStepFast : CHAR.aimStep;
    if (Math.abs(to - a) < next || (dir > 0 ? a >= CHAR.aimMax : a <= -CHAR.aimMax)) break;
    ({ a, held } = aimTick(a, held, dir));
    steps.push({ input: btn });
  }
  if (steps.length) steps.push({ input: 0 });
  // taps for the rest
  for (let guard = 0; guard < 40; guard++) {
    const d = to - a;
    if (Math.abs(d) * 2 < CHAR.aimStep) break;
    const before = a;
    ({ a } = aimTick(a, 0, d > 0 ? 1 : -1));
    if (a === before) break; // clamped
    steps.push({ input: d > 0 ? Btn.Up : Btn.Down }, { input: 0 });
  }
  return { steps, aim: a };
}

export interface ShotSpec {
  weapon: number;
  facing: number;
  aim: number;
  /** Charge ticks (charged weapons); ignored for instant ones. */
  power: number;
  /** Fuse seconds (1..5) for weapons with a player fuse; 0 = leave it. */
  fuse: number;
  target: { x: number; y: number } | null;
}

export interface ShooterNow {
  weapon: number;
  facing: number;
  aim: number;
  fuse: number;
}

/**
 * The script for one attack from where the shooter stands: pick the weapon, set target and
 * fuse, turn, aim, fire (`shots` times for multi-shot weapons), then end the retreat.
 * Returns the script and the aim the shooter really ends up with.
 */
export function shotScript(now: ShooterNow, s: ShotSpec, opts: { instant: boolean; chargeTicks: number; shots: number; endRetreatAfter: number }): { script: Script; aim: number; turned: boolean } {
  const script: Script = [];
  if (now.weapon !== s.weapon) script.push({ input: 0, cmds: [{ type: 'selectWeapon', index: s.weapon }] });
  const setup: Step = { input: 0 };
  if (s.target) setup.cmds = [{ type: 'setTarget', x: Math.round(s.target.x), y: Math.round(s.target.y) }];
  if (s.fuse > 0 && s.fuse !== now.fuse) setup.input |= FUSE_BTN[s.fuse - 1]!;
  script.push(setup, { input: 0 });
  const turned = s.facing !== now.facing;
  if (turned) script.push({ input: s.facing > 0 ? Btn.Right : Btn.Left }, { input: 0 });
  const aimed = s.aim === now.aim ? { steps: [], aim: now.aim } : aimSteps(now.aim, s.aim);
  script.push(...aimed.steps, { input: 0 });
  for (let k = 0; k < Math.max(1, opts.shots); k++) {
    if (k > 0) for (let i = 0; i < 12; i++) script.push({ input: 0 });
    if (opts.instant) script.push({ input: Btn.Fire }, { input: 0 });
    else {
      const p = Math.max(1, Math.min(opts.chargeTicks, s.power));
      for (let i = 0; i < p; i++) script.push({ input: Btn.Fire });
      script.push({ input: 0 });
    }
  }
  if (opts.endRetreatAfter >= 0) {
    for (let i = 0; i < opts.endRetreatAfter; i++) script.push({ input: 0 });
    script.push({ input: Btn.EndTurn }, { input: 0 });
  }
  return { script, aim: aimed.aim, turned };
}

/** Walk in a direction for `ticks` (Jump when stuck against a wall, as a player would). */
export function walkStep(dir: number, jump: boolean): Step {
  return { input: (dir > 0 ? Btn.Right : Btn.Left) | (jump ? Btn.Jump : 0) };
}
