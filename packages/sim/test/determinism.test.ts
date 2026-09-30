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
import { arenaMap } from './helpers.js';

/**
 * Scripted session on the physics arena: bodies are thrown in, terrain is carved under them,
 * girders appear, tunnels are dug. Everything is derived from the tick number only.
 */
function scriptedCommands(ticks: number): TimedCommand[] {
  const out: TimedCommand[] = [
    { tick: 1, cmd: { type: 'debugSpawnCharacter', x: 150, y: 440, team: 0 } },
    { tick: 1, cmd: { type: 'debugSelect', id: 1 } },
  ];
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % 40 === 1) out.push({ tick, cmd: { type: 'debugSpawn', x: 60 + ((tick * 37) % 1100), y: 100 + (tick % 150), vx: ((tick % 13) - 6) * 200, vy: -((tick % 7) * 150), r: 6 + (tick % 5) } });
    if (tick % 120 === 60) out.push({ tick, cmd: { type: 'debugCarve', x: 100 + ((tick * 53) % 1000), y: 505, r: 30 + (tick % 20) } });
    if (tick % 300 === 150) out.push({ tick, cmd: { type: 'debugGirder', x: 200 + (tick % 700), y: 380, w: 96, h: 12 } });
    if (tick % 400 === 200) out.push({ tick, cmd: { type: 'debugTunnel', x0: 300, y0: 520, x1: 600, y1: 600, r: 9 } });
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
    if (k >= 201) return Btn.Up;
    return 0;
  });
}

const TICKS = 3000;
const REPLAY: Replay = { config: { seed: 20260930, map: arenaMap() }, inputs: scriptedInputs(TICKS), commands: scriptedCommands(TICKS) };

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
    expect(a.state.characters[0]!.state).not.toBe('dead'); // …and a live, controlled character
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
    expect(runReplay(REPLAY).finalHash.toString(16)).toMatchInlineSnapshot(`"bf8b18a8"`);
  });
});
