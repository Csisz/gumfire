import type { MusicId } from './world/themes';

/**
 * Procedural music (M18): a tiny step sequencer with synthesised instruments, one tune per map
 * theme plus the menu. Each tune is a chord progression, a bass line, drums and a melody made
 * from a seeded motif (so it is the same tune every time), looped. Intensity adds layers in the
 * last seconds of a turn; sudden death turns the tune minor and adds a low drone.
 */
type Inst = 'glock' | 'pluck' | 'marimba' | 'guitar' | 'bubble' | 'chip' | 'pad' | 'stab' | 'bass' | 'funkBass';

interface Song {
  bpm: number;
  /** MIDI note of the key's root. */
  root: number;
  mode: 'major' | 'mixo';
  /** Scale degree (0-based) of each bar's chord. */
  prog: number[];
  lead: Inst;
  chords: Inst;
  bass: Inst;
  /** 16-step drum patterns ('x' hit, '.' rest, 'o' soft). */
  kick: string;
  snare: string;
  hat: string;
  swing: number;
  seed: number;
}

const SONGS: Record<MusicId, Song> = {
  menu: { bpm: 112, root: 60, mode: 'major', prog: [0, 4, 5, 3, 0, 4, 3, 4], lead: 'chip', chords: 'stab', bass: 'bass', kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'o.x.o.x.o.x.o.x.', swing: 0.08, seed: 11 },
  frozen: { bpm: 100, root: 65, mode: 'major', prog: [0, 5, 3, 4, 0, 5, 1, 4], lead: 'glock', chords: 'pad', bass: 'bass', kick: 'x.......x.......', snare: '........o.......', hat: '..o...o...o...o.', swing: 0, seed: 23 },
  picnic: { bpm: 118, root: 67, mode: 'major', prog: [0, 3, 0, 4, 0, 3, 4, 0], lead: 'pluck', chords: 'stab', bass: 'bass', kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', swing: 0.16, seed: 37 },
  toys: { bpm: 124, root: 62, mode: 'major', prog: [0, 4, 5, 3, 1, 4, 0, 4], lead: 'marimba', chords: 'stab', bass: 'bass', kick: 'x...x...x...x...', snare: '....x.......x..o', hat: 'o.o.o.o.o.o.o.o.', swing: 0.05, seed: 41 },
  garage: { bpm: 104, root: 52, mode: 'mixo', prog: [0, 0, 6, 3, 0, 0, 6, 4], lead: 'guitar', chords: 'pad', bass: 'funkBass', kick: 'x..x..x...x.....', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo', swing: 0.1, seed: 53 },
  bath: { bpm: 94, root: 69, mode: 'major', prog: [0, 3, 5, 4, 0, 3, 1, 4], lead: 'bubble', chords: 'pad', bass: 'bass', kick: 'x.......x..x....', snare: '........x.......', hat: '..o...o...o...o.', swing: 0.12, seed: 67 },
};

const SCALES: Record<Song['mode'] | 'minor', number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Melody: per bar a rhythm and a contour over the scale, phrases A A' B A. */
function makeMelody(song: Song): Array<Array<{ step: number; deg: number; len: number }>> {
  const r = rng(song.seed);
  const rhythms = [
    [0, 4, 6, 8, 12],
    [0, 2, 4, 8, 10, 12],
    [0, 3, 6, 8, 11, 14],
    [0, 4, 8, 10, 12, 14],
    [0, 6, 8, 12],
  ];
  const bar = (chordDeg: number) => {
    const rh = rhythms[Math.floor(r() * rhythms.length)]!;
    let deg = chordDeg + [0, 2, 4][Math.floor(r() * 3)]!;
    return rh.map((step, i) => {
      if (i > 0) deg += [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)]!;
      deg = Math.max(chordDeg - 2, Math.min(chordDeg + 7, deg));
      const next = rh[i + 1] ?? 16;
      return { step, deg, len: next - step };
    });
  };
  const a = [bar(song.prog[0]!), bar(song.prog[1]!)];
  const b = [bar(song.prog[2]!), bar(song.prog[3]!)];
  const a2 = a.map((m) => m.map((n, i) => (i === m.length - 1 ? { ...n, deg: n.deg + 1 } : n)));
  // the last bar resolves to the root
  const end = a.map((m) => m.map((n) => ({ ...n })));
  end[1] = [{ step: 0, deg: song.prog[7]!, len: 4 }, { step: 4, deg: song.prog[7]! + 2, len: 4 }, { step: 8, deg: 7, len: 8 }];
  return [...a, ...a2, ...b, ...end];
}

export class Music {
  private song: Song | null = null;
  private id: MusicId | null = null;
  private melody: ReturnType<typeof makeMelody> = [];
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private intensity = 0;
  private gain: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly noiseBuf: AudioBuffer,
  ) {
    this.gain = ctx.createGain();
    this.gain.connect(out);
  }

  play(id: MusicId | null): void {
    if (id === this.id) return;
    this.id = id;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    window.setTimeout(() => this.start(this.id), 450);
  }

  private start(id: MusicId | null): void {
    if (id !== this.id) return;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (!id) return;
    this.song = SONGS[id];
    this.melody = makeMelody(this.song);
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.linearRampToValueAtTime(1, t + 0.8);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Schedule `seconds` of a tune at once (offline rendering, e.g. to export a sample). */
  prerender(id: MusicId, seconds: number, intensity = 0): void {
    this.id = id;
    this.song = SONGS[id];
    this.melody = makeMelody(this.song);
    this.step = 0;
    this.nextTime = 0.05;
    this.intensity = intensity;
    this.gain.gain.value = 1;
    const sixteenth = 60 / this.song.bpm / 4;
    while (this.nextTime < seconds) {
      const swing = this.step % 2 === 1 ? this.song.swing * sixteenth : 0;
      this.playStep(this.song, this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % (16 * this.song.prog.length);
    }
  }

  setIntensity(level: number): void {
    this.intensity = level;
  }

  /** The victory fanfare (or a sad little draw) over a quick fade of the loop. */
  jingle(kind: 'victory' | 'draw'): void {
    const song = this.song ?? SONGS.menu;
    const t = this.ctx.currentTime + 0.05;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0.15, t + 0.2);
    this.gain.gain.linearRampToValueAtTime(1, t + 3.2);
    const notes = kind === 'victory' ? [0, 4, 7, 12, 7, 12, 16] : [7, 5, 4, 0];
    const lens = kind === 'victory' ? [0.12, 0.12, 0.12, 0.3, 0.12, 0.18, 0.7] : [0.25, 0.25, 0.25, 0.8];
    let at = t + 0.15;
    const fan = this.ctx.createGain();
    fan.gain.value = 1.4;
    fan.connect(this.gain);
    notes.forEach((n, i) => {
      this.note(song.lead, at, song.root + n, lens[i]!, 0.9, fan);
      this.note('stab', at, song.root + n - 12, lens[i]!, 0.5, fan);
      at += lens[i]!;
    });
  }

  private schedule(): void {
    const song = this.song;
    if (!song) return;
    const sixteenth = 60 / song.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const swing = this.step % 2 === 1 ? song.swing * sixteenth : 0;
      this.playStep(song, this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % (16 * song.prog.length);
    }
  }

  private playStep(song: Song, step: number, t: number, sixteenth: number): void {
    const barI = Math.floor(step / 16), s = step % 16;
    const minor = this.intensity >= 2;
    const scale = minor ? SCALES.minor : SCALES[song.mode];
    const degToMidi = (deg: number, base = song.root) => {
      const oct = Math.floor(deg / 7);
      return base + 12 * oct + scale[((deg % 7) + 7) % 7]!;
    };
    const chord = song.prog[barI]!;
    const tense = this.intensity >= 1;
    // drums
    const hit = (pat: string) => pat[s] === 'x' ? 1 : pat[s] === 'o' ? 0.5 : 0;
    const k = hit(song.kick);
    if (k) this.drum('kick', t, k);
    const sn = hit(song.snare) || (tense && s === 14 ? 0.5 : 0);
    if (sn) this.drum('snare', t, sn);
    const hh = hit(song.hat) || (tense && s % 2 === 1 ? 0.35 : 0);
    if (hh) this.drum('hat', t, hh);
    // bass
    if (song.bass === 'funkBass') {
      const pat = [0, 0, -1, 0, 7, -1, 0, -1, 0, 0, -1, 10, 7, -1, 5, -1];
      const off = pat[s]!;
      if (off >= 0) this.note('funkBass', t, degToMidi(chord, song.root - 24) + (off === 7 ? 7 : off === 10 ? 10 : off === 5 ? 5 : 0), sixteenth * 1.6, 0.8);
    } else if (s % 4 === 0) {
      const tone = s === 8 ? 4 : 0; // root, then the fifth
      this.note('bass', t, degToMidi(chord + tone, song.root - 24), sixteenth * 3.5, s === 0 ? 0.9 : 0.7);
    }
    // chords
    const triad = [chord, chord + 2, chord + 4].map((d) => degToMidi(d, song.root - 12));
    if (song.chords === 'pad' && s === 0) for (const m of triad) this.note('pad', t, m, sixteenth * 16, 0.35);
    if (song.chords === 'stab' && (s === 2 || s === 6 || s === 10 || s === 14)) for (const m of triad) this.note('stab', t, m, sixteenth * 1.5, 0.3);
    // melody (rests in the first bar of every other loop when calm, so it breathes)
    for (const n of this.melody[barI] ?? []) {
      if (n.step !== s) continue;
      const m = degToMidi(n.deg);
      this.note(song.lead, t, m, sixteenth * n.len, 0.7);
      if (tense) this.note(song.lead, t, m + 12, sixteenth * n.len, 0.25);
    }
    if (minor && s === 0) this.note('pad', t, song.root - 24, sixteenth * 16, 0.5); // a low drone
  }

  private drum(kind: 'kick' | 'snare' | 'hat', t: number, vel: number): void {
    const c = this.ctx;
    const g = c.createGain();
    g.connect(this.gain);
    if (kind === 'kick') {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.2);
      return;
    }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7500 : 1800;
    const dur = kind === 'hat' ? 0.035 : 0.13;
    g.gain.setValueAtTime((kind === 'hat' ? 0.22 : 0.5) * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    if (kind === 'snare') {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(210, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      const og = c.createGain();
      og.gain.setValueAtTime(0.25 * vel, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(og).connect(this.gain);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** One note of a synthesised instrument. */
  private note(inst: Inst, t: number, midi: number, len: number, vel: number, out: AudioNode = this.gain): void {
    const c = this.ctx;
    const f = mtof(midi);
    const g = c.createGain();
    g.connect(out);
    const osc = (type: OscillatorType, freq: number, gainV: number, dur: number, into: AudioNode = g) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const og = c.createGain();
      og.gain.setValueAtTime(gainV, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(og).connect(into);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    };
    g.gain.value = vel * 0.32;
    switch (inst) {
      case 'glock': // bell: fundamental + inharmonic partial, long ring
        osc('sine', f * 2, 1, 1.4);
        osc('sine', f * 2 * 2.76, 0.35, 0.5);
        break;
      case 'pluck': {
        // ukulele-ish: bright attack through a closing filter
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(4000, t);
        lp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
        lp.connect(g);
        osc('triangle', f, 1, 0.5, lp);
        osc('sawtooth', f, 0.3, 0.25, lp);
        break;
      }
      case 'marimba':
        osc('sine', f, 1, 0.45);
        osc('sine', f * 4, 0.25, 0.08);
        break;
      case 'guitar': {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        lp.Q.value = 3;
        lp.connect(g);
        osc('sawtooth', f, 0.8, Math.min(0.35, len), lp);
        osc('square', f * 1.005, 0.3, Math.min(0.3, len), lp);
        break;
      }
      case 'bubble': {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * 0.7, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
        const og = c.createGain();
        og.gain.setValueAtTime(1, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.25, len));
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + Math.max(0.25, len) + 0.05);
        osc('sine', f * 2, 0.2, 0.15);
        break;
      }
      case 'chip': {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        lp.connect(g);
        osc('square', f, 0.55, Math.max(0.12, len * 0.9), lp);
        break;
      }
      case 'pad': {
        // slow swell, held for the bar
        const o1 = c.createOscillator(), o2 = c.createOscillator();
        o1.type = 'triangle';
        o2.type = 'sine';
        o1.frequency.value = f;
        o2.frequency.value = f * 1.003;
        const og = c.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.linearRampToValueAtTime(0.5, t + 0.35);
        og.gain.setValueAtTime(0.5, t + len * 0.7);
        og.gain.linearRampToValueAtTime(0.0001, t + len);
        o1.connect(og);
        o2.connect(og);
        og.connect(g);
        o1.start(t);
        o2.start(t);
        o1.stop(t + len + 0.05);
        o2.stop(t + len + 0.05);
        break;
      }
      case 'stab':
        osc('triangle', f, 0.7, Math.max(0.1, len));
        break;
      case 'bass':
        osc('triangle', f, 1, Math.max(0.15, len));
        osc('sine', f / 2, 0.6, Math.max(0.15, len));
        break;
      case 'funkBass': {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(250, t + 0.15);
        lp.connect(g);
        osc('sawtooth', f, 0.9, Math.max(0.12, len), lp);
        break;
      }
    }
  }
}
