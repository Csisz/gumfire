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
  type InputFrame,
  type Replay,
} from '../src/index.js';

/** Scripted input: pushes, kicks and spawns at fixed ticks, derived only from the tick number. */
function scriptedInputs(ticks: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let t = 1; t <= ticks; t++) {
    let f = 0;
    if (t % 97 < 20) f |= Btn.Right;
    if (t % 131 < 15) f |= Btn.Left;
    if (t % 250 === 0) f |= Btn.Jump;
    if (t % 60 === 0) f |= Btn.Fire;
    out.push(f);
  }
  return out;
}

const REPLAY: Replay = { config: { seed: 20260930 }, inputs: scriptedInputs(3000) };

describe('determinism', () => {
  it('same seed + inputs → identical hashes at every checkpoint', () => {
    const a = runReplay(REPLAY);
    const b = runReplay(REPLAY);
    expect(a.checkpoints.length).toBe(60);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('different seeds diverge', () => {
    const a = runReplay(REPLAY);
    const b = runReplay({ ...REPLAY, config: { seed: 1 } });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('one changed input frame changes the outcome', () => {
    const inputs = [...REPLAY.inputs];
    inputs[500] = (inputs[500] ?? 0) | Btn.Fire;
    const a = runReplay(REPLAY);
    const b = runReplay({ ...REPLAY, inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('clone mid-match and continue → same result', () => {
    const s = createGame(REPLAY.config);
    const half = 1500;
    REPLAY.inputs.slice(0, half).forEach((f) => step(s, f));
    const copy = cloneState(s);
    REPLAY.inputs.slice(half).forEach((f) => step(s, f));
    REPLAY.inputs.slice(half).forEach((f) => step(copy, f));
    expect(hashState(copy)).toBe(hashState(s));
    expect(hashState(s)).toBe(runReplay(REPLAY).finalHash);
  });

  it('serialise → deserialise round-trip preserves the hash and future', () => {
    const s = createGame(REPLAY.config);
    REPLAY.inputs.slice(0, 1000).forEach((f) => step(s, f));
    const restored = deserializeState(serializeState(s));
    expect(hashState(restored)).toBe(hashState(s));
    REPLAY.inputs.slice(1000).forEach((f) => {
      step(s, f);
      step(restored, f);
    });
    expect(hashState(restored)).toBe(hashState(s));
  });

  it('state stays integer-only (no float drift can enter)', () => {
    const { state } = runReplay(REPLAY);
    const visit = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isSafeInteger(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(state);
  });

  it('golden hash: the demo sim has not changed unintentionally', () => {
    // Update deliberately (with a docs/tuning.md note) when sim behaviour changes on purpose.
    expect(runReplay(REPLAY).finalHash.toString(16)).toMatchInlineSnapshot(`"4df6b565"`);
  });
});
