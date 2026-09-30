import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  Btn,
  CHAR,
  Mat,
  charPx,
  charPy,
  TICK_MS,
  TICKS_PER_SECOND,
  MAX_COMMANDS_PER_TICK,
  countSolid,
  createGame,
  getMat,
  hashHex,
  hashState,
  hashTerrain,
  markDirtyRect,
  runReplay,
  step,
  subToPxFloat,
  type Body,
  type Character,
  type GameConfig,
  type GameState,
  type InputFrame,
  type SimCommand,
  type SimEvent,
  type TimedCommand,
} from '@gumfire/sim';
import { BIRTHDAY_THEME, Camera, TerrainView, WaterView } from '@gumfire/render';
import { FixedStepLoop } from './fixedStepLoop';
import { loadMap, loadMapIndex, type LoadedMap } from './mapLoader';

/**
 * Technical sandbox for the deterministic simulation.
 * - Fixed 50 Hz sim with render interpolation, input + command recording, replay verification.
 * - Terrain from PNG masks (M1), destruction tools (M2), physics bodies (M3),
 *   playable characters (M4): keyboard input is recorded as per-tick input frames.
 * Every tool action becomes a recorded sim command, so "Verify" replays the session exactly.
 */

const TEAM_COLOURS = [0x8fd14f, 0xe8364f, 0x3fa9f5, 0x9b59d0, 0xff9f1c, 0x3a3a44];
const OUTLINE = 0x1a1320;
const SKY = 0xf6d9e3;
const MAT_NAMES: Record<number, string> = { [Mat.AIR]: 'air', [Mat.SOIL]: 'soil', [Mat.ROCK]: 'rock', [Mat.GIRDER]: 'girder', [Mat.BORDER]: 'border' };
const BODY_RADIUS = 9;
/** Throw strength: px/tick of launch speed per px of slingshot drag. */
const THROW_PER_PX = 0.08;
/** Commands fed per tick from the queue (stress tests enqueue hundreds). */
const CMDS_PER_TICK = 10;

type Tool = 'char' | 'body' | 'crater';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- sim session state
let config: GameConfig = { seed: 20260930 };
let state: GameState = createGame(config);
let recorded: InputFrame[] = [];
let recordedCmds: TimedCommand[] = [];
let pendingCmds: SimCommand[] = [];
let tool: Tool = 'char';
let followActive = true;
let lastJump = '—';
let carveR = 48;
let craters = 0;
let impacts = 0;
let drowned = 0;
let lost = 0;
let worstStepMs = 0;
let worstStepDecay = 0;
/** Previous-tick positions for interpolation, keyed 'b<id>' (bodies) / 'c<id>' (characters). */
let prevPos = new Map<string, { x: number; y: number }>();
let paused = false;
let interpolate = true;
let singleStep = false;
let stepTimeAvg = 0;
let lastSteps = 0;
let loadedMap: LoadedMap | null = null;
/** True while a map loads: the old state must not keep ticking into the new recording. */
let loading = false;
let onEvents: (events: SimEvent[]) => void = () => {};

const loop = new FixedStepLoop(TICK_MS, 5);
const held = new Set<string>();
/**
 * Presses not yet delivered to the sim, per key. Every press reaches the sim as its own edge:
 * a tap shorter than a tick still shows up for one tick, and two presses that arrive between
 * the same pair of ticks (low fps, a stalled frame) are delivered on separate ticks with a
 * released tick in between — so a quick double-tap is never merged into one press.
 */
const pendingPresses = new Map<string, number>();
let deliveredLastTick = new Set<string>();
let deliveredThisTick = new Set<string>();
function down(code: string): boolean {
  const n = pendingPresses.get(code) ?? 0;
  if (n > 0) {
    if (deliveredLastTick.has(code)) return false; // insert a released tick → a new edge
    pendingPresses.set(code, n - 1);
    deliveredThisTick.add(code);
    return true;
  }
  if (held.has(code)) {
    deliveredThisTick.add(code);
    return true;
  }
  return false;
}

/** Keyboard → input frame for the active character. Arrows move/aim, Enter jumps. */
function currentInput(): InputFrame {
  deliveredThisTick = new Set<string>();
  let f = 0;
  if (down('ArrowLeft')) f |= Btn.Left;
  if (down('ArrowRight')) f |= Btn.Right;
  if (down('ArrowUp')) f |= Btn.Up;
  if (down('ArrowDown')) f |= Btn.Down;
  if (down('Enter') || down('NumpadEnter')) f |= Btn.Jump;
  deliveredLastTick = deliveredThisTick;
  return f;
}

function simTick(): void {
  prevPos = new Map<string, { x: number; y: number }>();
  for (const b of state.bodies) prevPos.set(`b${b.id}`, { x: b.x, y: b.y });
  for (const c of state.characters) prevPos.set(`c${c.id}`, { x: c.body.x, y: c.body.y });
  const input = currentInput();
  if (input) followActive = true;
  recorded.push(input);
  const batch = pendingCmds.splice(0, Math.min(CMDS_PER_TICK, MAX_COMMANDS_PER_TICK));
  for (const cmd of batch) recordedCmds.push({ tick: state.tick + 1, cmd });
  const t0 = performance.now();
  const events = step(state, input, batch);
  const ms = performance.now() - t0;
  stepTimeAvg = stepTimeAvg * 0.95 + ms * 0.05;
  if (ms > worstStepMs) {
    worstStepMs = ms;
    worstStepDecay = 150;
  } else if (--worstStepDecay <= 0) worstStepMs = ms;
  onEvents(events);
}

function verify(): void {
  const t0 = performance.now();
  const replay = runReplay({ config, inputs: recorded, commands: recordedCmds });
  const ms = performance.now() - t0;
  const live = hashState(state);
  const ok = replay.finalHash === live && replay.state.tick === state.tick;
  const v = $('verdict');
  v.className = ok ? 'ok' : 'bad';
  v.textContent = ok
    ? `✓ ${state.tick} ticks, ${recordedCmds.length} commands replayed headless in ${ms.toFixed(1)} ms — hash ${hashHex(live)} matches`
    : `✗ DESYNC: live ${hashHex(live)} vs replay ${hashHex(replay.finalHash)}`;
}

// ---------------------------------------------------------------- body views
interface BodyView {
  root: Container;
  eyesOpen: Graphics;
  eyesShut: Graphics;
  squash: number;
}

function makeBodyView(colour: number, r: number): BodyView {
  const root = new Container();
  const body = new Graphics()
    .roundRect(-r, -r * 1.1, r * 2, r * 2.1, r)
    .fill({ color: colour, alpha: 0.93 })
    .stroke({ width: 2, color: OUTLINE });
  const shine = new Graphics().ellipse(-r * 0.45, -r * 0.55, r * 0.2, r * 0.36).fill({ color: 0xffffff, alpha: 0.5 });
  const eyesOpen = new Graphics().circle(-r * 0.3, -r * 0.3, r * 0.17).circle(r * 0.3, -r * 0.3, r * 0.17).fill(OUTLINE);
  const eyesShut = new Graphics()
    .moveTo(-r * 0.45, -r * 0.3)
    .lineTo(-r * 0.15, -r * 0.3)
    .moveTo(r * 0.15, -r * 0.3)
    .lineTo(r * 0.45, -r * 0.3)
    .stroke({ width: 1.6, color: OUTLINE });
  eyesShut.visible = false;
  root.addChild(body, shine, eyesOpen, eyesShut);
  return { root, eyesOpen, eyesShut, squash: 0 };
}

interface CharView {
  root: Container;
  body: Container;
  eyes: Graphics;
  label: Text;
  marker: Graphics;
  squash: number;
}

function makeCharView(colour: number): CharView {
  const r = CHAR.radius;
  const root = new Container();
  const body = new Container();
  const blob = new Graphics()
    .roundRect(-r - 1, -r * 1.35, (r + 1) * 2, r * 2.35, r)
    .fill({ color: colour, alpha: 0.95 })
    .stroke({ width: 2, color: OUTLINE });
  const shine = new Graphics().ellipse(-r * 0.5, -r * 0.75, r * 0.2, r * 0.4).fill({ color: 0xffffff, alpha: 0.55 });
  const eyes = new Graphics();
  body.addChild(blob, shine, eyes);
  // pivot at the feet so squash/stretch keeps them on the ground
  body.pivot.set(0, r);
  body.position.set(0, r);
  const label = new Text({ text: '', style: { fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: '700', fill: colour, stroke: { color: OUTLINE, width: 3 } } });
  label.anchor.set(0.5, 1);
  label.position.set(0, -r - 8);
  const marker = new Graphics().poly([-5, 0, 5, 0, 0, 7]).fill(0xffffff).stroke({ width: 1.5, color: OUTLINE });
  marker.visible = false;
  root.addChild(body, label, marker);
  return { root, body, eyes, label, marker, squash: 0 };
}

function drawEyes(g: Graphics, facing: number, mode: 'open' | 'squint' | 'x'): void {
  const r = CHAR.radius;
  const ex = facing * r * 0.18, ey = -r * 0.55;
  g.clear();
  if (mode === 'x') {
    for (const dx of [-r * 0.3, r * 0.3]) {
      g.moveTo(ex + dx - 2, ey - 2).lineTo(ex + dx + 2, ey + 2).moveTo(ex + dx + 2, ey - 2).lineTo(ex + dx - 2, ey + 2);
    }
    g.stroke({ width: 1.5, color: OUTLINE });
    return;
  }
  const h = mode === 'squint' ? 0.8 : 2.1;
  g.ellipse(ex - r * 0.3, ey, 1.8, h).ellipse(ex + r * 0.3, ey, 1.8, h).fill(OUTLINE);
}

function viewSize(): { w: number; h: number } {
  const w = Math.max(320, Math.min(window.innerWidth - 32, 1600));
  const h = Math.max(300, Math.min(window.innerHeight - 190, Math.round(w * 0.5625), 800));
  return { w, h };
}

/** Debug hook for automated browser checks (sandbox only). */
(globalThis as Record<string, unknown>).__sandbox = {
  recorded: () => recorded,
  state: () => state,
};

async function main(): Promise<void> {
  const app = new Application();
  const size = viewSize();
  await app.init({ width: size.w, height: size.h, background: SKY, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
  $('stage').appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  let terrainView: TerrainView | null = null;
  let waterView: WaterView | null = null;
  const bodyLayer = new Container();
  const charLayer = new Container();
  const fxLayer = new Container();
  const views = new Map<number, BodyView>();
  const charViews = new Map<number, CharView>();
  const reticle = new Graphics();
  const popups: Array<{ t: Text; age: number }> = [];
  const preview = new Graphics();
  const camera = new Camera(1920, 696);
  camera.setViewport(size.w, size.h);
  let cursorWorld: { x: number; y: number } | null = null;

  onEvents = (events) => {
    for (const e of events) {
      switch (e.type) {
        case 'TerrainChanged':
          terrainView?.invalidateRect(e.x0, e.y0, e.x1, e.y1);
          if (e.cause === 'carve') craters++;
          break;
        case 'BodyImpact': {
          impacts++;
          const v = views.get(e.id);
          if (v) v.squash = Math.min(1, e.speed / (256 * 8));
          break;
        }
        case 'BodyRemoved':
          if (e.reason === 'drowned') drowned++;
          else lost++;
          break;
        case 'CharacterJumped':
          lastJump = e.kind;
          break;
        case 'CharacterLanded': {
          const v = charViews.get(e.id);
          if (v) v.squash = Math.min(1, 0.25 + e.impact / (256 * 10));
          break;
        }
        case 'CharacterDamaged': {
          const c = state.characters.find((x) => x.id === e.id);
          if (!c) break;
          const t = new Text({ text: `-${e.amount}`, style: { fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: '800', fill: 0xffffff, stroke: { color: 0xe8364f, width: 4 } } });
          t.anchor.set(0.5);
          t.position.set(subToPxFloat(c.body.x), subToPxFloat(c.body.y) - 30);
          fxLayer.addChild(t);
          popups.push({ t, age: 0 });
          break;
        }
        case 'CharacterDied':
          if (e.id === state.activeCharacter) selectNext();
          break;
      }
    }
  };

  function clearScene(): void {
    terrainView?.destroy();
    waterView?.destroy();
    terrainView = null;
    waterView = null;
    for (const v of views.values()) v.root.destroy({ children: true });
    views.clear();
    for (const v of charViews.values()) v.root.destroy({ children: true });
    charViews.clear();
    for (const p of popups) p.t.destroy();
    popups.length = 0;
    world.removeChildren();
    prevPos.clear();
    recorded = [];
    recordedCmds = [];
    pendingCmds = [];
    craters = impacts = drowned = lost = 0;
    worstStepMs = 0;
    loop.reset();
    $('verdict').textContent = '';
    $('error').textContent = '';
  }

  function buildMap(m: LoadedMap): void {
    config = { seed: config.seed, map: m.spec };
    state = createGame(config);
    // The recording starts together with the new state.
    recorded = [];
    recordedCmds = [];
    pendingCmds = [];
    prevPos.clear();
    loop.reset();
    const t = state.terrain!;
    terrainView = new TerrainView(t, BIRTHDAY_THEME);
    waterView = new WaterView(t.width, t.height, state.waterY);
    // bodies are drawn behind the water so sinking Gumlings disappear into the cocoa
    world.addChild(terrainView.container, bodyLayer, charLayer, reticle, waterView.container, fxLayer, preview);
    camera.setWorld(t.width, t.height);
    camera.fitWorld();
    updateKeysHelp();
  }

  function updateKeysHelp(): void {
    const names: Record<Tool, string> = { char: 'Gumling (C)', body: 'candy ball (E)', crater: 'crater (Q)' };
    const how: Record<Tool, string> = {
      char: 'click: place a Gumling (next team)',
      body: 'click: drop · drag: slingshot throw',
      crater: 'click: crater · [ ]: size',
    };
    $('keys').innerHTML =
      `<b>Play:</b> ←/→ walk · ↑/↓ aim · Enter jump · Enter×2 backflip · Tab next Gumling<br>` +
      `Tool: <b>${names[tool]}</b> — ${how[tool]} · Shift+click girder · right-drag tunnel · N 50 balls · B 200 craters<br>` +
      'Middle-drag / WASD pan · wheel zoom · F fit · L follow · V verify · R restart · P pause · . step';
  }

  /** Give control to the next living character (recorded as a command). */
  function selectNext(): void {
    const alive = state.characters.filter((c) => c.state !== 'dead');
    if (alive.length === 0) {
      pendingCmds.push({ type: 'debugSelect', id: 0 });
      return;
    }
    const i = alive.findIndex((c) => c.id === state.activeCharacter);
    pendingCmds.push({ type: 'debugSelect', id: alive[(i + 1) % alive.length]!.id });
    followActive = true;
  }

  let loadSeq = 0;
  async function loadScene(id: string): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    clearScene();
    try {
      const m = await loadMap(id);
      if (seq !== loadSeq) return; // a newer load superseded this one
      loadedMap = m;
      buildMap(m);
    } catch (e) {
      $('error').textContent = String(e instanceof Error ? e.message : e);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  let sceneId = '';
  function restart(): void {
    config = { ...config, seed: (config.seed + 1) >>> 0 };
    void loadScene(sceneId);
  }

  // ---------------------------------------------------------------- scene picker
  const select = $('scene') as HTMLSelectElement;
  const ids = await loadMapIndex().catch(() => [] as string[]);
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    select.appendChild(o);
  }
  select.onchange = () => {
    sceneId = select.value;
    void loadScene(sceneId);
  };
  sceneId = ids[0] ?? '';
  select.value = sceneId;
  if (sceneId) await loadScene(sceneId);
  else $('error').textContent = 'No maps found in /maps/index.json';

  // ---------------------------------------------------------------- input
  const togglePause = () => {
    paused = !paused;
    loop.reset();
    $('pause').textContent = paused ? 'Resume (P)' : 'Pause (P)';
  };
  $('pause').onclick = togglePause;
  $('stepOnce').onclick = () => (singleStep = true);
  $('verify').onclick = () => !loading && verify();
  $('restart').onclick = restart;

  const ready = () => terrainView !== null && state.terrain !== null;
  const centre = () => ({ x: camera.viewW / 2, y: camera.viewH / 2 });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab'].includes(e.code)) e.preventDefault();
    held.add(e.code);
    if (!e.repeat) pendingPresses.set(e.code, (pendingPresses.get(e.code) ?? 0) + 1);
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'Period') singleStep = true;
    if (e.code === 'KeyV' && !loading) verify();
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyI') interpolate = !interpolate;
    if (!ready()) return;
    const t = state.terrain!;
    if (e.code === 'KeyC') tool = 'char';
    if (e.code === 'KeyE') tool = 'body';
    if (e.code === 'KeyQ') tool = 'crater';
    if (e.code === 'KeyE' || e.code === 'KeyQ' || e.code === 'KeyC') updateKeysHelp();
    if (e.code === 'Tab' && !e.repeat) selectNext();
    if (e.code === 'KeyL') followActive = !followActive;
    if (e.code === 'KeyF') {
      camera.fitWorld();
      followActive = false;
    }
    if (e.code === 'Digit1') camera.zoomAt(1 / camera.zoom, centre().x, centre().y);
    if (e.code === 'Equal' || e.code === 'NumpadAdd') camera.zoomAt(1.25, centre().x, centre().y);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') camera.zoomAt(0.8, centre().x, centre().y);
    if (e.code === 'KeyU') markDirtyRect(t, 0, 0, t.width - 1, t.height - 1);
    if (e.code === 'BracketLeft') carveR = Math.max(4, carveR - 4);
    if (e.code === 'BracketRight') carveR = Math.min(160, carveR + 4);
    // Stress tests use Math.random on purpose: the resulting commands are recorded, so the
    // replay is still exact.
    if (e.code === 'KeyB') {
      for (let k = 0; k < 200; k++) {
        pendingCmds.push({ type: 'debugCarve', x: Math.floor(Math.random() * t.width), y: Math.floor(t.height * 0.35 + Math.random() * t.height * 0.6), r: 20 + Math.floor(Math.random() * 50) });
      }
    }
    if (e.code === 'KeyN') {
      for (let k = 0; k < 50; k++) {
        pendingCmds.push({
          type: 'debugSpawn',
          x: Math.floor(40 + Math.random() * (t.width - 80)),
          y: Math.floor(20 + Math.random() * 160),
          vx: Math.round((Math.random() - 0.5) * 1200),
          vy: 0,
          r: BODY_RADIUS,
        });
      }
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => {
    held.clear();
    pendingPresses.clear();
  });

  // Pointer. Canvas CSS size may differ from its logical size.
  const canvas = app.canvas;
  const toView = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * camera.viewW, y: ((e.clientY - r.top) / r.height) * camera.viewH };
  };
  const DRAG_THRESHOLD = 5;
  interface Press {
    x: number;
    y: number;
    id: number;
    button: number;
    shift: boolean;
    dragging: boolean;
    world: { x: number; y: number };
  }
  let press: Press | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!ready()) return;
    const p = toView(e);
    press = { ...p, id: e.pointerId, button: e.button, shift: e.shiftKey, dragging: false, world: camera.screenToWorld(p.x, p.y) };
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toView(e);
    cursorWorld = camera.screenToWorld(p.x, p.y);
    if (!press || press.id !== e.pointerId) return;
    if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > DRAG_THRESHOLD) press.dragging = true;
    const pans = press.button === 1 || (press.button === 0 && tool === 'crater' && !press.shift);
    if (press.dragging && pans) {
      followActive = false;
      canvas.classList.add('dragging');
      camera.panByScreen(p.x - press.x, p.y - press.y);
      press.x = p.x;
      press.y = p.y;
    }
  });
  const endPress = (e: PointerEvent, cancelled: boolean) => {
    if (!press || press.id !== e.pointerId) return;
    const pr = press;
    press = null;
    canvas.classList.remove('dragging');
    if (cancelled || pr.button === 1) return;
    const w = camera.screenToWorld(toView(e).x, toView(e).y);
    const wx = Math.floor(w.x), wy = Math.floor(w.y);
    const sx = Math.floor(pr.world.x), sy = Math.floor(pr.world.y);
    if (pr.button === 2) {
      if (Math.abs(wx - sx) <= 2048 && Math.abs(wy - sy) <= 2048) pendingCmds.push({ type: 'debugTunnel', x0: sx, y0: sy, x1: wx, y1: wy, r: 10 });
      return;
    }
    if (pr.button !== 0) return;
    if (pr.shift) {
      if (!pr.dragging) pendingCmds.push({ type: 'debugGirder', x: wx - 48, y: wy - 6, w: 96, h: 12 });
      return;
    }
    if (tool === 'crater') {
      if (!pr.dragging) pendingCmds.push({ type: 'debugCarve', x: wx, y: wy, r: carveR });
      return;
    }
    if (tool === 'char') {
      if (pr.dragging) return;
      // ids are assigned in order, so the new Gumling's id (and team colour) is predictable
      const newId = state.nextCharacterId + pendingCmds.filter((c) => c.type === 'debugSpawnCharacter').length;
      const team = (newId - 1) % TEAM_COLOURS.length;
      pendingCmds.push({ type: 'debugSpawnCharacter', x: wx, y: wy, team });
      if (state.activeCharacter === 0) pendingCmds.push({ type: 'debugSelect', id: newId });
      followActive = true;
      if (camera.zoom < 1) camera.zoomAt(1 / camera.zoom, camera.viewW / 2, camera.viewH / 2);
      return;
    }
    // Gumling: click drops, drag throws from the press point (slingshot: pull back to aim).
    const clampV = (v: number) => Math.max(-8192, Math.min(8192, Math.round(v)));
    const vx = pr.dragging ? clampV((sx - wx) * THROW_PER_PX * 256) : 0;
    const vy = pr.dragging ? clampV((sy - wy) * THROW_PER_PX * 256) : 0;
    pendingCmds.push({ type: 'debugSpawn', x: sx, y: sy, vx, vy, r: BODY_RADIUS });
  };
  canvas.addEventListener('pointerup', (e) => endPress(e, false));
  canvas.addEventListener('pointercancel', (e) => endPress(e, true));
  canvas.addEventListener('pointerleave', () => (cursorWorld = null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!ready()) return;
      e.preventDefault();
      const p = toView(e);
      camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    },
    { passive: false },
  );

  window.addEventListener('resize', () => {
    const s = viewSize();
    app.renderer.resize(s.w, s.h);
    camera.setViewport(s.w, s.h);
  });

  // ---------------------------------------------------------------- frame
  let fps = 60;
  let uploadsLast = 0;
  app.ticker.add((ticker) => {
    fps = fps * 0.95 + (1000 / Math.max(1, ticker.deltaMS)) * 0.05;
    let alpha = 1;
    if (loading) {
      lastSteps = 0;
    } else if (paused) {
      if (singleStep) simTick();
      lastSteps = singleStep ? 1 : 0;
    } else {
      const adv = loop.advance(performance.now());
      for (let i = 0; i < adv.steps; i++) simTick();
      lastSteps = adv.steps;
      alpha = adv.alpha;
    }
    singleStep = false;
    if (!interpolate) alpha = 1;

    if (ready()) {
      const sp = 14;
      const dx = (held.has('KeyA') ? sp : 0) - (held.has('KeyD') ? sp : 0);
      const dy = (held.has('KeyW') ? sp : 0) - (held.has('KeyS') ? sp : 0);
      if (dx || dy) {
        camera.panByScreen(dx, dy);
        followActive = false;
      }
      // follow the active character (presentation only; M8 brings the full camera rules)
      const act = state.characters.find((c) => c.id === state.activeCharacter);
      if (followActive && act && act.state !== 'dead') {
        const tx = subToPxFloat(act.body.x), ty = subToPxFloat(act.body.y);
        camera.centerOn(camera.x + (tx - camera.x) * 0.12, camera.y + (ty - camera.y) * 0.12);
      }
    }

    const tr = camera.transform();
    world.scale.set(tr.scale);
    world.position.set(tr.x, tr.y);

    if (terrainView) uploadsLast = terrainView.update();
    waterView?.update(performance.now());
    drawBodies(alpha);
    drawCharacters(alpha);
    drawPopups();
    drawPreview();
    drawHud();
  });

  function drawBodies(alpha: number): void {
    const alive = new Set<number>();
    for (const b of state.bodies) {
      alive.add(b.id);
      let v = views.get(b.id);
      if (!v) {
        v = makeBodyView(TEAM_COLOURS[(b.id - 1) % TEAM_COLOURS.length]!, b.radius);
        views.set(b.id, v);
        bodyLayer.addChild(v.root);
      }
      const p = prevPos.get(`b${b.id}`) ?? b;
      v.root.x = subToPxFloat(p.x + (b.x - p.x) * alpha);
      v.root.y = subToPxFloat(p.y + (b.y - p.y) * alpha);
      // squash on impact, stretch with vertical speed (presentation only)
      v.squash *= 0.85;
      const stretch = Math.min(0.18, Math.abs(subToPxFloat(b.vy)) / 60);
      v.root.scale.set(1 + v.squash * 0.35 - stretch * 0.5, 1 - v.squash * 0.35 + stretch);
      v.eyesOpen.visible = !b.sleeping;
      v.eyesShut.visible = b.sleeping;
      v.root.alpha = b.drownTicks > 0 ? Math.max(0, 1 - b.drownTicks / 75) : 1;
    }
    for (const [id, v] of views) {
      if (!alive.has(id)) {
        v.root.destroy({ children: true });
        views.delete(id);
      }
    }
  }

  function drawCharacters(alpha: number): void {
    const alive = new Set<number>();
    reticle.clear();
    const now = performance.now();
    for (const c of state.characters) {
      alive.add(c.id);
      let v = charViews.get(c.id);
      if (!v) {
        v = makeCharView(TEAM_COLOURS[c.team % TEAM_COLOURS.length]!);
        charViews.set(c.id, v);
        charLayer.addChild(v.root);
      }
      const p = prevPos.get(`c${c.id}`) ?? { x: c.body.x, y: c.body.y };
      const x = subToPxFloat(p.x + (c.body.x - p.x) * alpha);
      const y = subToPxFloat(p.y + (c.body.y - p.y) * alpha);
      v.root.position.set(x, y);
      v.root.visible = c.state !== 'dead';
      v.root.alpha = c.state === 'drowning' ? Math.max(0, 1 - c.body.drownTicks / 75) : 1;
      // squash: landing / jump crouch; stretch while flying
      v.squash *= 0.82;
      let sx = 1, sy = 1;
      if (c.state === 'jumpPrep') {
        sy = 0.8;
        sx = 1.15;
      } else if (c.state === 'air') {
        const st = Math.min(0.2, Math.abs(subToPxFloat(c.body.vy)) / 40);
        sy = 1 + st;
        sx = 1 - st * 0.5;
      }
      sy -= v.squash * 0.3;
      sx += v.squash * 0.3;
      if (c.state === 'walk') sy += Math.sin(c.stateTicks * 0.9) * 0.04;
      v.body.scale.set(sx * c.facing, sy);
      drawEyes(v.eyes, 1, c.state === 'drowning' ? 'x' : c.state === 'landing' ? 'squint' : 'open');
      const active = c.id === state.activeCharacter;
      v.label.text = `${c.hp}`;
      v.marker.visible = active && c.state !== 'dead';
      v.marker.position.set(0, -CHAR.radius - 30 + Math.sin(now * 0.006) * 3);
      if (active && (c.state === 'idle' || c.state === 'walk' || c.state === 'jumpPrep')) {
        // aim angle is relative to facing: 0 = forward, positive = up
        const a = (c.aim / 4096) * 2 * Math.PI; // angle units → radians (sign kept)
        const rx = x + Math.cos(a) * 38 * c.facing, ry = y - Math.sin(a) * 38;
        reticle.circle(rx, ry, 5).stroke({ width: 2, color: 0xe8364f }).circle(rx, ry, 1.5).fill(0xe8364f);
      }
    }
    for (const [id, v] of charViews) {
      if (!alive.has(id)) {
        v.root.destroy({ children: true });
        charViews.delete(id);
      }
    }
  }

  function drawPopups(): void {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]!;
      p.age++;
      p.t.y -= 0.6;
      p.t.alpha = Math.max(0, 1 - p.age / 70);
      if (p.age > 70) {
        p.t.destroy();
        popups.splice(i, 1);
      }
    }
  }

  function drawPreview(): void {
    preview.clear();
    if (!ready() || !cursorWorld) return;
    const lw = 1.5 / camera.zoom;
    const ink = { color: OUTLINE, alpha: 0.75, width: lw };
    if (press && press.button === 2) {
      preview.moveTo(press.world.x, press.world.y).lineTo(cursorWorld.x, cursorWorld.y).stroke({ width: 20, color: OUTLINE, alpha: 0.25, cap: 'round' });
    } else if (held.has('ShiftLeft') || held.has('ShiftRight')) {
      preview.rect(Math.floor(cursorWorld.x) - 48, Math.floor(cursorWorld.y) - 6, 96, 12).stroke(ink);
    } else if (tool === 'crater') {
      preview.circle(cursorWorld.x, cursorWorld.y, carveR).stroke(ink);
    } else if (tool === 'char') {
      preview.roundRect(cursorWorld.x - CHAR.radius, cursorWorld.y - CHAR.radius * 1.3, CHAR.radius * 2, CHAR.radius * 2.3, CHAR.radius).stroke(ink);
    } else if (press && press.button === 0 && press.dragging) {
      // slingshot: band from the launch point to the cursor, arrow the other way
      const { x: sx, y: sy } = press.world;
      const ax = sx + (sx - cursorWorld.x), ay = sy + (sy - cursorWorld.y);
      preview.moveTo(cursorWorld.x, cursorWorld.y).lineTo(sx, sy).stroke({ width: 2 * lw, color: OUTLINE, alpha: 0.4 });
      preview.moveTo(sx, sy).lineTo(ax, ay).stroke({ width: 2 * lw, color: 0xe8364f, alpha: 0.9 });
      preview.circle(sx, sy, BODY_RADIUS).stroke(ink);
    } else {
      preview.circle(cursorWorld.x, cursorWorld.y, BODY_RADIUS).stroke(ink);
    }
  }

  function drawHud(): void {
    const hud: string[] = [
      `tick <b>${state.tick}</b>`,
      `sim time <b>${(state.tick / TICKS_PER_SECOND).toFixed(2)} s</b>`,
      `hash <b>${hashHex(hashState(state))}</b>`,
      `seed <b>${config.seed}</b>`,
      `fps <b>${fps.toFixed(0)}</b>`,
      `steps/frame <b>${lastSteps}</b>`,
      `step cost <b>${(stepTimeAvg * 1000).toFixed(1)} µs</b>`,
      `worst step <b>${worstStepMs.toFixed(2)} ms</b>`,
    ];
    const t = state.terrain;
    if (t && terrainView && loadedMap) {
      const bs: Body[] = state.bodies;
      const asleep = bs.filter((b) => b.sleeping).length;
      const sinking = bs.filter((b) => b.drownTicks > 0).length;
      const c = cursorWorld;
      const cx = c ? Math.floor(c.x) : null;
      const cy = c ? Math.floor(c.y) : null;
      const act: Character | undefined = state.characters.find((c) => c.id === state.activeCharacter);
      if (act) {
        hud.push(
          `Gumling <b>#${act.id}</b> · <b>${act.state}</b>`,
          `hp <b>${act.hp}</b> · facing <b>${act.facing > 0 ? '→' : '←'}</b> · last jump <b>${lastJump}</b>`,
          `aim <b>${Math.round((act.aim * 360) / 4096)}°</b>`,
          `pos <b>${charPx(act)}, ${charPy(act)}</b> · last impact <b>${(act.lastImpact / 256).toFixed(1)} px/t</b>`,
        );
      } else hud.push('Gumling <b>— press C and click to place one</b>');
      hud.push(
        `bodies <b>${bs.length}</b> · asleep <b>${asleep}</b> · sinking <b>${sinking}</b>`,
        `impacts <b>${impacts}</b> · drowned <b>${drowned}</b> · lost <b>${lost}</b>`,
        `zoom <b>${Math.round(camera.zoom * 100)}%</b>`,
        `map <b>${t.width}×${t.height}</b> · water y <b>${state.waterY}</b>`,
        `solid px <b>${countSolid(t).toLocaleString('en')}</b>`,
        `terrain hash <b>${hashHex(hashTerrain(t))}</b> · v <b>${t.version}</b>`,
        `uploads <b>${uploadsLast}</b> · queued <b>${terrainView.pendingUploads}</b> · cmds <b>${pendingCmds.length}</b>`,
        `crater r <b>${carveR}</b> · craters <b>${craters}</b>`,
        cx !== null && cy !== null ? `cursor <b>${cx}, ${cy}</b> <b>${MAT_NAMES[getMat(t, cx, cy)]}</b>` : 'cursor <b>—</b>',
      );
    }
    $('hud').innerHTML = hud.map((s) => `<span>${s}</span>`).join('');
  }
}

void main();
