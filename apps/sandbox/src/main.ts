import { Application, Container, Graphics } from 'pixi.js';
import {
  Btn,
  DEMO,
  TICK_MS,
  TICKS_PER_SECOND,
  createGame,
  hashHex,
  hashState,
  runReplay,
  step,
  subToPxFloat,
  type GameConfig,
  type GameState,
  type InputFrame,
} from '@gumfire/sim';
import { FixedStepLoop } from './fixedStepLoop';

/**
 * M0 technical sandbox: drives the deterministic sim at a fixed 50 Hz, renders it
 * with interpolation, records every input frame, and can re-run the whole session
 * headlessly to prove the live state hash is reproducible.
 */

const WIDTH = 960;
const HEIGHT = 540;
const TEAM_COLOURS = [0x8fd14f, 0xe8364f, 0x3fa9f5, 0x9b59d0, 0xff9f1c, 0x3a3a44];
const OUTLINE = 0x1a1320;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let config: GameConfig = { seed: 20260930, demo: { widthPx: WIDTH, heightPx: HEIGHT - 40, balls: 8 } };
let state: GameState = createGame(config);
let recorded: InputFrame[] = [];
let prevPos = new Map<number, { x: number; y: number }>();
let paused = false;
let interpolate = true;
let singleStep = false;

const loop = new FixedStepLoop(TICK_MS, 5);
const held = new Set<string>();
let stepTimeAvg = 0;
let droppedFrames = 0;
let lastSteps = 0;

function currentInput(): InputFrame {
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

function restart(): void {
  config = { ...config, seed: (config.seed + 1) >>> 0 };
  state = createGame(config);
  recorded = [];
  prevPos.clear();
  loop.reset();
  $('verdict').textContent = '';
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

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: WIDTH, height: HEIGHT, background: '#f6d9e3', antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
  $('stage').appendChild(app.canvas);

  const world = new Container();
  const floor = new Graphics()
    .rect(0, HEIGHT - 40, WIDTH, 40)
    .fill(0xe9b872)
    .rect(0, HEIGHT - 40, WIDTH, 8)
    .fill(0xfff4e6)
    .stroke({ width: 2, color: OUTLINE });
  const ballLayer = new Container();
  world.addChild(floor, ballLayer);
  app.stage.addChild(world);

  const views = new Map<number, Container>();
  const radiusPx = DEMO.radiusPx;

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'Period') singleStep = true;
    if (e.code === 'KeyV') verify();
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyI') {
      interpolate = !interpolate;
      $('interp').textContent = interpolate ? 'on' : 'off';
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());

  const togglePause = () => {
    paused = !paused;
    loop.reset();
    $('pause').textContent = paused ? 'Resume (P)' : 'Pause (P)';
  };
  $('pause').onclick = togglePause;
  $('stepOnce').onclick = () => (singleStep = true);
  $('verify').onclick = verify;
  $('restart').onclick = restart;

  let fps = 60;
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

    // sync views
    const alive = new Set<number>();
    for (const b of state.demo.balls) {
      alive.add(b.id);
      let v = views.get(b.id);
      if (!v) {
        v = drawGumling(TEAM_COLOURS[(b.id - 1) % TEAM_COLOURS.length]!, radiusPx);
        views.set(b.id, v);
        ballLayer.addChild(v);
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

    $('hud').innerHTML = [
      `tick <b>${state.tick}</b>`,
      `sim time <b>${(state.tick / TICKS_PER_SECOND).toFixed(2)} s</b>`,
      `hash <b>${hashHex(hashState(state))}</b>`,
      `seed <b>${config.seed}</b>`,
      `fps <b>${fps.toFixed(0)}</b>`,
      `steps/frame <b>${lastSteps}</b>`,
      `step cost <b>${(stepTimeAvg * 1000).toFixed(1)} µs</b>`,
      `bodies <b>${state.demo.balls.length}</b>${droppedFrames ? ` · dropped ${droppedFrames}` : ''}`,
    ]
      .map((s) => `<span>${s}</span>`)
      .join('');
  });
}

void main();
