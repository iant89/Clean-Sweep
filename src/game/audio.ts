export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  humGain: GainNode | null = null;
  humFilter: BiquadFilterNode | null = null;
  humOsc: OscillatorNode | null = null;
  muted = false;
  noiseBuf: AudioBuffer | null = null;

  constructor() {
    try { this.muted = localStorage.getItem('cs_muted') === '1'; } catch { /* ignore */ }
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // vacuum hum
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      this.humFilter = this.ctx.createBiquadFilter();
      this.humFilter.type = 'bandpass';
      this.humFilter.frequency.value = 600;
      this.humFilter.Q.value = 1.2;
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0;
      src.connect(this.humFilter).connect(this.humGain).connect(this.master);
      src.start();
      this.humOsc = this.ctx.createOscillator();
      this.humOsc.type = 'sawtooth';
      this.humOsc.frequency.value = 110;
      const og = this.ctx.createGain();
      og.gain.value = 0.05;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      this.humOsc.connect(lp).connect(og).connect(this.humGain);
      this.humOsc.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('cs_muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  hum(level: number, pitch: number) {
    if (!this.ctx || !this.humGain || !this.humFilter || !this.humOsc) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(level * 0.22, t, 0.08);
    this.humFilter.frequency.setTargetAtTime(500 + pitch * 900, t, 0.1);
    this.humOsc.frequency.setTargetAtTime(90 + pitch * 60, t, 0.1);
  }

  tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slide = 0, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur: number, freq: number, vol = 0.3, delay = 0, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  bump(k: number) {
    this.tone(140, 0.14, 'sine', 0.35 * k + 0.1, -80);
    this.noise(0.08, 900, 0.25 * k);
  }
  coin() { this.tone(988, 0.08, 'square', 0.12); this.tone(1319, 0.25, 'square', 0.12, 0, 0.07); }
  combo(level: number) { this.tone(520 + level * 120, 0.12, 'triangle', 0.18); this.tone(780 + level * 160, 0.18, 'triangle', 0.14, 0, 0.06); }
  clear() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.22, 0, i * 0.08));
    this.noise(0.6, 6000, 0.08, 0.1, 'highpass');
  }
  boot() {
    [392, 523, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.25, 0, i * 0.12));
    this.tone(1568, 0.5, 'triangle', 0.15, 0, 0.5);
  }
  dock() { this.tone(660, 0.12, 'sine', 0.25); this.tone(990, 0.25, 'sine', 0.25, 0, 0.1); }
  undock() { this.tone(880, 0.1, 'sine', 0.18); this.tone(660, 0.15, 'sine', 0.15, 0, 0.08); }
  low() { this.tone(880, 0.12, 'square', 0.12); this.tone(880, 0.12, 'square', 0.12, 0, 0.2); }
  full() { this.tone(180, 0.35, 'sawtooth', 0.15, -60); this.tone(150, 0.35, 'sawtooth', 0.12, -50, 0.18); }
  ghost() {
    this.tone(300, 1.4, 'sine', 0.15, 250);
    this.tone(450, 1.6, 'sine', 0.08, -200, 0.3);
  }
  buy() { this.tone(1200, 0.08, 'square', 0.1); this.tone(1600, 0.08, 'square', 0.1, 0, 0.06); this.tone(2000, 0.25, 'triangle', 0.12, 0, 0.12); }
  deny() { this.tone(200, 0.15, 'square', 0.12, -40); }
  over() { [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.22, -20, i * 0.18)); }
  dawn() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, 0, i * 0.12)); }
  click() { this.tone(700, 0.05, 'square', 0.08); }
}
