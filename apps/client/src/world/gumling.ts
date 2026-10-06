import { Container, FillGradient, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { GumlingArt } from './artPack';

/**
 * Placeholder Gumling art in the reference style (docs/art/STYLE.md): a translucent gummy bean
 * with stubby arms and feet, thick dark outline, one highlight, simple face, and a role hat.
 * Drawn with vector Graphics so it stays crisp at every zoom; replaced by the final rig at M18.
 * The container's origin is the character's centre (the sim's body centre); feet touch y = +9.
 */
export const OUTLINE = 0x1a1320;

export type Hat = 'helmet' | 'aviator' | 'chef' | 'bandana' | 'miner' | 'beret' | 'hardhat' | 'captain';
export type Face = 'open' | 'squint' | 'x' | 'grin' | 'wince';

export interface GumlingView {
  root: Container;
  /** Everything that flips with facing and squashes. */
  body: Container;
  face: Graphics;
  /** Feet (walk cycle) and the soft contact shadow. */
  feet: Graphics;
  shadow: Graphics;
  /** The hand in front, holding the selected weapon; rotates with the aim. */
  hand: Container;
  held: Sprite;
  heldId: string;
  colour: number;
  feetPhase: number;
  name: Text;
  hp: Text;
  pending: Text;
  marker: Graphics;
  grave: Graphics;
  squash: number;
  flash: number;
  shownHp: number;
  blinkAt: number;
  diedOf: 'drowned' | 'lost' | 'hp' | null;
  /** The hat covers the mouth. */
  masked: boolean;
  /** Painted body (art pack): a team-tinted pose sprite instead of the vector body and feet. */
  pose: Sprite | null;
  poses: GumlingArt['poses'] | null;
  poseName: Pose;
}

export type Pose = 'idle' | 'walk' | 'jump' | 'hurt';

/** Switch the painted body to another pose (no-op for vector Gumlings). */
export function setPose(v: GumlingView, pose: Pose): void {
  if (!v.pose || !v.poses || v.poseName === pose) return;
  const tex = v.poses[pose] ?? v.poses.idle;
  if (!tex) return;
  v.poseName = pose;
  v.pose.texture = tex;
  v.pose.scale.set(POSE_H / v.poses.idle!.height);
  // a flattened pose keeps the width of a standing one
  v.face.visible = pose !== 'hurt';
}

/** Painted body height in world px (feet at y = +10.5). */
const POSE_H = 29;

const lighten = (c: number, t: number) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.round(v + (255 - v) * t);
  return (f(r) << 16) | (f(g) << 8) | f(b);
};
const darken = (c: number, t: number) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v: number) => Math.round(v * (1 - t));
  return (f(r) << 16) | (f(g) << 8) | f(b);
};

function drawBody(g: Graphics, colour: number): void {
  const ink = { width: 2, color: OUTLINE };
  // arms (behind the body edge)
  g.ellipse(-9.6, 1.5, 3, 4.2).fill(darken(colour, 0.12)).stroke(ink);
  // the gummy bean: lit from the top left, a warm core, a dark rim (translucent candy)
  const grad = new FillGradient({
    type: 'radial',
    center: { x: 0.36, y: 0.28 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.72,
    colorStops: [
      { offset: 0, color: lighten(colour, 0.55) },
      { offset: 0.35, color: lighten(colour, 0.12) },
      { offset: 0.75, color: colour },
      { offset: 1, color: darken(colour, 0.32) },
    ],
    textureSpace: 'local',
  });
  g.roundRect(-9.5, -15, 19, 25, 9).fill(grad).stroke(ink);
  // inner glow (sub-surface) and a rim light on the shadow side
  g.roundRect(-6, -1, 12, 9, 5).fill({ color: lighten(colour, 0.35), alpha: 0.3 });
  g.moveTo(7.6, -8).quadraticCurveTo(9, 1, 6.5, 7.5).stroke({ width: 1.2, color: lighten(colour, 0.6), alpha: 0.55 });
  // glossy highlights
  g.ellipse(-4.8, -9.5, 2, 4).fill({ color: 0xffffff, alpha: 0.75 });
  g.circle(-2.2, -13, 1).fill({ color: 0xffffff, alpha: 0.8 });
}

/** Feet for a walk phase (−1..1). */
export function drawFeet(g: Graphics, colour: number, phase: number): void {
  g.clear();
  const ink = { width: 2, color: OUTLINE };
  const lift = (p: number) => Math.max(0, p) * 2.2;
  g.ellipse(-4.5 + phase * 1.6, 9 - lift(phase), 4.2, 2.7).fill(darken(colour, 0.18)).stroke(ink);
  g.ellipse(4.5 - phase * 1.6, 9 - lift(-phase), 4.2, 2.7).fill(darken(colour, 0.18)).stroke(ink);
}

/** Put a weapon texture in the hand (null = empty hand). Icons are drawn 48 px; held ≈ 13 px. */
export function holdWeapon(v: GumlingView, id: string, tex: Texture | null): void {
  if (v.heldId === id) return;
  v.heldId = id;
  if (tex) v.held.texture = tex;
  v.held.visible = !!tex;
  if (tex) v.held.scale.set(13 / Math.max(tex.width, tex.height));
}

function drawHat(g: Graphics, hat: Hat, colour: number): void {
  const ink = { width: 2, color: OUTLINE };
  switch (hat) {
    case 'helmet': // grey soldier helmet
      g.moveTo(-10, -11).arc(0, -11, 10, Math.PI, 0).closePath().fill(0x8d949e).stroke(ink);
      g.roundRect(-11, -12.5, 22, 3.2, 1.5).fill(0x6f7680).stroke({ width: 1.5, color: OUTLINE });
      g.ellipse(-4, -16, 3, 1.3).fill({ color: 0xffffff, alpha: 0.45 });
      break;
    case 'aviator': // leather cap with goggles
      g.moveTo(-10, -9).arc(0, -10, 10, Math.PI, 0).lineTo(10, -6).lineTo(-10, -6).closePath().fill(0x8a5a33).stroke(ink);
      g.circle(-3.6, -10.5, 3.3).circle(3.6, -10.5, 3.3).fill(0x9fd8f5).stroke(ink);
      g.circle(-4.4, -11.4, 1).circle(2.8, -11.4, 1).fill(0xffffff);
      break;
    case 'chef': // tall white toque
      g.roundRect(-8, -16, 16, 5, 2).fill(0xffffff).stroke(ink);
      g.circle(-5, -20, 5).circle(0, -23, 5.5).circle(5, -20, 5).fill(0xffffff).stroke(ink);
      g.rect(-7.2, -18, 14.4, 4).fill(0xffffff);
      break;
    case 'bandana': // dark mask over the lower face + knot
      g.roundRect(-9.5, -5.5, 19, 7, 3).fill(0x26222c).stroke(ink);
      g.poly([9, -5, 14, -8, 13, -2]).fill(0x26222c).stroke({ width: 1.5, color: OUTLINE });
      break;
    case 'miner': // yellow helmet with a lamp
      g.moveTo(-10, -11).arc(0, -11, 10, Math.PI, 0).closePath().fill(0xffc928).stroke(ink);
      g.roundRect(-11, -12.5, 22, 3.2, 1.5).fill(0xe6ad12).stroke({ width: 1.5, color: OUTLINE });
      g.circle(0, -17, 3.4).fill(0xfff6c2).stroke(ink);
      break;
    case 'beret': // floppy beret in a contrasting colour
      g.ellipse(1, -14.5, 10.5, 4.2).fill(0x3f63d8).stroke(ink);
      g.circle(1, -19, 1.4).fill(0x3f63d8).stroke({ width: 1.2, color: OUTLINE });
      break;
    case 'hardhat':
      g.moveTo(-9, -11).arc(0, -11, 9, Math.PI, 0).closePath().fill(0xff9f1c).stroke(ink);
      g.roundRect(-12, -12, 24, 3, 1.5).fill(0xff9f1c).stroke({ width: 1.5, color: OUTLINE });
      g.rect(-1.2, -19.5, 2.4, 8).fill(0xffc46b);
      break;
    case 'captain':
      g.roundRect(-9, -18, 18, 6, 2.5).fill(0xffffff).stroke(ink);
      g.roundRect(-10.5, -13, 21, 3, 1.5).fill(0x223a66).stroke({ width: 1.5, color: OUTLINE });
      g.circle(0, -15, 1.8).fill(0xffd23f);
      break;
  }
  void colour;
}

/**
 * Draw the face: big candy eyes with pupils that look along `look` (unit-ish vector in body
 * space, x towards the facing side), brows and a mouth per expression.
 */
export function drawFace(g: Graphics, face: Face, masked: boolean, lookX = 0.6, lookY = 0): void {
  g.clear();
  const ey = -7;
  const ink = { width: 1.4, color: OUTLINE };
  if (face === 'x') {
    for (const dx of [-3.6, 3.6]) g.moveTo(dx - 2, ey - 2).lineTo(dx + 2, ey + 2).moveTo(dx + 2, ey - 2).lineTo(dx - 2, ey + 2);
    g.stroke({ width: 1.8, color: OUTLINE });
    if (!masked) g.ellipse(0, 0.5, 2.2, 1.6).fill(OUTLINE);
    return;
  }
  const lid = face === 'squint' ? 0.45 : face === 'wince' ? 0.3 : 1;
  for (const dx of [-3.6, 3.6]) {
    // white of the eye, then the eyelid crop for squints
    g.ellipse(dx, ey, 3.2, 3.8 * lid + 0.4).fill(0xffffff).stroke(ink);
    if (lid > 0.4) {
      const px = dx + lookX * 1.3, py = ey + lookY * 1.4 + (face === 'grin' ? 0.3 : 0);
      g.circle(px, py, 1.75 * Math.min(1, lid + 0.2)).fill(OUTLINE);
      g.circle(px - 0.6, py - 0.7, 0.55).fill(0xffffff);
    }
  }
  // brows
  if (face === 'wince') g.moveTo(-6.2, ey - 4.6).lineTo(-1.4, ey - 3.2).moveTo(6.2, ey - 4.6).lineTo(1.4, ey - 3.2).stroke({ width: 1.6, color: OUTLINE });
  else if (face === 'grin') g.moveTo(-6, ey - 3.6).lineTo(-1.6, ey - 5).moveTo(6, ey - 3.6).lineTo(1.6, ey - 5).stroke({ width: 1.6, color: OUTLINE });
  if (masked) return;
  if (face === 'grin') {
    g.moveTo(-3.6, -1.2).quadraticCurveTo(0, 3.2, 3.6, -1.2).closePath().fill(0x5a1020).stroke(ink);
    g.rect(-2.2, -1.1, 4.4, 1).fill(0xffffff);
  } else if (face === 'wince') g.ellipse(0, 0, 2.4, 1.6).fill(0x5a1020).stroke(ink);
  else g.moveTo(-2.4, -1.4).quadraticCurveTo(0, 0.6, 2.4, -1.4).stroke({ width: 1.4, color: OUTLINE });
}

export function makeGumling(colour: number, hat: Hat, name: string, art: GumlingArt | null = null): GumlingView {
  const root = new Container();
  const body = new Container();
  const g = new Graphics();
  const feet = new Graphics();
  const face = new Graphics();
  let hatG: Container = new Graphics();
  let pose: Sprite | null = null;
  if (art?.poses.idle) {
    // painted candy body, tinted with the team colour; the code-drawn face sits on top
    pose = new Sprite(art.poses.idle);
    pose.anchor.set(0.5, 1);
    pose.position.set(0, 10.8);
    pose.scale.set(POSE_H / art.poses.idle.height);
    pose.tint = lighten(colour, 0.12);
    // glossy highlights survive the tint
    g.ellipse(-5.2, -10, 2.1, 3.6).fill({ color: 0xffffff, alpha: 0.6 });
    g.circle(-2.6, -13.6, 1).fill({ color: 0xffffff, alpha: 0.75 });
    const ht = art.hats[hat];
    if (ht) {
      const hs = new Sprite(ht);
      const fit = HAT_FIT[hat];
      hs.anchor.set(0.5, fit.anchor);
      hs.position.set(fit.dx, fit.y);
      hs.scale.set(fit.w / ht.width);
      hatG = hs;
    } else drawHat(hatG as Graphics, hat, colour);
  } else {
    drawBody(g, colour);
    drawFeet(feet, colour, 0);
    drawHat(hatG as Graphics, hat, colour);
  }
  // the front hand holds the weapon; it pivots at the shoulder
  const hand = new Container();
  hand.position.set(4, 1);
  const held = new Sprite();
  held.anchor.set(0.25, 0.55);
  held.position.set(5, 0);
  const mitt = new Graphics().circle(5, 1, 3.1).fill(darken(colour, 0.06)).stroke({ width: 1.8, color: OUTLINE });
  hand.addChild(held, mitt);
  if (pose) body.addChild(pose);
  if (pose && HAT_FIT[hat].faceOnTop) body.addChild(feet, g, hatG, face, hand);
  else body.addChild(feet, g, face, hatG, hand);
  const shadow = new Graphics().ellipse(0, 10.5, 10, 2.6).fill({ color: 0x1a1320, alpha: 0.22 });
  // pivot at the feet so squash keeps them planted
  body.pivot.set(0, 10);
  body.position.set(0, 10);
  const labelStyle = (size: number, fill: number) => ({
    fontFamily: 'Fredoka, "Trebuchet MS", sans-serif',
    fontSize: size,
    fontWeight: '700' as const,
    fill,
    stroke: { color: 0xffffff, width: 3.5 },
  });
  const nameT = new Text({ text: name, style: labelStyle(10, darken(colour, 0.35)), resolution: 3 });
  nameT.anchor.set(0.5, 1);
  nameT.position.set(0, -34);
  const hpT = new Text({ text: '', style: labelStyle(11, OUTLINE), resolution: 3 });
  hpT.anchor.set(0.5, 1);
  hpT.position.set(0, -23);
  const pending = new Text({ text: '', style: { ...labelStyle(9, 0xffffff), stroke: { color: 0xe8364f, width: 3 } }, resolution: 3 });
  pending.anchor.set(0, 1);
  pending.position.set(10, -23);
  pending.visible = false; // hidden information in a real match; the reveal shows the number
  const marker = new Graphics().poly([-5, 0, 5, 0, 0, 7]).fill(0xffffff).stroke({ width: 2, color: OUTLINE });
  marker.visible = false;
  // grave: a lollipop stick planted where a Gumling popped
  const grave = new Graphics()
    .rect(-1.5, -2, 3, 12)
    .fill(0xfff6ea)
    .stroke({ width: 1.2, color: OUTLINE })
    .circle(0, -7, 6.5)
    .fill(colour)
    .stroke({ width: 2, color: OUTLINE })
    .moveTo(-3.5, -8.5)
    .arc(0, -7, 3.5, Math.PI, Math.PI * 2.4)
    .stroke({ width: 1.4, color: 0xffffff, alpha: 0.8 });
  grave.visible = false;
  root.addChild(shadow, body, grave, nameT, hpT, pending, marker);
  return { root, body, face, feet, shadow, hand, held, heldId: '', colour, feetPhase: 0, name: nameT, hp: hpT, pending, marker, grave, squash: 0, flash: 0, shownHp: 100, blinkAt: 0, diedOf: null, masked: hat === 'bandana' && !pose, pose, poses: pose ? art!.poses : null, poseName: 'idle' };
}

/** Where each painted hat sits on the head: width (px), y of its anchor, vertical anchor. */
const HAT_FIT: Record<Hat, { w: number; y: number; anchor: number; dx: number; faceOnTop?: boolean }> = {
  // brims sit on the forehead, just over the top of the eyes (tuned with a contact sheet)
  helmet: { w: 21, y: -8.5, anchor: 1, dx: 0 },
  aviator: { w: 21, y: 2.5, anchor: 1, dx: 0, faceOnTop: true }, // flaps down the cheeks, face in the opening
  chef: { w: 17, y: -9.5, anchor: 1, dx: 0 },
  bandana: { w: 21, y: -8.5, anchor: 1, dx: 1 },
  miner: { w: 21, y: -8.5, anchor: 1, dx: 0 },
  beret: { w: 20, y: -10, anchor: 1, dx: 1 },
  hardhat: { w: 21, y: -8.5, anchor: 1, dx: 0 },
  captain: { w: 20, y: -9, anchor: 1, dx: 0 },
};

/** Roster flavour per team slot: hat + name (presentation only). */
export const ROSTERS: ReadonlyArray<ReadonlyArray<{ hat: Hat; name: string }>> = [
  [
    { hat: 'helmet', name: 'Pip' },
    { hat: 'aviator', name: 'Zippy' },
    { hat: 'chef', name: 'Mochi' },
    { hat: 'miner', name: 'Bolt' },
  ],
  [
    { hat: 'helmet', name: 'Rex' },
    { hat: 'bandana', name: 'Nib' },
    { hat: 'miner', name: 'Tuck' },
    { hat: 'beret', name: 'Jojo' },
  ],
  [
    { hat: 'captain', name: 'Salt' },
    { hat: 'hardhat', name: 'Brick' },
    { hat: 'chef', name: 'Suds' },
    { hat: 'aviator', name: 'Loop' },
  ],
];
