import { TICKS_PER_SECOND, type GameState } from '@gumfire/sim';
import { ROSTERS } from './world/gumling';
import { TEAM_COLOURS } from './world/worldView';

/**
 * DOM HUD in the reference card style (docs/art/STYLE.md): turn card with timer, team bars,
 * weapon tiles, wind gauge, banners. Placeholder layout for the vertical slice; the final HUD
 * and menus are designed at M14. Reads the sim state only; actions go back as callbacks.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const ICONS: Record<string, string> = {
  pepper_rocket: `<svg viewBox="0 0 48 48"><path d="M8 30 L2 27 L6 24 L2 21 L8 18" fill="#ffb03a" stroke="#1a1320" stroke-width="2" stroke-linejoin="round"/><ellipse cx="25" cy="24" rx="16" ry="8" fill="#e8364f" stroke="#1a1320" stroke-width="3"/><ellipse cx="27" cy="20.5" rx="7" ry="2" fill="#fff" opacity=".6"/><rect x="6" y="20.5" width="6" height="7" rx="1.5" fill="#6fdc4a" stroke="#1a1320" stroke-width="2.5"/></svg>`,
  fizz_grenade: `<svg viewBox="0 0 48 48"><rect x="13" y="7" width="22" height="34" rx="5" fill="#3fa9f5" stroke="#1a1320" stroke-width="3"/><rect x="13" y="7" width="22" height="5" fill="#dfe5ee" stroke="#1a1320" stroke-width="2"/><rect x="13" y="36" width="22" height="5" fill="#dfe5ee" stroke="#1a1320" stroke-width="2"/><circle cx="25" cy="24" r="5" fill="#fff"/><rect x="17" y="14" width="3" height="19" rx="1.5" fill="#fff" opacity=".6"/><circle cx="38" cy="10" r="2.5" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/><circle cx="42" cy="4" r="1.8" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/></svg>`,
  rolling_pin: `<svg viewBox="0 0 48 48"><g transform="rotate(-35 24 24)"><rect x="12" y="17" width="24" height="14" rx="6" fill="#e9b872" stroke="#1a1320" stroke-width="3"/><rect x="2" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="35" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="16" y="20" width="14" height="3" rx="1.5" fill="#fff" opacity=".5"/></g></svg>`,
};

export class Hud {
  private last = new Map<string, string>();
  private bannerTimer = 0;
  private weaponTiles: HTMLElement[] = [];

  constructor(
    private readonly state: GameState,
    private readonly onSelectWeapon: (index: number) => void,
  ) {
    const bar = $('weaponBar');
    bar.innerHTML = '';
    this.weaponTiles = state.weapons.map((w, i) => {
      const tile = document.createElement('div');
      tile.className = 'wtile';
      tile.title = w.name;
      tile.innerHTML = `<span class="key">F${i + 1}</span>${ICONS[w.id] ?? `<b>${w.name[0]}</b>`}`;
      tile.addEventListener('click', () => this.onSelectWeapon(i));
      bar.appendChild(tile);
      return tile;
    });
    $('teamsCard').innerHTML = (state.match?.teams ?? [])
      .map(
        (t) =>
          `<div class="teamRow" id="team${t.id}"><span class="dot" style="background:${css(TEAM_COLOURS[t.id]!)}"></span><span class="name">${t.name}</span><span class="bar"><i style="background:${css(TEAM_COLOURS[t.id]!)};width:100%"></i></span><span class="hp">0</span></div>`,
      )
      .join('');
  }

  private set(id: string, key: 'text' | 'html' | 'class' | 'style', value: string, apply: (el: HTMLElement) => void): void {
    const k = `${id}.${key}`;
    if (this.last.get(k) === value) return;
    this.last.set(k, value);
    apply($(id));
  }

  banner(text: string, ms = 1400): void {
    const b = $('banner');
    b.textContent = text;
    b.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), ms);
  }

  gumlingName(id: number): string {
    const m = this.state.match;
    const c = this.state.characters.find((x) => x.id === id);
    if (!m || !c) return '—';
    const slot = m.teams[c.team]!.characterIds.indexOf(id);
    const roster = ROSTERS[c.team % ROSTERS.length]!;
    return roster[slot % roster.length]!.name;
  }

  update(): void {
    const s = this.state, m = s.match;
    if (!m) return;
    const team = m.teams[m.activeTeam];
    const colour = team ? css(TEAM_COLOURS[team.id]!) : '#2f6fa8';
    this.set('teamPill', 'text', team?.name.toUpperCase() ?? '', (el) => (el.textContent = team?.name.toUpperCase() ?? ''));
    this.set('teamPill', 'style', colour, (el) => (el.style.background = colour));
    const act = s.characters.find((c) => c.id === s.activeCharacter);
    const name = act ? this.gumlingName(act.id) : '—';
    this.set('gumName', 'text', name, (el) => (el.textContent = name));
    const secs = (t: number) => Math.max(0, Math.ceil(t / TICKS_PER_SECOND));
    let phase = '', timer = '', timerClass = '';
    switch (m.phase) {
      case 'turnPrep':
        phase = 'get ready…';
        timer = String(secs(m.ruleset.turnTicks));
        break;
      case 'turnActive':
        phase = act?.state === 'charging' ? 'winding up!' : 'your move';
        timer = String(secs(m.turnTicksLeft));
        timerClass = m.turnTicksLeft <= 5 * TICKS_PER_SECOND ? 'warn' : '';
        break;
      case 'retreat':
        phase = 'run for cover!';
        timer = String(secs(m.retreatTicksLeft));
        timerClass = 'retreat';
        break;
      case 'settling':
        phase = 'waiting for the dust…';
        timer = '…';
        break;
      case 'damageReveal':
        phase = 'ouch!';
        timer = '…';
        break;
      case 'matchOver':
        phase = 'match over';
        timer = '★';
        break;
    }
    this.set('phaseLine', 'text', phase, (el) => (el.textContent = phase));
    this.set('timer', 'text', timer, (el) => (el.textContent = timer));
    this.set('timer', 'class', timerClass, (el) => (el.className = timerClass));
    const r = m.ruleset.roundTicks > 0 ? secs(m.roundTicksLeft) : -1;
    const round = m.suddenDeath ? 'SUDDEN DEATH — the ice is melting!' : r >= 0 ? `round ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}` : '';
    this.set('roundLine', 'text', round, (el) => (el.textContent = round));

    // teams
    for (const t of m.teams) {
      const members = s.characters.filter((c) => c.team === t.id);
      const hp = members.reduce((a, c) => a + (c.state === 'dead' ? 0 : c.hp), 0);
      const pct = Math.round((100 * hp) / (m.ruleset.hp * t.characterIds.length));
      const key = `${hp}|${pct}|${t.id === m.activeTeam}`;
      this.set(`team${t.id}`, 'html', key, (el) => {
        el.classList.toggle('active', t.id === m.activeTeam && m.phase !== 'matchOver');
        (el.querySelector('.bar i') as HTMLElement).style.width = `${pct}%`;
        (el.querySelector('.hp') as HTMLElement).textContent = String(hp);
      });
    }

    // weapons
    const canPick = m.phase === 'turnActive' && m.shotsFired === 0 && act?.state !== 'charging';
    const sel = act?.weapon ?? -1;
    this.weaponTiles.forEach((tile, i) => {
      const cls = `wtile${i === sel ? ' sel' : ''}${canPick ? '' : ' off'}`;
      if (tile.className !== cls) tile.className = cls;
    });
    const w = act ? s.weapons[act.weapon] : undefined;
    let info = w ? w.name : '';
    if (w && w.fuseTicks > 0 && act) info += ` · fuse ${act.fuse} s (1–5) · ${act.bounceHigh ? 'bouncy' : 'soft'} (B)`;
    const showInfo = m.phase === 'turnActive' && !!w;
    this.set('weaponInfo', 'text', info + showInfo, (el) => {
      el.textContent = info;
      el.classList.toggle('hidden', !showInfo);
    });

    // wind: 10 segments per side
    const wind = s.wind;
    const wl = wind < 0 ? `${-wind}%` : '0', wr = wind > 0 ? `${wind}%` : '0';
    this.set('windL', 'style', wl, (el) => (el.style.width = wl));
    this.set('windR', 'style', wr, (el) => (el.style.width = wr));
    const lbl = `WIND ${wind < 0 ? '◀' : wind > 0 ? '▶' : '·'} ${Math.abs(wind)}`;
    this.set('windLbl', 'text', lbl, (el) => (el.textContent = lbl));
  }
}
