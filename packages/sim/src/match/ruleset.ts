import { TICKS_PER_SECOND } from '../core/units.js';

/**
 * Ruleset (plan §3, "scheme-driven"): every match rule is data, never a hard-coded constant.
 * Authored in human units (seconds, px) as `RulesetJson`; compiled to ticks for the sim.
 * The compiled ruleset lives in the match state and is part of the state hash.
 */
export type SuddenDeathMode = 'hpToOne' | 'water' | 'both' | 'roundEnds';
export type CharacterSelect = 'sequential' | 'free';

export interface RulesetJson {
  /** Starting hp of every character. */
  hp?: number;
  /** Characters per team when a team gives no size. */
  teamSize?: number;
  turnSeconds?: number;
  retreatSeconds?: number;
  /** Round time in seconds; counts only while a turn is active or retreating. 0 = no limit. */
  roundSeconds?: number;
  suddenDeath?: SuddenDeathMode;
  /** Water rise per turn in sudden death, px. */
  waterRisePx?: number;
  characterSelect?: CharacterSelect;
  /** Pause between turns (camera travel, "your turn" banner), seconds. */
  turnPrepSeconds?: number;
  /** Hold after a damage reveal so HP bars can animate, seconds. */
  revealSeconds?: number;
  /** Settling gives up and force-settles after this many seconds. */
  settleCapSeconds?: number;
  /** Random placement: minimum distance between characters, px. */
  placementSpacingPx?: number;
  /** Random placement: minimum height of a spawn above the water line, px. */
  placementAboveWaterPx?: number;
  /** Map objects placed at the start (needs the props content). */
  mines?: number;
  barrels?: number;
  /** Chance of a supply crate dropping at each turn start, 0..1. */
  crateChance?: number;
  /** Share of crates that are health (the rest are weapons), 0..1. */
  healthCrateShare?: number;
  /** Warn this many seconds of round time before sudden death. */
  suddenDeathWarnSeconds?: number;
}

export interface Ruleset {
  hp: number;
  teamSize: number;
  turnTicks: number;
  retreatTicks: number;
  /** 0 = unlimited. */
  roundTicks: number;
  suddenDeath: SuddenDeathMode;
  waterRise: number;
  characterSelect: CharacterSelect;
  turnPrepTicks: number;
  revealTicks: number;
  settleCapTicks: number;
  placementSpacing: number;
  placementAboveWater: number;
  mines: number;
  barrels: number;
  /** per 1000 */
  crateChance: number;
  healthCrateShare: number;
  suddenDeathWarnTicks: number;
}

/** Plan §3.2 defaults. */
export const DEFAULT_RULESET_JSON: Required<RulesetJson> = {
  hp: 100,
  teamSize: 4,
  turnSeconds: 45,
  retreatSeconds: 3,
  roundSeconds: 15 * 60,
  suddenDeath: 'both',
  waterRisePx: 20,
  characterSelect: 'sequential',
  turnPrepSeconds: 1,
  revealSeconds: 1,
  settleCapSeconds: 20,
  placementSpacingPx: 40,
  placementAboveWaterPx: 60,
  mines: 4,
  barrels: 3,
  crateChance: 0.35,
  healthCrateShare: 0.6,
  suddenDeathWarnSeconds: 30,
};

export class RulesetError extends Error {}

const SD_MODES: readonly SuddenDeathMode[] = ['hpToOne', 'water', 'both', 'roundEnds'];
const SELECT_MODES: readonly CharacterSelect[] = ['sequential', 'free'];

function num(name: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    throw new RulesetError(`ruleset.${name} must be a number in [${lo}, ${hi}] (got ${String(v)})`);
  }
  return v;
}
const secs = (name: string, v: unknown, lo: number, hi: number) => Math.round(num(name, v, lo, hi) * TICKS_PER_SECOND);

export function compileRuleset(json: RulesetJson = {}): Ruleset {
  const j = { ...DEFAULT_RULESET_JSON, ...json };
  if (!SD_MODES.includes(j.suddenDeath)) throw new RulesetError(`ruleset.suddenDeath must be one of ${SD_MODES.join(', ')}`);
  if (!SELECT_MODES.includes(j.characterSelect)) throw new RulesetError(`ruleset.characterSelect must be one of ${SELECT_MODES.join(', ')}`);
  return {
    hp: Math.trunc(num('hp', j.hp, 1, 999)),
    teamSize: Math.trunc(num('teamSize', j.teamSize, 1, 8)),
    turnTicks: secs('turnSeconds', j.turnSeconds, 1, 600),
    retreatTicks: secs('retreatSeconds', j.retreatSeconds, 0, 30),
    roundTicks: secs('roundSeconds', j.roundSeconds, 0, 7200),
    suddenDeath: j.suddenDeath,
    waterRise: Math.trunc(num('waterRisePx', j.waterRisePx, 0, 200)),
    characterSelect: j.characterSelect,
    turnPrepTicks: secs('turnPrepSeconds', j.turnPrepSeconds, 0, 10),
    revealTicks: secs('revealSeconds', j.revealSeconds, 0, 10),
    settleCapTicks: secs('settleCapSeconds', j.settleCapSeconds, 1, 120),
    placementSpacing: Math.trunc(num('placementSpacingPx', j.placementSpacingPx, 0, 400)),
    placementAboveWater: Math.trunc(num('placementAboveWaterPx', j.placementAboveWaterPx, 0, 400)),
    mines: Math.trunc(num('mines', j.mines, 0, 30)),
    barrels: Math.trunc(num('barrels', j.barrels, 0, 30)),
    crateChance: Math.round(num('crateChance', j.crateChance, 0, 1) * 1000),
    healthCrateShare: Math.round(num('healthCrateShare', j.healthCrateShare, 0, 1) * 1000),
    suddenDeathWarnTicks: secs('suddenDeathWarnSeconds', j.suddenDeathWarnSeconds, 0, 600),
  };
}
