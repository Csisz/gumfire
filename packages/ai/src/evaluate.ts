import { allied, deepClone, step, type GameState, type SimEvent } from '@gumfire/sim';
import type { Script } from './script';

/**
 * Full look-ahead: play a script on a copy of the world with the real `step`, let everything
 * settle (knockback, chain reactions, drowning), and score what changed. Exact — the same
 * code that will run when the script is played for real.
 */

/** Copy a state for look-ahead; the compiled weapon and prop sets are shared (read only). */
export function fork(s: GameState): GameState {
  const { weapons, props } = s;
  const c = deepClone({ ...s, weapons: [], props: [] }) as GameState;
  c.weapons = weapons;
  c.props = props;
  return c;
}

export interface Outcome {
  score: number;
  /** The script ran to the end with the character still in control and a shot fired. */
  fired: boolean;
  enemyDamage: number;
  ownDamage: number;
  kills: number;
  losses: number;
  ticks: number;
}

/** Run the script; `false` if control was lost before it finished. */
export function playScript(s: GameState, script: Script, events?: SimEvent[]): boolean {
  const me = s.activeCharacter;
  for (const st of script) {
    const ev = step(s, st.input, st.cmds ?? []);
    if (events) for (const e of ev) events.push(e);
    if (s.activeCharacter !== me) return false;
  }
  return true;
}

/** Score a script played from `base` (not modified). `team` is the AI's team. */
export function evaluate(base: GameState, script: Script, team: number, opts: { maxSettle?: number; ref?: GameState } = {}): Outcome {
  const s = fork(base);
  const me = s.characters.find((c) => c.id === s.activeCharacter);
  // health before the turn (`ref`: the state before any walking, so mines stepped on count)
  const before = new Map((opts.ref ?? s).characters.map((c) => [c.id, c.state === 'dead' || c.state === 'drowning' ? 0 : c.hp - c.pendingDamage]));
  const turn = s.match?.turn ?? 0;
  const events: SimEvent[] = [];
  playScript(s, script, events);
  const fired = events.some((e) => e.type === 'ProjectileFired' || e.type === 'MeleeSwing' || e.type === 'Exploded' || e.type === 'StrikeCalled' || e.type === 'HitscanFired');
  // settle: until the damage reveal or the next turn
  const cap = opts.maxSettle ?? 1500;
  let ticks = 0;
  for (; ticks < cap; ticks++) {
    const m = s.match;
    if (!m || m.phase === 'damageReveal' || m.phase === 'matchOver' || m.turn !== turn) break;
    if (m.phase === 'turnActive' && ticks > 40) break; // nothing happened: the turn would just run out
    const ev = step(s, 0, []);
    for (const e of ev) events.push(e);
  }
  let enemyDamage = 0, ownDamage = 0, kills = 0, losses = 0, score = 0, near = 1e9;
  const blasts = events.filter((e): e is Extract<SimEvent, { type: 'Exploded' }> => e.type === 'Exploded');
  for (const c of s.characters) {
    const hp0 = before.get(c.id) ?? 0;
    if (hp0 <= 0) continue;
    const gone = c.state === 'dead' || c.state === 'drowning';
    const hp1 = gone ? 0 : Math.max(0, c.hp - c.pendingDamage);
    const loss = hp0 - hp1;
    const enemy = !allied(s.match, c.team, team);
    if (enemy) {
      enemyDamage += loss;
      if (gone || hp1 === 0) kills++;
      score += loss + (gone || hp1 === 0 ? 30 : 0);
      for (const b of blasts) near = Math.min(near, Math.hypot(b.x - (c.body.x >> 8), b.y - (c.body.y >> 8)));
    } else {
      ownDamage += loss;
      if (gone || hp1 === 0) losses++;
      const w = me && c.id === me.id ? 2 : 1.5;
      score -= (loss + (gone || hp1 === 0 ? 40 : 0)) * w;
    }
  }
  if (s.match?.phase === 'matchOver') score += s.match.result === 'win' && allied(s.match, s.match.winner, team) ? 500 : -500;
  score += Math.max(0, 1 - near / 220) * 8;
  return { score, fired, enemyDamage, ownDamage, kills, losses, ticks };
}

