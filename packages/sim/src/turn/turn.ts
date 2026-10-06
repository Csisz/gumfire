import type { SimEvent } from '../core/events.js';
import { Btn, pressed, type InputFrame } from '../core/input.js';
import { rollWind } from '../environment/wind.js';
import { SETTLE_TICKS, hasPendingDamage, revealDamage, worldInMotion } from '../explosions/resolve.js';
import { emitPhase, isAlive, livingSides, livingTeams, type MatchState } from '../match/match.js';
import type { GameState } from '../state/gameState.js';
import type { WeaponDef } from '../weapons/definition.js';
import { chance, nextRange } from '../core/rng.js';
import { MAX_OBJECTS, makeObject } from '../environment/objects.js';

/**
 * Turn manager (plan §7.3). One match phase machine, advanced once per tick:
 *
 *   turnPrep ─(prep time)→ turnActive ─(turn-ending shot)→ retreat
 *       ↑                       │ timer 0 / hurt / water      │ retreat 0 / hurt / water / End Turn
 *       │                       └────────────→ settling ←─────┘
 *       │                                         │ quiet 10 ticks (or cap)
 *       │                              damageReveal (hp applied, deaths → death blasts)
 *       │                                         │ hold; more motion → settling again
 *       └──────── turn end: victory / draw → matchOver, round time → sudden death ─┘
 *
 * Only the active character is controlled, and only in turnActive and retreat. The rest of the
 * simulation keeps running in every phase (projectiles fly through the retreat, bodies settle).
 */

export type ControlEndReason = 'timeout' | 'damage' | 'water' | 'retreatOver' | 'endTurn' | 'skip';

/** The character that may act this tick and whether it may still use a weapon. */
export function controlOf(s: GameState): { id: number; mayFire: boolean } {
  const m = s.match;
  if (!m) return { id: s.activeCharacter, mayFire: true };
  if (m.phase === 'turnActive') return { id: s.activeCharacter, mayFire: true };
  if (m.phase === 'retreat') return { id: s.activeCharacter, mayFire: false };
  return { id: 0, mayFire: false };
}

/** Mask the buttons a controlled character may use in the current phase. */
export function maskInput(s: GameState, input: InputFrame): InputFrame {
  return controlOf(s).mayFire ? input : input & ~Btn.Fire;
}

/** Weapon selection is a turn action: only before the first shot of an active turn. */
export function maySelectWeapon(s: GameState): boolean {
  const m = s.match;
  return !m || (m.phase === 'turnActive' && m.shotsFired === 0);
}

/** A shot left the barrel: count it; a turn-ending weapon starts the retreat. */
export function onShotFired(s: GameState, weapon: WeaponDef, events: SimEvent[], fromAir = false): void {
  const m = s.match;
  if (!m || m.phase !== 'turnActive') return;
  if (!weapon.endsTurn) return; // utilities that keep the turn going are not shots
  m.shotsFired++;
  if (weapon.endsTurn && m.shotsFired >= weapon.shotsPerTurn) {
    if (weapon.remote) {
      m.remoteWait = true; // the owner may still detonate it; the retreat follows the bang
      return;
    }
    startRetreat(s, m, events, fromAir ? m.ruleset.ropeRetreatTicks : m.ruleset.retreatTicks);
  }
}

function startRetreat(s: GameState, m: MatchState, events: SimEvent[], ticks = m.ruleset.retreatTicks): void {
  if (ticks <= 0) {
    endControl(s, m, 'retreatOver', events);
    return;
  }
  m.retreatTicksLeft = ticks;
  emitPhase(m, 'retreat', s.tick, events);
  events.push({ type: 'RetreatStarted', tick: s.tick, id: s.activeCharacter, ticks: m.retreatTicksLeft });
}

/** The active character's remote-triggered projectile still out, if any. */
export function liveRemote(s: GameState, ownerId: number): GameState['projectiles'][0] | undefined {
  return s.projectiles.find((p) => p.owner === ownerId && s.weapons[p.weapon]?.remote === true && !p.detonate);
}

/** `nextCharacter` command: free character select, before the first shot. */
export function selectNextInTeam(s: GameState, events: SimEvent[]): void {
  const m = s.match;
  if (!m || m.ruleset.characterSelect !== 'free' || m.phase !== 'turnActive' || m.shotsFired > 0) return;
  const team = m.teams[m.activeTeam];
  if (!team) return;
  const ids = team.characterIds;
  const cur = ids.indexOf(s.activeCharacter);
  for (let k = 1; k < ids.length; k++) {
    const idx = (cur + k) % ids.length;
    const c = s.characters.find((x) => x.id === ids[idx]);
    if (c && isAlive(c) && c.state !== 'drowning') {
      const prev = s.characters.find((x) => x.id === s.activeCharacter);
      if (prev?.state === 'charging') return;
      s.activeCharacter = c.id;
      team.next = (idx + 1) % ids.length;
      events.push({ type: 'ActiveCharacterChanged', tick: s.tick, id: c.id });
      return;
    }
  }
}

/** "Skip" utility: the active character gives up the rest of the turn. */
export function skipTurn(s: GameState, events: SimEvent[]): void {
  const m = s.match;
  if (!m || m.phase !== 'turnActive') return;
  endControl(s, m, 'skip', events);
}

function endControl(s: GameState, m: MatchState, reason: ControlEndReason, events: SimEvent[]): void {
  events.push({ type: 'ControlEnded', tick: s.tick, id: s.activeCharacter, reason });
  emitPhase(m, 'settling', s.tick, events);
}

/** Why the active character must lose control this tick, if it must. */
function controlLoss(s: GameState, events: readonly SimEvent[]): ControlEndReason | null {
  const id = s.activeCharacter;
  const c = s.characters.find((x) => x.id === id);
  if (!c || c.state === 'dead' || c.state === 'drowning') return 'water';
  for (const e of events) if (e.type === 'CharacterHit' && e.id === id && e.damage > 0) return 'damage';
  return null;
}

/** Telegraph (Phase 2 hook 26.4): announce sudden death before the round clock runs out. */
function warnSuddenDeath(s: GameState, m: MatchState, events: SimEvent[]): void {
  const w = m.ruleset.suddenDeathWarnTicks;
  if (w > 0 && m.ruleset.roundTicks > w && m.roundTicksLeft === w && !m.suddenDeath) {
    events.push({ type: 'SuddenDeathSoon', tick: s.tick, seconds: Math.round(w / 50) });
  }
}

/** Choose the next team and character, reroll the wind, raise the water in sudden death. */
function beginTurn(s: GameState, m: MatchState, events: SimEvent[]): void {
  const alive = new Set(livingTeams(m, s.characters));
  const n = m.order.length;
  let team = -1;
  for (let k = 1; k <= n; k++) {
    const pos = (((m.orderPos + k) % n) + n) % n;
    if (alive.has(m.order[pos]!)) {
      m.orderPos = pos;
      team = m.order[pos]!;
      break;
    }
  }
  if (team < 0) return; // unreachable: turn end checks victory first
  const t = m.teams[team]!;
  let chosen = 0;
  for (let k = 0; k < t.characterIds.length; k++) {
    const idx = (t.next + k) % t.characterIds.length;
    const c = s.characters.find((x) => x.id === t.characterIds[idx]);
    if (c && isAlive(c)) {
      chosen = c.id;
      t.next = (idx + 1) % t.characterIds.length;
      break;
    }
  }
  m.turn++;
  m.activeTeam = team;
  t.turns++;
  m.turnTicksLeft = m.ruleset.turnTicks;
  m.retreatTicksLeft = 0;
  m.shotsFired = 0;
  m.remoteWait = false;
  if (s.activeCharacter !== chosen) {
    s.activeCharacter = chosen;
    events.push({ type: 'ActiveCharacterChanged', tick: s.tick, id: chosen });
  }
  const w = rollWind(s.rng.wind, s.wind);
  if (w !== s.wind) {
    s.wind = w;
    events.push({ type: 'WindChanged', tick: s.tick, wind: w });
  }
  if (m.suddenDeath && (m.ruleset.suddenDeath === 'water' || m.ruleset.suddenDeath === 'both') && m.ruleset.waterRise > 0 && s.terrain) {
    const from = s.waterY > 0 ? s.waterY : s.terrain.height;
    s.waterY = Math.max(1, from - m.ruleset.waterRise);
    for (const b of s.bodies) {
      b.sleeping = false;
      b.stillTicks = 0;
    }
    events.push({ type: 'WaterRose', tick: s.tick, y: s.waterY });
  }
  maybeDropCrate(s, m, events);
  events.push({ type: 'TurnStarted', tick: s.tick, turn: m.turn, team, id: chosen });
}

/** Turn start: maybe a supply crate floats down somewhere over the map (seeded `crates` stream). */
function maybeDropCrate(s: GameState, m: MatchState, events: SimEvent[]): void {
  if (!s.terrain || m.ruleset.crateChance <= 0 || s.objects.length >= MAX_OBJECTS) return;
  const health = s.props.findIndex((p) => p.kind === 'crate' && p.heal > 0);
  const weapon = s.props.findIndex((p) => p.kind === 'crate' && p.ammo > 0 && !p.utility);
  const utility = s.props.findIndex((p) => p.kind === 'crate' && p.ammo > 0 && p.utility);
  if (health < 0 && weapon < 0 && utility < 0) return;
  if (!chance(s.rng.crates, m.ruleset.crateChance, 1000)) return;
  let kind: 'health' | 'weapon' | 'utility';
  if (health >= 0 && (weapon < 0 && utility < 0 ? true : chance(s.rng.crates, m.ruleset.healthCrateShare, 1000))) kind = 'health';
  else if (utility >= 0 && (weapon < 0 || chance(s.rng.crates, m.ruleset.utilityCrateShare, 1000))) kind = 'utility';
  else kind = weapon >= 0 ? 'weapon' : 'health';
  const idx = kind === 'health' ? health : kind === 'utility' ? utility : weapon;
  if (idx < 0) return;
  const def = s.props[idx]!;
  const x = nextRange(s.rng.crates, 40, s.terrain.width - 41);
  const o = makeObject(s.nextObjectId++, idx, def, x, -40);
  s.objects.push(o);
  events.push({ type: 'CrateDropped', tick: s.tick, id: o.id, kind, x });
}

/** Ammo the active team has left for weapon `index` (−1 = unlimited; free play: unlimited). */
export function ammoLeft(s: GameState, characterId: number, index: number): number {
  const m = s.match;
  if (!m) return -1;
  const c = s.characters.find((x) => x.id === characterId);
  const team = c ? m.teams[c.team] : undefined;
  return team?.ammo[index] ?? -1;
}

/**
 * Turns the active character's team must still wait before weapon `index` unlocks (classic
 * weapon delay: big weapons are locked for the first N turns); 0 = usable.
 */
export function delayLeft(s: GameState, characterId: number, index: number): number {
  const m = s.match;
  const def = s.weapons[index];
  if (!m || !def || def.delayTurns <= 0) return 0;
  const c = s.characters.find((x) => x.id === characterId);
  const team = c ? m.teams[c.team] : undefined;
  if (!team) return 0;
  return Math.max(0, def.delayTurns - team.turns + 1);
}

/** Use one round of ammo for the first shot of a turn (multi-shot weapons cost one). */
export function spendAmmo(s: GameState, c: { id: number; team: number; weapon: number }, events: SimEvent[]): void {
  const m = s.match;
  if (!m || m.shotsFired > 0) return;
  const team = m.teams[c.team];
  const a = team?.ammo[c.weapon];
  if (team && a !== undefined && a > 0) {
    team.ammo[c.weapon] = a - 1;
    events.push({ type: 'AmmoChanged', tick: s.tick, team: team.id, weapon: c.weapon, ammo: a - 1 });
  }
}

function finish(s: GameState, m: MatchState, result: 'win' | 'draw', winner: number, events: SimEvent[]): void {
  m.result = result;
  m.winner = winner;
  if (s.activeCharacter !== 0) {
    s.activeCharacter = 0;
    events.push({ type: 'ActiveCharacterChanged', tick: s.tick, id: 0 });
  }
  emitPhase(m, 'matchOver', s.tick, events);
  events.push({ type: 'MatchEnded', tick: s.tick, result, winner });
}

/** Turn end: victory / draw, sudden death, then the next turn's prep. */
function endTurn(s: GameState, m: MatchState, events: SimEvent[]): void {
  const living = livingTeams(m, s.characters);
  const sides = livingSides(m, s.characters);
  if (sides.length === 1) return finish(s, m, 'win', living[0]!, events); // allies win together
  if (living.length === 0) return finish(s, m, 'draw', -1, events);
  const clockOut = m.ruleset.roundTicks > 0 && m.roundTicksLeft <= 0;
  const turnsOut = m.ruleset.roundTurns > 0 && m.turn >= m.ruleset.roundTurns;
  if ((clockOut || turnsOut) && !m.suddenDeath) {
    m.suddenDeath = true;
    const mode = m.ruleset.suddenDeath;
    events.push({ type: 'SuddenDeath', tick: s.tick, mode });
    if (mode === 'roundEnds') {
      // the side with the most hp left wins; a tie is a draw
      const hp = new Map<number, number>();
      for (const c of s.characters) if (isAlive(c)) hp.set(m.teams[c.team]!.side, (hp.get(m.teams[c.team]!.side) ?? 0) + c.hp);
      const ranked = [...hp.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return finish(s, m, 'draw', -1, events);
      const side = ranked[0]![0];
      return finish(s, m, 'win', living.find((id) => m.teams[id]!.side === side)!, events);
    }
    if (mode === 'hpToOne' || mode === 'both') {
      for (const c of s.characters) if (isAlive(c) && c.hp > 1) c.hp = 1;
    }
  }
  emitPhase(m, 'turnPrep', s.tick, events);
  beginTurn(s, m, events);
}

/**
 * Turn post-update (plan §7.2 step 11), after physics, explosions and settle bookkeeping.
 * `input`/`prevInput` are the raw frames (End Turn is read here, not by the controller).
 */
export function stepTurn(s: GameState, input: InputFrame, prevInput: InputFrame, events: SimEvent[]): void {
  const m = s.match;
  if (!m) return;
  m.phaseTicks++;
  if (m.turn === 0) {
    beginTurn(s, m, events); // the very first turn: prep starts at tick 1
    m.phaseTicks = 0;
    return;
  }
  switch (m.phase) {
    case 'turnPrep':
      if (m.phaseTicks >= m.ruleset.turnPrepTicks) emitPhase(m, 'turnActive', s.tick, events);
      return;
    case 'turnActive': {
      if (m.roundTicksLeft > 0) m.roundTicksLeft--;
      warnSuddenDeath(s, m, events);
      m.turnTicksLeft = Math.max(0, m.turnTicksLeft - 1);
      const lost = controlLoss(s, events);
      if (lost) endControl(s, m, lost, events);
      else if (m.turnTicksLeft === 0) endControl(s, m, 'timeout', events);
      else if (m.remoteWait && !s.projectiles.some((p) => p.owner === s.activeCharacter && s.weapons[p.weapon]?.remote === true)) {
        m.remoteWait = false;
        startRetreat(s, m, events);
      }
      return;
    }
    case 'retreat': {
      if (m.roundTicksLeft > 0) m.roundTicksLeft--;
      warnSuddenDeath(s, m, events);
      m.retreatTicksLeft = Math.max(0, m.retreatTicksLeft - 1);
      const lost = controlLoss(s, events);
      if (lost) endControl(s, m, lost, events);
      else if (pressed(prevInput, input, Btn.EndTurn)) endControl(s, m, 'endTurn', events);
      else if (m.retreatTicksLeft === 0) endControl(s, m, 'retreatOver', events);
      return;
    }
    case 'settling':
      if (s.quietTicks >= SETTLE_TICKS || m.phaseTicks >= m.ruleset.settleCapTicks) {
        if (hasPendingDamage(s)) {
          revealDamage(s, events);
          emitPhase(m, 'damageReveal', s.tick, events);
        } else endTurn(s, m, events);
      }
      return;
    case 'damageReveal':
      if (m.phaseTicks >= m.ruleset.revealTicks) {
        if (worldInMotion(s) || hasPendingDamage(s)) emitPhase(m, 'settling', s.tick, events);
        else endTurn(s, m, events);
      }
      return;
    case 'matchOver':
      return;
  }
}
