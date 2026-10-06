/**
 * Painted backdrop layers drawn with Canvas 2D (M15 art pass): gradients, rim light, soft
 * shadows, haze and blur give the "painted" depth of the reference boards without image files.
 * An art pack can replace any layer with a real painting (see artPack.ts).
 *
 * Every layer is drawn once at match start into a canvas `w`×`h` px that covers the world plus
 * its parallax overscan; Background scales and scrolls it.
 */
export type LayerId = 'sky' | 'far' | 'mid';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return { c, g: c.getContext('2d')! };
}

/** Deterministic pseudo-random from a seed (presentation only). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function lin(g: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Array<[number, string]>): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}
function rad(g: Ctx, x: number, y: number, r: number, stops: Array<[number, string]>): CanvasGradient {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

/** A soft cumulus cloud from overlapping lit puffs. */
function cloud(g: Ctx, x: number, y: number, s: number, r: () => number, tint: string, shade: string): void {
  g.save();
  g.filter = `blur(${Math.max(1, s * 0.04)}px)`;
  const puffs = 6 + Math.floor(r() * 4);
  for (let i = 0; i < puffs; i++) {
    const px = x + (i / (puffs - 1) - 0.5) * s * 2.2 + (r() - 0.5) * s * 0.3;
    const py = y - Math.sin((i / (puffs - 1)) * Math.PI) * s * 0.5 + (r() - 0.5) * s * 0.15;
    const pr = s * (0.38 + r() * 0.3);
    g.fillStyle = rad(g, px - pr * 0.3, py - pr * 0.4, pr * 1.3, [
      [0, tint],
      [0.7, tint],
      [1, shade],
    ]);
    g.beginPath();
    g.arc(px, py, pr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------------------ Frozen Snack Factory
function frozenSky(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  g.fillStyle = lin(g, 0, 0, 0, h, [
    [0, '#6cbfe9'],
    [0.55, '#bfe6f8'],
    [1, '#eef9ff'],
  ]);
  g.fillRect(0, 0, w, h);
  // cold sun glow
  g.fillStyle = rad(g, w * 0.72, h * 0.18, h * 0.6, [
    [0, 'rgba(255,255,255,0.85)'],
    [0.25, 'rgba(230,248,255,0.45)'],
    [1, 'rgba(230,248,255,0)'],
  ]);
  g.fillRect(0, 0, w, h);
  const r = rng(11);
  for (let i = 0; i < 9; i++) cloud(g, r() * w, h * (0.1 + r() * 0.35), h * (0.06 + r() * 0.08), r, 'rgba(255,255,255,0.95)', 'rgba(205,232,248,0.6)');
  return c;
}

function frozenFar(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const base = h * 0.97;
  const r = rng(23);
  // back haze band
  g.fillStyle = lin(g, 0, base - h * 0.6, 0, base, [
    [0, 'rgba(210,236,250,0)'],
    [1, 'rgba(210,236,250,0.9)'],
  ]);
  g.fillRect(0, base - h * 0.6, w, h * 0.6);
  // pipes and catwalks
  for (let k = 0; k < 10; k++) {
    const x = (k + 0.3) * (w / 10);
    g.fillStyle = lin(g, x, 0, x + 26, 0, [
      [0, '#a9cde3'],
      [0.4, '#e3f3fb'],
      [1, '#94bcd6'],
    ]);
    g.fillRect(x, base - h * 0.95, 26, h * 0.95);
  }
  for (const yy of [0.6, 0.42]) {
    g.fillStyle = lin(g, 0, base - h * yy, 0, base - h * yy + 18, [
      [0, '#e6f4fb'],
      [1, '#9cc3da'],
    ]);
    g.fillRect(0, base - h * yy, w, 18);
  }
  // big storage tanks: metallic cylinders with frost caps and rivets
  const tanks = [
    [0.06, 0.16, 0.72],
    [0.3, 0.12, 0.58],
    [0.52, 0.18, 0.8],
    [0.78, 0.14, 0.66],
  ] as const;
  for (const [fx, fw, fh] of tanks) {
    const x = fx * w, tw = fw * w, th = fh * h, y = base - th;
    g.fillStyle = lin(g, x, 0, x + tw, 0, [
      [0, '#8fb7d3'],
      [0.18, '#d8edf8'],
      [0.35, '#f4fbff'],
      [0.7, '#b7d6ea'],
      [1, '#7fa7c4'],
    ]);
    g.beginPath();
    g.roundRect(x, y, tw, th, tw * 0.12);
    g.fill();
    g.strokeStyle = 'rgba(90,130,165,0.6)';
    g.lineWidth = 3;
    g.stroke();
    // bands and rivets
    for (let b = 1; b < 4; b++) {
      g.fillStyle = 'rgba(120,160,190,0.35)';
      g.fillRect(x, y + (th * b) / 4, tw, 6);
      for (let k = 0; k < 8; k++) {
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.arc(x + ((k + 0.5) * tw) / 8, y + (th * b) / 4 + 3, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // frost cap with drips
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x + tw / 2, y + 6, tw * 0.54, 22, 0, Math.PI, 0);
    g.fill();
    for (let k = 0; k < 7; k++) {
      const dx = x + tw * (0.08 + r() * 0.84), len = 14 + r() * 40;
      g.beginPath();
      g.moveTo(dx - 6, y + 4);
      g.quadraticCurveTo(dx - 5, y + len, dx, y + len + 6);
      g.quadraticCurveTo(dx + 5, y + len, dx + 6, y + 4);
      g.fill();
    }
    // a glowing gauge
    g.fillStyle = rad(g, x + tw * 0.75, y + th * 0.3, 18, [
      [0, '#fff6c9'],
      [0.5, '#ffd23f'],
      [1, 'rgba(255,210,63,0)'],
    ]);
    g.beginPath();
    g.arc(x + tw * 0.75, y + th * 0.3, 18, 0, Math.PI * 2);
    g.fill();
  }
  // atmospheric haze over everything far away
  g.fillStyle = 'rgba(214,238,250,0.35)';
  g.fillRect(0, 0, w, h);
  return c;
}

function frozenMid(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const base = h * 0.99;
  const ink = 'rgba(70,100,130,0.75)';
  const shadow = (x: number, ww: number) => {
    g.fillStyle = rad(g, x, base, ww, [
      [0, 'rgba(60,90,120,0.35)'],
      [1, 'rgba(60,90,120,0)'],
    ]);
    g.beginPath();
    g.ellipse(x, base, ww, ww * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  };
  // a giant popsicle: rounded slab with a bite, glossy, on a stick
  const popsicle = (x: number, hh: number, col: [string, string, string]) => {
    const ww = hh * 0.42, y = base - hh;
    shadow(x + ww / 2, ww * 0.9);
    g.fillStyle = lin(g, 0, base - hh * 0.25, 0, base, [
      [0, '#e9c99a'],
      [1, '#c79d68'],
    ]);
    g.beginPath();
    g.roundRect(x + ww * 0.4, base - hh * 0.28, ww * 0.2, hh * 0.28, 8);
    g.fill();
    g.fillStyle = lin(g, x, 0, x + ww, 0, [
      [0, col[2]],
      [0.3, col[0]],
      [0.55, col[1]],
      [1, col[2]],
    ]);
    g.beginPath();
    g.roundRect(x, y, ww, hh * 0.78, ww * 0.45);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.stroke();
    // bite
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(x + ww, y + hh * 0.12, ww * 0.18, 0, Math.PI * 2);
    g.arc(x + ww * 0.9, y + hh * 0.02, ww * 0.14, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // gloss
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.roundRect(x + ww * 0.16, y + hh * 0.08, ww * 0.12, hh * 0.5, ww * 0.06);
    g.fill();
  };
  // an ice-cream tub with a frosty rim
  const tub = (x: number, ww: number, hh: number) => {
    shadow(x + ww / 2, ww * 0.7);
    g.fillStyle = lin(g, x, 0, x + ww, 0, [
      [0, '#b8d8ec'],
      [0.3, '#f2f9fd'],
      [1, '#a3c8e0'],
    ]);
    g.beginPath();
    g.moveTo(x, base - hh);
    g.lineTo(x + ww, base - hh);
    g.lineTo(x + ww * 0.9, base);
    g.lineTo(x + ww * 0.1, base);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = lin(g, 0, base - hh - 40, 0, base - hh, [
      [0, '#ffffff'],
      [1, '#d5ecf8'],
    ]);
    g.beginPath();
    g.roundRect(x - 14, base - hh - 34, ww + 28, 40, 18);
    g.fill();
    g.stroke();
    // a scoop peeking out
    g.fillStyle = rad(g, x + ww * 0.45, base - hh - 50, ww * 0.35, [
      [0, '#ffe4ee'],
      [0.7, '#f7b6cc'],
      [1, '#e48aa8'],
    ]);
    g.beginPath();
    g.arc(x + ww * 0.5, base - hh - 30, ww * 0.3, Math.PI, 0);
    g.fill();
    g.stroke();
  };
  // a cone with a melting scoop
  const cone = (x: number, hh: number) => {
    const ww = hh * 0.45;
    shadow(x, ww * 0.6);
    g.fillStyle = lin(g, x - ww / 2, 0, x + ww / 2, 0, [
      [0, '#c9965a'],
      [0.4, '#f0cf98'],
      [1, '#b98445'],
    ]);
    g.beginPath();
    g.moveTo(x - ww / 2, base - hh * 0.62);
    g.lineTo(x + ww / 2, base - hh * 0.62);
    g.lineTo(x, base);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.stroke();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(140,90,40,0.45)';
    g.lineWidth = 3;
    for (let k = -6; k < 8; k++) {
      g.beginPath();
      g.moveTo(x - ww / 2 + k * 22, base - hh * 0.62);
      g.lineTo(x - ww / 2 + k * 22 + hh * 0.6, base);
      g.moveTo(x + ww / 2 - k * 22, base - hh * 0.62);
      g.lineTo(x + ww / 2 - k * 22 - hh * 0.6, base);
      g.stroke();
    }
    g.restore();
    g.fillStyle = rad(g, x - ww * 0.15, base - hh * 0.8, ww * 0.7, [
      [0, '#ffffff'],
      [0.5, '#d9f1ff'],
      [1, '#9fd2ef'],
    ]);
    g.beginPath();
    g.arc(x, base - hh * 0.72, ww * 0.56, Math.PI * 0.95, Math.PI * 0.05);
    g.quadraticCurveTo(x + ww * 0.3, base - hh * 0.55, x, base - hh * 0.6);
    g.quadraticCurveTo(x - ww * 0.35, base - hh * 0.52, x - ww * 0.56, base - hh * 0.66);
    g.fill();
    g.stroke();
  };
  // translucent ice cubes
  const cube = (x: number, s: number) => {
    shadow(x + s / 2, s * 0.6);
    g.fillStyle = lin(g, x, base - s, x + s, base, [
      [0, 'rgba(255,255,255,0.95)'],
      [0.5, 'rgba(200,236,255,0.75)'],
      [1, 'rgba(150,205,235,0.8)'],
    ]);
    g.beginPath();
    g.roundRect(x, base - s, s, s, s * 0.16);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.roundRect(x + s * 0.14, base - s * 0.86, s * 0.2, s * 0.08, 4);
    g.fill();
  };
  tub(w * 0.03, w * 0.11, h * 0.36);
  popsicle(w * 0.22, h * 0.6, ['#ff8fb3', '#ffc2d6', '#e25a86']);
  cube(w * 0.38, h * 0.11);
  cube(w * 0.38 + h * 0.12, h * 0.09);
  cube(w * 0.385 + h * 0.04, h * 0.08 - 0);
  cone(w * 0.55, h * 0.62);
  popsicle(w * 0.68, h * 0.5, ['#7fd3ff', '#c9efff', '#3fa1d8']);
  tub(w * 0.84, w * 0.1, h * 0.3);
  // light haze so the mid layer sits behind the play field
  g.fillStyle = 'rgba(225,244,252,0.18)';
  g.fillRect(0, 0, w, h);
  return c;
}

// ------------------------------------------------------------------ Garden Picnic
function picnicSky(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  g.fillStyle = lin(g, 0, 0, 0, h, [
    [0, '#58b7ef'],
    [0.6, '#a9dcf7'],
    [1, '#fff3d6'],
  ]);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rad(g, w * 0.2, h * 0.15, h * 0.7, [
    [0, 'rgba(255,250,215,0.95)'],
    [0.2, 'rgba(255,240,190,0.5)'],
    [1, 'rgba(255,240,190,0)'],
  ]);
  g.fillRect(0, 0, w, h);
  const r = rng(7);
  for (let i = 0; i < 8; i++) cloud(g, r() * w, h * (0.08 + r() * 0.3), h * (0.07 + r() * 0.09), r, 'rgba(255,255,255,0.97)', 'rgba(220,232,250,0.6)');
  return c;
}

function picnicFar(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const base = h * 0.97;
  const r = rng(5);
  // two rows of rolling hills with tree clumps, bluish with distance
  const hills = (yb: number, amp: number, col: [string, string], seed: number) => {
    g.fillStyle = lin(g, 0, yb - amp * 2, 0, base, [
      [0, col[0]],
      [1, col[1]],
    ]);
    g.beginPath();
    g.moveTo(0, base);
    for (let x = 0; x <= w; x += 12) g.lineTo(x, yb - amp - Math.sin(x / (w * 0.09) + seed) * amp * 0.6 - Math.sin(x / (w * 0.031) + seed * 2) * amp * 0.15);
    g.lineTo(w, base);
    g.closePath();
    g.fill();
  };
  hills(base - h * 0.42, h * 0.12, ['#9fd3b8', '#c4e7cf'], 1);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = base - h * 0.5 + r() * h * 0.12, s = h * (0.03 + r() * 0.04);
    g.fillStyle = rad(g, x - s * 0.3, y - s * 0.4, s * 1.4, [
      [0, '#a7dcb1'],
      [1, '#6fb489'],
    ]);
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.arc(x + s * 0.8, y + s * 0.2, s * 0.8, 0, Math.PI * 2);
    g.arc(x - s * 0.8, y + s * 0.25, s * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  hills(base - h * 0.25, h * 0.1, ['#8ccf7a', '#b5e39a'], 4);
  // a fence along the far hill
  g.strokeStyle = 'rgba(240,230,210,0.9)';
  g.lineWidth = 6;
  for (let x = 20; x < w; x += 46) {
    g.beginPath();
    g.moveTo(x, base - h * 0.27);
    g.lineTo(x, base - h * 0.19);
    g.stroke();
  }
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, base - h * 0.245);
  g.lineTo(w, base - h * 0.245);
  g.moveTo(0, base - h * 0.215);
  g.lineTo(w, base - h * 0.215);
  g.stroke();
  g.fillStyle = 'rgba(220,240,250,0.3)';
  g.fillRect(0, 0, w, h);
  return c;
}

function picnicMid(w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const base = h * 0.99;
  const ink = 'rgba(90,60,60,0.8)';
  const shadow = (x: number, ww: number) => {
    g.fillStyle = rad(g, x, base, ww, [
      [0, 'rgba(60,70,40,0.35)'],
      [1, 'rgba(60,70,40,0)'],
    ]);
    g.beginPath();
    g.ellipse(x, base, ww, ww * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  };
  // checked picnic cloth draped along the bottom
  g.save();
  g.beginPath();
  g.moveTo(0, base - h * 0.08);
  for (let x = 0; x <= w; x += 20) g.lineTo(x, base - h * 0.08 + Math.sin(x / 80) * 6);
  g.lineTo(w, base + 10);
  g.lineTo(0, base + 10);
  g.closePath();
  g.clip();
  g.fillStyle = '#fff4f4';
  g.fillRect(0, base - h * 0.12, w, h * 0.2);
  g.fillStyle = 'rgba(232,54,79,0.55)';
  for (let x = 0; x < w; x += 44) g.fillRect(x, base - h * 0.12, 22, h * 0.2);
  for (let y = base - h * 0.12; y < base + 10; y += 22) g.fillRect(0, y, w, 11);
  g.restore();
  // a giant teacup with a saucer
  const cup = (x: number, s: number) => {
    shadow(x, s * 0.9);
    g.fillStyle = lin(g, 0, base - s * 0.12, 0, base, [
      [0, '#ffffff'],
      [1, '#d9e4ef'],
    ]);
    g.beginPath();
    g.ellipse(x, base - s * 0.06, s * 0.8, s * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = lin(g, x - s * 0.5, 0, x + s * 0.5, 0, [
      [0, '#c9d8e8'],
      [0.35, '#ffffff'],
      [1, '#b3c6db'],
    ]);
    g.beginPath();
    g.moveTo(x - s * 0.5, base - s * 0.75);
    g.lineTo(x + s * 0.5, base - s * 0.75);
    g.quadraticCurveTo(x + s * 0.48, base - s * 0.15, x, base - s * 0.12);
    g.quadraticCurveTo(x - s * 0.48, base - s * 0.15, x - s * 0.5, base - s * 0.75);
    g.fill();
    g.stroke();
    g.lineWidth = s * 0.07;
    g.strokeStyle = '#e9f0f7';
    g.beginPath();
    g.arc(x + s * 0.56, base - s * 0.5, s * 0.15, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    g.fillStyle = '#7fb3e6';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(x - s * 0.3 + k * s * 0.2, base - s * 0.45 + (k % 2) * s * 0.08, s * 0.05, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = lin(g, 0, base - s * 0.78, 0, base - s * 0.7, [
      [0, '#a8642c'],
      [1, '#7a4419'],
    ]);
    g.beginPath();
    g.ellipse(x, base - s * 0.75, s * 0.48, s * 0.07, 0, 0, Math.PI * 2);
    g.fill();
  };
  // a jam jar with a gingham lid
  const jar = (x: number, s: number) => {
    shadow(x + s * 0.4, s * 0.6);
    g.fillStyle = lin(g, x, 0, x + s * 0.8, 0, [
      [0, '#a8162f'],
      [0.35, '#e8445f'],
      [0.6, '#ff7d93'],
      [1, '#9c1229'],
    ]);
    g.beginPath();
    g.roundRect(x, base - s, s * 0.8, s, s * 0.12);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.roundRect(x + s * 0.1, base - s * 0.85, s * 0.08, s * 0.6, 6);
    g.fill();
    g.fillStyle = '#fff6ee';
    g.beginPath();
    g.roundRect(x + s * 0.12, base - s * 0.62, s * 0.56, s * 0.28, 10);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(x - s * 0.05, base - s * 1.1, s * 0.9, s * 0.16, 10);
    g.fill();
    g.fillStyle = 'rgba(232,54,79,0.75)';
    for (let k = 0; k < 6; k++) g.fillRect(x - s * 0.05 + k * s * 0.15, base - s * 1.1, s * 0.075, s * 0.16);
    g.strokeRect(x - s * 0.05, base - s * 1.1, s * 0.9, s * 0.16);
  };
  const berry = (x: number, s: number) => {
    shadow(x, s * 0.5);
    g.fillStyle = rad(g, x - s * 0.2, base - s * 0.75, s * 0.9, [
      [0, '#ff9aa8'],
      [0.5, '#f04b62'],
      [1, '#b5203a'],
    ]);
    g.beginPath();
    g.moveTo(x, base);
    g.bezierCurveTo(x - s * 0.7, base - s * 0.3, x - s * 0.55, base - s * 1.05, x, base - s * 0.95);
    g.bezierCurveTo(x + s * 0.55, base - s * 1.05, x + s * 0.7, base - s * 0.3, x, base);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffe28a';
    for (let k = 0; k < 9; k++) {
      g.beginPath();
      g.ellipse(x - s * 0.3 + (k % 3) * s * 0.3, base - s * 0.75 + Math.floor(k / 3) * s * 0.22, 3, 5, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#4fae3c';
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = Math.PI + (k / 4) * Math.PI;
      g.ellipse(x + Math.cos(a) * s * 0.25, base - s * 0.98 + Math.sin(a) * s * 0.06, s * 0.16, s * 0.06, a, 0, Math.PI * 2);
    }
    g.fill();
  };
  const flower = (x: number, stem: number, r: number, petal: string) => {
    g.strokeStyle = '#4f9a34';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(x + 20, base - stem * 0.5, x, base - stem);
    g.stroke();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.fillStyle = rad(g, x + Math.cos(a) * r, base - stem + Math.sin(a) * r, r * 0.9, [
        [0, '#ffffff'],
        [1, petal],
      ]);
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r, base - stem + Math.sin(a) * r, r * 0.75, r * 0.5, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = rad(g, x - 3, base - stem - 3, r * 0.6, [
      [0, '#fff3a0'],
      [1, '#f2b82c'],
    ]);
    g.beginPath();
    g.arc(x, base - stem, r * 0.5, 0, Math.PI * 2);
    g.fill();
  };
  cup(w * 0.12, h * 0.5);
  flower(w * 0.3, h * 0.42, h * 0.05, '#ffc2d6');
  berry(w * 0.38, h * 0.22);
  jar(w * 0.5, h * 0.42);
  flower(w * 0.66, h * 0.5, h * 0.06, '#d9c2ff');
  berry(w * 0.74, h * 0.28);
  cup(w * 0.9, h * 0.38);
  g.fillStyle = 'rgba(235,246,255,0.14)';
  g.fillRect(0, 0, w, h);
  return c;
}

/** Draw one backdrop layer for a theme (canvas `w`×`h`). */
export function paintLayer(theme: 'frozen' | 'picnic', layer: LayerId, w: number, h: number): HTMLCanvasElement {
  if (theme === 'picnic') return layer === 'sky' ? picnicSky(w, h) : layer === 'far' ? picnicFar(w, h) : picnicMid(w, h);
  return layer === 'sky' ? frozenSky(w, h) : layer === 'far' ? frozenFar(w, h) : frozenMid(w, h);
}
