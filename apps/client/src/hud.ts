import { TICKS_PER_SECOND, delayLeft, type GameState } from '@gumfire/sim';
import { defaultLooks, type TeamLook } from './world/worldView';

/**
 * DOM HUD in the reference card style (docs/art/STYLE.md): turn card with timer, team bars,
 * weapon tiles, wind gauge, banners. Placeholder layout for the vertical slice; the final HUD
 * and menus are designed at M14. Reads the sim state only; actions go back as callbacks.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export const ICONS: Record<string, string> = {
  pepper_rocket: `<svg viewBox="0 0 48 48"><path d="M8 30 L2 27 L6 24 L2 21 L8 18" fill="#ffb03a" stroke="#1a1320" stroke-width="2" stroke-linejoin="round"/><ellipse cx="25" cy="24" rx="16" ry="8" fill="#e8364f" stroke="#1a1320" stroke-width="3"/><ellipse cx="27" cy="20.5" rx="7" ry="2" fill="#fff" opacity=".6"/><rect x="6" y="20.5" width="6" height="7" rx="1.5" fill="#6fdc4a" stroke="#1a1320" stroke-width="2.5"/></svg>`,
  fizz_grenade: `<svg viewBox="0 0 48 48"><rect x="13" y="7" width="22" height="34" rx="5" fill="#3fa9f5" stroke="#1a1320" stroke-width="3"/><rect x="13" y="7" width="22" height="5" fill="#dfe5ee" stroke="#1a1320" stroke-width="2"/><rect x="13" y="36" width="22" height="5" fill="#dfe5ee" stroke="#1a1320" stroke-width="2"/><circle cx="25" cy="24" r="5" fill="#fff"/><rect x="17" y="14" width="3" height="19" rx="1.5" fill="#fff" opacity=".6"/><circle cx="38" cy="10" r="2.5" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/><circle cx="42" cy="4" r="1.8" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/></svg>`,
  acorn_mortar: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="28" rx="13" ry="15" fill="#b8743a" stroke="#1a1320" stroke-width="3"/><path d="M9 20 Q24 4 39 20 Q24 24 9 20Z" fill="#7a4a24" stroke="#1a1320" stroke-width="3"/><rect x="22" y="5" width="4" height="8" rx="2" fill="#5a3418"/><ellipse cx="18" cy="28" rx="3" ry="6" fill="#fff" opacity=".35"/><circle cx="40" cy="38" r="4" fill="#b8743a" stroke="#1a1320" stroke-width="2"/><circle cx="8" cy="40" r="3" fill="#b8743a" stroke="#1a1320" stroke-width="2"/></svg>`,
  cookie_roller: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="#d9a35c" stroke="#1a1320" stroke-width="3"/><circle cx="17" cy="18" r="3" fill="#4a2a14"/><circle cx="30" cy="16" r="2.5" fill="#4a2a14"/><circle cx="28" cy="30" r="3" fill="#4a2a14"/><circle cx="16" cy="31" r="2.2" fill="#4a2a14"/><path d="M4 44 H44" stroke="#1a1320" stroke-width="2.5" stroke-dasharray="4 4"/></svg>`,
  magnet_bomb: `<svg viewBox="0 0 48 48"><path d="M10 8 V26 A14 14 0 0 0 38 26 V8 H29 V26 A5 5 0 0 1 19 26 V8 Z" fill="#e8364f" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><rect x="10" y="8" width="9" height="7" fill="#dfe5ee" stroke="#1a1320" stroke-width="2.5"/><rect x="29" y="8" width="9" height="7" fill="#dfe5ee" stroke="#1a1320" stroke-width="2.5"/><path d="M4 4 l3 3 M44 4 l-3 3 M24 2 v3" stroke="#3fa9f5" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  sprinkle_drop: `<svg viewBox="0 0 48 48"><rect x="8" y="4" width="7" height="18" rx="3.5" fill="#ff5d8f" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 11 13)"/><rect x="21" y="10" width="7" height="18" rx="3.5" fill="#3fa9f5" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 24 19)"/><rect x="34" y="4" width="7" height="18" rx="3.5" fill="#ffd23f" stroke="#1a1320" stroke-width="2.5" transform="rotate(20 37 13)"/><path d="M6 42 H42" stroke="#1a1320" stroke-width="3"/><circle cx="24" cy="38" r="3" fill="none" stroke="#e8364f" stroke-width="2.5"/></svg>`,
  frosting_blaster: `<svg viewBox="0 0 48 48"><path d="M10 30 Q8 16 22 14 Q26 4 34 12 Q44 14 40 28 Q42 38 30 38 H18 Q8 38 10 30Z" fill="#fff6f8" stroke="#1a1320" stroke-width="3"/><path d="M14 30 Q20 24 26 30 Q32 24 36 30" fill="none" stroke="#ff9ebb" stroke-width="3"/><path d="M18 44 L21 37 L24 44 M28 44 L31 36 L34 44" fill="#ff7a1c" stroke="#1a1320" stroke-width="1.5"/></svg>`,
  binder_clip: `<svg viewBox="0 0 48 48"><path d="M8 20 H30 L34 34 H4 Z" fill="#2a2a33" stroke="#1a1320" stroke-width="3"/><path d="M12 20 Q12 8 19 10 M26 20 Q26 8 19 10" fill="none" stroke="#c9d3de" stroke-width="3"/><path d="M34 27 H46" stroke="#e8364f" stroke-width="3" stroke-dasharray="3 3"/></svg>`,
  boomerang_trowel: `<svg viewBox="0 0 48 48"><path d="M24 4 L36 26 L24 32 L12 26 Z" fill="#c9d3de" stroke="#1a1320" stroke-width="3"/><rect x="21" y="31" width="6" height="14" rx="3" fill="#6fdc4a" stroke="#1a1320" stroke-width="2.5"/><path d="M40 8 Q48 20 40 32" fill="none" stroke="#1a1320" stroke-width="2" stroke-dasharray="3 3"/></svg>`,
  popcorn_bomb: `<svg viewBox="0 0 48 48"><path d="M13 18 H35 L32 44 H16 Z" fill="#fff" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><path d="M19 18 L20 44 M28 18 L27 44" stroke="#e8364f" stroke-width="4"/><circle cx="17" cy="14" r="6" fill="#fffbea" stroke="#1a1320" stroke-width="2.5"/><circle cx="26" cy="11" r="6.5" fill="#fffbea" stroke="#1a1320" stroke-width="2.5"/><circle cx="33" cy="15" r="5" fill="#fffbea" stroke="#1a1320" stroke-width="2.5"/><circle cx="40" cy="6" r="3" fill="#fffbea" stroke="#1a1320" stroke-width="2"/></svg>`,
  pomegranate: `<svg viewBox="0 0 48 48"><circle cx="24" cy="27" r="16" fill="#d62246" stroke="#1a1320" stroke-width="3"/><path d="M17 12 L19 4 L23 10 L27 4 L30 12 Z" fill="#a8152f" stroke="#1a1320" stroke-width="2.5" stroke-linejoin="round"/><circle cx="18" cy="22" r="4" fill="#fff" opacity=".45"/><path d="M38 38 l4 4 M8 40 l-3 3 M42 24 h4" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/></svg>`,
  jawbreaker: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="#3fa9f5" stroke="#1a1320" stroke-width="3"/><circle cx="24" cy="24" r="12" fill="#ff5d8f"/><circle cx="24" cy="24" r="7" fill="#ffd23f"/><circle cx="24" cy="24" r="3" fill="#fff"/><circle cx="17" cy="15" r="3" fill="#fff" opacity=".7"/></svg>`,
  cherry_bomb: `<svg viewBox="0 0 48 48"><path d="M24 20 Q28 6 40 4" fill="none" stroke="#4f8a2b" stroke-width="3.5"/><circle cx="24" cy="30" r="14" fill="#c8102e" stroke="#1a1320" stroke-width="3"/><circle cx="18" cy="25" r="4" fill="#fff" opacity=".55"/><circle cx="40" cy="4" r="3.5" fill="#ffb03a"/><path d="M4 46 H44" stroke="#1a1320" stroke-width="2.5" stroke-dasharray="4 4"/></svg>`,
  mouse_trap: `<svg viewBox="0 0 48 48"><rect x="4" y="30" width="40" height="10" rx="2" fill="#d9a35c" stroke="#1a1320" stroke-width="3"/><path d="M10 30 V18 H34 V30" fill="none" stroke="#8a96a3" stroke-width="3.5"/><path d="M24 30 L28 22 L34 30 Z" fill="#ffd23f" stroke="#1a1320" stroke-width="2"/><circle cx="29" cy="27" r="1.4" fill="#1a1320"/></svg>`,
  toffee_bomb: `<svg viewBox="0 0 48 48"><path d="M8 24 L11 12 L22 8 L35 11 L40 24 L33 37 L18 38 Z" fill="#9a5b22" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><ellipse cx="20" cy="17" rx="6" ry="3" fill="#ffd9a0" opacity=".8"/><path d="M18 38 Q18 44 20 46 M31 37 Q32 42 30 45" stroke="#9a5b22" stroke-width="3" fill="none"/></svg>`,
  gumball_scatter: `<svg viewBox="0 0 48 48"><rect x="4" y="22" width="20" height="9" rx="3" fill="#2f6fa8" stroke="#1a1320" stroke-width="3"/><circle cx="32" cy="18" r="4" fill="#ff5d8f" stroke="#1a1320" stroke-width="2"/><circle cx="38" cy="27" r="4" fill="#ffd23f" stroke="#1a1320" stroke-width="2"/><circle cx="31" cy="35" r="4" fill="#6fdc4a" stroke="#1a1320" stroke-width="2"/><circle cx="43" cy="16" r="3" fill="#3fa9f5" stroke="#1a1320" stroke-width="2"/><circle cx="43" cy="38" r="3" fill="#9b59d0" stroke="#1a1320" stroke-width="2"/></svg>`,
  whisk_uppercut: `<svg viewBox="0 0 48 48"><rect x="21" y="30" width="6" height="16" rx="3" fill="#e9b872" stroke="#1a1320" stroke-width="2.5"/><path d="M24 31 C10 22 14 4 24 4 C34 4 38 22 24 31 Z" fill="none" stroke="#8a96a3" stroke-width="3"/><path d="M24 31 C18 20 20 6 24 4 C28 6 30 20 24 31" fill="none" stroke="#8a96a3" stroke-width="2.5"/><path d="M40 20 V6 M36 10 L40 5 L44 10" stroke="#e8364f" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  spatula_shove: `<svg viewBox="0 0 48 48"><rect x="4" y="21" width="18" height="6" rx="3" fill="#e9b872" stroke="#1a1320" stroke-width="2.5"/><rect x="21" y="12" width="20" height="24" rx="4" fill="#ff9ebb" stroke="#1a1320" stroke-width="3"/><path d="M27 18 V30 M33 18 V30" stroke="#1a1320" stroke-width="2" opacity=".5"/><path d="M42 24 H47" stroke="#1a1320" stroke-width="2.5" stroke-dasharray="2 2"/></svg>`,
  fortune_cookie: `<svg viewBox="0 0 48 48"><path d="M6 30 Q10 10 24 12 Q38 10 42 30 Q34 24 24 34 Q14 24 6 30 Z" fill="#f2c26b" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><rect x="22" y="30" width="16" height="7" rx="1" fill="#fff" stroke="#1a1320" stroke-width="2" transform="rotate(12 30 33)"/><path d="M8 8 l3 3 M40 6 l-2 4 M24 3 v4" stroke="#9b59d0" stroke-width="3" stroke-linecap="round"/></svg>`,
  biscuit_bridge: `<svg viewBox="0 0 48 48"><rect x="3" y="18" width="42" height="12" rx="3" fill="#e3ad62" stroke="#1a1320" stroke-width="3" transform="rotate(-18 24 24)"/><g fill="#b57a38" transform="rotate(-18 24 24)"><circle cx="10" cy="24" r="1.6"/><circle cx="18" cy="24" r="1.6"/><circle cx="26" cy="24" r="1.6"/><circle cx="34" cy="24" r="1.6"/><circle cx="41" cy="24" r="1.6"/></g></svg>`,
  cocktail_umbrella: `<svg viewBox="0 0 48 48"><path d="M4 22 Q24 -2 44 22 Z" fill="#ff9ebb" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><path d="M14 22 Q19 10 24 4 Q29 10 34 22" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M24 22 V44" stroke="#8a5a2b" stroke-width="3"/><path d="M8 34 l-3 3 M40 34 l3 3" stroke="#3fa9f5" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  soda_jetpack: `<svg viewBox="0 0 48 48"><rect x="10" y="6" width="12" height="28" rx="4" fill="#6fdc4a" stroke="#1a1320" stroke-width="3"/><rect x="26" y="6" width="12" height="28" rx="4" fill="#6fdc4a" stroke="#1a1320" stroke-width="3"/><rect x="10" y="14" width="12" height="5" fill="#fff"/><rect x="26" y="14" width="12" height="5" fill="#fff"/><circle cx="16" cy="40" r="3" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/><circle cx="32" cy="41" r="3" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/><circle cx="24" cy="45" r="2" fill="#cdf2fa" stroke="#1a1320" stroke-width="1.5"/></svg>`,
  chopstick_drill: `<svg viewBox="0 0 48 48"><path d="M17 4 L23 40 M31 4 L25 40" stroke="#b8743a" stroke-width="4.5" stroke-linecap="round"/><path d="M16 4 L18 12 M32 4 L30 12" stroke="#e8364f" stroke-width="5" stroke-linecap="round"/><path d="M14 44 l-4 2 M34 44 l4 2 M24 46 v1" stroke="#d9a35c" stroke-width="3" stroke-linecap="round"/></svg>`,
  candle_torch: `<svg viewBox="0 0 48 48"><rect x="6" y="22" width="24" height="10" rx="2" fill="#fff6f8" stroke="#1a1320" stroke-width="3"/><path d="M8 22 V18 M14 22 V19" stroke="#ff9ebb" stroke-width="2"/><path d="M30 27 Q38 18 46 27 Q38 36 30 27 Z" fill="#ff7a1c" stroke="#1a1320" stroke-width="2"/><path d="M33 27 Q38 22 42 27 Q38 32 33 27 Z" fill="#ffe066"/></svg>`,
  nap_time: `<svg viewBox="0 0 48 48"><path d="M30 8 A16 16 0 1 0 40 32 A13 13 0 1 1 30 8 Z" fill="#ffd23f" stroke="#1a1320" stroke-width="3" stroke-linejoin="round"/><text x="30" y="22" font-family="Fredoka, sans-serif" font-weight="700" font-size="11" fill="#2f6fa8">z</text><text x="36" y="14" font-family="Fredoka, sans-serif" font-weight="700" font-size="8" fill="#2f6fa8">z</text></svg>`,
  licorice_grapple: `<svg viewBox="0 0 48 48"><path d="M8 44 C12 30 30 34 26 20 C23 10 34 6 40 8" fill="none" stroke="#5a0f1e" stroke-width="6" stroke-linecap="round"/><path d="M8 44 C12 30 30 34 26 20 C23 10 34 6 40 8" fill="none" stroke="#c8364f" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 3"/><circle cx="41" cy="8" r="5" fill="#e8364f" stroke="#1a1320" stroke-width="2.5"/></svg>`,
  rolling_pin: `<svg viewBox="0 0 48 48"><g transform="rotate(-35 24 24)"><rect x="12" y="17" width="24" height="14" rx="6" fill="#e9b872" stroke="#1a1320" stroke-width="3"/><rect x="2" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="35" y="21" width="11" height="6" rx="3" fill="#c98f4f" stroke="#1a1320" stroke-width="2.5"/><rect x="16" y="20" width="14" height="3" rx="1.5" fill="#fff" opacity=".5"/></g></svg>`,
};

/** Weapon panel rows (anything not listed lands in the last row). */
const GROUPS: Array<[string, string[]]> = [
  ['Throw', ['pepper_rocket', 'fizz_grenade', 'acorn_mortar', 'popcorn_bomb', 'jawbreaker', 'toffee_bomb', 'frosting_blaster', 'pomegranate']],
  ['Tricks', ['cookie_roller', 'magnet_bomb', 'sprinkle_drop', 'cherry_bomb', 'mouse_trap', 'boomerang_trowel']],
  ['Close & quick', ['rolling_pin', 'whisk_uppercut', 'spatula_shove', 'binder_clip', 'gumball_scatter']],
  ['Tools', ['licorice_grapple', 'fortune_cookie', 'biscuit_bridge', 'cocktail_umbrella', 'soda_jetpack', 'chopstick_drill', 'candle_torch', 'nap_time']],
];

/** Short how-to line per utility kind. */
const UTILITY_HINT: Record<string, string> = {
  teleport: 'click a free spot, then Space',
  girder: 'click to place · ↑ ↓ tilt · Space builds',
  parachute: 'Space while falling opens it',
  jetpack: 'Space starts · ↑ thrust · ← → steer · Space stops',
  drill: 'Space digs down (Space again stops)',
  torch: 'Space burns ahead · aim ↑ ↓ for 45° (Space stops)',
  skip: 'Space skips the rest of your turn',
  rope: 'Space shoots · ← → swing · ↑ ↓ reel · Space or Enter lets go',
};

export class Hud {
  private last = new Map<string, string>();
  private bannerTimer = 0;
  private weaponTiles: HTMLElement[] = [];
  /** Weapon index of each tile (hidden sub-projectile defs get none). */
  private weaponIndex: number[] = [];
  private panelOpen = false;
  /** Is this team played by the CPU (M15b)? */
  cpu: (team: number) => boolean = () => false;
  /** Is the CPU still thinking about this turn? */
  thinking: () => boolean = () => false;
  /** Online (M17): who plays a team — null for this player, else a name. */
  who: (team: number) => string | null = () => null;
  /** Online: the player we are waiting for, if the game is held up. */
  waiting: () => string | null = () => null;

  constructor(
    private readonly state: GameState,
    private readonly onSelectWeapon: (index: number) => void,
    private readonly descriptions: Record<string, string> = {},
    private readonly looks: TeamLook[] = defaultLooks(),
  ) {
    this.mount();
  }

  /** (Re)build the HUD's DOM for this match — again after a replay borrowed it (M16). */
  mount(): void {
    const state = this.state;
    this.last.clear();
    // the bottom bar: the weapon in hand, Q / E arrows and the panel button
    $('curIcon').innerHTML = '';
    // the panel: one row per group
    const panel = $('weaponRows');
    panel.innerHTML = '';
    this.weaponIndex = [];
    this.weaponTiles = [];
    const placed = new Set<string>();
    const rows: Array<[string, number[]]> = GROUPS.map(([label, ids]) => {
      const list = ids.map((id) => state.weapons.findIndex((w) => w.id === id && !w.hidden)).filter((i) => i >= 0);
      list.forEach((i) => placed.add(state.weapons[i]!.id));
      return [label, list];
    });
    const rest = state.weapons.map((w, i) => (!w.hidden && !placed.has(w.id) ? i : -1)).filter((i) => i >= 0);
    if (rest.length) rows.push(['More', rest]);
    for (const [label, list] of rows) {
      if (!list.length) continue;
      const row = document.createElement('div');
      row.className = 'wrow';
      row.innerHTML = `<span class="wlabel">${label}</span>`;
      for (const i of list) {
        const w = state.weapons[i]!;
        const tile = document.createElement('div');
        tile.className = 'wtile';
        tile.innerHTML = `${ICONS[w.id] ?? `<b>${w.name[0]}</b>`}<span class="ammo"></span><span class="lock"></span>`;
        tile.addEventListener('click', () => {
          this.onSelectWeapon(i);
          this.togglePanel(false);
        });
        tile.addEventListener('mouseenter', () => {
          $('weaponDesc').innerHTML = `<b>${w.name}</b> — ${this.descriptions[w.id] ?? ''}`;
        });
        row.appendChild(tile);
        this.weaponTiles.push(tile);
        this.weaponIndex.push(i);
      }
      panel.appendChild(row);
    }
    $('weaponDesc').textContent = 'Pick a weapon (Tab closes)';
    this.togglePanel(false);
    // with alliances every row says its side
    const teams = state.match?.teams ?? [];
    const allied = new Set(teams.map((t) => t.side)).size < teams.length;
    const sideTag = (side: number) => (allied ? `<b class="side">${'ABCDEF'[side] ?? '?'}</b> ` : '');
    $('teamsCard').innerHTML = teams
      .map(
        (t) =>
          `<div class="teamRow" id="team${t.id}"><span class="dot" style="background:${css(this.look(t.id).colour)}">${this.look(t.id).emblem}</span><span class="name">${sideTag(t.side)}${t.name}</span><span class="bar"><i style="background:${css(this.look(t.id).colour)};width:100%"></i></span><span class="hp">0</span></div>`,
      )
      .join('');
  }

  private set(id: string, key: 'text' | 'html' | 'class' | 'style', value: string, apply: (el: HTMLElement) => void): void {
    const k = `${id}.${key}`;
    if (this.last.get(k) === value) return;
    this.last.set(k, value);
    apply($(id));
  }

  look(team: number): TeamLook {
    return this.looks[team % this.looks.length]!;
  }

  get isPanelOpen(): boolean {
    return this.panelOpen;
  }

  togglePanel(open = !this.panelOpen): void {
    this.panelOpen = open;
    $('weaponPanel').classList.toggle('hidden', !open);
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
    const roster = this.look(c.team).members;
    return roster[slot % roster.length]!.name;
  }

  update(): void {
    const s = this.state, m = s.match;
    if (!m) return;
    const team = m.teams[m.activeTeam];
    const colour = team ? css(this.look(team.id).colour) : '#2f6fa8';
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
        phase =
          team && this.cpu(team.id)
            ? this.thinking()
              ? 'CPU is thinking…'
              : act?.state === 'charging'
                ? 'winding up!'
                : 'CPU’s move'
            : act?.state === 'charging'
              ? 'winding up!'
              : team && this.who(team.id)
                ? `${this.who(team.id)}’s move`
                : 'your move';
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
    const wait = this.waiting();
    if (wait) phase = `waiting for ${wait}…`;
    this.set('phaseLine', 'text', phase, (el) => (el.textContent = phase));
    this.set('timer', 'text', timer, (el) => (el.textContent = timer));
    this.set('timer', 'class', timerClass, (el) => (el.className = timerClass));
    const r = m.ruleset.roundTicks > 0 ? secs(m.roundTicksLeft) : -1;
    const turnsLeft = m.ruleset.roundTurns > 0 ? m.ruleset.roundTurns - m.turn : -1;
    const soon = turnsLeft >= 0 && turnsLeft <= 10 ? ` · sudden death in ${turnsLeft} turn${turnsLeft === 1 ? '' : 's'}` : '';
    const round = m.suddenDeath ? 'SUDDEN DEATH — the ice is melting!' : r >= 0 ? `round ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}${soon}` : soon.slice(3);
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
    // strongest team on top (plan §17)
    const ranked = m.teams
      .map((t) => ({ id: t.id, hp: s.characters.filter((c) => c.team === t.id && c.state !== 'dead').reduce((a, c) => a + c.hp, 0) }))
      .sort((a, b) => b.hp - a.hp || a.id - b.id);
    const order = ranked.map((r) => r.id).join(',');
    this.set('teamsCard', 'class', order, () => ranked.forEach((r, k) => ($(`team${r.id}`).style.order = String(k))));

    // weapons
    const canPick = m.phase === 'turnActive' && m.shotsFired === 0 && act?.state !== 'charging';
    const sel = act?.weapon ?? -1;
    const ammoOf = (i: number) => (act && m.teams[act.team] ? (m.teams[act.team]!.ammo[i] ?? -1) : -1);
    if (this.panelOpen) {
      this.weaponTiles.forEach((tile, k) => {
        const i = this.weaponIndex[k]!;
        const a = ammoOf(i);
        const wait = act ? delayLeft(s, act.id, i) : 0;
        const badge = a < 0 ? '' : String(a);
        const b = tile.querySelector('.ammo') as HTMLElement;
        if (b.textContent !== badge) b.textContent = badge;
        const lock = wait > 0 ? `⏳${wait}` : '';
        const l = tile.querySelector('.lock') as HTMLElement;
        if (l.textContent !== lock) l.textContent = lock;
        const cls = `wtile${i === sel ? ' sel' : ''}${canPick && a !== 0 && wait === 0 ? '' : ' off'}`;
        if (tile.className !== cls) tile.className = cls;
      });
    }
    const w = act ? s.weapons[act.weapon] : undefined;
    const curKey = `${w?.id ?? ''}|${act ? ammoOf(act.weapon) : -1}`;
    this.set('curIcon', 'html', curKey, (el) => {
      el.innerHTML = w ? `${ICONS[w.id] ?? `<b>${w.name[0]}</b>`}<span class="ammo">${act && ammoOf(act.weapon) >= 0 ? ammoOf(act.weapon) : ''}</span>` : '';
    });
    const curName = w?.name ?? '—';
    this.set('curName', 'text', curName, (el) => (el.textContent = curName));
    let info = w ? `${w.name}  (Q/E · Tab)` : '';
    if (w?.utility) info += ` · ${UTILITY_HINT[w.utility] ?? ''}`;
    if (act?.jet) info = `Jetpack · fuel ${Math.ceil(act.jetFuel / TICKS_PER_SECOND)} s · Space stops`;
    if (act?.state === 'rope') {
      info = w?.utility === 'rope' || !w?.usableFromRope ? `On the rope · ← → swing · ↑ ↓ reel · Space lets go` : `On the rope · ${w.name}: ↑ ↓ aim · Space fires · Enter lets go`;
      if (m.phase === 'retreat') info = 'On the rope · Enter lets go';
    } else if (act?.ropeOn && act.state === 'air' && w?.utility === 'rope') info = `Licorice Grapple · Space re-shoots (${act.ropeShots} left)`;
    if (act?.jet && w && w.utility !== 'jetpack' && w.usableFromRope) info = `Jetpack · ${w.name}: Space fires · Enter stops the jetpack`;
    if (act?.state === 'tool') info = `${s.weapons[act.toolWeapon]?.name ?? ''} · ${Math.ceil(act.toolTicks / TICKS_PER_SECOND)} s · Space stops`;
    const remoteOut = act ? s.projectiles.some((p) => p.owner === act.id && s.weapons[p.weapon]?.remote) : false;
    if (w && w.fuseTicks > 0 && w.playerFuse && act) info += ` · fuse ${act.fuse} s (1–5) · ${act.bounceHigh ? 'bouncy' : 'soft'} (B)`;
    if (w?.needsTarget && act && !w.utility) info += act.hasTarget ? ' · target set (click to move)' : ' · click the map to place a target';
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
