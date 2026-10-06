import { Application } from 'pixi.js';
import { TICKS_PER_SECOND, cloneState, delayLeft, hashState, subToPxFloat, type GameState, type SimCommand, type SimEvent } from '@gumfire/sim';
import { Camera, CameraDirector, type CameraScene } from '@gumfire/render';
import { PROPS, WEAPONS } from '@gumfire/content';
import { Audio } from './audio';
import { Hud } from './hud';
import { Keyboard } from './input';
import { loadMap, type LoadedMap } from './mapLoader';
import { Mat, generateMap, type MapGenerator, type MapSpec } from '@gumfire/sim';
import type { BackdropTheme } from './world/background';
import { MatchSession } from './session';
import { WorldView, type TeamLook } from './world/worldView';
import { loadArtPack, piecesFor } from './world/artPack';
import { generateObjectMap, type Piece } from './world/objectMaps';
import { THEMES, THEME_IDS, themeOf } from './world/themes';
import { loadSettings, rulesOf, saveSettings, turnLimit, teamColour, type MatchSetup, type Settings } from './settings';
import { newSeries, recordMatch, sidesOf, toWin, type Series } from './series';
import { OnlineClient, defaultServer } from './online';
import { Lockstep, authorOf, hostPlaysTeam, isCpuOwner, rle, unrle, type AuthorCtx, type MatchSpec } from '@gumfire/net';
import { ReplayError, commandsAt, decodeReplay, encodeReplay, indexReplay, type ReplayData, type ReplayIndex } from './replay';
import { AiPlayer, type Plan, type RemotePlanner } from '@gumfire/ai';
import { Music } from './music';
import type { MusicId } from './world/themes';

/** 16-bit stereo WAV of an audio buffer, base64 (debug export). */
function wavBase64(buf: AudioBuffer): string {
  const n = buf.length, ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch).keys()].map((c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c]![i]!));
      out.setInt16(o, v * 32767, true);
      o += 2;
    }
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

/** The CPU's search runs in a worker so a slow frame rate never slows its thinking. */
let worker: Worker | null = null;
let workerSeq = 0;
const waiting = new Map<number, (p: Plan) => void>();
function workerPlanner(): RemotePlanner | null {
  try {
    worker ??= new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; plan: Plan }>) => {
      waiting.get(e.data.id)?.(e.data.plan);
      waiting.delete(e.data.id);
    };
  } catch {
    return null;
  }
  return (state, level) =>
    new Promise<Plan>((resolve, reject) => {
      const id = ++workerSeq;
      waiting.set(id, resolve);
      try {
        worker!.postMessage({ id, state, level });
      } catch (err) {
        waiting.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
}
import { Menus } from './menus';
import { Ticker, awardsFor } from './messages';

/**
 * GUMFIRE game client — vertical slice (M8): title → hot-seat match → results → rematch.
 * The sim runs at a fixed 50 Hz; rendering interpolates between ticks; the camera director,
 * HUD and audio react to sim events. Nothing here writes to the sim state.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MAP_ID = 'slice-island';

/** Title-screen map choice: the handmade slice map or a generated one (seeded, re-rollable). */
/** 'objects': built from the theme's own things (M18.5; generic island for themes without a kit). */
type MapKind = 'slice' | MapGenerator | 'objects';
let mapKind: MapKind = 'objects';
let theme: BackdropTheme = 'frozen';
let mapSeed = ((Date.now() / 1000) >>> 0) % 100000;
/** The map last made for (kind, theme, seed): preview and start use the same one. */
let mapCache: { key: string; spec: MapSpec; pieces: Piece[] } | null = null;

async function currentMap(): Promise<{ spec: MapSpec; pieces: Piece[] }> {
  const key = `${mapKind}|${theme}|${mapSeed}`;
  if (mapCache?.key === key) return mapCache;
  let out: { spec: MapSpec; pieces: Piece[] };
  if (mapKind === 'slice') {
    map ??= await loadMap(MAP_ID);
    out = { spec: map.spec, pieces: [] };
  } else if (mapKind === 'objects') {
    const kit = THEMES[theme].kit;
    const { masks } = piecesFor(theme, kit ? await loadArtPack(theme) : null);
    if (kit && masks.size) {
      const m = generateObjectMap(kit, masks, mapSeed);
      out = { spec: m.spec, pieces: m.pieces };
    } else out = { spec: generateMap({ generator: 'island', seed: mapSeed }).spec, pieces: [] };
  } else out = { spec: generateMap({ generator: mapKind, seed: mapSeed }).spec, pieces: [] };
  mapCache = { key, ...out };
  return out;
}

async function currentSpec(): Promise<MapSpec> {
  return (await currentMap()).spec;
}


async function drawPreview(): Promise<void> {
  const canvas = $('mapPreview') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const spec = await currentSpec();
  const W = canvas.width, H = canvas.height, pal = THEMES[theme].preview;
  const img = ctx.createImageData(W, H);
  const sx = spec.width / W, sy = spec.height / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mx = Math.floor(x * sx), my = Math.floor(y * sy);
      const m = spec.mat[my * spec.width + mx]!;
      const above = my >= 4 ? spec.mat[(my - 4) * spec.width + mx]! : 0;
      const c = m === Mat.AIR ? (my >= spec.waterY ? pal.water : pal.sky) : m === Mat.SOIL ? (above === Mat.AIR ? pal.top : pal.soil) : pal.rock;
      const p = (y * W + x) * 4;
      img.data[p] = c[0]!;
      img.data[p + 1] = c[1]!;
      img.data[p + 2] = c[2]!;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  $('mapSeed').textContent = mapKind === 'slice' ? 'handmade map' : `seed ${mapSeed}`;
  ($('reseedBtn') as HTMLButtonElement).disabled = mapKind === 'slice';
}

const audio = new Audio();
const keyboard = new Keyboard();
keyboard.enabled = false;
let settings: Settings = loadSettings();

/** Apply the options to audio, keys and text size (on load and after every change). */
function applySettings(s: Settings): void {
  settings = s;
  audio.setVolume(s.volume, s.muted, s.musicOn ? s.musicVolume : 0);
  for (const id of ['titleMusic', 'musicBtn']) $(id).classList.toggle('off', !s.musicOn);
  $('pauseMusic').textContent = `Music: ${s.musicOn ? 'on' : 'off'}`;
  keyboard.setKeys(s.keys);
  keyboard.holdToggle = s.holdToggle;
  document.body.classList.remove('text0', 'text1', 'text2');
  document.body.classList.add(`text${s.textSize}`);
  $('muteBtn').textContent = s.muted ? '✕' : '♪';
}

/** The looks of the teams in play, in sim team order. */
function looksFor(s: Settings, setup: MatchSetup = s.match): TeamLook[] {
  return setup.teams.map((i) => {
    const t = s.teams[i]!;
    return { name: t.name, colour: teamColour(s, t.colour), emblem: t.emblem, members: t.members };
  });
}

interface Running {
  session: MatchSession;
  view: WorldView;
  hud: Hud;
  camera: Camera;
  director: CameraDirector;
  over: boolean;
  lastTickSecond: number;
  ticker: Ticker;
  /** CPU players by sim team index (null = a person). */
  ais: Array<AiPlayer | null>;
  /** The setup this match was started with (rematch / restart use it again). */
  setup: MatchSetup;
  theme: BackdropTheme;
  looks: TeamLook[];
  /** Objects of an object-built map (drawing only). */
  pieces: Piece[];
  /** The latest turn start of a live match: a copy of the state and where the recording was. */
  lastTurn: { state: GameState; inputs: number; commands: number } | null;
  /** Set when this run plays back a recording instead of being played (M16). */
  replay: ReplayCtl | null;
  /** This match's result went into the series already. */
  recorded: boolean;
  /** Online match (M17): the shared input log and who plays what. */
  net: NetCtl | null;
}

interface NetCtl {
  ls: Lockstep;
  match: MatchSpec;
  /** CPUs this machine plays as the host (CPU teams, teams whose player is away). */
  ais: Map<number, AiPlayer>;
  /** Frames since the game last moved (to say who we are waiting for). */
  stalled: number;
  desynced: boolean;
}

/** Playback of a recording in a run (M16). */
interface ReplayCtl {
  data: ReplayData;
  index: ReplayIndex | null;
  /** Tick of the state the recording's first input applies to (0 for whole matches). */
  base: number;
  cmdAt: number;
  playing: boolean;
  speed: number;
  /** The live match to go back to when the replay closes. */
  live: Running | null;
}

let app: Application;
let map: LoadedMap | null = null;
let run: Running | null = null;
let seed = (Date.now() >>> 0) % 1_000_000;

/**
 * The title's moving backdrop (M20): the themes' painted rooms, one after another, cross-faded.
 * Runs only while the title is up; the pictures come from the art pack (no pack: plain sky).
 */
const titleShow = (() => {
  let timer = 0, index = -1, layer = 0;
  let files: Array<{ name: string; url: string }> | null = null;
  const next = () => {
    if (!files?.length) return;
    index = (index + 1) % files.length;
    const f = files[index]!;
    const img = new Image();
    img.onload = () => {
      const layers = $('titleBg').querySelectorAll('i');
      layer ^= 1;
      const on = layers[layer] as HTMLElement, off = layers[layer ^ 1] as HTMLElement;
      on.style.backgroundImage = `url("${f.url}")`;
      on.classList.remove('on');
      void on.offsetWidth; // restart the drift
      on.classList.add('on');
      off.classList.remove('on');
      $('titlePlace').textContent = f.name;
    };
    img.src = f.url;
  };
  return {
    async toggle(show: boolean) {
      window.clearInterval(timer);
      timer = 0;
      if (!show) return;
      if (!files) {
        files = [];
        try {
          const m = (await (await fetch('art/manifest.json')).json()) as { backdrops?: Record<string, string> };
          files = THEME_IDS.filter((t) => m.backdrops?.[t]).map((t) => ({ name: THEMES[t].name, url: `art/${m.backdrops![t]}` }));
          index = Math.floor(Math.random() * Math.max(1, files.length)) - 1;
        } catch {
          /* no art pack: the plain sky stays */
        }
      }
      if (index < 0 || !$('titleBg').querySelector('i.on')) next();
      timer = window.setInterval(next, 9000);
    },
  };
})();

type ScreenId = 'title' | 'setup' | 'teamsScreen' | 'optionsScreen' | 'results' | 'pause' | 'onlineScreen' | 'lobby' | 'about';
function showScreen(id: ScreenId | null): void {
  for (const k of ['title', 'setup', 'teamsScreen', 'optionsScreen', 'results', 'pause', 'onlineScreen', 'lobby', 'about'] as const) $(k).classList.toggle('hidden', id !== k);
  // the menus between matches sit in front of the themes' painted rooms
  const menus = run === null && id !== null && id !== 'pause' && id !== 'results';
  $('titleBg').classList.toggle('hidden', !menus);
  void titleShow.toggle(menus);
  $('hud').classList.toggle('hidden', id !== null || run === null);
  keyboard.enabled = id === null;
  if (id !== null) keyboard.clear();
  // music: the map's tune in a match (also behind its menu and results), the menu tune elsewhere
  if (id === null && run) audio.playMusic(run.theme);
  else if (id !== 'pause' && id !== 'results') audio.playMusic('menu');
}

/** The CPU playing the current turn, if any. */
function cpuTurn(r: Running | null = run): AiPlayer | null {
  if (!r) return null;
  return r.ais.find((a) => a?.isMyTurn(r.session.state)) ?? null;
}

/** Quick match: the first two teams of the setup, the second one played by the CPU. */
function quickSetup(): MatchSetup {
  const m = settings.match;
  return { ...m, teams: m.teams.slice(0, 2), control: ['human', settings.aiLevel], sides: [0, 1], series: 1 };
}

let series: Series | null = null;
let pack: Awaited<ReturnType<typeof loadArtPack>> = null;

/** Names of the teams on a side, joined (alliances). */
function sideName(setup: MatchSetup, side: number): string {
  return setup.teams
    .map((ti, slot) => (setup.sides[slot] === side ? settings.teams[ti]!.name : null))
    .filter((n): n is string => !!n)
    .join(' & ');
}

/** "Mint wins!" / "Mint & Grape win!" */
function winnerLine(r: Running): string {
  const m = r.session.state.match!;
  if (m.result !== 'win') return 'Draw!';
  const side = m.teams[m.winner]!.side;
  const names = m.teams.filter((t) => t.side === side).map((t) => t.name);
  return `${names.join(' & ')} ${names.length > 1 ? 'win' : 'wins'}!`;
}

/** Build a run around a session: world view, camera, HUD, CPUs. */
function buildRun(session: MatchSession, setup: MatchSetup, looks: TeamLook[], runTheme: BackdropTheme, cpuFlags: boolean[], replay: ReplayCtl | null, pieces: Piece[] = []): Running {
  const t = session.state.terrain!;
  const view = new WorldView(session.state, runTheme, looks, { shake: settings.shake, flash: settings.flash }, pack, pieces);
  app.stage.addChild(view.root);
  const camera = new Camera(t.width, t.height, { minZoom: 0.3, maxZoom: 2.2, topMargin: 600, sideMargin: 200, fillWidth: true });
  camera.setViewport(app.renderer.width / app.renderer.resolution, app.renderer.height / app.renderer.resolution);
  camera.fitWorld();
  camera.zoomAt(1.3 / camera.zoom, camera.viewW / 2, camera.viewH / 2); // close enough to read faces
  const hud = new Hud(session.state, (i) => selectWeapon(i), Object.fromEntries(WEAPONS.map((w) => [w.id, w.description ?? ''])), looks);
  const ais = replay
    ? []
    : setup.teams.map((_, i) => {
        const c = setup.control[i] ?? 'human';
        if (c === 'human') return null;
        const ai = new AiPlayer(i, c);
        ai.remote = workerPlanner();
        return ai;
      });
  hud.cpu = (team) => !!cpuFlags[team];
  hud.thinking = () => !!ais.find((a) => a?.isMyTurn(session.state) && a.thinking);
  return { session, view, hud, camera, director: new CameraDirector(), over: false, lastTickSecond: -1, ticker: new Ticker($('ticker')), ais, setup, theme: runTheme, looks, lastTurn: null, replay, recorded: false, net: null, pieces };
}

async function startMatch(setup: MatchSetup = run?.setup ?? settings.match): Promise<void> {
  audio.unlock();
  $('loading').classList.remove('hidden');
  let made: { spec: MapSpec; pieces: Piece[] };
  try {
    made = await currentMap();
    pack = await loadArtPack(theme); // painted art; null without one (the generated look then)
  } catch (e) {
    $('error').textContent = String(e instanceof Error ? e.message : e);
    $('error').classList.remove('hidden');
    return;
  } finally {
    $('loading').classList.add('hidden');
  }
  endMatch();
  const rules = rulesOf(setup);
  const looks = looksFor(settings, setup);
  seed = (seed * 1103515245 + 12345) >>> 0;
  const session = new MatchSession({
    seed,
    // handmade and object-built maps travel as maps; generic ones as generator settings
    ...(mapKind === 'slice' || made.pieces.length ? { map: made.spec } : { mapgen: { generator: mapKind === 'objects' ? 'island' : mapKind, seed: mapSeed } }),
    weapons: WEAPONS,
    props: PROPS,
    match: {
      teams: looks.map((t, i) => ({ name: t.name, size: setup.size, side: setup.sides[i] ?? i })),
      ruleset: { ...rules, teamSize: setup.size, roundTurns: turnLimit(looks.length, setup.size) },
    },
  });
  run = buildRun(session, setup, looks, theme, setup.control.map((c) => c !== 'human'), null, made.pieces);
  showScreen(null);
}

// ------------------------------------------------------------------ replays (M16)
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Play one recorded tick; false at the end of the recording. */
function replayStep(r: Running, fx: boolean): boolean {
  const rp = r.replay!;
  const s = r.session.state;
  const i = s.tick - rp.base;
  if (i < 0 || i >= rp.data.inputs.length) return false;
  const batch: SimCommand[] = [];
  rp.cmdAt = commandsAt(rp.data.commands, rp.cmdAt, s.tick + 1, batch);
  for (const c of batch) r.session.command(c);
  if (fx) r.view.snapshot();
  const ev = r.session.tick(rp.data.inputs[i]!);
  if (fx) onEvents(r, ev);
  return true;
}

/** The recording of the live match so far. */
function liveRecording(r: Running, from: Running['lastTurn'] = null): ReplayData {
  const ss = r.session;
  return {
    config: ss.config,
    inputs: ss.inputs.slice(from?.inputs ?? 0),
    commands: ss.commands.slice(from?.commands ?? 0),
    theme: r.theme,
    looks: r.looks,
    pieces: r.pieces,
    cpu: r.setup.control.map((c) => c !== 'human'),
    finalHash: hashState(ss.state),
    created: new Date().toISOString(),
  };
}

/** Watch a recording; `live`: the match to return to afterwards. */
function openReplay(data: ReplayData, start: GameState | undefined, live: Running | null): void {
  $('loading').classList.remove('hidden');
  let index: ReplayIndex;
  try {
    index = indexReplay(data, cloneState, 4, start);
  } finally {
    $('loading').classList.add('hidden');
  }
  if (live) {
    app.stage.removeChild(live.view.root);
    live.session.paused = true;
  } else endMatch();
  const first = index.checkpoints[0]!;
  const session = new MatchSession(data.config, cloneState(first.state));
  run = buildRun(session, live?.setup ?? settings.match, data.looks, data.theme, data.cpu, { data, index, base: first.tick, cmdAt: 0, playing: true, speed: 1, live }, data.pieces ?? []);
  run.over = false;
  $('replayBar').classList.remove('hidden');
  showScreen(null);
  if (!index.verified) run.hud.banner('This recording plays differently in this version', 3000);
}

/** Jump to a tick: forwards by playing on headless, backwards from the nearest checkpoint. */
function seekReplay(target: number): void {
  const r = run;
  if (!r?.replay) return;
  const rp = r.replay;
  target = Math.max(rp.base, Math.min(rp.base + rp.data.inputs.length, target));
  let cur = r;
  if (target < r.session.state.tick) {
    const cps = rp.index?.checkpoints ?? [];
    const cp = cps.filter((c) => c.tick <= target).pop() ?? cps[0]!;
    const session = new MatchSession(rp.data.config, cloneState(cp.state));
    const camera = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
    r.view.destroy();
    cur = buildRun(session, r.setup, r.looks, r.theme, rp.data.cpu, { ...rp, cmdAt: 0 }, r.pieces);
    cur.camera.zoomAt(camera.zoom / cur.camera.zoom, cur.camera.viewW / 2, cur.camera.viewH / 2);
    cur.camera.centerOn(camera.x, camera.y);
    run = cur;
  }
  while (cur.session.state.tick < target && replayStep(cur, false));
  cur.view.snapshot();
  cur.director.release();
}

function replayTurnStep(dir: number): void {
  const rp = run?.replay;
  if (!rp?.index) return;
  const now = run!.session.state.tick;
  const starts = rp.index.turns.map((t) => t.tick);
  const target = dir > 0 ? starts.find((t) => t > now) : starts.filter((t) => t < now - 25).pop();
  seekReplay(target ?? (dir > 0 ? rp.base + rp.data.inputs.length : rp.base));
}

function updateReplayBar(r: Running): void {
  const rp = r.replay!;
  const s = r.session.state, m = s.match!;
  const team = m.teams[m.activeTeam];
  const total = rp.data.inputs.length;
  const pos = s.tick - rp.base;
  const turns = rp.index?.turns ?? [];
  const lastTurn = turns.length ? turns[turns.length - 1]!.turn : m.turn;
  const info = `turn ${m.turn}/${lastTurn}${team ? ` · ${team.name}` : ''}${pos >= total ? ' · the end' : ''}`;
  const el = $('rpInfo');
  if (el.textContent !== info) el.textContent = info;
  $('rpPos').style.width = `${total ? Math.round((100 * pos) / total) : 0}%`;
  const play = rp.playing ? '⏸' : '▶';
  if ($('rpPlay').textContent !== play) $('rpPlay').textContent = play;
  const sp = `${rp.speed}×`;
  if ($('rpSpeed').textContent !== sp) $('rpSpeed').textContent = sp;
}

function closeReplay(): void {
  const r = run;
  if (!r?.replay) return;
  const live = r.replay.live;
  r.view.destroy();
  $('replayBar').classList.add('hidden');
  run = live;
  if (!live) {
    showScreen('title');
    return;
  }
  app.stage.addChild(live.view.root);
  live.hud.mount();
  live.session.loop.reset();
  if (live.over) showResults();
  else {
    live.session.paused = false;
    showScreen(null);
  }
}

function saveReplay(): void {
  if (!run || run.replay) return;
  const text = encodeReplay(liveRecording(run), run.session.state.schema);
  const a = document.createElement('a');
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  a.download = `gumfire-replay-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------------ online (M17)
let online: OnlineClient | null = null;
/** Lobby, host side: who plays each slot. */
let lobbyOwners: string[] = [];
/** Slots whose owner the host picked by hand. */
const lobbyManual: boolean[] = [];
/** A catch-up has been asked for and not yet received. */
let resyncAsked = false;

/** Is the acting team this player's (always true offline)? */
function myTurn(r: Running): boolean {
  if (!r.net || !online) return true;
  const s = r.session.state;
  const c = s.characters.find((x) => x.id === s.activeCharacter);
  return !!c && r.net.match.owners[c.team] === online.id;
}

function netCtx(r: Running): AuthorCtx {
  return { host: online?.host ?? '', owners: r.net!.match.owners, connected: (id) => online?.isConnected(id) ?? false };
}

/** One rendered frame of an online match: play known frames, author ours, catch up when behind. */
function netFrame(r: Running, now: number): number {
  const net = r.net!;
  const s = r.session.state;
  const adv = r.session.loop.advance(now);
  const ctx = netCtx(r);
  // the host plays CPUs (and absent players' teams); they think between ticks
  const cpuTeam = online?.isHost ? hostPlaysTeam(s, ctx) : -1;
  if (cpuTeam >= 0) {
    const owner = net.match.owners[cpuTeam]!;
    const level = isCpuOwner(owner) ? (owner.slice(4) as 'easy' | 'normal' | 'hard') : 'normal';
    let ai = net.ais.get(cpuTeam) ?? null;
    if (!ai || ai.level !== level) {
      ai = new AiPlayer(cpuTeam, level);
      ai.remote = workerPlanner();
      net.ais.set(cpuTeam, ai);
    }
    ai.think(9);
  }
  // behind? play faster until we are back in step
  const behind = net.ls.behind(s);
  let budget = adv.steps + (behind > 6 ? Math.min(behind - 3, 40) : 0);
  let moved = false;
  while (budget-- > 0) {
    const d = net.ls.decide(s, ctx);
    if (d === 'wait') break;
    r.view.snapshot();
    let events: SimEvent[];
    if (d === 'play') {
      r.session.clearCommands(); // not ours to act on this tick
      const f = net.ls.next(s);
      for (const c of f.cmds) r.session.command(c);
      events = r.session.tick(f.input);
    } else {
      const act = s.characters.find((c) => c.id === s.activeCharacter);
      keyboard.charging = !!act && (act.state === 'charging' || act.power > 0);
      let input = keyboard.frame();
      const cpu = online?.isHost ? hostPlaysTeam(s, ctx) : -1;
      if (cpu >= 0) {
        r.session.clearCommands();
        const st = net.ais.get(cpu)?.control(s) ?? { input: 0 };
        for (const c of st.cmds ?? []) r.session.command(c);
        input = st.input;
      } else if (!myTurn(r)) {
        input = 0; // a quiet tick the host keeps time with
        r.session.clearCommands();
      }
      net.ls.record(s.tick + 1, input, r.session.pendingCommands());
      events = r.session.tick(input);
    }
    moved = true;
    onEvents(r, events);
    if (s.tick % 250 === 0) online?.send({ type: 'hash', tick: s.tick, hash: hashState(s) });
  }
  const out = net.ls.takeOutbox();
  if (out) online?.send({ type: 'frames', ...out });
  net.stalled = moved ? 0 : net.stalled + 1;
  return moved ? adv.alpha : 1;
}

/** Build a match from the host's spec (and, when catching up, the log so far). */
/** Frames that arrive while a match is still being built (its art loading). */
let netBuffer: Array<{ from: number; frames: number[]; cmds: Parameters<Lockstep['receive']>[2] }> = [];
let netBuilding = 0;
/** A match is being (re)built: frames wait in `netBuffer`. */
let netPending = false;

async function startOnline(match: MatchSpec, frames: number[] = [], cmds: Parameters<Lockstep['receive']>[2] = []): Promise<void> {
  const build = ++netBuilding;
  netBuffer = [];
  netPending = true;
  const art = await loadArtPack(themeOf(match.theme));
  if (build !== netBuilding) return; // a newer start or catch-up came in meanwhile
  netPending = false;
  pack = art;
  const { map, ...rest } = match.config;
  const config = { ...rest, ...(map ? { map: { width: map.width, height: map.height, waterY: map.waterY, mat: Uint8Array.from(unrle(map.rle, map.width * map.height)) } } : {}) };
  const keepCamera = run?.net ? { x: run.camera.x, y: run.camera.y, zoom: run.camera.zoom } : null;
  if (run) {
    if (run.replay?.live) run.replay.live.view.destroy();
    run.view.destroy();
    run = null;
  }
  const looks = match.looks as unknown as TeamLook[];
  const control = match.owners.map((o) => (isCpuOwner(o) ? (o.slice(4) as 'easy' | 'normal' | 'hard') : 'human'));
  const setup: MatchSetup = { ...settings.match, teams: match.owners.map((_, i) => i), control, sides: (config.match?.teams ?? []).map((t, i) => t.side ?? i), series: 1 };
  const session = new MatchSession(config);
  const r = buildRun(session, setup, looks, themeOf(match.theme), match.owners.map(isCpuOwner), null, (match.pieces ?? []) as Piece[]);
  const ls = new Lockstep(online?.id ?? '');
  ls.receive(1, frames, cmds);
  for (const b of netBuffer) ls.receive(b.from, b.frames, b.cmds);
  netBuffer = [];
  r.net = { ls, match, ais: new Map(), stalled: 0, desynced: false };
  r.hud.who = (team) => {
    const o = match.owners[team];
    if (!o || isCpuOwner(o) || o === online?.id) return null;
    return online?.nameOf(o) ?? '?';
  };
  r.hud.waiting = () => {
    if (!r.net || r.net.stalled < 30 || r.over || !online) return null;
    const who = authorOf(r.session.state, netCtx(r));
    return who === online.id ? null : online.nameOf(who);
  };
  // replay what already happened, quietly
  const s = session.state;
  while (ls.behind(s) > 0) {
    const f = ls.next(s);
    for (const c of f.cmds) session.command(c);
    session.tick(f.input);
  }
  r.view.snapshot();
  if (keepCamera) {
    r.camera.zoomAt(keepCamera.zoom / r.camera.zoom, r.camera.viewW / 2, r.camera.viewH / 2);
    r.camera.centerOn(keepCamera.x, keepCamera.y);
  }
  run = r;
  if (s.match?.phase === 'matchOver') r.over = true;
  showScreen(r.over ? 'results' : null);
  if (r.over) showResults();
}

/** The host's match: the current setup with the lobby's owners. */
async function hostMatch(): Promise<MatchSpec> {
  const setup = lobbySetup();
  const made = await currentMap();
  const spec = mapKind === 'slice' || made.pieces.length ? made.spec : null;
  const looks = looksFor(settings, setup);
  seed = (seed * 1103515245 + 12345) >>> 0;
  return {
    config: {
      seed,
      ...(spec ? { map: { width: spec.width, height: spec.height, waterY: spec.waterY, rle: rle(spec.mat) } } : { mapgen: { generator: mapKind === 'objects' || mapKind === 'slice' ? 'island' : mapKind, seed: mapSeed } }),
      weapons: WEAPONS,
      props: PROPS,
      match: { teams: looks.map((t, i) => ({ name: t.name, size: setup.size, side: setup.sides[i] ?? i })), ruleset: { ...rulesOf(setup), teamSize: setup.size, roundTurns: turnLimit(looks.length, setup.size) } },
    },
    owners: lobbyOwners.slice(0, setup.teams.length),
    theme,
    pieces: made.pieces,
    looks: looks.map((l) => ({ name: l.name, colour: l.colour, emblem: l.emblem, members: l.members.map((m) => ({ name: m.name, hat: m.hat })) })),
  };
}

/** Slots of the lobby (the host's saved setup, 2–4 teams). */
function lobbySetup(): MatchSetup {
  const m = settings.match;
  return { ...m, control: m.teams.map(() => 'human'), series: 1 };
}

const CPU_LABEL: Record<string, string> = { 'cpu:easy': 'CPU · easy', 'cpu:normal': 'CPU · normal', 'cpu:hard': 'CPU · hard' };

function renderLobby(): void {
  if (!online) return;
  $('lobbyCode').textContent = online.code;
  $('lobbyPlayers').innerHTML = online.players
    .map((p) => `<span class="lp ${p.connected ? '' : 'away'}">${p.id === online!.host ? '★ ' : ''}${esc(p.name)}${p.id === online!.id ? ' (you)' : ''}</span>`)
    .join('');
  const host = online.isHost;
  $('lobbyHostOpts').classList.toggle('hidden', !host);
  ($('lobbyStart') as HTMLButtonElement).classList.toggle('hidden', !host);
  if (host) {
    const setup = lobbySetup();
    renderLobbyOwnersOnly(); // default owners: players in join order, then CPUs
    const looks = looksFor(settings, setup);
    $('lobbySlots').innerHTML = looks
      .map((l, i) => {
        const opts = [...online!.players.map((p) => [p.id, p.name] as const), ...Object.entries(CPU_LABEL)]
          .map(([v, label]) => `<option value="${v}" ${lobbyOwners[i] === v ? 'selected' : ''}>${esc(label)}</option>`)
          .join('');
        const col = `#${l.colour.toString(16).padStart(6, '0')}`;
        return `<div class="slot" style="background:${col}33;border-color:${col}"><b>${esc(l.name)}</b> <span class="emb" style="color:${col}">${l.emblem}</span> <span class="hand">side ${'ABCD'[setup.sides[i] ?? i]}</span><select data-owner="${i}">${opts}</select></div>`;
      })
      .join('');
    for (const sel of document.querySelectorAll<HTMLSelectElement>('#lobbySlots select[data-owner]')) {
      sel.addEventListener('change', () => {
        lobbyOwners[Number(sel.dataset.owner)] = sel.value;
        lobbyManual[Number(sel.dataset.owner)] = true;
        shareLobby();
      });
    }
    ($('lbMap') as HTMLSelectElement).value = mapKind;
    ($('lbTheme') as HTMLSelectElement).value = theme;
    $('lobbyNote').textContent = 'Teams, sides and rules come from your match setup (Hot-seat → setup). Pick who plays each team, then start.';
  } else {
    const lobby = online.lobby;
    $('lobbySlots').innerHTML = (lobby?.slots ?? [])
      .map((sl) => {
        const col = `#${sl.colour.toString(16).padStart(6, '0')}`;
        const owner = CPU_LABEL[sl.owner] ?? online!.nameOf(sl.owner);
        return `<div class="slot" style="background:${col}33;border-color:${col}"><b>${esc(sl.team)}</b> <span class="hand">side ${'ABCD'[sl.side] ?? '?'}</span><div class="names">${esc(owner)}${sl.owner === online!.id ? ' (you)' : ''}</div></div>`;
      })
      .join('');
    $('lobbyNote').textContent = lobby ? `${lobby.summary} — waiting for the host to start.` : 'Waiting for the host…';
  }
}

/** Tell the room what the host has set up (only when it changed: the room echoes it back). */
let lobbySent = '';
function shareLobby(): void {
  if (!online?.isHost) return;
  renderLobbyOwnersOnly();
  const setup = lobbySetup();
  const looks = looksFor(settings, setup);
  const preset = setup.preset === 'custom' ? 'custom rules' : setup.preset;
  const mapName = mapKind === 'slice' ? 'Slice Island' : mapKind === 'objects' ? 'built from the theme' : `random ${mapKind}`;
  const lobby = {
    summary: `${mapName} · ${THEMES[theme].name} · ${preset} · ${setup.size} each`,
    slots: looks.map((l, i) => ({ team: l.name, colour: l.colour, owner: lobbyOwners[i] ?? 'cpu:normal', side: setup.sides[i] ?? i })),
  };
  const key = JSON.stringify(lobby) + online.code;
  if (key === lobbySent) return;
  lobbySent = key;
  online.send({ type: 'lobby', lobby });
}

/** Keep the owner list valid for the players in the room (host): slots the host has not
 *  picked by hand go to players in join order, then to CPUs. */
function renderLobbyOwnersOnly(): void {
  if (!online) return;
  const setup = lobbySetup();
  const present = online.players.filter((p) => p.connected).map((p) => p.id);
  const owners: string[] = [];
  setup.teams.forEach((_, i) => {
    const cur = lobbyOwners[i];
    if (lobbyManual[i] && cur && (isCpuOwner(cur) || present.includes(cur))) owners.push(cur);
    else owners.push('');
  });
  setup.teams.forEach((_, i) => {
    if (owners[i]) return;
    owners[i] = present.find((id) => !owners.includes(id)) ?? 'cpu:normal';
  });
  lobbyOwners = owners;
}

function onlineError(message: string): void {
  const el = $(run?.net || !$('lobby').classList.contains('hidden') ? 'lobbyNote' : 'onError');
  el.textContent = message;
  if (run?.net) run.hud.banner(message, 3000);
}

async function connectOnline(code: string | null): Promise<void> {
  pack = await loadArtPack(theme);
  const name = ($('onName') as HTMLInputElement).value.trim() || 'Player';
  const url = ($('onServer') as HTMLInputElement).value.trim() || defaultServer();
  online?.leave();
  lobbyOwners = [];
  lobbyManual.length = 0;
  lobbySent = '';
  $('onError').textContent = 'Connecting…';
  online = new OnlineClient({
    room: () => {
      $('onError').textContent = '';
      if (!online!.started && !run?.net) {
        renderLobby();
        shareLobby();
        if ($('lobby').classList.contains('hidden') && $('results').classList.contains('hidden')) showScreen('lobby');
      }
    },
    start: (match) => void startOnline(match),
    catchup: (match, frames, cmds) => {
      resyncAsked = false;
      void startOnline(match, frames, cmds);
    },
    frames: (from, frames, cmds) => {
      if (!run?.net || netPending) {
        netBuffer.push({ from, frames, cmds }); // the match is still being built
        return;
      }
      // a gap: ask for the whole log
      if (run.net.ls.receive(from, frames, cmds)) return;
      if (!resyncAsked) online?.send({ type: 'resync' });
      resyncAsked = true;
    },
    desync: (tick) => {
      if (run?.net && !run.net.desynced) {
        run.net.desynced = true;
        run.hud.banner(`Out of sync at tick ${tick} — please report this match`, 5000);
      }
    },
    backToLobby: () => {
      endMatch();
      renderLobby();
      shareLobby();
      showScreen('lobby');
    },
    error: (message) => onlineError(message),
    down: (retrying) => {
      if (retrying) onlineError('Connection lost — reconnecting…');
      else {
        endMatch();
        showScreen('onlineScreen');
        $('onError').textContent = 'Could not reach the server. Is it running? (see README: Online)';
      }
    },
  });
  online.connect(url, name, code);
}

/** In-game menu (Esc / ☰): the sim stops while it is open. */
function openPause(): void {
  if (!run || run.over) return;
  $('instantBtn').classList.toggle('hidden', !!run.net);
  $('restartBtn').classList.toggle('hidden', !!run.net);
  if (run.net) {
    showScreen('pause'); // online, the match goes on while the menu is open
    return;
  }
  run.session.paused = true;
  showScreen('pause');
}
function closePause(): void {
  if (!run) return;
  run.session.paused = false;
  run.session.loop.reset();
  showScreen(null);
}

function endMatch(): void {
  if (!run) return;
  if (run.replay?.live) run.replay.live.view.destroy();
  run.view.destroy();
  run = null;
  $('replayBar').classList.add('hidden');
}

function selectWeapon(i: number): void {
  if (!run) return;
  const m = run.session.state.match;
  if (!m || m.phase !== 'turnActive' || m.shotsFired > 0 || cpuTurn() || run.replay || !myTurn(run)) return;
  run.session.command({ type: 'selectWeapon', index: i });
  audio.play('select');
}

/** Q / E: previous / next selectable weapon. */
function cycleWeapon(dir: number): void {
  if (!run || run.replay || !myTurn(run)) return;
  const s = run.session.state;
  const act = s.characters.find((c) => c.id === s.activeCharacter);
  const team = act && s.match ? s.match.teams[act.team] : undefined;
  const list = s.weapons.map((w, i) => (w.hidden || team?.ammo[i] === 0 || delayLeft(s, act?.id ?? 0, i) > 0 ? -1 : i)).filter((i) => i >= 0);
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
  if (!w?.needsTarget || s.match?.phase !== 'turnActive' || (s.match?.shotsFired ?? 0) > 0 || cpuTurn() || run.replay || !myTurn(run)) return;
  const p = run.camera.screenToWorld(sx, sy);
  run.session.command({ type: 'setTarget', x: Math.round(p.x), y: Math.round(p.y) });
}

function showResults(): void {
  if (!run) return;
  const s = run.session.state, m = s.match!;
  const winner = m.result === 'win' ? m.teams[m.winner]! : null;
  $('resPill').textContent = winner ? 'VICTORY' : 'DRAW';
  $('resTitle').textContent = winner ? winnerLine(run) : 'Everybody popped!';
  // series bookkeeping and scoreboard
  const sr = series && series.setup === run.setup ? series : null;
  if (sr && !run.recorded) {
    run.recorded = true;
    const per = new Map<number, { dealt: number; kills: number }>();
    for (const [id, st] of run.session.charStats) {
      const c = s.characters.find((x) => x.id === id);
      if (!c) continue;
      const ti = run.setup.teams[c.team]!;
      const t = per.get(ti) ?? { dealt: 0, kills: 0 };
      t.dealt += st.dealt;
      t.kills += st.kills;
      per.set(ti, t);
    }
    recordMatch(sr, winner ? winner.side : -1, [...per.entries()].map(([team, v]) => ({ team, ...v })));
  }
  const box = $('resSeries');
  box.classList.toggle('hidden', !sr || sr.length <= 1);
  if (sr && sr.length > 1) {
    const need = toWin(sr.length);
    box.innerHTML = sidesOf(sr.setup)
      .map((side) => {
        const w = sr.wins[side] ?? 0;
        const pips = '●'.repeat(w) + '○'.repeat(Math.max(0, need - w));
        return `<div class="sd ${sr.champion === side ? 'champ' : ''}">${esc(sideName(sr.setup, side))} <span class="pips">${pips}</span></div>`;
      })
      .join('');
    if (sr.over) {
      $('resPill').textContent = 'SERIES';
      $('resTitle').textContent = sr.champion >= 0 ? `${sideName(sr.setup, sr.champion)} take${sr.setup.sides.filter((x) => x === sr.champion).length > 1 ? '' : 's'} the series!` : 'The series ends level!';
    }
    ($('rematchBtn') as HTMLButtonElement).textContent = sr.over ? 'New series' : `Next match (${sr.played + 1})`;
  } else ($('rematchBtn') as HTMLButtonElement).textContent = run.net ? (online?.isHost ? 'Back to the lobby' : 'The host picks what next') : 'Rematch';
  ($('rematchBtn') as HTMLButtonElement).disabled = !!run.net && !online?.isHost;
  const secs = Math.round(s.tick / TICKS_PER_SECOND);
  $('resSub').textContent = `${m.turn} turn${m.turn === 1 ? '' : 's'} · ${Math.floor(secs / 60)} min ${secs % 60} s${m.suddenDeath ? ' · went to sudden death' : ''}`;
  const rows = m.teams
    .map((t) => {
      const st = run!.session.stats[t.id]!;
      const alive = s.characters.filter((c) => c.team === t.id && c.state !== 'dead').length;
      return `<tr><td><b>${t.name}</b></td><td>${alive}/${t.characterIds.length}</td><td>${st.damageTaken}</td><td>${st.shots}</td></tr>`;
    })
    .join('');
  const name = (id: number) => run!.hud.gumlingName(id);
  $('resAwards').innerHTML = awardsFor(run.session.charStats, run.session.deaths, s, name)
    .map((a) => `<div class="award"><b>${a.title}</b><span>${a.text.replace(/</g, '&lt;')}</span></div>`)
    .join('');
  $('resTable').innerHTML = `<tr><th></th><th>STANDING</th><th>DAMAGE TAKEN</th><th>ATTACKS</th></tr>${rows}`;
  if (sr?.over && sr.totals.size) {
    const best = [...sr.totals.entries()].sort((a, b) => b[1].kills - a[1].kills || b[1].dealt - a[1].dealt)[0]!;
    $('resSub').textContent += ` · series MVP team: ${settings.teams[best[0]]!.name} (${best[1].kills} KO, ${best[1].dealt} dmg over ${sr.played} matches)`;
  }
  showScreen('results');
}

// ------------------------------------------------------------------ sim events → presentation
/** Stereo position (−1 left … 1 right) of a world x on screen. */
function panAt(r: Running, x: number): number {
  const sx = r.camera.worldToScreen(x, 0).x / Math.max(1, r.camera.viewW);
  return Math.max(-0.8, Math.min(0.8, sx * 2 - 1));
}

function charX(r: Running, id: number): number {
  const c = r.session.state.characters.find((x) => x.id === id);
  return c ? subToPxFloat(c.body.x) : r.camera.x;
}
function onEvents(r: Running, events: SimEvent[]): void {
  const now = performance.now();
  for (const e of events) {
    r.view.onEvent(e);
    r.ticker.onEvent(e, r.session.state, (id) => r.hud.gumlingName(id));
    switch (e.type) {
      case 'TurnStarted':
        // remember the turn's start (instant replay of the last turn)
        if (!r.replay) r.lastTurn = { state: cloneState(r.session.state), inputs: r.session.inputs.length, commands: r.session.commands.length };
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
        audio.play('bounce', e.speed / (256 * 6), panAt(r, e.x));
        break;
      case 'Exploded':
        r.director.explosion(e.x, e.y, now);
        audio.play(e.cause === 'death' ? 'pop' : e.radius >= 44 ? 'bigBoom' : 'boom', 1, panAt(r, e.x));
        break;
      case 'ProjectileSplashed':
        audio.play('splash', 1, panAt(r, e.x));
        break;
      case 'CharacterEnteredWater':
        audio.play('splash', 1, panAt(r, charX(r, e.id)));
        audio.play('byebye', 1, panAt(r, charX(r, e.id)));
        break;
      case 'CharacterJumped':
        audio.play('jump', 1, panAt(r, charX(r, e.id)));
        break;
      case 'CharacterLanded':
        if (e.impact > 256 * 3) audio.play('land', e.impact / (256 * 8), panAt(r, charX(r, e.id)));
        if (e.damage > 0) audio.play('oof', 1, panAt(r, charX(r, e.id)));
        break;
      case 'CharacterDamaged':
        audio.play('reveal');
        audio.play('ouch', 1, panAt(r, charX(r, e.id)));
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
        r.hud.banner(e.kind === 'health' ? 'A candy box is coming!' : e.kind === 'utility' ? 'A toolbox is coming!' : 'A surprise box is coming!', 1600);
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
      case 'UtilityUsed':
        audio.play(e.kind === 'teleport' ? 'whistle' : e.kind === 'skip' ? 'select' : e.kind === 'jetpack' ? 'throw' : e.kind === 'parachute' ? 'jump' : 'sizzle');
        if (e.kind === 'teleport') r.director.release();
        break;
      case 'UtilityFailed':
        audio.play('tick');
        break;
      case 'GirderPlaced':
        audio.play('thwack');
        break;
      case 'ObjectDeployed':
        audio.play('select');
        break;
      case 'RopeShot':
        audio.play('throw');
        break;
      case 'RopeAttached':
        audio.play('land', 0.4);
        break;
      case 'RopeReleased':
        audio.play('jump');
        break;
      case 'RopeMissed':
        audio.play('tick');
        break;
      case 'MatchEnded':
        audio.jingle(e.result === 'win' ? 'victory' : 'draw');
        if (e.result === 'win') audio.play('cheer');
        r.hud.banner(winnerLine(r), 2500);
        if (r.replay) break;
        r.over = true;
        window.setTimeout(() => {
          if (run === r) showResults();
        }, 2600);
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
  if (r.replay) {
    const rp = r.replay;
    const adv = r.session.loop.advance(now);
    if (rp.playing) {
      for (let i = 0; i < adv.steps * rp.speed; i++) {
        if (!replayStep(r, true)) {
          rp.playing = false;
          break;
        }
      }
    }
    alpha = rp.playing ? adv.alpha : 1;
    updateReplayBar(r);
  } else if (r.net) {
    alpha = netFrame(r, now);
  } else if (!r.session.paused) {
    // the CPU thinks between ticks, a slice per frame so the game keeps running smoothly
    cpuTurn(r)?.think(9);
    const adv = r.session.loop.advance(now);
    for (let i = 0; i < adv.steps; i++) {
      r.view.snapshot();
      const act = s.characters.find((c) => c.id === s.activeCharacter);
      keyboard.charging = !!act && (act.state === 'charging' || act.power > 0);
      const human = keyboard.frame(); // read every tick so held keys stay in sync
      const cpu = cpuTurn(r);
      let input = human;
      if (cpu) {
        const st = cpu.control(s);
        for (const c of st.cmds ?? []) r.session.command(c);
        input = st.input;
      }
      onEvents(r, r.session.tick(input));
    }
    alpha = adv.alpha;
  }
  // music: tenser in the last seconds of a turn, minor in sudden death
  const m = s.match!;
  audio.setIntensity(m.suddenDeath ? 2 : m.phase === 'turnActive' && m.turnTicksLeft <= 10 * TICKS_PER_SECOND ? 1 : 0);
  // last-5-seconds tick
  if (m.phase === 'turnActive') {
    const sec = Math.ceil(m.turnTicksLeft / TICKS_PER_SECOND);
    if (sec !== r.lastTickSecond && sec <= 5 && sec > 0) audio.play('tick');
    r.lastTickSecond = sec;
  }
  // camera
  const scene: CameraScene = {
    projectiles: s.projectiles.map((p) => ({ x: subToPxFloat(p.x), y: subToPxFloat(p.y), vx: subToPxFloat(p.vx), vy: subToPxFloat(p.vy) })),
    flyers: s.characters
      .filter((c) => c.state === 'air' || c.state === 'rope')
      .map((c) => ({ x: subToPxFloat(c.body.x), y: subToPxFloat(c.body.y), speed: Math.hypot(subToPxFloat(c.body.vx), subToPxFloat(c.body.vy)) })),
    active: (() => {
      const a = s.characters.find((c) => c.id === s.activeCharacter && c.state !== 'dead');
      return a ? { x: subToPxFloat(a.body.x), y: subToPxFloat(a.body.y) - 30 } : null;
    })(),
  };
  r.director.update(r.camera, scene, now, app.ticker.deltaMS);
  r.view.update(r.camera, alpha, now, { pending: false });
  r.hud.update();
  r.ticker.update(now);
}

// ------------------------------------------------------------------ boot
declare const __GUMFIRE_VERSION__: string;
declare const __GUMFIRE_BUILT__: string;
const GAME_VERSION = typeof __GUMFIRE_VERSION__ === 'string' ? __GUMFIRE_VERSION__ : 'dev';
const GAME_BUILT = typeof __GUMFIRE_BUILT__ === 'string' ? __GUMFIRE_BUILT__ : 'now';

/** Something broke (M20): say so on screen instead of freezing silently, with a way out. */
function showCrash(message: string): void {
  const el = $('error');
  if (!el) return;
  el.textContent = `Oops — ${message} `;
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = 'Reload';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });
  el.append(a);
  el.classList.remove('hidden');
  window.setTimeout(() => el.classList.add('hidden'), 12000);
}
window.addEventListener('error', (e) => {
  if (e.message && !/ResizeObserver/.test(e.message)) showCrash(e.message);
});
window.addEventListener('unhandledrejection', (e) => showCrash(String((e.reason as Error | undefined)?.message ?? e.reason)));

async function main(): Promise<void> {
  app = new Application();
  await app.init({ resizeTo: window, background: 0x98e4fc, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
  $('stage').appendChild(app.canvas);
  app.ticker.add(frame);
  window.addEventListener('resize', () => run?.camera.setViewport(window.innerWidth, window.innerHeight));

  $('startBtn').addEventListener('click', () => {
    series = newSeries({ ...settings.match, teams: [...settings.match.teams], control: [...settings.match.control], sides: [...settings.match.sides] });
    void startMatch(series.setup);
  });
  const aiLevel = $('aiLevel') as HTMLSelectElement;
  aiLevel.value = settings.aiLevel;
  aiLevel.addEventListener('change', () => {
    settings.aiLevel = aiLevel.value === 'easy' || aiLevel.value === 'hard' ? aiLevel.value : 'normal';
    saveSettings(settings);
  });
  $('goAi').addEventListener('click', () => {
    audio.unlock();
    series = newSeries(quickSetup());
    void startMatch(series.setup);
  });
  for (const id of ['optTheme', 'lbTheme']) $(id).innerHTML = THEME_IDS.map((t) => `<option value="${t}">${THEMES[t].name}</option>`).join('');
  const optMap = $('optMap') as HTMLSelectElement, optTheme = $('optTheme') as HTMLSelectElement;
  optMap.addEventListener('change', () => {
    mapKind = optMap.value as MapKind;
    void drawPreview();
  });
  optTheme.addEventListener('change', () => {
    theme = themeOf(optTheme.value);
    void drawPreview();
  });
  $('reseedBtn').addEventListener('click', () => {
    mapSeed = (mapSeed * 48271 + 11) % 100000;
    void drawPreview();
  });
  void drawPreview();
  $('rematchBtn').addEventListener('click', () => {
    if (run?.net) {
      if (online?.isHost) online.send({ type: 'backToLobby' });
      return;
    }
    // in a series: the next match on a fresh map; after it: a new series
    if (series && run && series.setup === run.setup) {
      if (series.over) series = newSeries(series.setup);
      if (mapKind !== 'slice') {
        mapSeed = (mapSeed * 48271 + 11) % 100000;
      }
    }
    void startMatch();
  });
  $('watchBtn').addEventListener('click', () => {
    if (run && !run.replay) openReplay(liveRecording(run), undefined, run);
  });
  $('saveReplayBtn').addEventListener('click', saveReplay);
  $('instantBtn').addEventListener('click', () => {
    if (!run || run.replay || !run.lastTurn) return;
    openReplay(liveRecording(run, run.lastTurn), run.lastTurn.state, run);
  });
  // ---- online (M17)
  ($('onServer') as HTMLInputElement).value = defaultServer();
  try {
    ($('onName') as HTMLInputElement).value = window.localStorage.getItem('gumfire.name') ?? '';
  } catch {
    /* no storage */
  }
  $('onName').addEventListener('change', () => {
    try {
      window.localStorage.setItem('gumfire.name', ($('onName') as HTMLInputElement).value.trim());
    } catch {
      /* no storage */
    }
  });
  $('goOnline').addEventListener('click', () => {
    audio.unlock();
    $('onError').textContent = '';
    showScreen('onlineScreen');
  });
  $('onlineBack').addEventListener('click', () => showScreen('title'));
  $('onCreate').addEventListener('click', () => void connectOnline(null));
  $('onJoin').addEventListener('click', () => {
    const code = ($('onCode') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length === 4) void connectOnline(code);
    else $('onError').textContent = 'Room codes have four letters.';
  });
  $('lobbyLeave').addEventListener('click', () => {
    online?.leave();
    online = null;
    showScreen('title');
  });
  $('lobbyStart').addEventListener('click', async () => {
    if (!online?.isHost) return;
    const setup = lobbySetup();
    if (new Set(setup.sides).size < 2) return onlineError('Everybody is on one side — change the sides in the match setup.');
    online.send({ type: 'start', match: await hostMatch() });
  });
  ($('lbMap') as HTMLSelectElement).addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    mapKind = v as MapKind;
    shareLobby();
  });
  ($('lbTheme') as HTMLSelectElement).addEventListener('change', (e) => {
    theme = themeOf((e.target as HTMLSelectElement).value);
    shareLobby();
  });
  $('lbReseed').addEventListener('click', () => {
    mapSeed = (mapSeed * 48271 + 11) % 100000;
    shareLobby();
  });
  $('goReplay').addEventListener('click', () => ($('replayFile') as HTMLInputElement).click());
  $('replayFile').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const data = decodeReplay(await file.text(), 13);
      pack = await loadArtPack(data.theme);
      openReplay(data, undefined, null);
    } catch (err) {
      $('error').textContent = err instanceof ReplayError ? err.message : `Could not open the replay: ${String(err)}`;
      $('error').classList.remove('hidden');
      window.setTimeout(() => $('error').classList.add('hidden'), 4000);
    }
  });
  $('rpPlay').addEventListener('click', () => {
    if (run?.replay) {
      if (!run.replay.playing && run.session.state.tick - run.replay.base >= run.replay.data.inputs.length) seekReplay(run.replay.base);
      run.replay.playing = !run.replay.playing;
      run.session.loop.reset();
    }
  });
  $('rpSpeed').addEventListener('click', () => {
    if (run?.replay) run.replay.speed = run.replay.speed >= 8 ? 1 : run.replay.speed * 2;
  });
  $('rpRestart').addEventListener('click', () => run?.replay && seekReplay(run.replay.base));
  $('rpPrev').addEventListener('click', () => replayTurnStep(-1));
  $('rpNext').addEventListener('click', () => replayTurnStep(1));
  $('rpExit').addEventListener('click', closeReplay);
  window.addEventListener('keydown', (e) => {
    if (!run?.replay) return;
    if (e.code === 'Escape') closeReplay();
    else if (e.code === 'Space') $('rpPlay').click();
    else if (e.code === 'ArrowLeft') replayTurnStep(-1);
    else if (e.code === 'ArrowRight') replayTurnStep(1);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  $('pauseBtn').addEventListener('click', openPause);
  $('resumeBtn').addEventListener('click', closePause);
  $('restartBtn').addEventListener('click', () => void startMatch());
  $('quitBtn').addEventListener('click', () => {
    const wasOnline = !!run?.net;
    endMatch();
    if (wasOnline) online?.leave();
    showScreen('title');
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !run || run.over || run.replay) return;
    if (run.hud.isPanelOpen) run.hud.togglePanel(false);
    else if (run.session.paused && !$('pause').classList.contains('hidden')) closePause();
    else openPause();
  });
  $('prevW').addEventListener('click', () => cycleWeapon(-1));
  $('nextW').addEventListener('click', () => cycleWeapon(1));
  $('panelBtn').addEventListener('click', () => run?.hud.togglePanel());
  // ---- menus (M14)
  const menus = new Menus(settings, applySettings);
  applySettings(settings);
  $('goSetup').addEventListener('click', () => {
    audio.unlock();
    menus.renderSetup();
    void drawPreview();
    showScreen('setup');
  });
  $('goTeams').addEventListener('click', () => {
    menus.renderTeams();
    showScreen('teamsScreen');
  });
  $('goAbout').addEventListener('click', () => showScreen('about'));
  $('aboutBack').addEventListener('click', () => showScreen('title'));
  $('version').textContent = `v${GAME_VERSION}`;
  $('aboutBuild').textContent = `Version ${GAME_VERSION} · built ${GAME_BUILT}`;
  $('goOptions').addEventListener('click', () => {
    menus.renderOptions();
    showScreen('optionsScreen');
  });
  for (const id of ['setupBack', 'teamsBack', 'optionsBack']) $(id).addEventListener('click', () => showScreen('title'));
  $('menuBtn').addEventListener('click', () => {
    const wasOnline = !!run?.net;
    endMatch();
    if (wasOnline) online?.leave();
    showScreen('title');
  });
  $('helpBtn').addEventListener('click', () => $('help').classList.toggle('hidden'));
  const toggleMute = () => {
    settings.muted = !settings.muted;
    menus.settings.muted = settings.muted;
    applySettings(settings);
  };
  $('muteBtn').addEventListener('click', toggleMute);
  const toggleMusic = () => {
    settings.musicOn = !settings.musicOn;
    menus.settings.musicOn = settings.musicOn;
    saveSettings(settings);
    applySettings(settings);
  };
  for (const id of ['titleMusic', 'musicBtn', 'pauseMusic']) $(id).addEventListener('click', toggleMusic);
  $('followBtn').addEventListener('click', () => run?.director.release());

  window.addEventListener('keydown', (e) => {
    if (!run || run.over || run.replay || !keyboard.enabled) return;
    if (e.code === settings.keys.prevWeapon) cycleWeapon(-1);
    if (e.code === settings.keys.nextWeapon) cycleWeapon(1);
    if (e.code === 'KeyF') run.director.release();
    if (e.code === settings.keys.panel) {
      e.preventDefault();
      run.hud.togglePanel();
    }
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyN') toggleMusic();
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
    if (e.button === 2) return; // right-click opens the weapon panel
    run?.hud.togglePanel(false);
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
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (run && !run.over) run.hud.togglePanel();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!run) return;
      e.preventDefault();
      run.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // the first click or key anywhere wakes the audio (browsers need a gesture), menu music starts
  const wake = () => {
    audio.unlock();
    audio.playMusic(run ? run.theme : 'menu');
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);

  // debug hook for automated browser checks
  (globalThis as Record<string, unknown>).__gumfire = {
    /** Render a tune offline to a WAV (base64), to check the music without speakers. */
    renderMusic: async (id: MusicId, seconds = 16, intensity = 0) => {
      const rate = 32000;
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
      const noise = ctx.createBuffer(1, rate, rate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < rate; i++) d[i] = Math.random() * 2 - 1;
      const bus = ctx.createGain();
      bus.gain.value = 0.32 * 0.8;
      bus.connect(ctx.destination);
      new Music(ctx, bus, noise).prerender(id, seconds, intensity);
      const buf = await ctx.startRendering();
      return wavBase64(buf);
    },
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
