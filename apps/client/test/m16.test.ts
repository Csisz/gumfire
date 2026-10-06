import { describe, expect, it } from 'vitest';
import { Btn, cloneState, createGame, generateMap, hashState, step, type GameConfig, type InputFrame, type TimedCommand } from '@gumfire/sim';
import { PROPS, WEAPONS } from '@gumfire/content';
import { ReplayError, decodeReplay, encodeReplay, indexReplay, rle, unrle, type ReplayData } from '../src/replay';
import { newSeries, recordMatch, toWin } from '../src/series';
import { defaultSettings } from '../src/settings';

function record(cfg: GameConfig, ticks: number): ReplayData {
  const s = createGame(cfg);
  const inputs: InputFrame[] = [];
  const commands: TimedCommand[] = [];
  for (let i = 0; i < ticks && s.match!.phase !== 'matchOver'; i++) {
    const k = i % 300;
    const input = k < 40 ? Btn.Up : k < 90 ? Btn.Fire : k < 120 ? Btn.Left : 0;
    const cmds = k === 10 ? [{ type: 'selectWeapon' as const, index: (i / 300) % 3 | 0 }] : [];
    for (const c of cmds) commands.push({ tick: s.tick + 1, cmd: c });
    inputs.push(input);
    step(s, input, cmds);
  }
  return { config: cfg, inputs, commands, theme: 'picnic', looks: [], cpu: [false, true], finalHash: hashState(s), created: '2026-10-03T00:00:00Z' };
}

const cfg = (map: boolean): GameConfig => ({
  seed: 3,
  ...(map ? { map: generateMap({ generator: 'island', seed: 4 }).spec } : { mapgen: { generator: 'island', seed: 4 } }),
  weapons: WEAPONS,
  props: PROPS,
  match: { teams: [{ name: 'A', size: 2, side: 0 }, { name: 'B', size: 2, side: 1 }], ruleset: { teamSize: 2, turnSeconds: 10 } },
});

describe('replay files', () => {
  it('run-length coding round-trips and rejects broken data', () => {
    const v = [0, 0, 0, 5, 5, 1, 0, 0];
    expect(rle(v)).toEqual([0, 3, 5, 2, 1, 1, 0, 2]);
    expect(unrle(rle(v), v.length)).toEqual(v);
    expect(() => unrle([1, 3], 2)).toThrow(ReplayError);
  });

  for (const map of [false, true]) {
    it(`a recorded match survives the file and replays to the same hash (${map ? 'handmade map' : 'generated map'})`, () => {
      const d = record(cfg(map), 2500);
      const text = encodeReplay(d, 13);
      expect(text.length).toBeLessThan(map ? 400_000 : 60_000);
      const back = decodeReplay(text, 13);
      expect(back.inputs).toEqual(d.inputs);
      expect(back.commands).toEqual(d.commands);
      expect(back.theme).toBe('picnic');
      const idx = indexReplay(back, cloneState);
      expect(idx.verified).toBe(true);
      expect(idx.turns.length).toBeGreaterThan(2);
      expect(idx.checkpoints[0]!.tick).toBe(0);
    });
  }

  it('a replay that starts mid-match (instant replay of the last turn) checks out too', () => {
    const d = record(cfg(false), 2000);
    const s = createGame(d.config);
    const cut = 900;
    for (let i = 0; i < cut; i++) step(s, d.inputs[i]!, d.commands.filter((c) => c.tick === s.tick + 1).map((c) => c.cmd));
    const tail: ReplayData = { ...d, inputs: d.inputs.slice(cut), commands: d.commands.filter((c) => c.tick > cut) };
    const idx = indexReplay(tail, cloneState, 4, s);
    expect(idx.checkpoints[0]!.tick).toBe(cut);
    expect(idx.verified).toBe(true);
  });

  it('refuses files from elsewhere or another version', () => {
    expect(() => decodeReplay('hello', 13)).toThrow(/not a GUMFIRE replay/);
    const d = record(cfg(false), 100);
    expect(() => decodeReplay(encodeReplay(d, 12), 13)).toThrow(/another game version/);
  });
});

describe('series', () => {
  it('best of 3: the first side to two wins takes it; draws do not count', () => {
    const setup = { ...defaultSettings().match, series: 3 };
    const sr = newSeries(setup);
    expect(toWin(3)).toBe(2);
    recordMatch(sr, 1, [{ team: 1, dealt: 50, kills: 1 }]);
    recordMatch(sr, -1);
    expect(sr.over).toBe(false);
    recordMatch(sr, 0);
    recordMatch(sr, 1, [{ team: 1, dealt: 30, kills: 2 }]);
    expect(sr.over).toBe(true);
    expect(sr.champion).toBe(1);
    expect(sr.totals.get(1)).toEqual({ dealt: 80, kills: 3 });
    recordMatch(sr, 0); // ignored once over
    expect(sr.played).toBe(4);
  });

  it('a series of draws still ends', () => {
    const sr = newSeries({ ...defaultSettings().match, series: 1 });
    recordMatch(sr, -1);
    expect(sr.over).toBe(false);
    recordMatch(sr, -1);
    expect(sr.over).toBe(true);
    expect(sr.champion).toBe(-1);
  });
});
