import {
  ACTIONS,
  CONTROLS,
  SIDE_NAMES,
  EMBLEMS,
  HATS,
  PRESETS,
  TEAM_PALETTE,
  COLOURBLIND_PALETTE,
  defaultSettings,
  defaultTeams,
  keyLabel,
  rulesOf,
  saveSettings,
  teamColour,
  type Action,
  type Control,
  type PresetId,
  type Settings,
} from './settings';

/**
 * The DOM screens around a match (M14, plan §17): match setup (2–4 teams, rules presets or custom
 * rules), the team editor and the options. Every change is saved at once; `onChange` lets the
 * client re-apply settings (volume, keys, text size…).
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class Menus {
  private editTeam = 0;
  private waitingKey: Action | null = null;

  constructor(
    private s: Settings,
    private readonly onChange: (s: Settings) => void,
  ) {
    this.wireSetup();
    this.wireTeams();
    this.wireOptions();
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.waitingKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'Escape') this.bindKey(this.waitingKey, e.code);
        this.waitingKey = null;
        this.renderKeys();
      },
      true,
    );
  }

  get settings(): Settings {
    return this.s;
  }

  private commit(): void {
    saveSettings(this.s);
    this.onChange(this.s);
  }

  // ------------------------------------------------------------------ match setup
  private wireSetup(): void {
    const preset = $<HTMLSelectElement>('optPreset');
    preset.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('') + '<option value="custom">Custom…</option>';
    preset.addEventListener('change', () => {
      this.s.match.preset = preset.value as PresetId;
      if (this.s.match.preset === 'custom') this.s.match.custom = { ...rulesOf({ ...this.s.match, preset: 'classic' }) };
      this.commit();
      this.renderSetup();
    });
    $<HTMLSelectElement>('optSize').addEventListener('change', (e) => {
      this.s.match.size = Number((e.target as HTMLSelectElement).value);
      this.commit();
      this.renderSetup();
    });
    $('addTeam').addEventListener('click', () => {
      if (this.s.match.teams.length >= 4) return;
      const free = this.s.teams.findIndex((_, i) => !this.s.match.teams.includes(i));
      if (free >= 0) {
        this.s.match.teams.push(free);
        this.s.match.control.push('human');
        this.s.match.sides.push(Math.min(3, this.s.match.teams.length - 1));
      }
      this.commit();
      this.renderSetup();
    });
    $('removeTeam').addEventListener('click', () => {
      if (this.s.match.teams.length <= 2) return;
      this.s.match.teams.pop();
      this.s.match.control.pop();
      this.s.match.sides.pop();
      if (new Set(this.s.match.sides).size < 2) this.s.match.sides = this.s.match.teams.map((_, i) => i);
      this.commit();
      this.renderSetup();
    });
    const custom: Array<[string, (v: number) => void]> = [
      ['cTurn', (v) => (this.s.match.custom.turnSeconds = clamp(v, 10, 120))],
      ['cRound', (v) => (this.s.match.custom.roundSeconds = clamp(v, 1, 60) * 60)],
      ['cRetreat', (v) => (this.s.match.custom.retreatSeconds = clamp(v, 0, 10))],
      ['cHp', (v) => (this.s.match.custom.hp = clamp(v, 10, 300))],
      ['cMines', (v) => (this.s.match.custom.mines = clamp(v, 0, 30))],
      ['cBarrels', (v) => (this.s.match.custom.barrels = clamp(v, 0, 30))],
      ['cCrates', (v) => (this.s.match.custom.crateChance = clamp(v, 0, 100) / 100)],
    ];
    for (const [id, set] of custom) {
      $<HTMLInputElement>(id).addEventListener('change', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) set(Math.round(v));
        this.commit();
        this.renderSetup();
      });
    }
    $<HTMLSelectElement>('optSeries').addEventListener('change', (e) => {
      const v = Number((e.target as HTMLSelectElement).value);
      this.s.match.series = v === 3 || v === 5 ? v : 1;
      this.commit();
    });
    $<HTMLSelectElement>('cSudden').addEventListener('change', (e) => {
      this.s.match.custom.suddenDeath = (e.target as HTMLSelectElement).value as Settings['match']['custom']['suddenDeath'];
      this.commit();
    });
  }

  renderSetup(): void {
    const m = this.s.match;
    $('teamSlots').innerHTML = m.teams
      .map((ti, slot) => {
        const t = this.s.teams[ti]!;
        const col = css(teamColour(this.s, t.colour));
        const options = this.s.teams.map((tt, i) => `<option value="${i}" ${i === ti ? 'selected' : ''} ${i !== ti && m.teams.includes(i) ? 'disabled' : ''}>${esc(tt.name)}</option>`).join('');
        const names = t.members.slice(0, m.size).map((x) => esc(x.name)).join(' · ');
        const ctl = CONTROLS.map(([k, label]) => `<option value="${k}" ${m.control[slot] === k ? 'selected' : ''}>${label}</option>`).join('');
        const side = SIDE_NAMES.slice(0, Math.max(2, m.teams.length)).map((n, i) => `<option value="${i}" ${m.sides[slot] === i ? 'selected' : ''}>Side ${n}</option>`).join('');
        return `<div class="slot" style="background:${col}33;border-color:${col}"><b>Slot ${slot + 1}</b> <span class="emb" style="color:${col}">${t.emblem}</span><select data-slot="${slot}">${options}</select><select class="ctl" data-ctl="${slot}" title="Who plays this team">${ctl}</select><select class="ctl" data-side="${slot}" title="Teams on the same side are allies">${side}</select><div class="names">${names}</div></div>`;
      })
      .join('');
    for (const sel of document.querySelectorAll<HTMLSelectElement>('#teamSlots select[data-slot]')) {
      sel.addEventListener('change', () => {
        m.teams[Number(sel.dataset.slot)] = Number(sel.value);
        this.commit();
        this.renderSetup();
      });
    }
    for (const sel of document.querySelectorAll<HTMLSelectElement>('#teamSlots select[data-ctl]')) {
      sel.addEventListener('change', () => {
        m.control[Number(sel.dataset.ctl)] = sel.value as Control;
        this.commit();
      });
    }
    for (const sel of document.querySelectorAll<HTMLSelectElement>('#teamSlots select[data-side]')) {
      sel.addEventListener('change', () => {
        m.sides[Number(sel.dataset.side)] = Number(sel.value);
        this.commit();
        this.renderSetup();
      });
    }
    const oneSide = new Set(m.sides).size < 2;
    ($('startBtn') as HTMLButtonElement).disabled = oneSide;
    const ally = oneSide ? 'Everybody is on one side — put someone on another side.' : new Set(m.sides).size < m.sides.length ? 'Alliances: teams on the same side win together.' : '';
    $('sideNote').textContent = ally;
    $<HTMLSelectElement>('optSeries').value = String(m.series);
    ($('addTeam') as HTMLButtonElement).disabled = m.teams.length >= 4;
    ($('removeTeam') as HTMLButtonElement).disabled = m.teams.length <= 2;
    $<HTMLSelectElement>('optSize').value = String(m.size);
    $<HTMLSelectElement>('optPreset').value = m.preset;
    const p = PRESETS.find((x) => x.id === m.preset);
    $('presetBlurb').textContent = p ? p.blurb : 'your own rules:';
    $('customRules').classList.toggle('hidden', m.preset !== 'custom');
    const c = m.custom;
    $<HTMLInputElement>('cTurn').value = String(c.turnSeconds);
    $<HTMLInputElement>('cRound').value = String(Math.round(c.roundSeconds / 60));
    $<HTMLInputElement>('cRetreat').value = String(c.retreatSeconds);
    $<HTMLInputElement>('cHp').value = String(c.hp);
    $<HTMLInputElement>('cMines').value = String(c.mines);
    $<HTMLInputElement>('cBarrels').value = String(c.barrels);
    $<HTMLInputElement>('cCrates').value = String(Math.round(c.crateChance * 100));
    $<HTMLSelectElement>('cSudden').value = c.suddenDeath;
  }

  // ------------------------------------------------------------------ team editor
  private wireTeams(): void {
    $<HTMLInputElement>('teamName').addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (v) this.s.teams[this.editTeam]!.name = v.slice(0, 16);
      this.commit();
      this.renderTeamTabs();
    });
    $('teamsReset').addEventListener('click', () => {
      this.s.teams[this.editTeam] = defaultTeams()[this.editTeam]!;
      this.commit();
      this.renderTeams();
    });
  }

  private renderTeamTabs(): void {
    $('teamTabs').innerHTML = this.s.teams
      .map((t, i) => `<button data-i="${i}" class="${i === this.editTeam ? 'sel' : ''}" style="background:${css(teamColour(this.s, t.colour))}">${t.emblem} ${esc(t.name)}</button>`)
      .join('');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#teamTabs button')) {
      b.addEventListener('click', () => {
        this.editTeam = Number(b.dataset.i);
        this.renderTeams();
      });
    }
  }

  renderTeams(): void {
    this.renderTeamTabs();
    const t = this.s.teams[this.editTeam]!;
    $<HTMLInputElement>('teamName').value = t.name;
    const pal = this.s.colourBlind ? COLOURBLIND_PALETTE : TEAM_PALETTE;
    $('teamColours').innerHTML = pal.map((c, i) => `<span class="swatch ${i === t.colour ? 'sel' : ''}" data-c="${i}" style="background:${css(c)}"></span>`).join('');
    $('teamEmblems').innerHTML = EMBLEMS.map((e) => `<span class="swatch ${e === t.emblem ? 'sel' : ''}" data-e="${e}">${e}</span>`).join('');
    for (const el of document.querySelectorAll<HTMLElement>('#teamColours .swatch')) {
      el.addEventListener('click', () => {
        t.colour = Number(el.dataset.c);
        this.commit();
        this.renderTeams();
      });
    }
    for (const el of document.querySelectorAll<HTMLElement>('#teamEmblems .swatch')) {
      el.addEventListener('click', () => {
        t.emblem = el.dataset.e as typeof t.emblem;
        this.commit();
        this.renderTeams();
      });
    }
    $('teamMembers').innerHTML = t.members
      .map((m, k) => `<label>${k + 1}. <input data-k="${k}" maxlength="12" value="${esc(m.name)}" /> <select data-k="${k}">${HATS.map((h) => `<option ${h === m.hat ? 'selected' : ''}>${h}</option>`).join('')}</select></label>`)
      .join('');
    for (const el of document.querySelectorAll<HTMLInputElement>('#teamMembers input')) {
      el.addEventListener('input', () => {
        const v = el.value.trim();
        if (v) t.members[Number(el.dataset.k)]!.name = v.slice(0, 12);
        this.commit();
      });
    }
    for (const el of document.querySelectorAll<HTMLSelectElement>('#teamMembers select')) {
      el.addEventListener('change', () => {
        t.members[Number(el.dataset.k)]!.hat = el.value as (typeof HATS)[number];
        this.commit();
      });
    }
  }

  // ------------------------------------------------------------------ options
  private wireOptions(): void {
    const check = (id: string, set: (v: boolean) => void) =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => {
        set((e.target as HTMLInputElement).checked);
        this.commit();
        if (id === 'oColourBlind') this.renderTeams();
      });
    $<HTMLInputElement>('oVolume').addEventListener('input', (e) => {
      this.s.volume = Number((e.target as HTMLInputElement).value) / 100;
      this.commit();
    });
    $<HTMLInputElement>('oMusic').addEventListener('input', (e) => {
      this.s.musicVolume = Number((e.target as HTMLInputElement).value) / 100;
      this.commit();
    });
    check('oMuted', (v) => (this.s.muted = v));
    check('oShake', (v) => (this.s.shake = v));
    check('oFlash', (v) => (this.s.flash = v));
    check('oColourBlind', (v) => (this.s.colourBlind = v));
    check('oHoldToggle', (v) => (this.s.holdToggle = v));
    $<HTMLSelectElement>('oText').addEventListener('change', (e) => {
      this.s.textSize = Number((e.target as HTMLSelectElement).value);
      this.commit();
    });
    $('optionsReset').addEventListener('click', () => {
      const d = defaultSettings();
      this.s = { ...d, teams: this.s.teams, match: this.s.match };
      this.commit();
      this.renderOptions();
    });
  }

  renderOptions(): void {
    $<HTMLInputElement>('oVolume').value = String(Math.round(this.s.volume * 100));
    $<HTMLInputElement>('oMusic').value = String(Math.round(this.s.musicVolume * 100));
    $<HTMLInputElement>('oMuted').checked = this.s.muted;
    $<HTMLInputElement>('oShake').checked = this.s.shake;
    $<HTMLInputElement>('oFlash').checked = this.s.flash;
    $<HTMLInputElement>('oColourBlind').checked = this.s.colourBlind;
    $<HTMLInputElement>('oHoldToggle').checked = this.s.holdToggle;
    $<HTMLSelectElement>('oText').value = String(this.s.textSize);
    this.renderKeys();
  }

  private renderKeys(): void {
    $('keyGrid').innerHTML = ACTIONS.map(([a, label]) => `<span>${label}</span><button data-a="${a}" class="${this.waitingKey === a ? 'wait' : ''}">${this.waitingKey === a ? 'press a key…' : keyLabel(this.s.keys[a])}</button>`).join('');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#keyGrid button')) {
      b.addEventListener('click', () => {
        this.waitingKey = b.dataset.a as Action;
        this.renderKeys();
      });
    }
  }

  /** A key used by another action swaps places with it, so every action keeps one key. */
  private bindKey(a: Action, code: string): void {
    if (['Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyF', 'KeyM', 'KeyH', 'KeyP'].includes(code)) return;
    const other = ACTIONS.find(([b]) => b !== a && this.s.keys[b] === code)?.[0];
    if (other) this.s.keys[other] = this.s.keys[a];
    this.s.keys[a] = code;
    this.commit();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
