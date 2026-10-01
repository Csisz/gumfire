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
  acorn_mortar: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="28" rx="13" ry="15" fill="#b8743a" stroke="#1a1320" stroke-width="3"/><path d="M9 20 Q24 4 39 20 Q24 24 9 20Z" fill="#7a4a24" stroke="#1a1320" stroke-width="3"/><rect x="22" y="5" width="4" height="8" rx="2" fill="#5a3418"/><ellipse cx="18" cy="28" rx="3" ry="6" fill="#fff" opacity=".35"/><circle cx="40" cy="38" r="4" fill="#b8743a" stroke="#1a1320" stroke-width="2"/><circle cx="8" cy="40" r="3" fill="#b8743a" stroke="#1a1320" stroke-width="2"/></svg>`,
  cookie_roller: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="#d9a35c" stroke="#1a1320" stroke-width="3"/><circle cx="17" cy="18" r="3" fill="#4a2a14"/><circle cx="30" cy="16" r="2.5" fill="#4a2a14"/><circle cx="28" cy="30" r="3" fill="#4a2a14"/><circle cx="16" cy="31" r="2.2" fill="#4a2a14"/><path d="M4 44 H44" stroke="#1a1320" stroke-width="2.5" stroke-dasharray="4 4"/></svg>`,
  magnet_bomb: `<svg viewBox="0 0 48 48"><path d="M10 8 V26 A14 14 0 0 0 38 26 V8 H29 V26 A5 5 0 0 1 19 26 V8 Z" fill="#e8364f" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><rect x="10" y="8" width="9" height="7" fill="#dfe5ee" stroke="#1a1320" stroke-width="2.5"/><rect x="29" y="8" width="9" height="7" fill="#dfe5ee" stroke="#1a1320" stroke-width="2.5"/><path d="M4 4 l3 3 M44 4 l-3 3 M24 2 v3" stroke="#3fa9f5" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  sprinkle_drop: `<svg viewBox="0 0 48 48"><rect x="8" y="4" width="7" height="18" rx="3.5" fill="#ff5d8f" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 11 13)"/><rect x="21" y="10" width="7" height="18" rx="3.5" fill="#3fa9f5" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 24 19)"/><rect x="34" y="4" width="7" height="18" rx="3.5" fill="#ffd23f" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 37 13)"/><path d="M6 42 H42" stroke="#1a1320" stroke-width="3"/><circle cx="24" cy="38" r="3" fill="none" stroke="#e8364f" stroke-width="2.5"/></svg>`,
  frosting_blaster: `<svg viewBox="0 0 48 48"><path d="M10 30 Q8 16 22 14 Q26 4 34 12 Q44 14 40 28 Q42 38 30 38 H18 Q8 38 10 30Z" fill="#fff6f8" stroke="#1a1320" stroke-width="3"/><path d="M14 30 Q20 24 26 30 Q32 24 36 30" fill="none" stroke="#ff9ebb" stroke-width="3"/><path d="M18 44 L21 37 L24 44 M28 44 L31 36 L34 44" fill="#ff7a1c" stroke="#1a1320" stroke-width="1.5"/></svg>`,
  binder_clip: `<svg viewBox="0 0 48 48"><path d="M8 20 H30 L34 34 H4 Z" fill="#2a2a33" stroke="#1a1320" stroke-width="3"/><path d="M12 20 Q12 8 19 10 M26 20 Q26 8 19 10" fill="none" stroke="#c9d3de" stroke-width="3"/><path d="M34 27 H46" stroke="#e8364f" stroke-width="3" stroke-dasharray="3 3"/></svg>`,
  boomerang_trowel: `<svg viewBox="0 0 48 48"><path d="M24 4 L36 26 L24 32 L12 26 Z" fill="#c9d3de" stroke="#1a1320" stroke-width="3"/><rect x="21" y="31" width="6" height="14" rx="3" fill="#6fdc4a" stroke="#1a1320" stroke-width="2.5"/><path d="M40 8 Q48 20 40 32" fill="none" stroke="#1a1320" stroke-width="2" stroke-dasharray="3 3"/></svg>`,
  rolling_pin: `<svg viewBox="0 0 48 48"><g transform="rotate(-35 24 24)"><rect x="12" y="17" width="24" height="14" rx="6" fill="#e9b872" stroke="#1a1320" stroke-width="3"/><rect x="2" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="35" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="16" y="20" width="14" height="3" rx="1.5" fill="#fff" opacity=".5"/></g></svg>`,
};

export class Hud {
  private last = new Map<string, string>();
  private bannerTimer = 0;
  private weaponTiles: HTMLElement[] = [];
  /** Weapon index of each tile (hidden sub-projectile defs get none). */
  private weaponIndex: number[] = [];

  constructor(
    private readonly state: GameState,
    private readonly onSelectWeapon: (index: number) => void,
  ) {
    const bar = $('weaponBar');
    bar.innerHTML = '';
    this.weaponIndex = [];
    this.weaponTiles = [];
    state.weapons.forEach((w, i) => {
      if (w.hidden) return;
      const tile = document.createElement('div');
      tile.className = 'wtile';
      tile.title = w.name;
      tile.innerHTML = `${ICONS[w.id] ?? `<b>${w.name[0]}</b>`}<span class="ammo"></span>`;
      tile.addEventListener('click', () => this.onSelectWeapon(i));
      bar.appendChild(tile);
      this.weaponTiles.push(tile);
      this.weaponIndex.push(i);
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
    const ammoOf = (i: number) => (act && m.teams[act.team] ? (m.teams[act.team]!.ammo[i] ?? -1) : -1);
    this.weaponTiles.forEach((tile, k) => {
      const a = ammoOf(this.weaponIndex[k]!);
      const badge = a < 0 ? '' : String(a);
      const b = tile.querySelector('.ammo') as HTMLElement;
      if (b.textContent !== badge) b.textContent = badge;
      const cls = `wtile${this.weaponIndex[k] === sel ? ' sel' : ''}${canPick && a !== 0 ? '' : ' off'}`;
      if (tile.className !== cls) tile.className = cls;
    });
    const w = act ? s.weapons[act.weapon] : undefined;
    let info = w ? `${w.name}  (Q/E)` : '';
    const remoteOut = act ? s.projectiles.some((p) => p.owner === act.id && s.weapons[p.weapon]?.remote) : false;
    if (w && w.fuseTicks > 0 && w.playerFuse && act) info += ` · fuse ${act.fuse} s (1–5) · ${act.bounceHigh ? 'bouncy' : 'soft'} (B)`;
    if (w?.needsTarget && act) info += act.hasTarget ? ' · target set (click to move)' : ' · click the map to place a target';
    if (w && w.shotsPerTurn > 1 && m.phase === 'turnActive') info += ` · shot ${Math.min(m.shotsFired + 1, w.shotsPerTurn)}/${w.shotsPerTurn}`;
    if (remoteOut) info = `${w?.name ?? ''} · Space: detonate!`;
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
