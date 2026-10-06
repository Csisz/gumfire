import type { MatchSetup } from './settings';

/**
 * A series of matches (M16): best of 1, 3 or 5. Wins are counted per side (allies share
 * theirs); the first side to win a majority takes the series. Draws count for nobody and the
 * series goes on (at most `length × 2` matches, so it always ends).
 */
export interface Series {
  setup: MatchSetup;
  length: number;
  /** Wins per side (index = side 0..3). */
  wins: number[];
  played: number;
  draws: number;
  /** Side that won the series, −1 while it goes on (or ended without a winner). */
  champion: number;
  over: boolean;
  /** Per saved-team totals over the series: damage dealt and knock-outs. */
  totals: Map<number, { dealt: number; kills: number }>;
}

export function newSeries(setup: MatchSetup): Series {
  return { setup, length: setup.series, wins: [0, 0, 0, 0], played: 0, draws: 0, champion: -1, over: false, totals: new Map() };
}

/** Wins needed to take the series. */
export const toWin = (length: number) => Math.floor(length / 2) + 1;

/** Record a match: `side` won (−1 = draw). */
export function recordMatch(s: Series, side: number, stats: Array<{ team: number; dealt: number; kills: number }> = []): void {
  if (s.over) return;
  s.played++;
  if (side < 0) s.draws++;
  else s.wins[side] = (s.wins[side] ?? 0) + 1;
  for (const st of stats) {
    const t = s.totals.get(st.team) ?? { dealt: 0, kills: 0 };
    t.dealt += st.dealt;
    t.kills += st.kills;
    s.totals.set(st.team, t);
  }
  if (side >= 0 && s.wins[side]! >= toWin(s.length)) {
    s.champion = side;
    s.over = true;
  } else if (s.played >= s.length * 2) s.over = true; // too many draws
}

/** The sides in play, in slot order of their first team. */
export function sidesOf(setup: MatchSetup): number[] {
  const out: number[] = [];
  for (const sd of setup.sides) if (!out.includes(sd)) out.push(sd);
  return out;
}
