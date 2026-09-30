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
  type GameConfig,
  type GameState,
  type InputFrame,
} from '@gumfire/sim';
import { BIRTHDAY_THEME, Camera, TerrainView, WaterView } from '@gumfire/render';
import { FixedStepLoop } from './fixedStepLoop';
import { loadMap, loadMapIndex, type LoadedMap } from './mapLoader';

/**
 * Technical sandbox.
 * - M0 scene "bouncers": fixed 50 Hz sim, interpolation, input recording, replay verification.
 * - M1 map scenes: terrain from a PNG mask, chunked textures with crust, water, pan/zoom camera.
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
  const t0 = performance.now();
  step(state, input);
  stepTimeAvg = stepTimeAvg * 0.95 + (performance.now() - t0) * 0.05;
}

function verify(): void {
  const t0 = performance.now();
  const replay = runReplay({ config, inputs: recorded });
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
    world.addChild(terrainView.container, waterView.container);
    camera.setWorld(t.width, t.height);
    camera.fitWorld();
    $('keys').innerHTML =
      'Drag: pan · Wheel: zoom at cursor · WASD/arrows: pan · +/−: zoom · F: fit · 1: 100% · U: repaint all chunks (upload budget test) · V verify · R restart';
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
  let drag: { x: number; y: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!isMap()) return;
    drag = { ...toView(e), id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toView(e);
    cursorWorld = camera.screenToWorld(p.x, p.y);
    if (drag && drag.id === e.pointerId) {
      camera.panByScreen(p.x - drag.x, p.y - drag.y);
      drag.x = p.x;
      drag.y = p.y;
    }
  });
  const endDrag = (e: PointerEvent) => {
    if (drag && drag.id === e.pointerId) drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
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
        cx !== null && cy !== null ? `cursor <b>${cx}, ${cy}</b> <b>${MAT_NAMES[getMat(t, cx, cy)]}</b>` : 'cursor <b>—</b>',
      );
    } else {
      hud.push(`bodies <b>${state.demo.balls.length}</b>${droppedFrames ? ` · dropped ${droppedFrames}` : ''}`);
    }
    $('hud').innerHTML = hud.map((s) => `<span>${s}</span>`).join('');
  });
}

void main();
