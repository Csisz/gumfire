import { Btn, CHAR, SUB, allied, ammoLeft, delayLeft, step, type Character, type GameState, type WeaponDef } from '@gumfire/sim';
import { evaluate, fork, type Outcome } from './evaluate';
import { explosionValue, predictFuses, type Target } from './predict';
import { AIM_UNIT, shotScript, walkStep, type Script, type ShotSpec } from './script';

/**
 * Turn planner (M15b). Search in two stages:
 *  1. **Predict**: for every usable weapon, facing, aim and charge, fly the projectile with the
 *     sim's projectile code over the current terrain and rate where it would go off.
 *  2. **Play out**: the best few candidates run as real scripts on a copy of the world
 *     (evaluate.ts) — knockback, drowning, chain reactions and self-damage included.
 * Harder levels look at more aims and charges, try walking first, refine the winner, and aim
 * exactly; easier ones shoot from where they stand and wobble their aim.
 *
 * It is a generator: each `yield` is a unit of work, so the client can spread the search over
 * frames. The result depends only on the state and the level (no clocks), so tests and replays
 * see the same choices.
 */
export type AiLevel = 'easy' | 'normal' | 'hard';

export interface Plan {
  script: Script;
  score: number;
  /** For logs and the HUD: weapon id or what the plan does. */
  label: string;
  outcome: Outcome | null;
}

interface LevelSpec {
  /** Aim lattice stride (in aim taps). */
  aimStride: number;
  powers: number;
  fuses: number[];
  /** Candidates played out in full. */
  playOut: number;
  perWeapon: number;
  move: 'none' | 'toward' | 'all';
  refine: boolean;
  /** Coarse cells refined at every aim tap. */
  refineCells: number;
  /** Try facing away from every enemy too (bank shots, wind). */
  bothFacings: boolean;
  /** Most weapons considered (strongest first). */
  maxWeapons: number;
  /** Aim wobble in taps and charge wobble in ticks (applied after the search). */
  aimNoise: number;
  powerNoise: number;
  /** Choose among this many best plans. */
  pickFrom: number;
  categories: ReadonlyArray<WeaponDef['category']>;
}

export const LEVELS: Record<AiLevel, LevelSpec> = {
  easy: { aimStride: 5, powers: 6, fuses: [3], playOut: 4, perWeapon: 2, move: 'none', refine: false, refineCells: 0, bothFacings: false, maxWeapons: 3, aimNoise: 3, powerNoise: 5, pickFrom: 3, categories: ['ballistic', 'melee'] },
  normal: { aimStride: 4, powers: 8, fuses: [2, 3, 4], playOut: 10, perWeapon: 2, move: 'toward', refine: false, refineCells: 1, bothFacings: false, maxWeapons: 7, aimNoise: 1, powerNoise: 2, pickFrom: 1, categories: ['ballistic', 'melee', 'hitscan', 'strike'] },
  hard: { aimStride: 4, powers: 8, fuses: [1, 2, 3, 4, 5], playOut: 20, perWeapon: 2, move: 'all', refine: true, refineCells: 3, bothFacings: true, maxWeapons: 99, aimNoise: 0, powerNoise: 0, pickFrom: 1, categories: ['ballistic', 'melee', 'hitscan', 'strike'] },
};

interface Base {
  /** Steps already taken (walking) before the attack. */
  prefix: Script;
  state: GameState;
  me: Character;
  /** Small cost for walking (time, risk). */
  cost: number;
  label: string;
}

interface Candidate {
  base: Base;
  spec: ShotSpec;
  est: number;
}

const px = (v: number) => v >> 8;

/** A small deterministic random stream for the choices that should vary (easy's wobble). */
function rng(seed: number): () => number {
  let r = seed >>> 0 || 1;
  return () => {
    r = (r + 0x6d2b79f5) >>> 0;
    let t = r;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function targetsOf(s: GameState, me: Character): Target[] {
  return s.characters
    .filter((c) => c.state !== 'dead' && c.state !== 'drowning')
    .map((c) => ({ id: c.id, x: px(c.body.x), y: px(c.body.y), hp: Math.max(1, c.hp - c.pendingDamage), enemy: !allied(s.match, c.team, me.team), self: c.id === me.id }));
}

/** Weapons this level may use right now. */
function usableWeapons(s: GameState, me: Character, spec: LevelSpec): number[] {
  const out: number[] = [];
  s.weapons.forEach((w, i) => {
    if (w.hidden || !spec.categories.includes(w.category)) return;
    if (ammoLeft(s, me.id, i) === 0 || delayLeft(s, me.id, i) > 0) return;
    if (w.remote || w.behavior === 'boomerang') return; // need timing the planner does not model
    out.push(i);
  });
  // strongest first (a rough blast value), unlimited ammo breaking ties; keep the level's share
  const value = (w: WeaponDef) => (w.category === 'ballistic' ? w.damage * (1 + w.clusterCount * 0.3) + w.explosionRadius / 2 : 40) + (w.ammo === -1 ? 15 : 0);
  return out.sort((a, b) => value(s.weapons[b]!) - value(s.weapons[a]!)).slice(0, spec.maxWeapons);
}

/** Walk `dir` for up to `ticks` (jumping when stuck), then wait until standing. */
function walkBase(origin: GameState, dir: number, ticks: number, stopNear: number | null, label: string): Base | null {
  const s = fork(origin);
  const id = s.activeCharacter;
  const prefix: Script = [];
  let lastX = -1, stuck = 0, jumps = 0;
  const me = () => s.characters.find((c) => c.id === id)!;
  for (let i = 0; i < ticks; i++) {
    const c = me();
    const x = px(c.body.x);
    if (stopNear !== null && Math.abs(x - stopNear) < 140) break;
    stuck = x === lastX && c.state === 'walk' ? stuck + 1 : 0;
    lastX = x;
    const jump = stuck > 6 && jumps < 3 && (c.state === 'walk' || c.state === 'idle');
    if (jump) {
      jumps++;
      stuck = 0;
    }
    const st = walkStep(dir, jump);
    prefix.push(st);
    step(s, st.input, []);
    if (s.activeCharacter !== id || s.match?.phase !== 'turnActive') return null;
  }
  for (let i = 0; i < 120; i++) {
    const c = me();
    if (c.state === 'idle') break;
    prefix.push({ input: 0 });
    step(s, 0, []);
    if (s.activeCharacter !== id || s.match?.phase !== 'turnActive') return null;
  }
  const c = me();
  if (c.state !== 'idle') return null;
  const c0 = origin.characters.find((x) => x.id === id)!;
  if (c.hp - c.pendingDamage < c0.hp - c0.pendingDamage) return null; // fell or stepped on something
  if (Math.abs(c.body.x - c0.body.x) < 12 * SUB) return null; // went nowhere
  return { prefix, state: s, me: c, cost: 3 + prefix.length / 40, label };
}

function shotFor(base: Base, spec: ShotSpec): Script {
  const def = base.state.weapons[spec.weapon]!;
  const m = base.state.match;
  const retreat = m && def.endsTurn ? 25 : -1;
  return [...base.prefix, ...shotScript(base.me, spec, { instant: def.instant, chargeTicks: def.chargeTicks, shots: def.shotsPerTurn, endRetreatAfter: retreat }).script];
}

/** Aim lattice reachable by taps from the current aim, within the sim's limits. */
function aims(me: Character, stride: number): number[] {
  const out: number[] = [];
  const unit = AIM_UNIT * stride;
  for (let a = me.aim; a <= CHAR.aimMax; a += unit) out.push(a);
  for (let a = me.aim - unit; a >= -CHAR.aimMax; a -= unit) out.push(a);
  return out.sort((x, y) => x - y);
}

/** Aim (on the tap lattice) pointing from the shooter at a point, for a facing. */
function aimAt(me: Character, x: number, y: number, facing: number): number {
  const dx = (x - px(me.body.x)) * facing, dy = px(me.body.y) - y;
  const deg = (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI;
  const raw = Math.round((deg * 4096) / 360);
  const k = Math.round((raw - me.aim) / AIM_UNIT);
  return Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, me.aim + k * AIM_UNIT));
}

export function* planTurn(origin: GameState, level: AiLevel): Generator<void, Plan> {
  const spec = LEVELS[level];
  const meId = origin.activeCharacter;
  const me0 = origin.characters.find((c) => c.id === meId);
  const idle: Plan = { script: [], score: 0, label: 'wait', outcome: null };
  if (!me0 || !origin.match) return idle;
  const team = me0.team;
  const rand = rng((origin.seed ^ Math.imul(origin.tick, 2654435761) ^ meId) >>> 0);
  const enemies = targetsOf(origin, me0).filter((t) => t.enemy);
  if (!enemies.length) return idle;

  // ---- where to shoot from
  const bases: Base[] = [{ prefix: [], state: origin, me: me0, cost: 0, label: '' }];
  if (spec.move !== 'none') {
    const nearest = enemies.reduce((a, b) => (Math.abs(a.x - px(me0.body.x)) < Math.abs(b.x - px(me0.body.x)) ? a : b));
    const dir = nearest.x > px(me0.body.x) ? 1 : -1;
    const toward = walkBase(origin, dir, level === 'hard' ? 160 : 120, nearest.x, 'walk');
    if (toward) bases.push(toward);
    yield;
    if (spec.move === 'all') {
      for (const d of [-1, 1]) {
        const b = walkBase(origin, d, 70, null, 'step');
        if (b) bases.push(b);
        yield;
      }
    }
  }

  // ---- stage 1: predict
  const cands: Candidate[] = [];
  let work = 0;
  for (const base of bases) {
    const me = base.me;
    const targets = targetsOf(base.state, me);
    const foes = targets.filter((t) => t.enemy);
    const mx = px(me.body.x), my = px(me.body.y);
    for (const wi of usableWeapons(base.state, me, spec)) {
      const def = base.state.weapons[wi]!;
      const mine: Candidate[] = [];
      const add = (c: Omit<Candidate, 'base'>) => mine.push({ ...c, base });
      if (def.category === 'melee') {
        for (const f of foes) {
          if (Math.abs(f.x - mx) > def.meleeReach + 14 || Math.abs(f.y - my) > 34) continue;
          const facing = f.x >= mx ? 1 : -1;
          add({ spec: { weapon: wi, facing, aim: def.meleeAngle >= 0 ? me.aim : aimAt(me, f.x, f.y, facing), power: 0, fuse: 0, target: null }, est: 40 + def.meleeDamage });
        }
      } else if (def.category === 'hitscan') {
        for (const f of foes) {
          if (Math.hypot(f.x - mx, f.y - my) > def.hitscanRange) continue;
          const facing = f.x >= mx ? 1 : -1;
          const a = aimAt(me, f.x, f.y, facing);
          for (const k of [0, -1, 1]) {
            const aim = Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, a + k * AIM_UNIT));
            add({ spec: { weapon: wi, facing, aim, power: 0, fuse: 0, target: null }, est: 30 - k * k * 5 - Math.hypot(f.x - mx, f.y - my) / 40 });
          }
        }
      } else if (def.category === 'strike') {
        for (const f of foes) add({ spec: { weapon: wi, facing: me.facing, aim: me.aim, power: 0, fuse: 0, target: { x: f.x, y: f.y } }, est: 35 + f.hp / 10 });
      } else if (def.category === 'ballistic') {
        const fuses = def.playerFuse && def.fuseTicks > 0 ? spec.fuses : [0];
        const step = Math.max(1, Math.round(def.chargeTicks / spec.powers));
        const powers: number[] = [];
        for (let p = def.chargeTicks; p >= 1; p -= step) powers.push(p);
        const targetsFor: Array<{ x: number; y: number } | null> = def.needsTarget ? foes.map((f) => ({ x: f.x, y: f.y })) : [null];
        // which way to face: towards the enemies (both ways only when they are on both sides or close)
        const facings = [-1, 1].filter((f) => spec.bothFacings || foes.some((e) => (e.x - mx) * f > -60));
        const rate = (facing: number, aim: number, power: number, target: { x: number; y: number } | null, out: Array<Omit<Candidate, 'base'>>) => {
          const dx = facing !== me.facing ? facing : 0; // turning takes a 1 px step
          const lands = predictFuses(base.state, me, wi, def, { facing, aim, power, dx, target }, fuses);
          lands.forEach((land, k) => {
            if (!land) return;
            let est = explosionValue(land.x, land.y, def.explosionRadius, def.damage, targets);
            if (def.clusterCount > 0) est *= 1.3;
            if (def.fireCount > 0) est += 3;
            out.push({ spec: { weapon: wi, facing, aim, power, fuse: fuses[k]!, target }, est: est - base.cost - land.ticks / 400 });
          });
        };
        for (const target of targetsFor) {
          // coarse grid
          const coarse: Array<Omit<Candidate, 'base'>> = [];
          for (const facing of facings) {
            for (const aim of aims(me, spec.aimStride)) {
              for (const power of powers) {
                rate(facing, aim, power, target, coarse);
                if (++work % 20 === 0) yield;
              }
            }
          }
          coarse.sort((a, b) => b.est - a.est);
          for (const c of coarse.slice(0, spec.perWeapon)) add(c);
          // refine around the best cells: every aim tap and finer charges in between
          if (spec.refineCells > 0) {
            const half = Math.floor(spec.aimStride / 2), ph = Math.max(1, Math.floor(step / 2));
            for (const c of coarse.slice(0, spec.refineCells)) {
              if (c.est <= 0) break;
              const fine: Array<Omit<Candidate, 'base'>> = [];
              for (let da = -half; da <= half; da++) {
                const aim = c.spec.aim + da * AIM_UNIT;
                if (Math.abs(aim) > CHAR.aimMax) continue;
                for (const dp of [-ph, 0, ph]) {
                  const power = c.spec.power + dp;
                  if ((da === 0 && dp === 0) || power < 1 || power > def.chargeTicks) continue;
                  rate(c.spec.facing, aim, power, target, fine);
                  if (++work % 20 === 0) yield;
                }
              }
              fine.sort((a, b) => b.est - a.est);
              for (const f of fine.slice(0, 2)) add(f);
            }
          }
        }
      }
      // keep the best few per weapon and base; limited ammo costs a little
      const keep = def.ammo === -1 ? 0 : 4;
      mine.sort((a, b) => b.est - a.est);
      for (const c of mine.slice(0, spec.perWeapon)) cands.push({ ...c, est: c.est - keep });
    }
  }
  if (!cands.length) return fallback(origin, level);

  // ---- stage 2: play out the best
  cands.sort((a, b) => b.est - a.est);
  const played: Array<{ cand: Candidate; script: Script; out: Outcome }> = [];
  const playOne = (cand: Candidate) => {
    const script = shotFor(cand.base, cand.spec);
    const out = evaluate(cand.base.state, script.slice(cand.base.prefix.length), team, { ref: origin });
    const def = origin.weapons[cand.spec.weapon]!;
    if (out.fired) {
      out.score -= cand.base.cost + (def.ammo === -1 ? 0 : 4);
      played.push({ cand, script, out });
    }
  };
  for (const cand of cands.slice(0, spec.playOut)) {
    playOne(cand);
    yield;
  }
  if (spec.refine && played.length) {
    played.sort((a, b) => b.out.score - a.out.score);
    for (const best of played.slice(0, 2)) {
      const c = best.cand;
      const def = origin.weapons[c.spec.weapon]!;
      if (def.category !== 'ballistic') continue;
      for (const [da, dp] of [[-1, 0], [1, 0], [0, -2], [0, 2], [-1, -2], [1, 2]] as const) {
        const aim = c.spec.aim + da * AIM_UNIT;
        const power = c.spec.power + dp;
        if (Math.abs(aim) > CHAR.aimMax || power < 1 || power > def.chargeTicks) continue;
        playOne({ ...c, spec: { ...c.spec, aim, power } });
        yield;
      }
    }
  }
  if (!played.length) return fallback(origin, level);
  played.sort((a, b) => b.out.score - a.out.score);
  if (played[0]!.out.score < -5) return fallback(origin, level); // every shot hurts us more
  // levels that wobble prefer shots that still work when wobbled (M19): a bouncing grenade
  // that only lands at one exact charge is a poor choice for a shaky hand
  if (spec.aimNoise || spec.powerNoise) {
    const top = played.slice(0, 3);
    for (const p of top) {
      const c = p.cand;
      const def = origin.weapons[c.spec.weapon]!;
      if (def.category !== 'ballistic') continue;
      let sum = p.out.score;
      for (const k of [1, -1]) {
        const aim = Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, c.spec.aim + k * spec.aimNoise * AIM_UNIT));
        const power = Math.max(1, Math.min(def.chargeTicks, c.spec.power + k * spec.powerNoise));
        const script = shotFor(c.base, { ...c.spec, aim, power });
        sum += evaluate(c.base.state, script.slice(c.base.prefix.length), team, { ref: origin }).score;
        yield;
      }
      p.out = { ...p.out, score: sum / 3 };
    }
    top.sort((a, b) => b.out.score - a.out.score);
    played.splice(0, top.length, ...top);
  }
  // easy picks one of its better ideas, never one much worse than its best
  const good = played.filter((p) => p.out.score >= played[0]!.out.score * 0.5 && p.out.ownDamage === 0);
  const pool = good.length ? good : played;
  const pick = pool[Math.min(pool.length - 1, Math.floor(rand() * spec.pickFrom))]!;
  let script = pick.script;
  // wobble (easy, normal): the plan is rebuilt with a slightly different aim and charge
  if (spec.aimNoise || spec.powerNoise) {
    const c = pick.cand;
    const def = origin.weapons[c.spec.weapon]!;
    if (def.category === 'ballistic') {
      const da = Math.round((rand() * 2 - 1) * spec.aimNoise);
      const dp = Math.round((rand() * 2 - 1) * spec.powerNoise);
      const aim = Math.max(-CHAR.aimMax, Math.min(CHAR.aimMax, c.spec.aim + da * AIM_UNIT));
      const power = Math.max(1, Math.min(def.chargeTicks, c.spec.power + dp));
      script = shotFor(c.base, { ...c.spec, aim, power });
    }
  }
  return { script, score: pick.out.score, label: origin.weapons[pick.cand.spec.weapon]!.id + (pick.cand.base.label ? ` after ${pick.cand.base.label}` : ''), outcome: pick.out };
}

/** No useful attack: walk towards the nearest enemy, then nap (skip) if that is available. */
function fallback(origin: GameState, level: AiLevel): Plan {
  const me = origin.characters.find((c) => c.id === origin.activeCharacter)!;
  const enemies = targetsOf(origin, me).filter((t) => t.enemy);
  let script: Script = [];
  if (level !== 'easy' && enemies.length) {
    const nearest = enemies.reduce((a, b) => (Math.abs(a.x - px(me.body.x)) < Math.abs(b.x - px(me.body.x)) ? a : b));
    const b = walkBase(origin, nearest.x > px(me.body.x) ? 1 : -1, 200, nearest.x, 'walk');
    if (b) script = b.prefix;
  }
  const skip = origin.weapons.findIndex((w, i) => w.utility === 'skip' && ammoLeft(origin, me.id, i) !== 0);
  if (skip >= 0) script = [...script, { input: 0, cmds: [{ type: 'selectWeapon', index: skip }] }, { input: 0 }, { input: 0 }, { input: Btn.Fire }, { input: 0 }];
  return { script, score: 0, label: 'regroup', outcome: null };
}
