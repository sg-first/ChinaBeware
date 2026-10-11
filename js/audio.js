// audio.js —— WebAudio 程序化音效：引擎、警笛、风雪
export class GameAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    /* ---- 引擎：锯齿波 + 噪声，随转速变调 ---- */
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 60;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engOsc2.frequency.value = 30;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;

    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc.start();
    this.engOsc2.start();

    /* ---- 风雪环境：过滤白噪声 ---- */
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    /* ---- 警笛：双音交替 ---- */
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenPan = ctx.createStereoPanner();
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sirenPan);
    this.sirenPan.connect(this.master);
    this.sirenOsc.start();
  }

  /* 每帧刷新 */
  update(dt, playerCar, nearestPolice, timeSec, closestPolice = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const kmh = playerCar.speedKmh;

    // 引擎：转速映射频率 55~220Hz
    const rpm = playerCar.engineRpm;
    this.engOsc.frequency.setTargetAtTime(48 + rpm * 150, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(24 + rpm * 75, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.05 + rpm * 0.1, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(400 + rpm * 1400, t, 0.08);

    // 风声随车速
    this.windGain.gain.setTargetAtTime(0.04 + Math.min(0.14, kmh / 700), t, 0.2);

    // 警笛：距离越近越响，双音交替
    if (nearestPolice < 220) {
      const near = 1 - nearestPolice / 220;
      const hi = Math.sin(timeSec * 7) > 0;
      this.sirenOsc.frequency.setTargetAtTime(hi ? 880 : 660, t, 0.02);
      this.sirenGain.gain.setTargetAtTime(near * 0.11, t, 0.1);
      if (closestPolice) {
        const dx = closestPolice.pos.x - playerCar.pos.x;
        const dz = closestPolice.pos.z - playerCar.pos.z;
        const side = dx * playerCar.right.x + dz * playerCar.right.z;
        this.sirenPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side / 90)), t, 0.12);
      }
    } else {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
    }
  }

  crash(impact) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + impact * 40;
    const vol = Math.min(0.4, impact * 0.02);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.35);
  }
}
