import type { SimEvent } from '../core/events.js';
import { nextInt, nextRange, type RngState } from '../core/rng.js';
import { CHAR, MAX_CHARACTERS, makeCharacter, type Character } from '../character/character.js';
import { overlapsDisc } from '../physics/collision.js';
import { isSolid, type TerrainState } from '../terrain/terrain.js';
import { compileRuleset, type Ruleset, type RulesetJson } from './ruleset.js';

/**
 * Match state (plan §3, §7.3): teams, turn order and the turn phase machine's data.
 * One GameState is one round; rematches and multi-round matches create a new state from the
 * same config (multi-round bookkeeping arrives with local multiplayer, M16).
 */
export type TurnPhase = 'turnPrep' | 'turnActive' | 'retreat' | 'settling' | 'damageReveal' | 'matchOver';

export interface TeamState {
  /** Index in `match.teams`; also the characters' `team` (colour) value. */
  id: number;
  name: string;
  /** Character ids in roster order. */
  characterIds: number[];
  /** Roster index of the character that plays this team's next turn. */
  next: number;
}

export interface MatchState {
  ruleset: Ruleset;
  teams: TeamState[];
  /** Team ids in turn rotation (shuffled with the seed at setup). */
  order: number[];
  /** Position in `order` of the team whose turn it is. */
  orderPos: number;
  phase: TurnPhase;
  /** Ticks spent in the current phase. */
  phaseTicks: number;
  /** 1-based turn counter. */
  turn: number;
  /** Team of the current turn (−1 before the first). */
  activeTeam: number;
  turnTicksLeft: number;
  retreatTicksLeft: number;
  /** Counts down during active turns and retreats; 0 with roundTicks > 0 → sudden death. */
  roundTicksLeft: number;
  suddenDeath: boolean;
  /** Turn-ending shots fired this turn. */
  shotsFired: number;
  /** 'none' while playing; the winning team id is in `winner`. */
  result: 'none' | 'win' | 'draw';
  winner: number;
}

export interface TeamConfig {
  name: string;
  /** Characters in the team (1..8); default: ruleset team size. */
  size?: number;
  /** Manual placement (whole px, character centre); overrides random placement. */
  spawns?: Array<{ x: number; y: number }>;
}

export interface MatchConfig {
  /** 2..6 teams. */
  teams: TeamConfig[];
  ruleset?: RulesetJson;
}

export class MatchConfigError extends Error {}

/** Find a free, dry, well-separated standing spot. Returns the character centre or null. */
export function findSpawn(
  t: TerrainState,
  rng: RngState,
  waterY: number,
  taken: ReadonlyArray<{ x: number; y: number }>,
  spacing: number,
  aboveWater: number,
): { x: number; y: number } | null {
  const r = CHAR.radius;
  const margin = r + 8;
  if (t.width <= margin * 2 || t.height <= r * 3) return null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = nextRange(rng, margin, t.width - 1 - margin);
    let y = nextRange(rng, r * 2 + 2, t.height - 1);
    if (isSolid(t, x, y)) continue;
    while (y < t.height && !isSolid(t, x, y)) y++; // fall to the first surface below
    if (y >= t.height) continue;
    const cy = y - r - 1;
    if (cy - r < 0) continue;
    if (waterY > 0 && y > waterY - aboveWater) continue;
    if (overlapsDisc(t, x, cy, r)) continue; // no room to stand (narrow crevice, overhang)
    let ok = true;
    for (const p of taken) {
      const dx = p.x - x, dy = p.y - cy;
      if (dx * dx + dy * dy < spacing * spacing) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y: cy };
  }
  return null;
}

/**
 * Build the match: compile the ruleset, create the teams' characters (placed randomly with the
 * `mapgen` stream, round-robin across teams so no team clusters), shuffle the turn order.
 */
export function setupMatch(
  cfg: MatchConfig,
  t: TerrainState,
  waterY: number,
  rng: RngState,
  firstId: number,
): { match: MatchState; characters: Character[] } {
  const ruleset = compileRuleset(cfg.ruleset);
  if (cfg.teams.length < 2 || cfg.teams.length > 6) throw new MatchConfigError(`a match needs 2..6 teams (got ${cfg.teams.length})`);
  const sizes = cfg.teams.map((tc) => {
    const n = tc.spawns ? tc.spawns.length : (tc.size ?? ruleset.teamSize);
    if (!Number.isInteger(n) || n < 1 || n > 8) throw new MatchConfigError(`team "${tc.name}" needs 1..8 characters (got ${n})`);
    return n;
  });
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > MAX_CHARACTERS) throw new MatchConfigError(`too many characters (${total} > ${MAX_CHARACTERS})`);

  const teams: TeamState[] = cfg.teams.map((tc, i) => ({ id: i, name: String(tc.name).slice(0, 24), characterIds: [], next: 0 }));
  const characters: Character[] = [];
  const taken: Array<{ x: number; y: number }> = [];
  let id = firstId;
  const maxSize = Math.max(...sizes);
  for (let slot = 0; slot < maxSize; slot++) {
    for (let ti = 0; ti < teams.length; ti++) {
      if (slot >= sizes[ti]!) continue;
      const manual = cfg.teams[ti]!.spawns?.[slot];
      let pos = manual ? { x: Math.trunc(manual.x), y: Math.trunc(manual.y) } : null;
      if (!pos) {
        pos =
          findSpawn(t, rng, waterY, taken, ruleset.placementSpacing, ruleset.placementAboveWater) ??
          findSpawn(t, rng, waterY, taken, 0, ruleset.placementAboveWater) ??
          findSpawn(t, rng, 0, taken, 0, 0);
      }
      if (!pos) throw new MatchConfigError('no room on this map to place every character');
      taken.push(pos);
      const c = makeCharacter(id++, ti, pos.x, pos.y);
      c.hp = ruleset.hp;
      characters.push(c);
      teams[ti]!.characterIds.push(c.id);
    }
  }
  const order = teams.map((tm) => tm.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const match: MatchState = {
    ruleset,
    teams,
    order,
    orderPos: -1,
    phase: 'turnPrep',
    phaseTicks: 0,
    turn: 0,
    activeTeam: -1,
    turnTicksLeft: 0,
    retreatTicksLeft: 0,
    roundTicksLeft: ruleset.roundTicks,
    suddenDeath: false,
    shotsFired: 0,
    result: 'none',
    winner: -1,
  };
  return { match, characters };
}

export const isAlive = (c: Character) => c.state !== 'dead';

/** Team ids that still have a living character, in id order. */
export function livingTeams(match: MatchState, chars: readonly Character[]): number[] {
  const alive = new Set<number>();
  for (const c of chars) if (isAlive(c)) alive.add(c.team);
  return match.teams.filter((t) => alive.has(t.id)).map((t) => t.id);
}

export function emitPhase(match: MatchState, phase: TurnPhase, tick: number, events: SimEvent[]): void {
  match.phase = phase;
  match.phaseTicks = 0;
  events.push({ type: 'TurnPhaseChanged', tick, phase, turn: match.turn });
}
