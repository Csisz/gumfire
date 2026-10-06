import { describe, expect, it } from 'vitest';
import { PRESETS, defaultSettings, keyLabel, loadSettings, rulesOf, teamColour } from '../src/settings';
import { awardsFor } from '../src/messages';
import { createGame } from '@gumfire/sim';

describe('settings', () => {
  it('fall back to the defaults without a store; presets and custom rules resolve', () => {
    const s = loadSettings(); // no window/localStorage under node: defaults
    expect(s).toEqual(defaultSettings());
    expect(s.teams).toHaveLength(6);
    for (const t of s.teams) expect(t.members).toHaveLength(6);
    expect(rulesOf(s.match)).toEqual(PRESETS[0]!.rules);
    expect(rulesOf({ ...s.match, preset: 'custom', custom: { ...PRESETS[1]!.rules, hp: 42 } }).hp).toBe(42);
    expect(teamColour(s, 0)).not.toBe(teamColour({ ...s, colourBlind: true }, 0));
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('ArrowLeft')).toBe('←');
  });

  it('every preset makes a valid match for 2–4 teams of up to 6', () => {
    for (const p of PRESETS) {
      const g = createGame({ seed: 1, mapgen: { generator: 'island', seed: 5 }, match: { teams: [1, 2, 3, 4].map((i) => ({ name: `T${i}`, size: 6 })), ruleset: { ...p.rules, teamSize: 6 } } });
      expect(g.characters).toHaveLength(24);
    }
  });
});

describe('awards', () => {
  it('MVP by knock-outs, most damage, and the funniest exit prefers an own goal', () => {
    const s = createGame({ seed: 1, mapgen: { generator: 'island', seed: 5 }, match: { teams: [{ name: 'A', size: 2 }, { name: 'B', size: 2 }] } });
    const [a1, b1, a2, b2] = s.characters.map((c) => c.id) as [number, number, number, number];
    const stats = new Map([
      [a1, { dealt: 80, kills: 1 }],
      [b1, { dealt: 120, kills: 0 }],
    ]);
    const deaths = [
      { id: b2, reason: 'hp' as const, by: a1 },
      { id: a2, reason: 'drowned' as const, by: a2 },
    ];
    const name = (id: number) => `G${id}`;
    const aw = awardsFor(stats, deaths, s, name);
    expect(aw.map((x) => x.title)).toEqual(['MVP', 'MOST DAMAGE', 'FUNNIEST EXIT']);
    expect(aw[0]!.text).toContain(`G${a1}`);
    expect(aw[1]!.text).toContain(`G${b1}`);
    expect(aw[2]!.text).toContain('own turn');
  });
});
