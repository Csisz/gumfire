import { Container, Graphics, Text } from 'pixi.js';

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
}

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
  // feet
  g.ellipse(-4.5, 9, 4, 2.6).ellipse(4.5, 9, 4, 2.6).fill(darken(colour, 0.12)).stroke(ink);
  // arms (behind the body edge)
  g.ellipse(-9.5, 1.5, 3, 4.2).fill(darken(colour, 0.08)).stroke(ink);
  g.ellipse(9.5, 1.5, 3, 4.2).fill(darken(colour, 0.08)).stroke(ink);
  // bean body
  g.roundRect(-9, -14, 18, 24, 8.5).fill({ color: colour, alpha: 0.96 }).stroke(ink);
  // inner glow + highlight
  g.roundRect(-6, -2, 12, 9, 5).fill({ color: lighten(colour, 0.25), alpha: 0.35 });
  g.ellipse(-4.8, -8.5, 1.8, 3.6).fill({ color: 0xffffff, alpha: 0.7 });
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

/** Draw the face (called every frame when the expression changes). */
export function drawFace(g: Graphics, face: Face, masked: boolean): void {
  g.clear();
  const ey = -6.5;
  if (face === 'x') {
    for (const dx of [-3.4, 3.4]) g.moveTo(dx - 1.8, ey - 1.8).lineTo(dx + 1.8, ey + 1.8).moveTo(dx + 1.8, ey - 1.8).lineTo(dx - 1.8, ey + 1.8);
    g.stroke({ width: 1.6, color: OUTLINE });
    return;
  }
  const h = face === 'squint' || face === 'wince' ? 0.9 : 2.4;
  g.ellipse(-3.4, ey, 1.6, h).ellipse(3.4, ey, 1.6, h).fill(OUTLINE);
  if (face === 'open' || face === 'grin') g.circle(-3, ey - 1, 0.6).circle(3.8, ey - 1, 0.6).fill(0xffffff);
  if (masked) return;
  if (face === 'grin') g.moveTo(-3, -2).quadraticCurveTo(0, 1.5, 3, -2).stroke({ width: 1.4, color: OUTLINE });
  else if (face === 'wince') g.moveTo(-2.5, -1).lineTo(2.5, -1).stroke({ width: 1.4, color: OUTLINE });
  else g.moveTo(-2, -2.2).quadraticCurveTo(0, -0.6, 2, -2.2).stroke({ width: 1.3, color: OUTLINE });
}

export function makeGumling(colour: number, hat: Hat, name: string): GumlingView {
  const root = new Container();
  const body = new Container();
  const g = new Graphics();
  drawBody(g, colour);
  const face = new Graphics();
  const hatG = new Graphics();
  drawHat(hatG, hat, colour);
  body.addChild(g, face, hatG);
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
  root.addChild(body, grave, nameT, hpT, pending, marker);
  return { root, body, face, name: nameT, hp: hpT, pending, marker, grave, squash: 0, flash: 0, shownHp: 100, blinkAt: 0, diedOf: null, masked: hat === 'bandana' };
}

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
