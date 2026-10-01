import { Application } from 'pixi.js';
import { TICKS_PER_SECOND, subToPxFloat, type SimEvent } from '@gumfire/sim';
import { Camera, CameraDirector, type CameraScene } from '@gumfire/render';
import { PROPS, WEAPONS } from '@gumfire/content';
import { Audio } from './audio';
import { Hud } from './hud';
import { Keyboard } from './input';
import { loadMap, type LoadedMap } from './mapLoader';
import { MatchSession } from './session';
import { WorldView } from './world/worldView';

/**
 * GUMFIRE game client — vertical slice (M8): title → hot-seat match → results → rematch.
 * The sim runs at a fixed 50 Hz; rendering interpolates between ticks; the camera director,
 * HUD and audio react to sim events. Nothing here writes to the sim state.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TEAMS = [{ name: 'Mint' }, { name: 'Cherry' }];
const MAP_ID = 'slice-island';

const audio = new Audio();
const keyboard = new Keyboard();
keyboard.enabled = false;

interface Running {
  session: MatchSession;
  view: WorldView;
  hud: Hud;
  camera: Camera;
  director: CameraDirector;
  over: boolean;
  lastTickSecond: number;
}

let app: Application;
let map: LoadedMap | null = null;
let run: Running | null = null;
let seed = (Date.now() >>> 0) % 1_000_000;

function showScreen(id: 'title' | 'results' | null): void {
  $('title').classList.toggle('hidden', id !== 'title');
  $('results').classList.toggle('hidden', id !== 'results');
  $('hud').classList.toggle('hidden', id !== null || run === null);
  keyboard.enabled = id === null;
  if (id !== null) keyboard.clear();
}

function options(): { size: number; turn: number; round: number } {
  return {
    size: Number(($('optSize') as HTMLSelectElement).value),
    turn: Number(($('optTurn') as HTMLSelectElement).value),
    round: Number(($('optRound') as HTMLSelectElement).value),
  };
}

async function startMatch(): Promise<void> {
  audio.unlock();
  $('loading').classList.remove('hidden');
  try {
    map ??= await loadMap(MAP_ID);
  } catch (e) {
    $('error').textContent = String(e instanceof Error ? e.message : e);
    $('error').classList.remove('hidden');
    return;
  } finally {
    $('loading').classList.add('hidden');
  }
  endMatch();
  const o = options();
  seed = (seed * 1103515245 + 12345) >>> 0;
  const session = new MatchSession({
    seed,
    map: map.spec,
    weapons: WEAPONS,
    props: PROPS,
    match: {
      teams: TEAMS.map((t) => ({ name: t.name, size: o.size })),
      ruleset: { turnSeconds: o.turn, roundSeconds: o.round },
    },
  });
  const view = new WorldView(session.state);
  app.stage.addChild(view.root);
  const camera = new Camera(map.spec.width, map.spec.height, { minZoom: 0.55, maxZoom: 2.2, topMargin: 600 });
  camera.setViewport(app.renderer.width / app.renderer.resolution, app.renderer.height / app.renderer.resolution);
  camera.fitWorld();
  camera.zoomAt(1.3 / camera.zoom, camera.viewW / 2, camera.viewH / 2); // close enough to read faces
  const hud = new Hud(session.state, (i) => selectWeapon(i));
  run = { session, view, hud, camera, director: new CameraDirector(), over: false, lastTickSecond: -1 };
  showScreen(null);
}

function endMatch(): void {
  if (!run) return;
  run.view.destroy();
  run = null;
}

function selectWeapon(i: number): void {
  if (!run) return;
  const m = run.session.state.match;
  if (!m || m.phase !== 'turnActive' || m.shotsFired > 0) return;
  run.session.command({ type: 'selectWeapon', index: i });
  audio.play('select');
}

/** Q / E: previous / next selectable weapon. */
function cycleWeapon(dir: number): void {
  if (!run) return;
  const s = run.session.state;
  const act = s.characters.find((c) => c.id === s.activeCharacter);
  const team = act && s.match ? s.match.teams[act.team] : undefined;
  const list = s.weapons.map((w, i) => (w.hidden || team?.ammo[i] === 0 ? -1 : i)).filter((i) => i >= 0);
  if (!act || list.length === 0) return;
  const at = Math.max(0, list.indexOf(act.weapon));
  selectWeapon(list[(at + dir + list.length) % list.length]!);
}

/** A click on the map places the target for targeted weapons. */
function clickWorld(sx: number, sy: number): void {
  if (!run) return;
  const s = run.session.state;
  const act = s.characters.find((c) => c.id === s.activeCharacter);
  const w = act ? s.weapons[act.weapon] : undefined;
  if (!w?.needsTarget || s.match?.phase !== 'turnActive' || (s.match?.shotsFired ?? 0) > 0) return;
  const p = run.camera.screenToWorld(sx, sy);
  run.session.command({ type: 'setTarget', x: Math.round(p.x), y: Math.round(p.y) });
}

function showResults(): void {
  if (!run) return;
  const s = run.session.state, m = s.match!;
  const winner = m.result === 'win' ? m.teams[m.winner]! : null;
  $('resPill').textContent = winner ? 'VICTORY' : 'DRAW';
  $('resTitle').textContent = winner ? `${winner.name} wins!` : 'Everybody popped!';
  const secs = Math.round(s.tick / TICKS_PER_SECOND);
  $('resSub').textContent = `${m.turn} turns · ${Math.floor(secs / 60)} min ${secs % 60} s${m.suddenDeath ? ' · went to sudden death' : ''}`;
  const rows = m.teams
    .map((t) => {
      const st = run!.session.stats[t.id]!;
      const alive = s.characters.filter((c) => c.team === t.id && c.state !== 'dead').length;
      return `<tr><td><b>${t.name}</b></td><td>${alive}/${t.characterIds.length}</td><td>${st.damageTaken}</td><td>${st.shots}</td></tr>`;
    })
    .join('');
  $('resTable').innerHTML = `<tr><th></th><th>STANDING</th><th>DAMAGE TAKEN</th><th>ATTACKS</th></tr>${rows}`;
  showScreen('results');
}

// ------------------------------------------------------------------ sim events → presentation
function onEvents(r: Running, events: SimEvent[]): void {
  const now = performance.now();
  for (const e of events) {
    r.view.onEvent(e);
    switch (e.type) {
      case 'TurnStarted':
        r.director.release();
        r.hud.banner(`${r.session.state.match!.teams[e.team]!.name}: ${r.hud.gumlingName(e.id)}!`);
        audio.play('turn');
        break;
      case 'ProjectileFired':
        r.director.release();
        audio.play(r.session.state.weapons[e.weapon]?.fuseTicks ? 'throw' : 'fire');
        break;
      case 'MeleeSwing':
        audio.play('swing');
        if (e.hits.length) audio.play('thwack');
        break;
      case 'ProjectileBounced':
        audio.play('bounce', e.speed / (256 * 6));
        break;
      case 'Exploded':
        r.director.explosion(e.x, e.y, now);
        audio.play(e.cause === 'death' ? 'pop' : e.radius >= 44 ? 'bigBoom' : 'boom');
        break;
      case 'ProjectileSplashed':
      case 'CharacterEnteredWater':
        audio.play('splash');
        break;
      case 'CharacterJumped':
        audio.play('jump');
        break;
      case 'CharacterLanded':
        if (e.impact > 256 * 3) audio.play('land', e.impact / (256 * 8));
        break;
      case 'CharacterDamaged':
        audio.play('reveal');
        break;
      case 'FuseChanged':
      case 'TargetSet':
      case 'ProjectileCaught':
        audio.play('select');
        break;
      case 'HitscanFired':
        audio.play('snap');
        if (e.hit !== 'none') r.director.explosion(e.x1, e.y1, now);
        break;
      case 'ProjectileStruck':
        audio.play('thwack');
        break;
      case 'FiresSpawned':
        audio.play('sizzle');
        break;
      case 'CrateDropped':
        r.hud.banner(e.kind === 'health' ? 'A candy box is coming!' : 'A surprise box is coming!', 1600);
        audio.play('whistle');
        break;
      case 'CrateCollected':
        audio.play(e.kind === 'health' ? 'reveal' : 'select');
        break;
      case 'MineArmed':
        audio.play('fuse');
        break;
      case 'MineDud':
        audio.play('sizzle');
        break;
      case 'SuddenDeathSoon':
        r.hud.banner(`Sudden death in ${e.seconds} s!`, 2200);
        audio.play('tick');
        break;
      case 'StrikeCalled':
        audio.play('whistle');
        r.director.explosion(e.x, e.y, now + 1200);
        break;
      case 'SuddenDeath':
        r.hud.banner('Sudden death!', 2200);
        audio.play('suddenDeath');
        break;
      case 'RetreatStarted':
        break;
      case 'MatchEnded':
        r.over = true;
        audio.play('victory');
        r.hud.banner(e.result === 'win' ? `${r.session.state.match!.teams[e.winner]!.name} wins!` : 'Draw!', 2500);
        window.setTimeout(showResults, 2600);
        break;
    }
  }
}

// ------------------------------------------------------------------ frame
function frame(): void {
  const r = run;
  if (!r) return;
  const now = performance.now();
  const s = r.session.state;
  let alpha = 1;
  if (!r.session.paused) {
    const adv = r.session.loop.advance(now);
    for (let i = 0; i < adv.steps; i++) {
      r.view.snapshot();
      onEvents(r, r.session.tick(keyboard.frame()));
    }
    alpha = adv.alpha;
  }
  // last-5-seconds tick
  const m = s.match!;
  if (m.phase === 'turnActive') {
    const sec = Math.ceil(m.turnTicksLeft / TICKS_PER_SECOND);
    if (sec !== r.lastTickSecond && sec <= 5 && sec > 0) audio.play('tick');
    r.lastTickSecond = sec;
  }
  // camera
  const scene: CameraScene = {
    projectiles: s.projectiles.map((p) => ({ x: subToPxFloat(p.x), y: subToPxFloat(p.y), vx: subToPxFloat(p.vx), vy: subToPxFloat(p.vy) })),
    flyers: s.characters
      .filter((c) => c.state === 'air')
      .map((c) => ({ x: subToPxFloat(c.body.x), y: subToPxFloat(c.body.y), speed: Math.hypot(subToPxFloat(c.body.vx), subToPxFloat(c.body.vy)) })),
    active: (() => {
      const a = s.characters.find((c) => c.id === s.activeCharacter && c.state !== 'dead');
      return a ? { x: subToPxFloat(a.body.x), y: subToPxFloat(a.body.y) - 30 } : null;
    })(),
  };
  r.director.update(r.camera, scene, now, app.ticker.deltaMS);
  r.view.update(r.camera, alpha, now, { pending: false });
  r.hud.update();
}

// ------------------------------------------------------------------ boot
async function main(): Promise<void> {
  app = new Application();
  await app.init({ resizeTo: window, background: 0x98e4fc, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
  $('stage').appendChild(app.canvas);
  app.ticker.add(frame);
  window.addEventListener('resize', () => run?.camera.setViewport(window.innerWidth, window.innerHeight));

  $('startBtn').addEventListener('click', () => void startMatch());
  $('rematchBtn').addEventListener('click', () => void startMatch());
  $('menuBtn').addEventListener('click', () => {
    endMatch();
    showScreen('title');
  });
  $('helpBtn').addEventListener('click', () => $('help').classList.toggle('hidden'));
  $('muteBtn').addEventListener('click', () => ($('muteBtn').textContent = audio.toggleMute() ? '✕' : '♪'));
  $('followBtn').addEventListener('click', () => run?.director.release());

  window.addEventListener('keydown', (e) => {
    if (!run || run.over || !keyboard.enabled) return;
    if (e.code === 'KeyQ') cycleWeapon(-1);
    if (e.code === 'KeyE') cycleWeapon(1);
    if (e.code === 'KeyF') run.director.release();
    if (e.code === 'KeyM') $('muteBtn').textContent = audio.toggleMute() ? '✕' : '♪';
    if (e.code === 'KeyH') $('help').classList.toggle('hidden');
    if (e.code === 'KeyP') {
      run.session.paused = !run.session.paused;
      run.session.loop.reset();
      run.hud.banner(run.session.paused ? 'Paused' : 'Go!', run.session.paused ? 100000 : 600);
    }
    if (e.code === 'KeyV' && e.ctrlKey && e.shiftKey) {
      const v = run.session.verify();
      run.hud.banner(v.ok ? `Replay OK (${v.ticks} ticks)` : 'Replay MISMATCH', 2000);
    }
  });

  // camera: drag to pan (hands control to the player), wheel to zoom
  const canvas = app.canvas;
  let drag: { x: number; y: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !run) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 5) run.director.takeManual();
    if (run.director.isManual) run.camera.panByScreen(dx, dy);
    drag = { x: e.clientX, y: e.clientY, moved: drag.moved };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && drag.moved <= 5) clickWorld(e.clientX, e.clientY);
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => (drag = null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!run) return;
      e.preventDefault();
      run.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // debug hook for automated browser checks
  (globalThis as Record<string, unknown>).__gumfire = {
    state: () => run?.session.state ?? null,
    start: () => startMatch(),
    worldToScreen: (x: number, y: number) => run?.camera.worldToScreen(x, y),
    look: (x: number, y: number, zoom = 1.6) => {
      if (!run) return;
      run.director.takeManual();
      run.camera.zoomAt(zoom / run.camera.zoom, run.camera.viewW / 2, run.camera.viewH / 2);
      run.camera.centerOn(x, y);
    },
  };
  showScreen('title');
}

void main();
