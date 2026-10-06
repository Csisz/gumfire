import type { RulesetJson } from '@gumfire/sim';
import type { Hat } from './world/gumling';

/**
 * Player settings, saved teams and the last match setup (M14). Kept in this browser's
 * localStorage; every read and write is guarded, and a missing or broken store falls back to the
 * defaults, so the game never depends on it.
 */
export type Emblem = '●' | '▲' | '■' | '◆' | '★' | '✚';
export const EMBLEMS: readonly Emblem[] = ['●', '▲', '■', '◆', '★', '✚'];
export const HATS: readonly Hat[] = ['helmet', 'aviator', 'chef', 'bandana', 'miner', 'beret', 'hardhat', 'captain'];

/** Candy colours; the colour-blind set (Okabe–Ito based) swaps in by slot. */
export const TEAM_PALETTE = [0x6fdc4a, 0xe8364f, 0x3fa9f5, 0x9b59d0, 0xff9f1c, 0xffd23f];
export const COLOURBLIND_PALETTE = [0x009e73, 0xd55e00, 0x0072b2, 0xcc79a7, 0xe69f00, 0x56b4e9];

export interface TeamSetup {
  name: string;
  /** Slot in the palette (0..5): the colour-blind option maps slots to its own colours. */
  colour: number;
  emblem: Emblem;
  members: Array<{ name: string; hat: Hat }>;
}

export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire' | 'bounce' | 'endTurn' | 'prevWeapon' | 'nextWeapon' | 'panel';
export const ACTIONS: ReadonlyArray<[Action, string]> = [
  ['left', 'Walk left / swing'],
  ['right', 'Walk right / swing'],
  ['up', 'Aim up / reel in'],
  ['down', 'Aim down / reel out'],
  ['jump', 'Jump (×2 backflip) · let go'],
  ['fire', 'Fire (hold to charge)'],
  ['bounce', 'Bouncy / soft throw'],
  ['endTurn', 'End the retreat'],
  ['prevWeapon', 'Previous weapon'],
  ['nextWeapon', 'Next weapon'],
  ['panel', 'Weapon panel'],
];

export type PresetId = 'classic' | 'quick' | 'long' | 'chaos' | 'custom';
export interface Preset {
  id: PresetId;
  name: string;
  blurb: string;
  rules: Required<Pick<RulesetJson, 'turnSeconds' | 'roundSeconds' | 'retreatSeconds' | 'hp' | 'mines' | 'barrels' | 'crateChance' | 'suddenDeath'>>;
}
export const PRESETS: readonly Preset[] = [
  { id: 'classic', name: 'Classic', blurb: '45 s turns, 15 min, a few mines and kegs', rules: { turnSeconds: 45, roundSeconds: 900, retreatSeconds: 3, hp: 100, mines: 4, barrels: 3, crateChance: 0.35, suddenDeath: 'both' } },
  { id: 'quick', name: 'Quick snack', blurb: '30 s turns, 5 min, low hp, crates galore', rules: { turnSeconds: 30, roundSeconds: 300, retreatSeconds: 3, hp: 70, mines: 3, barrels: 2, crateChance: 0.6, suddenDeath: 'both' } },
  { id: 'long', name: 'Long feast', blurb: '60 s turns, 20 min, tough Gumlings', rules: { turnSeconds: 60, roundSeconds: 1200, retreatSeconds: 4, hp: 150, mines: 4, barrels: 3, crateChance: 0.35, suddenDeath: 'water' } },
  { id: 'chaos', name: 'Sugar rush', blurb: 'mines and kegs everywhere, a crate every turn', rules: { turnSeconds: 40, roundSeconds: 600, retreatSeconds: 3, hp: 100, mines: 12, barrels: 8, crateChance: 1, suddenDeath: 'both' } },
];

/** Who plays a slot: a person at the keyboard or the computer at a difficulty (M15b). */
export type Control = 'human' | 'easy' | 'normal' | 'hard';
export const CONTROLS: ReadonlyArray<[Control, string]> = [
  ['human', 'Player'],
  ['easy', 'CPU · easy'],
  ['normal', 'CPU · normal'],
  ['hard', 'CPU · hard'],
];

export interface MatchSetup {
  /** Saved-team index per playing slot (2–4 slots). */
  teams: number[];
  /** Who plays each slot (same order as `teams`). */
  control: Control[];
  /** Alliance of each slot, 0..3 (A–D); slots on the same side win together (M16). */
  sides: number[];
  /** Matches in a series: 1, 3 or 5 (first to a majority wins the series, M16). */
  series: number;
  size: number;
  preset: PresetId;
  custom: Preset['rules'];
}

export interface Settings {
  version: 1;
  volume: number;
  /** Music volume 0..1 (M18). */
  musicVolume: number;
  /** Background music on or off (the ♫ buttons). */
  musicOn: boolean;
  muted: boolean;
  shake: boolean;
  flash: boolean;
  /** 0 small, 1 normal, 2 large. */
  textSize: number;
  colourBlind: boolean;
  /** Tap Fire to start charging, tap again to throw. */
  holdToggle: boolean;
  keys: Record<Action, string>;
  teams: TeamSetup[];
  match: MatchSetup;
  /** Difficulty for "Quick match vs AI". */
  aiLevel: Exclude<Control, 'human'>;
}

const members = (list: Array<[string, Hat]>) => list.map(([name, hat]) => ({ name, hat }));

export function defaultTeams(): TeamSetup[] {
  return [
    { name: 'Mint', colour: 0, emblem: '●', members: members([['Pip', 'helmet'], ['Zippy', 'aviator'], ['Mochi', 'chef'], ['Bolt', 'miner'], ['Fizz', 'beret'], ['Taffy', 'captain']]) },
    { name: 'Cherry', colour: 1, emblem: '▲', members: members([['Rex', 'helmet'], ['Nib', 'bandana'], ['Tuck', 'miner'], ['Jojo', 'beret'], ['Pit', 'hardhat'], ['Ruby', 'aviator']]) },
    { name: 'Blueberry', colour: 2, emblem: '■', members: members([['Salt', 'captain'], ['Brick', 'hardhat'], ['Suds', 'chef'], ['Loop', 'aviator'], ['Dot', 'helmet'], ['Moss', 'bandana']]) },
    { name: 'Grape', colour: 3, emblem: '◆', members: members([['Vin', 'beret'], ['Plum', 'chef'], ['Gus', 'miner'], ['Lilac', 'aviator'], ['Raisin', 'helmet'], ['Juno', 'captain']]) },
    { name: 'Orange', colour: 4, emblem: '★', members: members([['Zest', 'hardhat'], ['Pulp', 'helmet'], ['Tang', 'bandana'], ['Clem', 'chef'], ['Navel', 'miner'], ['Sunny', 'beret']]) },
    { name: 'Lemon', colour: 5, emblem: '✚', members: members([['Sour', 'bandana'], ['Peel', 'aviator'], ['Drop', 'captain'], ['Curd', 'chef'], ['Lime', 'helmet'], ['Twist', 'hardhat']]) },
  ];
}

export const DEFAULT_KEYS: Record<Action, string> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  jump: 'Enter',
  fire: 'Space',
  bounce: 'KeyB',
  endTurn: 'Backspace',
  prevWeapon: 'KeyQ',
  nextWeapon: 'KeyE',
  panel: 'Tab',
};

export function defaultSettings(): Settings {
  return {
    version: 1,
    volume: 0.8,
    musicVolume: 0.6,
    musicOn: true,
    muted: false,
    shake: true,
    flash: true,
    textSize: 1,
    colourBlind: false,
    holdToggle: false,
    keys: { ...DEFAULT_KEYS },
    teams: defaultTeams(),
    match: { teams: [0, 1], control: ['human', 'human'], sides: [0, 1], series: 1, size: 4, preset: 'classic', custom: { ...PRESETS[0]!.rules } },
    aiLevel: 'normal',
  };
}

const STORE_KEY = 'gumfire.settings.v1';

/** Read the saved settings over the defaults; anything missing or invalid keeps its default. */
export function loadSettings(): Settings {
  const d = defaultSettings();
  let raw: unknown;
  try {
    raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : dflt);
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const s: Settings = {
    ...d,
    volume: num(r.volume, 0, 1, d.volume),
    musicVolume: num(r.musicVolume, 0, 1, d.musicVolume),
    musicOn: bool(r.musicOn, d.musicOn),
    muted: bool(r.muted, d.muted),
    shake: bool(r.shake, d.shake),
    flash: bool(r.flash, d.flash),
    textSize: Math.round(num(r.textSize, 0, 2, d.textSize)),
    colourBlind: bool(r.colourBlind, d.colourBlind),
    holdToggle: bool(r.holdToggle, d.holdToggle),
    aiLevel: r.aiLevel === 'easy' || r.aiLevel === 'normal' || r.aiLevel === 'hard' ? r.aiLevel : d.aiLevel,
  };
  if (r.keys && typeof r.keys === 'object') for (const [a] of ACTIONS) if (typeof r.keys[a] === 'string') s.keys[a] = r.keys[a];
  if (Array.isArray(r.teams) && r.teams.length === d.teams.length) {
    s.teams = r.teams.map((t, i) => {
      const dt = d.teams[i]!;
      if (!t || typeof t !== 'object') return dt;
      return {
        name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 16) : dt.name,
        colour: Math.round(num(t.colour, 0, TEAM_PALETTE.length - 1, dt.colour)),
        emblem: EMBLEMS.includes(t.emblem) ? t.emblem : dt.emblem,
        members: dt.members.map((m, k) => {
          const tm = Array.isArray(t.members) ? t.members[k] : undefined;
          return {
            name: tm && typeof tm.name === 'string' && tm.name.trim() ? tm.name.slice(0, 12) : m.name,
            hat: tm && HATS.includes(tm.hat) ? tm.hat : m.hat,
          };
        }),
      };
    });
  }
  const m = r.match;
  if (m && typeof m === 'object') {
    const teams = Array.isArray(m.teams) ? m.teams.filter((i) => Number.isInteger(i) && i >= 0 && i < s.teams.length) : [];
    if (teams.length >= 2 && teams.length <= 4 && new Set(teams).size === teams.length) s.match.teams = teams;
    s.match.control = s.match.teams.map((_, i) => {
      const c = Array.isArray(m.control) ? m.control[i] : undefined;
      return CONTROLS.some(([k]) => k === c) ? c! : 'human';
    });
    s.match.sides = s.match.teams.map((_, i) => {
      const v = Array.isArray(m.sides) ? m.sides[i] : undefined;
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3 ? v : i;
    });
    if (new Set(s.match.sides).size < 2) s.match.sides = s.match.teams.map((_, i) => i);
    s.match.series = m.series === 3 || m.series === 5 ? m.series : 1;
    s.match.size = Math.round(num(m.size, 1, 6, d.match.size));
    if (['classic', 'quick', 'long', 'chaos', 'custom'].includes(m.preset)) s.match.preset = m.preset;
    if (m.custom && typeof m.custom === 'object') {
      const c = m.custom;
      const dc = d.match.custom;
      s.match.custom = {
        turnSeconds: num(c.turnSeconds, 10, 120, dc.turnSeconds),
        roundSeconds: num(c.roundSeconds, 60, 3600, dc.roundSeconds),
        retreatSeconds: num(c.retreatSeconds, 0, 10, dc.retreatSeconds),
        hp: num(c.hp, 10, 300, dc.hp),
        mines: num(c.mines, 0, 30, dc.mines),
        barrels: num(c.barrels, 0, 30, dc.barrels),
        crateChance: num(c.crateChance, 0, 1, dc.crateChance),
        suddenDeath: ['hpToOne', 'water', 'both', 'roundEnds'].includes(c.suddenDeath) ? c.suddenDeath : dc.suddenDeath,
      };
    }
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // private window / storage blocked: settings just last for this visit
  }
}

/** The rules a setup plays with. */
/**
 * Turn limit for sudden death (M19): 8 turns per Gumling. Human turns rarely get there before
 * the round clock does; it is for matches nobody can finish (CPUs walled in a cavern).
 */
export function turnLimit(teams: number, size: number): number {
  return Math.max(24, 8 * teams * size);
}

export function rulesOf(m: MatchSetup): Preset['rules'] {
  if (m.preset === 'custom') return m.custom;
  return (PRESETS.find((p) => p.id === m.preset) ?? PRESETS[0]!).rules;
}

/** Display colour of a team slot under the current palette. */
export function teamColour(s: Settings, slot: number): number {
  const pal = s.colourBlind ? COLOURBLIND_PALETTE : TEAM_PALETTE;
  return pal[slot % pal.length]!;
}

/** Friendly key name for the options screen. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', NumpadEnter: 'Num Enter' };
  return map[code] ?? code;
}

export const SIDE_NAMES = ['A', 'B', 'C', 'D'] as const;

/** Does this setup put two teams on one side? */
export function hasAlliances(m: MatchSetup): boolean {
  return new Set(m.sides).size < m.sides.length;
}
