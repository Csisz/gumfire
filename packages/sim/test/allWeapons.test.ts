import { describe, expect, it } from 'vitest';
import { Btn, CHAR, Mat, createGame, hashState, step, type GameState, type InputFrame, type MapSpec, type SimCommand, type SimEvent } from '../src/index.js';
import { PROPS, WEAPONS } from '../../content/src/index.js';

/**
 * Every selectable item in the shipped content, used once in a real match (M13.1 sweep):
 * it must do its thing (the event that proves it), the turn must move on afterwards, and the
 * same inputs must give the same state.
 */
const FLOOR = 700;
const standY = FLOOR - CHAR.radius - 1;

function sweepMap(): MapSpec {
  const width = 2400, height = 800;
  const mat = new Uint8Array(width * height);
  for (let x = 0; x < 2200; x++) for (let y = FLOOR; y < height; y++) mat[y * width + x] = Mat.SOIL;
  for (let x = 200; x <= 1400; x++) for (let y = 380; y < 400; y++) mat[y * width + x] = Mat.SOIL; // a ceiling for the rope
  return { width, height, mat, waterY: 780 };
}

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const ofType = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Ev<T>[];

interface Plan {
  /** Enemy distance to the right of the shooter (x 600). */
  enemyAt: number;
  /** Aim (angle units, 1024 = 90° up). */
  aim: number;
  target?: { x: number; y: number };
  /** Ticks to hold Fire (0 = a tap). */
  hold: number;
  /** Jump first (the umbrella opens in the air). */
  jumpFirst?: boolean;
  /** Extra input while it works (jetpack thrust, rope reel). */
  during?: InputFrame;
  /** The event that proves it worked. */
  proof: SimEvent['type'];
}

function planFor(id: string, category: string, utility: string, instant: boolean): Plan {
  const near = 22, far = 300;
  switch (utility) {
    case 'teleport':
      return { enemyAt: far, aim: 0, target: { x: 800, y: 600 }, hold: 0, proof: 'UtilityUsed' };
    case 'girder':
      return { enemyAt: far, aim: 0, target: { x: 680, y: 640 }, hold: 0, proof: 'GirderPlaced' };
    case 'parachute':
      return { enemyAt: far, aim: 0, hold: 0, jumpFirst: true, proof: 'GearChanged' };
    case 'jetpack':
      return { enemyAt: far, aim: 0, hold: 0, during: Btn.Up, proof: 'GearChanged' };
    case 'drill':
    case 'torch':
      return { enemyAt: utility === 'torch' ? 40 : far, aim: 0, hold: 0, proof: 'TerrainChanged' };
    case 'skip':
      return { enemyAt: far, aim: 0, hold: 0, proof: 'ControlEnded' };
    case 'rope':
      return { enemyAt: far, aim: 1024, hold: 0, during: Btn.Up, proof: 'RopeAttached' };
  }
  switch (category) {
    case 'melee':
      return { enemyAt: near - 6, aim: 0, hold: 0, proof: 'MeleeSwing' };
    case 'hitscan':
      return { enemyAt: id === 'gumball_scatter' ? 40 : far, aim: 0, hold: 0, proof: 'HitscanFired' };
    case 'strike':
      return { enemyAt: far, aim: 0, target: { x: 900, y: standY }, hold: 0, proof: 'StrikeCalled' };
    case 'deploy':
      return { enemyAt: far, aim: 0, hold: 0, proof: 'ObjectDeployed' };
  }
  if (id === 'boomerang_trowel') return { enemyAt: 110, aim: 60, hold: 30, proof: 'ProjectileFired' };
  // thrown: a medium lob towards the enemy (targeted ones get the enemy as target)
  return { enemyAt: far, aim: 300, target: { x: 900, y: standY }, hold: instant ? 0 : 35, proof: 'ProjectileFired' };
}

function play(index: number): { s: GameState; ev: SimEvent[]; plan: Plan } {
  const def0 = WEAPONS[index]!;
  const plan = planFor(def0.id, def0.category, def0.utility?.kind ?? '', def0.input.mode === 'instant' || def0.input.mode === 'target');
  const s = createGame({
    seed: 21,
    map: sweepMap(),
    weapons: WEAPONS,
    props: PROPS,
    match: {
      teams: [
        { name: 'A', spawns: [{ x: 600, y: standY }] },
        { name: 'B', spawns: [{ x: 600 + plan.enemyAt, y: standY }] },
      ],
      ruleset: { turnPrepSeconds: 0.2, revealSeconds: 0.2, crateChance: 0, mines: 0, barrels: 0, turnSeconds: 30 },
    },
  });
  const ev: SimEvent[] = [];
  const tick = (f: InputFrame = 0, cmds: SimCommand[] = []) => ev.push(...step(s, f, cmds));
  for (let i = 0; i < 3000 && !(s.match!.phase === 'turnActive' && s.activeCharacter === 1); i++) tick();
  const me = s.characters.find((c) => c.id === 1)!;
  const team = s.match!.teams[0]!;
  team.turns = 10; // past every weapon delay
  if (team.ammo[index] === 0) team.ammo[index] = 1; // crate-only weapons
  me.facing = 1;
  me.aim = plan.aim;
  tick(0, [{ type: 'selectWeapon', index }]);
  expect(me.weapon, `${def0.id} selectable`).toBe(index);
  if (plan.target) tick(0, [{ type: 'setTarget', x: plan.target.x, y: plan.target.y }]);
  if (plan.jumpFirst) {
    tick(Btn.Jump);
    for (let i = 0; i < 25; i++) tick();
  }
  if (plan.hold > 0) for (let i = 0; i < plan.hold; i++) tick(Btn.Fire);
  else tick(Btn.Fire);
  tick();
  for (let i = 0; i < 60; i++) tick(plan.during ?? 0);
  // tools that keep the turn going: skip it so the match moves on
  const napIndex = WEAPONS.findIndex((w) => w.id === 'nap_time');
  for (let i = 0; i < 400; i++) tick();
  if (s.match!.phase === 'turnActive' && s.activeCharacter === 1) {
    if (me.state === 'rope') {
      tick(Btn.Jump);
      for (let i = 0; i < 200; i++) tick();
    }
    if (me.jet) tick(Btn.Jump);
    tick(0, [{ type: 'selectWeapon', index: napIndex }]);
    tick(Btn.Fire);
  }
  for (let i = 0; i < 4000 && s.match!.turn < 2; i++) tick();
  return { s, ev, plan };
}

describe('every item in the shipped roster', () => {
  const items = WEAPONS.map((w, i) => [w.id, i] as const);
  it.each(items)('%s does its thing and the match moves on', (id, index) => {
    const { s, ev, plan } = play(index);
    expect(ofType(ev, plan.proof).length, `${id}: ${plan.proof}`).toBeGreaterThan(0);
    expect(s.match!.turn, `${id}: next turn`).toBeGreaterThanOrEqual(2);
    // weapons that hurt: something went bang or someone got hit
    const w = WEAPONS[index]!;
    if (w.category !== 'utility' && w.category !== 'deploy' && w.id !== 'spatula_shove') {
      const bang = ofType(ev, 'Exploded').length + ofType(ev, 'CharacterHit').length + ofType(ev, 'ProjectileStruck').length;
      expect(bang, `${id}: an explosion or a hit`).toBeGreaterThan(0);
    }
    if (w.id === 'spatula_shove') expect(ofType(ev, 'MeleeSwing')[0]!.hits, 'spatula reaches').toEqual([2]);
    // and it replays exactly
    expect(hashState(play(index).s)).toBe(hashState(s));
  });
});
