// Sons 100 % synthétisés (Web Audio) : aucun fichier à charger.
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private combo = 0;
  private comboAt = 0;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Souffle de boost : bruit filtré en boucle, volume piloté.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    noise.connect(bp).connect(this.boostGain).connect(this.master);
    noise.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** Bouchée d'humain : la note monte tant qu'on enchaîne. */
  eatHuman() {
    const now = performance.now();
    this.combo = now - this.comboAt < 450 ? Math.min(this.combo + 1, 18) : 0;
    this.comboAt = now;
    this.tone(480 * Math.pow(2, this.combo / 12), 0.07, 'sine', 0.18, 1.6);
  }

  eatOrb() {
    this.tone(900 + Math.random() * 300, 0.04, 'triangle', 0.05, 1.3);
  }

  eatLogo() {
    this.noiseBurst(0.12, 0.35, 2600);
    this.tone(220, 0.16, 'square', 0.08, 0.5);
    [0, 4, 7, 12].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.14, 'triangle', 0.12, 1, i * 0.035));
  }

  kill() {
    this.tone(180, 0.5, 'sine', 0.5, 0.2);
    this.noiseBurst(0.35, 0.4, 1200);
    [0, 7, 12, 19].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.2, 'sawtooth', 0.06, 1, 0.05 + i * 0.05));
  }

  death() {
    this.tone(440, 0.9, 'sawtooth', 0.22, 0.12);
    this.tone(220, 0.9, 'square', 0.1, 0.1, 0.05);
    this.noiseBurst(0.6, 0.5, 900);
  }

  click() {
    this.tone(1200, 0.05, 'square', 0.06, 0.6);
  }

  start() {
    [0, 5, 7, 12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.18, 'square', 0.07, 1, i * 0.06));
  }

  setBoost(on: boolean) {
    if (!this.ctx || !this.boostGain) return;
    this.boostGain.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, on ? 0.04 : 0.12);
  }
}

export const sfx = new Sfx();
