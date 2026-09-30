/**
 * Placeholder sound effects synthesised with WebAudio (plan §15: jsfxr-style placeholders until
 * M18). No files, no licences: every sound is a few oscillators and filtered noise.
 * Browsers only allow audio after a user gesture, so `unlock()` is called from the Start button.
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
  | 'fuse';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    return this.muted;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(s: Sfx, strength = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const v = Math.max(0.05, Math.min(1, strength));
    switch (s) {
      case 'fire':
        this.noise(0.35, 0.5, 'bandpass', 800, 3000);
        this.tone('sawtooth', 180, 520, 0.25, 0.12);
        break;
      case 'throw':
        this.noise(0.18, 0.35, 'highpass', 1500, 4000);
        this.tone('sine', 300, 700, 0.12, 0.15);
        break;
      case 'swing':
        this.noise(0.22, 0.4, 'bandpass', 600, 2400);
        break;
      case 'thwack':
        this.tone('square', 180, 60, 0.18, 0.35);
        this.noise(0.12, 0.5, 'lowpass', 2000, 300);
        break;
      case 'boom':
      case 'bigBoom': {
        const big = s === 'bigBoom';
        this.noise(big ? 1.2 : 0.8, 0.9 * v, 'lowpass', big ? 1800 : 2400, 60);
        this.tone('sine', big ? 90 : 120, 30, big ? 0.9 : 0.6, 0.6 * v);
        this.noise(0.5, 0.25 * v, 'highpass', 3000, 6000, 0.05); // fizz of sugar crystals
        break;
      }
      case 'bounce':
        this.tone('triangle', 900, 500, 0.08, 0.25 * v);
        break;
      case 'splash':
        this.noise(0.6, 0.5, 'bandpass', 1200, 300);
        this.tone('sine', 500, 150, 0.3, 0.15);
        break;
      case 'jump':
        this.tone('sine', 300, 700, 0.14, 0.18);
        break;
      case 'land':
        this.tone('sine', 160, 80, 0.08, 0.2 * v);
        break;
      case 'turn':
        this.tone('triangle', 660, 660, 0.12, 0.25);
        this.tone('triangle', 990, 990, 0.2, 0.25, 0.12);
        break;
      case 'tick':
        this.tone('square', 1400, 1400, 0.04, 0.12);
        break;
      case 'reveal':
        this.tone('triangle', 520, 380, 0.12, 0.2);
        break;
      case 'pop':
        this.tone('sine', 800, 1600, 0.1, 0.3);
        this.noise(0.25, 0.3, 'highpass', 2000, 5000, 0.05);
        break;
      case 'suddenDeath':
        for (let k = 0; k < 3; k++) this.tone('sawtooth', 440, 330, 0.3, 0.2, k * 0.35);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, k) => this.tone('triangle', f, f, 0.25, 0.3, k * 0.14));
        break;
      case 'select':
        this.tone('sine', 700, 900, 0.06, 0.15);
        break;
      case 'fuse':
        this.tone('square', 1000, 1000, 0.03, 0.08);
        break;
    }
  }
}
