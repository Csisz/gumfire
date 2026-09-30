import { describe, expect, it } from 'vitest';
import {
  Btn,
  cloneState,
  createGame,
  deserializeState,
  hashState,
  runReplay,
  serializeState,
  step,
  type Replay,
  type TimedCommand,
} from '../src/index.js';
import { GRENADE_JSON, PIN_JSON, ROCKET_JSON, arenaMap } from './helpers.js';

/**
 * Scripted session on the physics arena: bodies are thrown in, terrain is carved under them,
 * girders appear, tunnels are dug. Everything is derived from the tick number only.
 */
function scriptedCommands(ticks: number): TimedCommand[] {
  const out: TimedCommand[] = [
    { tick: 1, cmd: { type: 'debugSpawnCharacter', x: 150, y: 440, team: 0 } },
    { tick: 1, cmd: { type: 'debugSelect', id: 1 } },
    { tick: 1, cmd: { type: 'debugSpawnCharacter', x: 820, y: 440, team: 1 } },
  ];
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % 40 === 1) out.push({ tick, cmd: { type: 'debugSpawn', x: 60 + ((tick * 37) % 1100), y: 100 + (tick % 150), vx: ((tick % 13) - 6) * 200, vy: -((tick % 7) * 150), r: 6 + (tick % 5) } });
    if (tick % 120 === 60) out.push({ tick, cmd: { type: 'debugCarve', x: 100 + ((tick * 53) % 1000), y: 505, r: 30 + (tick % 20) } });
    if (tick % 300 === 150) out.push({ tick, cmd: { type: 'debugGirder', x: 200 + (tick % 700), y: 380, w: 96, h: 12 } });
    if (tick % 400 === 200) out.push({ tick, cmd: { type: 'debugTunnel', x0: 300, y0: 520, x1: 600, y1: 600, r: 9 } });
    if (tick % 300 === 0) out.push({ tick, cmd: { type: 'debugRollWind' } });
    if (tick % 250 === 125) out.push({ tick, cmd: { type: 'debugExplode', x: 780 + (tick % 90), y: 480, r: 40, damage: 35, knockback: 256 } });
  }
  return out;
}

/** The controlled character walks, jumps both ways and aims (symmetric, so it stays near x=150). */
function scriptedInputs(ticks: number): number[] {
  return Array.from({ length: ticks }, (_, t) => {
    const k = t % 240;
    if (k < 40) return Btn.Right;
    if (k === 40 || k === 141) return Btn.Jump;
    if (k >= 101 && k < 141) return Btn.Left;
    if (k >= 200 && k < 214) return Btn.Up; // aim while standing again after the jump
    if (k >= 215 && k < 238) return Btn.Fire; // charge 23 ticks, fire on release
    return 0;
  });
}

const TICKS = 3000;
const REPLAY: Replay = {
  config: { seed: 20260930, map: arenaMap(), weapons: [ROCKET_JSON], wind: 20 },
  inputs: scriptedInputs(TICKS),
  commands: scriptedCommands(TICKS),
};

function runLive(until: number) {
  const s = createGame(REPLAY.config);
  const cmds = REPLAY.commands!;
  let c = 0;
  const advance = (to: number) => {
    while (s.tick < to) {
      const batch = [];
      while (c < cmds.length && cmds[c]!.tick === s.tick + 1) batch.push(cmds[c++]!.cmd);
      step(s, REPLAY.inputs[s.tick]!, batch);
    }
  };
  advance(until);
  return { s, advance };
}

describe('determinism (physics arena)', () => {
  it('same seed + inputs + commands → identical hashes at every checkpoint', () => {
    const a = runReplay(REPLAY);
    const b = runReplay(REPLAY);
    expect(a.checkpoints.length).toBe(60);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.state.bodies.length + a.state.nextBodyId).toBeGreaterThan(10); // the scenario really exercised bodies
    // …a controlled character that fired rockets (its own craters eventually drown it — fine)
    expect(a.state.nextProjectileId).toBeGreaterThan(5);
  });

  it('one changed command changes the outcome', () => {
    const cmds = REPLAY.commands!.map((c) => (c.tick === 81 && c.cmd.type === 'debugSpawn' ? { ...c, cmd: { ...c.cmd, vx: c.cmd.vx + 1 } } : c));
    expect(runReplay({ ...REPLAY, commands: cmds }).finalHash).not.toBe(runReplay(REPLAY).finalHash);
  });

  it('clone mid-match and continue → same result', () => {
    const { s } = runLive(1500);
    const copy = cloneState(s);
    const cont = (st: typeof s) => {
      const cmds = REPLAY.commands!;
      let c = cmds.findIndex((x) => x.tick > st.tick);
      if (c < 0) c = cmds.length;
      while (st.tick < TICKS) {
        const batch = [];
        while (c < cmds.length && cmds[c]!.tick === st.tick + 1) batch.push(cmds[c++]!.cmd);
        step(st, REPLAY.inputs[st.tick]!, batch);
      }
    };
    cont(s);
    cont(copy);
    expect(hashState(copy)).toBe(hashState(s));
    expect(hashState(s)).toBe(runReplay(REPLAY).finalHash);
  });

  it('serialise → deserialise mid-match preserves the hash and the future', () => {
    const { s, advance } = runLive(1000);
    const restored = deserializeState(serializeState(s));
    expect(hashState(restored)).toBe(hashState(s));
    advance(TICKS);
    const cmds = REPLAY.commands!;
    let c = cmds.findIndex((x) => x.tick > restored.tick);
    while (restored.tick < TICKS) {
      const batch = [];
      while (c >= 0 && c < cmds.length && cmds[c]!.tick === restored.tick + 1) batch.push(cmds[c++]!.cmd);
      step(restored, REPLAY.inputs[restored.tick]!, batch);
    }
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('state stays integer-only (no float drift can enter)', () => {
    const { state } = runReplay(REPLAY);
    const visit = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isSafeInteger(v)).toBe(true);
      else if (ArrayBuffer.isView(v)) return;
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(state);
  });

  it('golden hash: simulation behaviour has not changed unintentionally', () => {
    // Update deliberately (with a docs/tuning.md note) when sim behaviour changes on purpose.
    expect(runReplay(REPLAY).finalHash.toString(16)).toMatchInlineSnapshot(`"3ca9e7f6"`);
  });

  it('golden hash: a scripted turn-based match (placement, turns, retreats, reveals, sudden death)', () => {
    const inputs = Array.from({ length: 6000 }, (_, t) => {
      const k = t % 400;
      if (k < 25) return Btn.Up;
      if (k === 57) return [Btn.Fuse1, Btn.Fuse2, Btn.Fuse3, Btn.Fuse4, Btn.Fuse5][Math.floor(t / 400) % 5]!;
      if (k === 58 && t % 1200 < 400) return Btn.Alt;
      if (k >= 60 && k < 100) return Btn.Fire;
      if (k >= 100 && k < 130) return t % 800 < 400 ? Btn.Left : Btn.Right;
      if (k === 131) return Btn.Jump;
      return 0;
    });
    const replay: Replay = {
      config: {
        seed: 7,
        map: arenaMap(),
        weapons: [ROCKET_JSON, GRENADE_JSON, PIN_JSON],
        match: { teams: [{ name: 'Sour', size: 3 }, { name: 'Sweet', size: 3 }], ruleset: { turnSeconds: 8, roundSeconds: 40 } },
      },
      inputs,
      // rotate rocket → grenade (fuse 1–5) → rolling pin, one per turn slot
      commands: Array.from({ length: 15 }, (_, i) => ({ tick: i * 400 + 55, cmd: { type: 'selectWeapon' as const, index: i % 3 } })),
    };
    const res = runReplay(replay);
    expect(res.state.match!.turn).toBeGreaterThan(8);
    expect(hashState(deserializeState(serializeState(res.state)))).toBe(res.finalHash);
    expect(res.finalHash.toString(16)).toMatchInlineSnapshot(`"5c74c658"`);
  });

  it('golden: a whole match played to the end (sudden death water finishes it)', () => {
    const config = {
      seed: 2026,
      map: arenaMap(),
      weapons: [ROCKET_JSON, GRENADE_JSON, PIN_JSON],
      match: { teams: [{ name: 'Mint', size: 2 }, { name: 'Cherry', size: 2 }], ruleset: { turnSeconds: 6, roundSeconds: 30 } },
    };
    const s = createGame(config);
    const inputs: number[] = [];
    const commands: TimedCommand[] = [];
    for (let t = 0; t < 60000 && s.match!.phase !== 'matchOver'; t++) {
      const k = t % 300;
      if (k === 40) commands.push({ tick: s.tick + 1, cmd: { type: 'selectWeapon', index: Math.floor(t / 300) % 3 } });
      const f = k < 20 ? Btn.Up : k >= 60 && k < 90 ? Btn.Fire : k >= 100 && k < 120 ? (t % 600 < 300 ? Btn.Left : Btn.Right) : 0;
      inputs.push(f);
      step(s, f, commands.length && commands.at(-1)!.tick === s.tick + 1 ? [commands.at(-1)!.cmd] : []);
    }
    expect(s.match!.phase).toBe('matchOver');
    const res = runReplay({ config, inputs, commands });
    expect(res.finalHash).toBe(hashState(s));
    expect(`${s.match!.result}:${s.match!.winner}:${s.tick}:${res.finalHash.toString(16)}`).toMatchInlineSnapshot(`"win:1:2948:423faa0"`);
  });
});
