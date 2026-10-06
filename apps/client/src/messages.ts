import type { GameState, SimEvent } from '@gumfire/sim';
import type { CharStats } from './session';

/**
 * The message ticker (plan §17: kills, drownings, crates, sudden death — with light humour lines)
 * and the end-of-match awards.
 */
const pick = <T>(list: readonly T[], seed: number): T => list[Math.abs(seed) % list.length]!;

const DIED: Record<'drowned' | 'lost' | 'hp', readonly string[]> = {
  drowned: ['{n} went for a swim.', 'Glug glug, {n}.', '{n} is sleeping with the jellyfish.', '{n} found out gummies sink.'],
  lost: ['{n} left the building.', '{n} flew off to another kitchen.', 'Bye bye, {n}!'],
  hp: ['{n} popped!', '{n} is sprinkles now.', 'So long, {n}!', '{n} has melted.'],
};

export class Ticker {
  private readonly lines: Array<{ el: HTMLElement; until: number }> = [];

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '';
  }

  push(text: string, ms = 3600): void {
    const el = document.createElement('div');
    el.textContent = text;
    this.root.appendChild(el);
    this.lines.push({ el, until: performance.now() + ms });
    while (this.lines.length > 3) this.lines.shift()!.el.remove();
  }

  update(now: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i]!;
      const left = l.until - now;
      if (left < 600) l.el.style.opacity = String(Math.max(0, left / 600));
      if (left <= 0) {
        l.el.remove();
        this.lines.splice(i, 1);
      }
    }
  }

  /** One sim event → maybe one line. `name` turns a character id into its Gumling name. */
  onEvent(e: SimEvent, s: GameState, name: (id: number) => string): void {
    switch (e.type) {
      case 'CharacterDied':
        this.push(pick(DIED[e.reason], e.id + e.tick).replace('{n}', name(e.id)));
        break;
      case 'CrateCollected':
        if (e.kind === 'health') this.push(`${name(e.by)} munched a candy box: +${e.amount} hp.`);
        else if (e.weapon >= 0) this.push(`${name(e.by)} found ${s.weapons[e.weapon]?.name ?? 'something'}!`);
        else this.push(`${name(e.by)} opened an empty box. Rude.`);
        break;
      case 'MineDud':
        this.push('A dud mine! Lucky.');
        break;
      case 'SuddenDeathSoon':
        this.push(`Sudden death in ${e.seconds} s — hurry!`);
        break;
      case 'SuddenDeath':
        this.push(e.mode === 'roundEnds' ? 'Time is up!' : 'Sudden death! Everything gets wetter.');
        break;
      case 'DamageRevealed':
        if (e.total >= 80) this.push(`Ouch! ${e.total} damage in one go.`);
        break;
      case 'UtilityUsed':
        if (e.kind === 'skip') this.push(`${name(e.id)} takes a nap.`);
        break;
    }
  }
}

export interface Award {
  title: string;
  text: string;
}

/** MVP, most damage and the funniest exit of the match. */
export function awardsFor(stats: ReadonlyMap<number, CharStats>, deaths: ReadonlyArray<{ id: number; reason: 'drowned' | 'lost' | 'hp'; by: number }>, s: GameState, name: (id: number) => string): Award[] {
  const out: Award[] = [];
  const all = [...stats.entries()];
  const mvp = all.slice().sort((a, b) => b[1].kills - a[1].kills || b[1].dealt - a[1].dealt || a[0] - b[0])[0];
  if (mvp && (mvp[1].kills > 0 || mvp[1].dealt > 0)) out.push({ title: 'MVP', text: `${name(mvp[0])} · ${mvp[1].kills} KO, ${mvp[1].dealt} dmg` });
  const dmg = all.slice().sort((a, b) => b[1].dealt - a[1].dealt || a[0] - b[0])[0];
  if (dmg && dmg[1].dealt > 0) out.push({ title: 'MOST DAMAGE', text: `${name(dmg[0])} · ${dmg[1].dealt}` });
  // allies count as teammates (M16 alliances)
  const teamOf = (id: number) => {
    const t = s.characters.find((c) => c.id === id)?.team ?? -1;
    return t >= 0 && s.match ? (s.match.teams[t]?.side ?? t) : t;
  };
  // funniest: own goal on your own turn > friendly fire > off the map > a swim > a pop
  const score = (d: (typeof deaths)[number]) => (d.by === d.id ? 5 : teamOf(d.by) === teamOf(d.id) ? 4 : d.reason === 'lost' ? 3 : d.reason === 'drowned' ? 2 : 1);
  const funny = deaths.slice().sort((a, b) => score(b) - score(a))[0];
  if (funny) {
    const n = name(funny.id);
    const text =
      funny.by === funny.id
        ? `${n} — taken out on their own turn`
        : teamOf(funny.by) === teamOf(funny.id)
          ? `${n} — a teammate's "help" (${name(funny.by)})`
          : funny.reason === 'lost'
            ? `${n} — launched off the map`
            : funny.reason === 'drowned'
              ? `${n} — went for a swim`
              : `${n} — popped`;
    out.push({ title: 'FUNNIEST EXIT', text });
  }
  return out;
}
