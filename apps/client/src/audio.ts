import { Music } from './music';
import type { MusicId } from './world/themes';

/**
 * GUMFIRE sound (M18): every sound is synthesised with WebAudio — no files, no licences.
 * Two buses (effects and music) under a master, a small generated room reverb on the effects,
 * stereo placement by where things happen on screen, a little random pitch so repeats do not
 * sound mechanical, and squeaky gummy voices. Music is played by `music.ts`.
 * Browsers only allow audio after a user gesture, so `unlock()` is called from the first click.
 */
export type Sfx =
  | 'fire'
  | 'throw'
  | 'swing'
  | 'thwack'
  | 'boom'
  | 'bigBoom'
  | 'bounce'
  | 'splash'
  | 'jump'
  | 'land'
  | 'turn'
  | 'tick'
  | 'reveal'
  | 'pop'
  | 'suddenDeath'
  | 'victory'
  | 'select'
  | 'fuse'
  | 'snap'
  | 'sizzle'
  | 'whistle'
  | 'ouch'
  | 'oof'
  | 'cheer'
  | 'byebye'
  | 'hmm';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: Music | null = null;
  private wantMusic: MusicId | null = null;
  muted = false;
  /** 0..1 effects volume and music volume (options). */
  volume = 0.8;
  musicVolume = 0.6;

  private applyGain(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfxBus.gain.value = 0.56 * this.volume;
    this.musicBus.gain.value = 0.45 * this.musicVolume;
  }

  setVolume(v: number, muted: boolean, music = this.musicVolume): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.muted = muted;
    this.applyGain();
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const c = (this.ctx = new Ctor());
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor(); // keeps big blasts from clipping
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfxBus = c.createGain();
      this.musicBus = c.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      // a small, bright room: generated impulse response
      const len = Math.floor(c.sampleRate * 1.1);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const verb = c.createConvolver();
      verb.buffer = ir;
      this.reverbSend = c.createGain();
      this.reverbSend.gain.value = 0.22;
      this.reverbSend.connect(verb).connect(this.sfxBus);
      const noiseLen = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, noiseLen, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(c, this.musicBus, this.noiseBuf);
      this.applyGain();
      if (this.wantMusic) this.music.play(this.wantMusic);
    }
    void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyGain();
    return this.muted;
  }

  /** Switch the music (the same id keeps playing). */
  playMusic(id: MusicId | null): void {
    this.wantMusic = id;
    this.music?.play(id);
  }

  /** 0 calm … 1 tense (the last seconds of a turn), 2 sudden death. */
  setIntensity(level: number): void {
    this.music?.setIntensity(level);
  }

  /** A short tune over the music (victory). */
  jingle(kind: 'victory' | 'draw'): void {
    this.music?.jingle(kind);
  }

  // ------------------------------------------------------------------ building blocks
  /** Output for one sound: panned, with some of it sent to the room reverb. */
  private out(pan: number, wet = 1): AudioNode {
    const c = this.ctx!;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfxBus!);
    if (wet > 0) {
      const send = c.createGain();
      send.gain.value = wet;
      p.connect(send).connect(this.reverbSend!);
    }
    return p;
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, attack = 0.004): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dest: AudioNode, dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  /**
   * A squeaky gummy voice: a buzzy source through two vowel formants, gliding in pitch —
   * cartoon gibberish rather than words.
   */
  private voice(dest: AudioNode, notes: Array<[number, number, number]>, vowels: Array<[number, number]>, vol: number): void {
    const c = this.ctx!, t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const vib = c.createOscillator(), vibG = c.createGain();
    vib.frequency.value = 7;
    vibG.gain.value = 9;
    vib.connect(vibG).connect(o.frequency);
    const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 6;
    f2.Q.value = 8;
    const g = c.createGain(), mix = c.createGain();
    g.gain.value = 0.0001;
    o.connect(f1).connect(mix);
    o.connect(f2).connect(mix);
    mix.connect(g).connect(dest);
    let t = t0;
    notes.forEach(([f, dur, glide], i) => {
      const [a, b] = vowels[i % vowels.length]!;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(60, f * glide), t + dur);
      f1.frequency.setValueAtTime(a, t);
      f2.frequency.setValueAtTime(b, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.setValueAtTime(vol, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      t += dur + 0.015;
    });
    o.start(t0);
    vib.start(t0);
    o.stop(t + 0.05);
    vib.stop(t + 0.05);
  }

  /**
   * Play a sound. `strength` 0..1 scales loud things; `pan` −1..1 places it left / right
   * (where it happened on screen).
   */
  play(s: Sfx, strength = 1, pan = 0): void {
    if (!this.ctx || !this.master || this.muted) return;
    const v = Math.max(0.05, Math.min(1, strength));
    const r = 0.94 + Math.random() * 0.12; // a little different every time
    const o = this.out(pan, s === 'boom' || s === 'bigBoom' || s === 'splash' ? 1 : 0.5);
    switch (s) {
      case 'fire':
        this.noise(o, 0.35, 0.45, 'bandpass', 900 * r, 3200, 0, 0.8);
        this.tone(o, 'sawtooth', 160 * r, 520, 0.25, 0.1);
        this.tone(o, 'sine', 90, 50, 0.18, 0.35);
        break;
      case 'throw':
        this.noise(o, 0.2, 0.32, 'highpass', 1500 * r, 4200);
        this.tone(o, 'sine', 320 * r, 760, 0.12, 0.14);
        break;
      case 'swing':
        this.noise(o, 0.24, 0.4, 'bandpass', 500 * r, 2600, 0, 2);
        break;
      case 'thwack':
        this.tone(o, 'square', 190 * r, 60, 0.16, 0.3);
        this.noise(o, 0.14, 0.5, 'lowpass', 2400, 300);
        this.tone(o, 'triangle', 620 * r, 300, 0.09, 0.2, 0.01);
        break;
      case 'boom':
      case 'bigBoom': {
        const big = s === 'bigBoom';
        // the crack, the body and the rumble, then sugar-crystal fizz
        this.noise(o, 0.08, 0.9 * v, 'highpass', 2500, 1200);
        this.noise(o, big ? 1.4 : 0.9, 0.95 * v, 'lowpass', (big ? 1600 : 2200) * r, 50);
        this.tone(o, 'sine', (big ? 85 : 115) * r, 28, big ? 1.1 : 0.7, 0.75 * v, 0, 0.01);
        this.tone(o, 'triangle', (big ? 140 : 190) * r, 40, 0.35, 0.35 * v);
        this.noise(o, big ? 0.9 : 0.6, 0.18 * v, 'highpass', 3500, 7000, 0.08);
        for (let k = 0; k < (big ? 6 : 3); k++) this.noise(o, 0.05, 0.12 * v, 'bandpass', 2000 + Math.random() * 3000, 1500, 0.15 + Math.random() * 0.5, 4);
        break;
      }
      case 'bounce':
        this.tone(o, 'triangle', 900 * r, 480, 0.09, 0.22 * v);
        this.tone(o, 'sine', 1800 * r, 1200, 0.05, 0.06 * v);
        break;
      case 'splash':
        this.noise(o, 0.7, 0.5, 'bandpass', 1400 * r, 280, 0, 0.7);
        this.tone(o, 'sine', 520 * r, 140, 0.32, 0.14);
        for (let k = 0; k < 5; k++) this.tone(o, 'sine', 600 + Math.random() * 900, 1500 + Math.random() * 800, 0.06, 0.07, 0.15 + k * 0.08); // bubbles
        break;
      case 'jump':
        this.tone(o, 'sine', 300 * r, 760, 0.15, 0.16);
        this.voice(o, [[520 * r, 0.09, 1.3]], [[700, 1200]], 0.05);
        break;
      case 'land':
        this.tone(o, 'sine', 170 * r, 70, 0.1, 0.22 * v);
        this.noise(o, 0.08, 0.12 * v, 'lowpass', 900, 200);
        break;
      case 'turn':
        this.tone(o, 'triangle', 660, 660, 0.12, 0.22);
        this.tone(o, 'triangle', 990, 990, 0.22, 0.22, 0.12);
        this.tone(o, 'sine', 1980, 1980, 0.18, 0.05, 0.12);
        break;
      case 'tick':
        this.tone(o, 'square', 1400, 1400, 0.035, 0.1);
        break;
      case 'reveal':
        this.tone(o, 'triangle', 520, 380, 0.12, 0.2);
        break;
      case 'pop':
        this.tone(o, 'sine', 800 * r, 1700, 0.1, 0.3);
        this.noise(o, 0.25, 0.3, 'highpass', 2000, 5000, 0.05);
        break;
      case 'suddenDeath':
        for (let k = 0; k < 3; k++) this.tone(o, 'sawtooth', 440, 330, 0.3, 0.16, k * 0.35);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, k) => this.tone(o, 'triangle', f, f, 0.25, 0.26, k * 0.14));
        break;
      case 'select':
        this.tone(o, 'sine', 700, 900, 0.06, 0.14);
        break;
      case 'fuse':
        this.tone(o, 'square', 1000, 1000, 0.03, 0.07);
        break;
      case 'snap':
        this.tone(o, 'square', 2200, 300, 0.07, 0.28);
        this.noise(o, 0.08, 0.4, 'highpass', 3000, 6000);
        break;
      case 'sizzle':
        this.noise(o, 1.2, 0.22, 'highpass', 4000, 2500);
        break;
      case 'whistle':
        this.tone(o, 'sine', 1800, 600, 1.1, 0.1);
        break;
      // gummy voices
      case 'ouch':
        this.voice(o, [[640 * r, 0.12, 1.25], [560 * r, 0.16, 0.7]], [[800, 1300], [400, 900]], 0.09);
        break;
      case 'oof':
        this.voice(o, [[300 * r, 0.16, 0.75]], [[450, 850]], 0.1);
        break;
      case 'cheer':
        this.voice(o, [[520 * r, 0.1, 1.2], [700 * r, 0.1, 1.15], [880 * r, 0.24, 1.2]], [[750, 1250], [350, 2300], [800, 1400]], 0.08);
        break;
      case 'byebye':
        this.voice(o, [[700 * r, 0.14, 0.9], [520 * r, 0.3, 0.5]], [[800, 1200], [500, 900]], 0.08);
        break;
      case 'hmm':
        this.voice(o, [[330 * r, 0.22, 1.08]], [[300, 900]], 0.06);
        break;
    }
  }
}
