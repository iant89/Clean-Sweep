import { Synth } from '../../engine/src';

/**
 * Clean Sweep's sound set on top of the engine's synth (which provides unlock/mute, tone(), noise(),
 * the motor drone and the stock bump/combo/click/deny effects).
 */
export class Sfx extends Synth {
  constructor() { super('cs_muted'); }

  /** Vacuum hum: the engine's motor drone. */
  hum(level: number, pitch: number) { this.drone(level, pitch); }

  coin() { this.tone(988, 0.08, 'square', 0.12); this.tone(1319, 0.25, 'square', 0.12, 0, 0.07); }
  clear() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.22, 0, i * 0.08));
    this.noise(0.6, 6000, 0.08, 0.1, 'highpass');
  }
  boot() {
    [392, 523, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.25, 0, i * 0.12));
    this.tone(1568, 0.5, 'triangle', 0.15, 0, 0.5);
  }
  /** Magnetic grab as the dock ring captures the roomba. */
  magnet() { this.tone(180, 0.25, 'sawtooth', 0.08, 520); this.tone(90, 0.2, 'sine', 0.2, 60); }
  dock() { this.tone(660, 0.12, 'sine', 0.25); this.tone(990, 0.25, 'sine', 0.25, 0, 0.1); }
  undock() { this.tone(880, 0.1, 'sine', 0.18); this.tone(660, 0.15, 'sine', 0.15, 0, 0.08); }
  low() { this.tone(880, 0.12, 'square', 0.12); this.tone(880, 0.12, 'square', 0.12, 0, 0.2); }
  full() { this.tone(180, 0.35, 'sawtooth', 0.15, -60); this.tone(150, 0.35, 'sawtooth', 0.12, -50, 0.18); }
  ghost() {
    this.tone(300, 1.4, 'sine', 0.15, 250);
    this.tone(450, 1.6, 'sine', 0.08, -200, 0.3);
  }
  buy() { this.tone(1200, 0.08, 'square', 0.1); this.tone(1600, 0.08, 'square', 0.1, 0, 0.06); this.tone(2000, 0.25, 'triangle', 0.12, 0, 0.12); }
  over() { [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.22, -20, i * 0.18)); }
  dawn() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, 0, i * 0.12)); }

  // ---- tidy-up cutscene
  tidyStart() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.1, 0, i * 0.07)); }
  tidyLift(vol = 1) {
    this.tone(520, 0.4, 'sine', 0.1 * vol, 380);
    this.tone(1040, 0.3, 'triangle', 0.04 * vol, 600, 0.05);
  }
  tidyLand(vol = 1) {
    this.tone(170, 0.14, 'sine', 0.3 * vol, -70);
    this.noise(0.07, 800, 0.18 * vol);
    this.tone(1760, 0.25, 'triangle', 0.05 * vol, 0, 0.04);
  }
  tidyDone() { [659, 880, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.15, 0, i * 0.09)); }

  // ---- positional sounds: vol already includes distance falloff, pan is -1 (left) .. 1 (right)
  private bus(vol: number, pan: number): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  // ---- ambient loops (fireplace, fountain): built lazily, level/pan driven every frame
  private loops: Partial<Record<'fire' | 'water', { gain: GainNode; pan: StereoPannerNode | null; vol: number; p: number }>> = {};

  private noiseSrc() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  private filt(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private makeLoop(kind: 'fire' | 'water') {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) gain.connect(pan).connect(this.master!); else gain.connect(this.master!);
    const layer = (node: AudioNode, vol: number) => { const g = ctx.createGain(); g.gain.value = vol; node.connect(g).connect(gain); return g; };
    if (kind === 'fire') {
      // low roar + faint hiss
      layer(this.noiseSrc().connect(this.filt('lowpass', 380)), 0.9);
      layer(this.noiseSrc().connect(this.filt('bandpass', 2600, 0.6)), 0.08);
    } else {
      // bubbling wash: a band of noise whose centre wobbles, plus a soft high splash
      const bp = this.filt('bandpass', 900, 0.9);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.3;
      const depth = ctx.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(bp.frequency);
      lfo.start();
      layer(this.noiseSrc().connect(bp), 0.7);
      layer(this.noiseSrc().connect(this.filt('highpass', 3500)), 0.12);
    }
    return (this.loops[kind] = { gain, pan, vol: 0, p: 0 });
  }

  /** Set an ambient loop's level (distance falloff already applied) and pan. */
  ambience(kind: 'fire' | 'water', vol: number, pan: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const l = this.loops[kind] ?? (vol > 0.001 ? this.makeLoop(kind) : null);
    if (!l) return;
    if (Math.abs(l.vol - vol) < 0.003 && Math.abs(l.p - pan) < 0.02) return;
    l.vol = vol; l.p = pan;
    const t = this.ctx.currentTime;
    l.gain.gain.setTargetAtTime(vol, t, 0.12);
    l.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.12);
  }

  /** A single fire crackle or pop. */
  crackle(vol: number, pan: number) {
    const d = this.bus(vol, pan);
    if (!d) return;
    if (Math.random() < 0.25) {
      this.noise(0.06 + Math.random() * 0.05, 500 + Math.random() * 500, 0.9, 0, 'bandpass', d); // pop
    } else {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) this.noise(0.008 + Math.random() * 0.02, 1800 + Math.random() * 3500, 0.7, k * (0.015 + Math.random() * 0.03), 'highpass', d);
    }
  }

  /** A water droplet plink. */
  drip(vol: number, pan: number) {
    const d = this.bus(vol, pan);
    if (!d) return;
    const f = 700 + Math.random() * 900;
    this.tone(f, 0.07 + Math.random() * 0.05, 'sine', 0.5, f * (0.6 + Math.random() * 0.6), 0, d);
  }

  /** Grandfather-clock tick (tock = the lower, alternate beat). */
  tick(vol: number, pan: number, tock: boolean) {
    const d = this.bus(vol, pan);
    if (!d) return;
    this.noise(0.035, tock ? 1900 : 2600, 0.9, 0, 'bandpass', d);
    this.tone(tock ? 900 : 1250, 0.045, 'triangle', 0.35, 0, 0, d);
  }

  /** One struck bell: a few inharmonic partials with long, staggered decays. */
  private bell(freq: number, delay: number, vol: number, dest: AudioNode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const partials: [number, number, number][] = [[0.5, 0.35, 4.5], [1, 1, 3.6], [2.0, 0.45, 2.4], [2.76, 0.3, 1.6], [5.4, 0.12, 0.8]];
    for (const [ratio, amp, dur] of partials) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Hourly chime: a short bell phrase, then one low strike per hour. */
  chime(hour: number, vol: number, pan: number, delay = 0) {
    const d = this.bus(vol, pan);
    if (!d) return;
    const phrase = [659, 784, 587, 392];
    phrase.forEach((f, i) => this.bell(f, delay + i * 0.6, 0.5, d));
    const start = delay + phrase.length * 0.6 + 0.8;
    for (let k = 0; k < hour; k++) this.bell(196, start + k * 1.6, 0.75, d);
  }
}
