import { Application, Container, Graphics } from 'pixi.js';
import {
  Btn,
  DEMO,
  Mat,
  TICK_MS,
  TICKS_PER_SECOND,
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
  MAX_COMMANDS_PER_TICK,
  type GameConfig,
  type GameState,
  type InputFrame,
  type SimCommand,
  type TimedCommand,
} from '@gumfire/sim';
import { BIRTHDAY_THEME, Camera, TerrainView, WaterView } from '@gumfire/render';
import { FixedStepLoop } from './fixedStepLoop';
import { loadMap, loadMapIndex, type LoadedMap } from './mapLoader';

/**
 * Technical sandbox.
 * - M0 scene "bouncers": fixed 50 Hz sim, interpolation, input recording, replay verification.
 * - M1 map scenes: terrain from a PNG mask, chunked textures with crust, water, pan/zoom camera.
 * - M2 destruction tools: every edit is a recorded sim command, so it replays exactly.
 */

const TEAM_COLOURS = [0x8fd14f, 0xe8364f, 0x3fa9f5, 0x9b59d0, 0xff9f1c, 0x3a3a44];
const OUTLINE = 0x1a1320;
const SKY = 0xf6d9e3;
const BOUNCERS = 'bouncers';
const MAT_NAMES: Record<number, string> = { [Mat.AIR]: 'air', [Mat.SOIL]: 'soil', [Mat.ROCK]: 'rock', [Mat.GIRDER]: 'girder', [Mat.BORDER]: 'border' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- sim session state
let sceneId = BOUNCERS;
let config: GameConfig = { seed: 20260930 };
let state: GameState = createGame(config);
let recorded: InputFrame[] = [];
let recordedCmds: TimedCommand[] = [];
/** Commands waiting for the next tick(s). The stress test feeds this 10 per tick. */
let pendingCmds: SimCommand[] = [];
const STRESS_PER_TICK = 10;
let carveR = 48;
let craters = 0;
let worstStepMs = 0;
let worstStepDecay = 0;
let onEvents: (events: ReturnType<typeof step>) => void = () => {};
let prevPos = new Map<number, { x: number; y: number }>();
let paused = false;
let interpolate = true;
let singleStep = false;
let stepTimeAvg = 0;
let droppedFrames = 0;
let lastSteps = 0;
let loadedMap: LoadedMap | null = null;

const loop = new FixedStepLoop(TICK_MS, 5);
const held = new Set<string>();

function currentInput(): InputFrame {
  if (sceneId !== BOUNCERS) return 0; // map scenes have no controllable sim content yet (M4)
  let f = 0;
  if (held.has('ArrowLeft')) f |= Btn.Left;
  if (held.has('ArrowRight')) f |= Btn.Right;
  if (held.has('Space')) f |= Btn.Fire;
  if (held.has('Enter')) f |= Btn.Jump;
  return f;
}

function simTick(): void {
  prevPos = new Map(state.demo.balls.map((b) => [b.id, { x: b.x, y: b.y }]));
  const input = currentInput();
  recorded.push(input);
  const batch = pendingCmds.splice(0, Math.min(STRESS_PER_TICK, MAX_COMMANDS_PER_TICK));
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
    ? `✓ ${state.tick} ticks replayed headless in ${ms.toFixed(1)} ms — hash ${hashHex(live)} matches`
    : `✗ DESYNC: live ${hashHex(live)} vs replay ${hashHex(replay.finalHash)}`;
}

// ---------------------------------------------------------------- rendering
function drawGumling(colour: number, radius: number): Container {
  const c = new Container();
  const body = new Graphics()
    .roundRect(-radius, -radius * 1.15, radius * 2, radius * 2.3, radius)
    .fill({ color: colour, alpha: 0.92 })
    .stroke({ width: 2.5, color: OUTLINE });
  const shine = new Graphics().ellipse(-radius * 0.45, -radius * 0.6, radius * 0.22, radius * 0.4).fill({ color: 0xffffff, alpha: 0.45 });
  const eyes = new Graphics()
    .circle(-radius * 0.3, -radius * 0.35, radius * 0.16)
    .circle(radius * 0.3, -radius * 0.35, radius * 0.16)
    .fill(OUTLINE);
  c.addChild(body, shine, eyes);
  return c;
}

function viewSize(): { w: number; h: number } {
  const w = Math.max(320, Math.min(window.innerWidth - 32, 1600));
  const h = Math.max(300, Math.min(window.innerHeight - 190, Math.round(w * 0.5625), 800));
  return { w, h };
}

async function main(): Promise<void> {
  const app = new Application();
  const size = viewSize();
  await app.init({ width: size.w, height: size.h, background: SKY, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
  $('stage').appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  // Scene-specific objects
  let terrainView: TerrainView | null = null;
  let waterView: WaterView | null = null;
  let bouncerLayer: Container | null = null;
  const views = new Map<number, Container>();
  const camera = new Camera(960, 540);
  camera.setViewport(size.w, size.h);
  let cursorWorld: { x: number; y: number } | null = null;
  const preview = new Graphics();

  onEvents = (events) => {
    for (const e of events) {
      if (e.type === 'TerrainChanged') {
        terrainView?.invalidateRect(e.x0, e.y0, e.x1, e.y1);
        if (e.cause === 'carve') craters++;
      }
    }
  };

  function clearScene(): void {
    terrainView?.destroy();
    waterView?.destroy();
    bouncerLayer?.destroy({ children: true });
    terrainView = null;
    waterView = null;
    bouncerLayer = null;
    views.clear();
    world.removeChildren();
    prevPos.clear();
    recorded = [];
    recordedCmds = [];
    pendingCmds = [];
    craters = 0;
    worstStepMs = 0;
    loop.reset();
    $('verdict').textContent = '';
    $('error').textContent = '';
  }

  function buildBouncers(): void {
    config = { seed: config.seed, demo: { widthPx: 960, heightPx: 500, balls: 8 } };
    state = createGame(config);
    bouncerLayer = new Container();
    const floor = new Graphics()
      .rect(0, 500, 960, 40)
      .fill(0xe9b872)
      .rect(0, 500, 960, 8)
      .fill(0xfff4e6)
      .stroke({ width: 2, color: OUTLINE });
    world.addChild(floor, bouncerLayer);
    camera.setWorld(960, 540);
    camera.fitWorld();
    $('keys').innerHTML = 'Space: spawn · ←/→: push · Enter: kick · I: interpolation · P pause · . step · V verify · R restart';
  }

  function buildMap(m: LoadedMap): void {
    config = { seed: config.seed, map: m.spec };
    state = createGame(config);
    const t = state.terrain!;
    terrainView = new TerrainView(t, BIRTHDAY_THEME);
    waterView = new WaterView(t.width, t.height, state.waterY);
    world.addChild(terrainView.container, waterView.container, preview);
    camera.setWorld(t.width, t.height);
    camera.fitWorld();
    $('keys').innerHTML =
      'Click: crater · Shift+click: girder · Right-drag: tunnel · [ ]: crater size · B: 200-crater stress test · ' +
      'Drag: pan · Wheel: zoom · WASD/arrows: pan · F: fit · 1: 100% · U: repaint all · V verify · R restart';
  }

  async function loadScene(id: string): Promise<void> {
    clearScene();
    sceneId = id;
    if (id === BOUNCERS) {
      loadedMap = null;
      buildBouncers();
      return;
    }
    try {
      loadedMap = await loadMap(id);
      if (sceneId !== id) return; // another scene was picked while loading
      buildMap(loadedMap);
    } catch (e) {
      $('error').textContent = String(e instanceof Error ? e.message : e);
    }
  }

  function restart(): void {
    config = { ...config, seed: (config.seed + 1) >>> 0 };
    void loadScene(sceneId);
  }

  // ---------------------------------------------------------------- scene picker
  const select = $('scene') as HTMLSelectElement;
  const ids = await loadMapIndex().catch(() => [] as string[]);
  for (const id of [...ids, BOUNCERS]) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id === BOUNCERS ? 'M0 bouncers' : id;
    select.appendChild(o);
  }
  select.onchange = () => void loadScene(select.value);
  select.value = ids[0] ?? BOUNCERS;
  await loadScene(select.value);

  // ---------------------------------------------------------------- input
  const togglePause = () => {
    paused = !paused;
    loop.reset();
    $('pause').textContent = paused ? 'Resume (P)' : 'Pause (P)';
  };
  $('pause').onclick = togglePause;
  $('stepOnce').onclick = () => (singleStep = true);
  $('verify').onclick = verify;
  $('restart').onclick = restart;

  const isMap = () => sceneId !== BOUNCERS && terrainView !== null;
  const centre = () => ({ x: camera.viewW / 2, y: camera.viewH / 2 });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'Period') singleStep = true;
    if (e.code === 'KeyV') verify();
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyI') interpolate = !interpolate;
    if (isMap()) {
      if (e.code === 'KeyF') camera.fitWorld();
      if (e.code === 'Digit1') camera.zoomAt(1 / camera.zoom, centre().x, centre().y);
      if (e.code === 'Equal' || e.code === 'NumpadAdd') camera.zoomAt(1.25, centre().x, centre().y);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') camera.zoomAt(0.8, centre().x, centre().y);
      if (e.code === 'KeyU' && state.terrain) markDirtyRect(state.terrain, 0, 0, state.terrain.width - 1, state.terrain.height - 1);
      if (e.code === 'BracketLeft') carveR = Math.max(4, carveR - 4);
      if (e.code === 'BracketRight') carveR = Math.min(160, carveR + 4);
      if (e.code === 'KeyB' && state.terrain) {
        // 200 craters across the terrain band, 10 per tick. Math.random is fine here: the
        // resulting commands are recorded, so the replay is still exact.
        const t = state.terrain;
        for (let k = 0; k < 200; k++) {
          pendingCmds.push({
            type: 'debugCarve',
            x: Math.floor(Math.random() * t.width),
            y: Math.floor(t.height * 0.35 + Math.random() * t.height * 0.6),
            r: 20 + Math.floor(Math.random() * 50),
          });
        }
      }
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());

  // Pointer: drag to pan, wheel to zoom at cursor. Canvas CSS size may differ from its logical size.
  const canvas = app.canvas;
  const toView = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * camera.viewW, y: ((e.clientY - r.top) / r.height) * camera.viewH };
  };
  // Left button: click = crater (shift: girder), drag = pan. Right button: drag = tunnel.
  const DRAG_THRESHOLD = 5;
  let press: { x: number; y: number; id: number; button: number; shift: boolean; panning: boolean; world: { x: number; y: number } } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!isMap()) return;
    const p = toView(e);
    press = { ...p, id: e.pointerId, button: e.button, shift: e.shiftKey, panning: false, world: camera.screenToWorld(p.x, p.y) };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toView(e);
    cursorWorld = camera.screenToWorld(p.x, p.y);
    if (!press || press.id !== e.pointerId || press.button !== 0) return;
    if (!press.panning && Math.hypot(p.x - press.x, p.y - press.y) > DRAG_THRESHOLD) {
      press.panning = true;
      canvas.classList.add('dragging');
    }
    if (press.panning) {
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
    if (cancelled) return;
    const w = camera.screenToWorld(toView(e).x, toView(e).y);
    const wx = Math.floor(w.x), wy = Math.floor(w.y);
    if (pr.button === 2) {
      const sx = Math.floor(pr.world.x), sy = Math.floor(pr.world.y);
      if (Math.abs(wx - sx) <= 2048 && Math.abs(wy - sy) <= 2048) {
        pendingCmds.push({ type: 'debugTunnel', x0: sx, y0: sy, x1: wx, y1: wy, r: 10 });
      }
    } else if (pr.button === 0 && !pr.panning) {
      if (pr.shift) pendingCmds.push({ type: 'debugGirder', x: wx - 48, y: wy - 6, w: 96, h: 12 });
      else pendingCmds.push({ type: 'debugCarve', x: wx, y: wy, r: carveR });
    }
  };
  canvas.addEventListener('pointerup', (e) => endPress(e, false));
  canvas.addEventListener('pointercancel', (e) => endPress(e, true));
  canvas.addEventListener('pointerleave', () => (cursorWorld = null));
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!isMap()) return;
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
    if (!isMap()) camera.fitWorld();
  });

  // ---------------------------------------------------------------- frame
  let fps = 60;
  let uploadsLast = 0;
  app.ticker.add((ticker) => {
    fps = fps * 0.95 + (1000 / Math.max(1, ticker.deltaMS)) * 0.05;
    let alpha = 1;
    if (paused) {
      if (singleStep) simTick();
      lastSteps = singleStep ? 1 : 0;
    } else {
      const adv = loop.advance(performance.now());
      for (let i = 0; i < adv.steps; i++) simTick();
      if (adv.dropped) droppedFrames++;
      lastSteps = adv.steps;
      alpha = adv.alpha;
    }
    singleStep = false;
    if (!interpolate) alpha = 1;

    // Keyboard panning (map scenes), in screen px per frame.
    if (isMap()) {
      const sp = 14;
      const dx = (held.has('KeyA') || held.has('ArrowLeft') ? sp : 0) - (held.has('KeyD') || held.has('ArrowRight') ? sp : 0);
      const dy = (held.has('KeyW') || held.has('ArrowUp') ? sp : 0) - (held.has('KeyS') || held.has('ArrowDown') ? sp : 0);
      if (dx || dy) camera.panByScreen(dx, dy);
    }

    const tr = camera.transform();
    world.scale.set(tr.scale);
    world.position.set(tr.x, tr.y);

    if (terrainView) uploadsLast = terrainView.update();
    waterView?.update(performance.now());
    preview.clear();
    if (isMap() && cursorWorld) {
      const lw = 1.5 / camera.zoom;
      if (press && press.button === 2) {
        preview
          .moveTo(press.world.x, press.world.y)
          .lineTo(cursorWorld.x, cursorWorld.y)
          .stroke({ width: 20, color: 0x1a1320, alpha: 0.25, cap: 'round' });
      } else if (held.has('ShiftLeft') || held.has('ShiftRight')) {
        preview.rect(Math.floor(cursorWorld.x) - 48, Math.floor(cursorWorld.y) - 6, 96, 12).stroke({ width: lw, color: 0x1a1320, alpha: 0.8 });
      } else {
        preview.circle(cursorWorld.x, cursorWorld.y, carveR).stroke({ width: lw, color: 0x1a1320, alpha: 0.7 });
      }
    }

    if (bouncerLayer) {
      const alive = new Set<number>();
      for (const b of state.demo.balls) {
        alive.add(b.id);
        let v = views.get(b.id);
        if (!v) {
          v = drawGumling(TEAM_COLOURS[(b.id - 1) % TEAM_COLOURS.length]!, DEMO.radiusPx);
          views.set(b.id, v);
          bouncerLayer.addChild(v);
        }
        const p = prevPos.get(b.id) ?? b;
        v.x = subToPxFloat(p.x + (b.x - p.x) * alpha);
        v.y = subToPxFloat(p.y + (b.y - p.y) * alpha);
        const speed = Math.min(1, Math.abs(subToPxFloat(b.vy)) / 10);
        const onFloor = b.y >= state.demo.height - b.radius;
        v.scale.set(onFloor ? 1.12 : 1 - speed * 0.12, onFloor ? 0.9 : 1 + speed * 0.15);
      }
      for (const [id, v] of views) {
        if (!alive.has(id)) {
          v.destroy({ children: true });
          views.delete(id);
        }
      }
    }

    const hud: string[] = [
      `tick <b>${state.tick}</b>`,
      `sim time <b>${(state.tick / TICKS_PER_SECOND).toFixed(2)} s</b>`,
      `hash <b>${hashHex(hashState(state))}</b>`,
      `seed <b>${config.seed}</b>`,
      `fps <b>${fps.toFixed(0)}</b>`,
      `steps/frame <b>${lastSteps}</b>`,
      `step cost <b>${(stepTimeAvg * 1000).toFixed(1)} µs</b>`,
    ];
    const t = state.terrain;
    if (t && terrainView && loadedMap) {
      const c = cursorWorld;
      const cx = c ? Math.floor(c.x) : null;
      const cy = c ? Math.floor(c.y) : null;
      hud.push(
        `zoom <b>${Math.round(camera.zoom * 100)}%</b>`,
        `map <b>${t.width}×${t.height}</b>`,
        `chunks <b>${t.chunksX}×${t.chunksY}</b>`,
        `solid px <b>${countSolid(t).toLocaleString('en')}</b>`,
        `terrain hash <b>${hashHex(hashTerrain(t))}</b>`,
        `paint <b>${terrainView.paintMs.toFixed(0)} ms</b> · decode <b>${loadedMap.decodeMs.toFixed(0)} ms</b>`,
        `uploads <b>${uploadsLast}</b> · queued <b>${terrainView.pendingUploads}</b>`,
        `water y <b>${state.waterY}</b>`,
        `crater r <b>${carveR}</b> · craters <b>${craters}</b>`,
        `terrain v <b>${t.version}</b> · cmds queued <b>${pendingCmds.length}</b>`,
        `worst step <b>${worstStepMs.toFixed(2)} ms</b>`,
        cx !== null && cy !== null ? `cursor <b>${cx}, ${cy}</b> <b>${MAT_NAMES[getMat(t, cx, cy)]}</b>` : 'cursor <b>—</b>',
      );
    } else {
      hud.push(`bodies <b>${state.demo.balls.length}</b>${droppedFrames ? ` · dropped ${droppedFrames}` : ''}`);
    }
    $('hud').innerHTML = hud.map((s) => `<span>${s}</span>`).join('');
  });
}

void main();
