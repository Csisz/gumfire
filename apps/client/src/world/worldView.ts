import { Container, Graphics, Text } from 'pixi.js';
import { CHAR, TICKS_PER_SECOND, subToPxFloat, type GameState, type SimEvent } from '@gumfire/sim';
import { FROZEN_SNACK_THEME, ICE_WATER, TerrainView, WaterView, type Camera } from '@gumfire/render';
import { Background } from './background';
import { OUTLINE, ROSTERS, drawFace, makeGumling, type Face, type GumlingView } from './gumling';

export const TEAM_COLOURS = [0x6fdc4a, 0xe8364f, 0x3fa9f5, 0x9b59d0, 0xff9f1c, 0xffd23f];

interface Particle {
  g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  grav: number;
}

/**
 * Everything drawn in world space for one match. Reads the sim state (never writes it) and
 * reacts to sim events with presentation-only effects (particles, pop-ups, squash, shake).
 */
export class WorldView {
  readonly root = new Container();
  readonly world = new Container();
  readonly background: Background;
  private readonly terrain: TerrainView;
  readonly water: WaterView;
  private readonly charLayer = new Container();
  private readonly projLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly reticle = new Graphics();
  private readonly flames = new Graphics();
  private readonly beams: Array<{ g: Graphics; age: number }> = [];
  private readonly chars = new Map<number, GumlingView>();
  private readonly projs = new Map<number, Container>();
  private readonly particles: Particle[] = [];
  private readonly rings: Array<{ g: Graphics; x: number; y: number; r: number; age: number }> = [];
  private readonly popups: Array<{ t: Text; age: number; vy: number }> = [];
  /** Previous-tick positions for render interpolation. */
  private prev = new Map<string, { x: number; y: number }>();
  shake = 0;

  constructor(private readonly state: GameState) {
    const t = state.terrain!;
    this.background = new Background(t.width, t.height);
    this.terrain = new TerrainView(t, FROZEN_SNACK_THEME);
    this.water = new WaterView(t.width, t.height, state.waterY, ICE_WATER);
    this.world.addChild(this.terrain.container, this.charLayer, this.reticle, this.projLayer, this.flames, this.water.container, this.fxLayer);
    this.root.addChild(this.background.container, this.world);
  }

  destroy(): void {
    this.terrain.destroy();
    this.water.destroy();
    this.root.destroy({ children: true });
  }

  /** Call before each sim tick: remember positions for interpolation. */
  snapshot(): void {
    const m = new Map<string, { x: number; y: number }>();
    for (const c of this.state.characters) m.set(`c${c.id}`, { x: c.body.x, y: c.body.y });
    for (const p of this.state.projectiles) m.set(`p${p.id}`, { x: p.x, y: p.y });
    this.prev = m;
  }

  // ------------------------------------------------------------------ events → effects
  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'TerrainChanged':
        this.terrain.invalidateRect(e.x0, e.y0, e.x1, e.y1);
        break;
      case 'CharacterLanded': {
        const v = this.chars.get(e.id);
        if (v) v.squash = Math.min(1, 0.25 + e.impact / (256 * 10));
        break;
      }
      case 'CharacterHit': {
        const v = this.chars.get(e.id);
        if (v) v.flash = 1;
        break;
      }
      case 'CharacterDamaged': {
        const c = this.state.characters.find((x) => x.id === e.id);
        if (c && e.amount > 0) this.popup(subToPxFloat(c.body.x), subToPxFloat(c.body.y) - 44, `-${e.amount}`, 0xe8364f, 18);
        break;
      }
      case 'CharacterDied': {
        const v = this.chars.get(e.id);
        if (v) v.diedOf = e.reason;
        break;
      }
      case 'Exploded':
        this.explosion(e.x, e.y, e.radius, e.cause === 'death');
        this.shake = Math.min(14, this.shake + e.radius / 7);
        break;
      case 'ProjectileSplashed':
        this.splash(e.x, e.y);
        break;
      case 'MeleeSwing': {
        const a = -(e.dir / 4096) * Math.PI * 2;
        for (let k = 0; k < 14; k++) {
          const t = (k / 13 - 0.5) * 1.7 + a;
          this.particle(e.x + Math.cos(t) * 18, e.y + Math.sin(t) * 18, 0xfff6d8, 2.6, Math.cos(a) * 1.6, Math.sin(a) * 1.6, 14, 0);
        }
        if (e.hits.length) {
          this.shake = Math.min(14, this.shake + 6);
          this.popup(e.x + Math.cos(a) * 26, e.y + Math.sin(a) * 26 - 10, 'BONK!', 0xffd23f, 16);
        }
        break;
      }
      case 'HitscanFired': {
        const g = new Graphics().moveTo(e.x0, e.y0).lineTo(e.x1, e.y1).stroke({ width: 3, color: 0xfff6d8 });
        g.moveTo(e.x0, e.y0).lineTo(e.x1, e.y1).stroke({ width: 1.2, color: 0x2a2a33 });
        this.fxLayer.addChild(g);
        this.beams.push({ g, age: 0 });
        break;
      }
      case 'ProjectileCaught':
      case 'ProjectileDropped': {
        const p = this.state.projectiles.find((x) => x.id === e.id);
        if (p) for (let k = 0; k < 6; k++) this.particle(subToPxFloat(p.x), subToPxFloat(p.y), 0xc9d3de, 1.6, (Math.random() - 0.5) * 3, -Math.random() * 2, 20, 0.1);
        break;
      }
      case 'WaterRose':
        this.water.setLevel(e.y);
        break;
    }
  }

  // ------------------------------------------------------------------ effects
  private particle(x: number, y: number, color: number, size: number, vx: number, vy: number, life: number, grav: number): void {
    const g = new Graphics().circle(0, 0, size).fill(color);
    g.position.set(x, y);
    this.fxLayer.addChild(g);
    this.particles.push({ g, x, y, vx, vy, age: 0, life, grav });
  }

  private popup(x: number, y: number, text: string, stroke: number, size: number): void {
    const t = new Text({
      text,
      style: { fontFamily: 'Fredoka, "Trebuchet MS", sans-serif', fontSize: size, fontWeight: '700', fill: 0xffffff, stroke: { color: stroke, width: 5 } },
      resolution: 3,
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.popups.push({ t, age: 0, vy: -0.7 });
  }

  private explosion(x: number, y: number, r: number, death: boolean): void {
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.rings.push({ g, x, y, r, age: 0 });
    const sugar = [0xffffff, 0xffd23f, 0xff5d8f, 0x3fa9f5, 0x6fdc4a];
    const n = death ? 34 : 26;
    for (let k = 0; k < n; k++) {
      const a = death ? -Math.PI / 2 + (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4.5;
      this.particle(x, y, sugar[k % sugar.length]!, 1.4 + Math.random() * 2, Math.cos(a) * sp, Math.sin(a) * sp - 1.5, 30 + Math.random() * 30, 0.12);
    }
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      this.particle(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, 0xe8eef5, 6 + Math.random() * 6, Math.cos(a) * 0.6, -0.4, 45, 0);
    }
  }

  private splash(x: number, y: number): void {
    for (let k = 0; k < 18; k++) {
      this.particle(x + (Math.random() - 0.5) * 10, y, k % 2 ? 0xf2fbff : 0x7cc8ee, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3, -2 - Math.random() * 3, 40, 0.15);
    }
  }

  // ------------------------------------------------------------------ per frame
  update(camera: Camera, alpha: number, nowMs: number, show: { pending: boolean }): void {
    const s = this.state;
    this.shake *= 0.86;
    if (this.shake < 0.2) this.shake = 0;
    const tr = camera.transform();
    this.world.scale.set(tr.scale);
    this.world.position.set(tr.x + (Math.random() - 0.5) * this.shake * 2, tr.y + (Math.random() - 0.5) * this.shake * 2);
    this.background.update(camera, nowMs);
    this.terrain.update();
    this.water.setLevel(s.waterY);
    this.water.update(nowMs);
    this.drawCharacters(alpha, nowMs, show.pending);
    this.drawProjectiles(alpha);
    this.drawFiresAndTarget(nowMs);
    this.drawFx();
  }

  private lerp(key: string, x: number, y: number, alpha: number): { x: number; y: number } {
    const p = this.prev.get(key) ?? { x, y };
    return { x: subToPxFloat(p.x + (x - p.x) * alpha), y: subToPxFloat(p.y + (y - p.y) * alpha) };
  }

  private drawCharacters(alpha: number, now: number, showPending: boolean): void {
    const s = this.state;
    this.reticle.clear();
    const team = (id: number) => s.characters.find((c) => c.id === id)!.team;
    for (const c of s.characters) {
      let v = this.chars.get(c.id);
      if (!v) {
        const slot = s.match ? s.match.teams[c.team]!.characterIds.indexOf(c.id) : c.id - 1;
        const roster = ROSTERS[c.team % ROSTERS.length]!;
        const r = roster[Math.max(0, slot) % roster.length]!;
        v = makeGumling(TEAM_COLOURS[team(c.id) % TEAM_COLOURS.length]!, r.hat, r.name);
        v.shownHp = c.hp;
        v.blinkAt = now + 1000 + Math.random() * 3000;
        this.chars.set(c.id, v);
        this.charLayer.addChild(v.root);
      }
      const { x, y } = this.lerp(`c${c.id}`, c.body.x, c.body.y, alpha);
      v.root.position.set(x, y);
      const dead = c.state === 'dead';
      v.root.visible = !dead || v.diedOf === 'hp';
      v.body.visible = !dead;
      v.grave.visible = dead;
      v.name.visible = v.hp.visible = !dead;
      v.root.alpha = c.state === 'drowning' ? Math.max(0, 1 - c.body.drownTicks / 75) : 1;
      // squash & stretch
      v.squash *= 0.82;
      let sx = 1, sy = 1;
      if (c.state === 'jumpPrep') {
        sy = 0.82;
        sx = 1.14;
      } else if (c.state === 'air') {
        const st = Math.min(0.2, Math.abs(subToPxFloat(c.body.vy)) / 40);
        sy = 1 + st;
        sx = 1 - st * 0.5;
      } else if (c.state === 'charging') {
        sy = 0.94 + Math.sin(now / 40) * 0.02;
        sx = 1.05;
      }
      sy -= v.squash * 0.3;
      sx += v.squash * 0.3;
      if (c.state === 'walk') sy += Math.sin(c.stateTicks * 0.9) * 0.05;
      v.body.scale.set(sx * c.facing, sy);
      v.flash *= 0.88;
      v.body.alpha = 1 - v.flash * 0.6;
      // face
      let face: Face = 'open';
      if (c.state === 'drowning') face = 'x';
      else if (v.flash > 0.3 || c.state === 'air') face = 'wince';
      else if (c.state === 'landing') face = 'squint';
      else if (c.state === 'charging') face = 'grin';
      if (now > v.blinkAt) {
        face = face === 'open' ? 'squint' : face;
        if (now > v.blinkAt + 120) v.blinkAt = now + 2000 + Math.random() * 3000;
      }
      drawFace(v.face, face, v.masked);
      // labels: hp counts down after a reveal
      if (v.shownHp > c.hp) v.shownHp = Math.max(c.hp, v.shownHp - 0.6);
      else v.shownHp = c.hp;
      v.hp.text = `${Math.ceil(v.shownHp)}`;
      v.pending.visible = showPending && c.pendingDamage > 0 && !dead;
      v.pending.text = `−${c.pendingDamage}`;
      const active = c.id === s.activeCharacter && !dead;
      v.marker.visible = active;
      if (active) this.drawAim(c, x, y);
    }
    this.declutterLabels(now);
  }

  /**
   * Gumlings standing close together would stack their name + hp labels on top of each other;
   * lift a label one row per neighbour it would overlap (greedy, left to right).
   */
  private declutterLabels(now: number): void {
    const placed: Array<{ x: number; y: number; level: number }> = [];
    const views = [...this.chars.values()].filter((v) => v.root.visible && v.name.visible).sort((a, b) => a.root.x - b.root.x);
    for (const v of views) {
      const x = v.root.x, y = v.root.y;
      let level = 0;
      while (placed.some((p) => p.level === level && Math.abs(p.x - x) < 44 && Math.abs(p.y - y) < 30)) level++;
      placed.push({ x, y, level });
      const lift = level * 24;
      v.name.y = -34 - lift;
      v.hp.y = -23 - lift;
      v.pending.y = -23 - lift;
    }
    // the active marker floats above the whole stack it belongs to, never between labels
    for (const v of views) {
      if (!v.marker.visible) continue;
      const top = Math.max(0, ...placed.filter((p) => Math.abs(p.x - v.root.x) < 44 && Math.abs(p.y - v.root.y) < 30).map((p) => p.level));
      v.marker.position.set(0, -50 - top * 24 + Math.sin(now * 0.006) * 3);
    }
  }

  private drawAim(c: GameState['characters'][0], x: number, y: number): void {
    const s = this.state;
    const phase = s.match?.phase;
    if (phase && phase !== 'turnActive') return;
    const w = s.weapons[c.weapon];
    const a = (c.aim / 4096) * 2 * Math.PI;
    if (c.state === 'idle' || c.state === 'walk' || c.state === 'jumpPrep') {
      const d = w?.category === 'melee' ? 24 : 42;
      const rx = x + Math.cos(a) * d * c.facing, ry = y - Math.sin(a) * d;
      this.reticle.circle(rx, ry, 6).stroke({ width: 2.5, color: 0xe8364f }).circle(rx, ry, 1.8).fill(0xe8364f);
    }
    if (c.state === 'charging' && w) {
      const frac = c.power / w.chargeTicks;
      const n = Math.ceil(frac * 14);
      for (let k = 1; k <= n; k++) {
        const d = 16 + k * 4.4;
        const t = k / 14;
        const col = (0xff << 16) | (Math.round(220 * (1 - t)) << 8) | 0x20;
        this.reticle.circle(x + Math.cos(a) * d * c.facing, y - Math.sin(a) * d, 1.3 + t * 3.4).fill(col).stroke({ width: 1, color: OUTLINE, alpha: 0.5 });
      }
    }
  }

  private makeRocket(): Container {
    const c = new Container();
    c.addChild(
      new Graphics().poly([-9, 0, -16, -3.5, -13, 0, -16, 3.5]).fill(0xffb03a),
      new Graphics().ellipse(0, 0, 8.5, 4).fill(0xe8364f).stroke({ width: 1.6, color: OUTLINE }),
      new Graphics().ellipse(1, -1.5, 4, 1).fill({ color: 0xffffff, alpha: 0.55 }),
      new Graphics().rect(-10, -1.8, 3.4, 3.6).fill(0x6fdc4a).stroke({ width: 1, color: OUTLINE }),
    );
    return c;
  }

  private makeCan(): Container {
    const c = new Container();
    const can = new Container();
    can.label = 'can';
    can.addChild(
      new Graphics().roundRect(-4.5, -6, 9, 12, 2).fill(0x3fa9f5).stroke({ width: 1.6, color: OUTLINE }),
      new Graphics().rect(-4.5, -6, 9, 1.8).rect(-4.5, 4.2, 9, 1.8).fill(0xdfe5ee),
      new Graphics().circle(0.5, 0, 2).fill(0xffffff),
      new Graphics().rect(-3, -4, 1.2, 8).fill({ color: 0xffffff, alpha: 0.6 }),
    );
    const fuse = new Text({ text: '', style: { fontFamily: 'Fredoka, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffffff, stroke: { color: OUTLINE, width: 3.5 } }, resolution: 3 });
    fuse.label = 'fuse';
    fuse.anchor.set(0.5, 1);
    fuse.position.set(0, -10);
    c.addChild(can, fuse);
    return c;
  }

  /** Placeholder sprite per weapon (vector, reference style). `spin` children rotate with travel. */
  private makeProjectileView(id: string): Container {
    const ink = { width: 1.6, color: OUTLINE };
    const c = new Container();
    const spin = new Container();
    spin.label = 'spin';
    c.addChild(spin);
    const base = id.split('__')[0]!;
    switch (base) {
      case 'fizz_grenade':
        return this.makeCan();
      case 'acorn_mortar': {
        const small = id.endsWith('__bomblet');
        const k = small ? 0.65 : 1;
        spin.addChild(
          new Graphics().ellipse(0, 1.5 * k, 5 * k, 6 * k).fill(0xb8743a).stroke(ink),
          new Graphics().roundRect(-5.5 * k, -5 * k, 11 * k, 4.5 * k, 2).fill(0x7a4a24).stroke(ink),
          new Graphics().rect(-0.8, -7.5 * k, 1.6, 3 * k).fill(0x5a3418),
        );
        break;
      }
      case 'cookie_roller':
        spin.addChild(
          new Graphics().circle(0, 0, 7).fill(0xd9a35c).stroke({ width: 2, color: OUTLINE }),
          new Graphics().circle(-2.5, -2, 1.3).circle(2.8, 1, 1.3).circle(-0.5, 3.2, 1.2).circle(2, -3.5, 1).fill(0x4a2a14),
        );
        break;
      case 'magnet_bomb': {
        // a red horseshoe magnet with silver tips
        const g = new Graphics()
          .moveTo(-6, -6)
          .lineTo(-6, 1)
          .arc(0, 1, 6, Math.PI, 0, true)
          .lineTo(6, -6)
          .lineTo(2.5, -6)
          .lineTo(2.5, 1)
          .arc(0, 1, 2.5, 0, Math.PI, false)
          .lineTo(-2.5, -6)
          .closePath()
          .fill(0xe8364f)
          .stroke({ width: 1.5, color: OUTLINE });
        spin.addChild(g, new Graphics().rect(-6, -6, 3.5, 2.5).rect(2.5, -6, 3.5, 2.5).fill(0xdfe5ee));
        break;
      }
      case 'sprinkle_drop': {
        const cols = [0xff5d8f, 0x3fa9f5, 0xffd23f, 0x6fdc4a, 0x9b59d0];
        spin.addChild(new Graphics().roundRect(-2.5, -7, 5, 14, 2.5).fill(cols[Math.floor(Math.random() * cols.length)]!).stroke(ink));
        break;
      }
      case 'frosting_blaster':
        spin.addChild(
          new Graphics().circle(0, 0, 5).fill(0xfff6f8).stroke(ink),
          new Graphics().circle(1.5, -1.5, 2).fill(0xff9ebb),
        );
        break;
      case 'boomerang_trowel':
        spin.addChild(
          new Graphics().poly([0, -9, 5, 2, 0, 5, -5, 2]).fill(0xc9d3de).stroke(ink),
          new Graphics().roundRect(-1.5, 4, 3, 7, 1.5).fill(0x6fdc4a).stroke({ width: 1.2, color: OUTLINE }),
        );
        break;
      default:
        return this.makeRocket();
    }
    return c;
  }

  private drawProjectiles(alpha: number): void {
    const alive = new Set<number>();
    for (const p of this.state.projectiles) {
      alive.add(p.id);
      const def = this.state.weapons[p.weapon];
      let v = this.projs.get(p.id);
      if (!v) {
        v = this.makeProjectileView(def?.id ?? '');
        this.projs.set(p.id, v);
        this.projLayer.addChild(v);
      }
      const { x, y } = this.lerp(`p${p.id}`, p.x, p.y, alpha);
      v.position.set(x, y);
      const spin = v.getChildByLabel('spin');
      if (p.body) {
        const can = v.getChildByLabel('can');
        if (can) can.rotation += p.vx / 1800;
        if (spin) spin.rotation += p.vx / 1600; // a rolling cookie
        const fuse = v.getChildByLabel('fuse') as Text | null;
        if (fuse) fuse.text = String(Math.max(0, Math.ceil(p.fuse / TICKS_PER_SECOND)));
        if (!p.body.sleeping && Math.random() < 0.35) this.particle(x, y, 0xf2fbff, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, -0.5, 22, 0);
      } else if (def?.behavior === 'boomerang') {
        if (spin) spin.rotation += 0.45;
      } else if (spin) {
        spin.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2;
        if (def?.homingDuration && Math.random() < 0.5) this.particle(x, y, 0xffd23f, 1.5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 12, 0);
      } else {
        v.rotation = Math.atan2(p.vy, p.vx);
        if (Math.random() < 0.6) this.particle(x - Math.cos(v.rotation) * 11, y - Math.sin(v.rotation) * 11, 0xffffff, 2.2 + Math.random() * 2, 0, -0.1, 30, 0);
      }
    }
    for (const [id, v] of this.projs) {
      if (!alive.has(id)) {
        v.destroy({ children: true });
        this.projs.delete(id);
      }
    }
  }

  /** Flames (sim `fires`) and the active Gumling's target marker; redrawn every frame. */
  private drawFiresAndTarget(now: number): void {
    const g = this.flames.clear();
    for (const f of this.state.fires) {
      const x = subToPxFloat(f.x), y = subToPxFloat(f.y);
      const flick = 0.75 + 0.25 * Math.sin(now / 60 + f.id * 1.7);
      const h = (f.landed ? 9 : 6) * flick;
      g.poly([x - 3.5, y + 1, x, y - h, x + 3.5, y + 1]).fill({ color: 0xff7a1c, alpha: 0.9 });
      g.poly([x - 2, y + 1, x, y - h * 0.6, x + 2, y + 1]).fill({ color: 0xffe066, alpha: 0.95 });
    }
    const s = this.state;
    const act = s.characters.find((c) => c.id === s.activeCharacter);
    const w = act ? s.weapons[act.weapon] : undefined;
    if (act && w?.needsTarget && act.hasTarget && (!s.match || s.match.phase === 'turnActive' || s.match.phase === 'retreat')) {
      const x = act.targetX + 0.5, y = act.targetY + 0.5, r = 11 + Math.sin(now / 150) * 1.5;
      g.circle(x, y, r).stroke({ width: 2.5, color: 0xe8364f });
      g.moveTo(x - r - 5, y).lineTo(x - r + 4, y).moveTo(x + r - 4, y).lineTo(x + r + 5, y);
      g.moveTo(x, y - r - 5).lineTo(x, y - r + 4).moveTo(x, y + r - 4).lineTo(x, y + r + 5);
      g.stroke({ width: 2.5, color: 0xe8364f });
    }
  }

  private drawFx(): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.g.alpha = Math.max(0, 1 - ++b.age / 12);
      if (b.age > 12) {
        b.g.destroy();
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age++;
      p.vy += p.grav;
      p.x += p.vx;
      p.y += p.vy;
      p.g.position.set(p.x, p.y);
      p.g.alpha = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) {
        p.g.destroy();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age++;
      const t = r.age / 18;
      r.g.clear();
      r.g.circle(r.x, r.y, r.r * (0.35 + t * 0.75)).fill({ color: 0xfff6d8, alpha: Math.max(0, 0.85 - t) });
      r.g.circle(r.x, r.y, r.r * (0.5 + t * 0.7)).stroke({ width: 3, color: 0xff9f1c, alpha: Math.max(0, 1 - t) });
      if (r.age > 18) {
        r.g.destroy();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      p.age++;
      p.t.y += p.vy;
      p.t.alpha = Math.max(0, 1 - p.age / 80);
      if (p.age === 1) p.t.scale.set(1.4);
      p.t.scale.set(Math.max(1, p.t.scale.x * 0.92));
      if (p.age > 80) {
        p.t.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  /** Radius used by the camera for characters (presentation constant). */
  static readonly CHAR_R = CHAR.radius;
}
