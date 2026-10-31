import { CUSTOM_SOUNDS } from './config.js';

// ------------------------------------------------------------------
//  Prozedurale Sounds (WebAudio). Keine Audio-Dateien nötig.
//  Optional können in config.js eigene Dateien hinterlegt werden.
// ------------------------------------------------------------------
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.buffers = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // Hall für die Nacht-Atmosphäre
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);
    this.music = ctx.createGain();
    this.music.gain.value = 0.0;
    this.music.connect(this.master);
    this.music.connect(this.reverb);
    this.noise = this._noiseBuffer(2);
    this._startAmbience();
    for (const [k, url] of Object.entries(CUSTOM_SOUNDS)) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => { this.buffers[k] = buf; }).catch(() => {});
    }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _brown(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }

  // Zielknoten: optional mit 3D-Position
  _out(pos, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }
  _custom(name, pos, gain = 1) {
    if (!this.buffers[name]) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[name];
    s.playbackRate.value = 0.95 + Math.random() * 0.1;
    s.connect(this._out(pos, gain));
    s.start();
    return true;
  }
  _ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  setListener(pos, fwd) {
    if (!this._ok()) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  // ---------------- Waffe ----------------
  shot(type = 'pistol') {
    if (!this._ok() || this._custom(type === 'rifle' ? 'rifle' : 'shot')) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const rifle = type === 'rifle';
    const out = this._out(null, rifle ? 0.75 : 0.9);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.setValueAtTime(5200, t); bp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(1.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + (rifle ? 0.16 : 0.3));
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random()); n.stop(t + 0.35);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const og = ctx.createGain(); og.gain.setValueAtTime(1.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.25);
  }
  // Raketenstart: Zischen mit steigender Tonhöhe
  rocket() {
    if (!this._ok() || this._custom('rocket')) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 0.9);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.4, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random()); n.stop(t + 1);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = ctx.createGain(); og.gain.setValueAtTime(1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.3);
  }
  explosion(pos) {
    if (!this._ok() || this._custom('explosion', pos)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 2.2);
    const s = ctx.createBufferSource(); s.buffer = this._brown(3);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(2.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 2.4);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(1.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(ng).connect(out); n.start(t, Math.random()); n.stop(t + 0.3);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.6);
    const og = ctx.createGain(); og.gain.setValueAtTime(2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.75);
  }
  throwGrenade() {
    if (!this._ok()) return;
    this.click(2200, 0.15);
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(f).connect(g).connect(this._out(null)); n.start(t, Math.random()); n.stop(t + 0.35);
  }
  clink(pos) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.5);
    for (const fr of [2300, 3550]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr * (0.95 + Math.random() * 0.1);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.15);
    }
  }
  pickup() {
    if (!this._ok() || this._custom('pickup')) return;
    const ctx = this.ctx;
    [523.3, 659.3, 784, 1046.5].forEach((fr, i) => {
      const t = ctx.currentTime + i * 0.07;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(this._out(null)); o.start(t); o.stop(t + 0.4);
    });
  }
  // dunkler Gong, wenn eine Waffe am Brunnen erscheint
  pickupReady() {
    if (!this._ok()) return;
    const ctx = this.ctx;
    [[146.8, 0], [220, 0.25], [293.7, 0.5]].forEach(([fr, dt]) => {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      o.connect(g).connect(this._out(null)); o.start(t); o.stop(t + 2.3);
    });
  }
  click(freq = 1800, gain = 0.25, when = 0) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    o.connect(hp).connect(g).connect(this._out(null)); o.start(t); o.stop(t + 0.05);
  }
  dryFire() { if (!this._custom('dry')) this.click(2400, 0.2); }
  reload() {
    if (this._custom('reload')) return;
    this.click(900, 0.3, 0.0); this.click(1300, 0.25, 0.35); this.click(700, 0.35, 0.9); this.click(1600, 0.3, 1.05);
  }
  uiHover() { if (!this._custom('hover')) this.click(2600, 0.05); }
  uiClick() { if (!this._custom('click')) { this.click(900, 0.12); this.click(1400, 0.08, 0.04); } }

  // ---------------- Zombies ----------------
  groan(pos, pitch = 1, len = 1.3) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.9);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = (70 + Math.random() * 45) * pitch;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.75 + Math.random() * 0.4), t + len);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random() * 4;
    const lg = ctx.createGain(); lg.gain.value = f0 * 0.06;
    lfo.connect(lg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 500 + Math.random() * 250; f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100 + Math.random() * 400; f2.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.15);
    g.gain.setValueAtTime(0.9, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(out);
    // Rasseln
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.25, t + 0.2); ng.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(nf).connect(ng).connect(out);
    o.start(t); lfo.start(t); n.start(t, Math.random()); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05); n.stop(t + len + 0.05);
  }
  zombieHit(pos) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(pos, 0.8);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random()); n.stop(t + 0.2);
  }
  zombieDie(pos) {
    if (!this._ok()) return;
    this.groan(pos, 0.7, 1.0);
    this.zombieHit(pos);
  }

  // ---------------- Spieler ----------------
  hurt() {
    if (!this._ok() || this._custom('hurt')) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(null, 1);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.4);
    const k = ctx.createOscillator(); k.type = 'sine'; k.frequency.setValueAtTime(90, t); k.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    const kg = ctx.createGain(); kg.gain.setValueAtTime(1.2, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    k.connect(kg).connect(out); k.start(t); k.stop(t + 0.3);
  }
  heartbeat(rate = 1) {
    if (!this._ok()) return;
    const ctx = this.ctx;
    for (const [dt, gain] of [[0, 0.9], [0.22 / rate, 0.6]]) {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(65, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.22);
    }
  }
  step(surface = 0) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = surface ? 1400 : 700 + Math.random() * 300;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.1);
  }

  // ---------------- Atmosphäre ----------------
  bell(count = 12, interval = 1.15) {
    if (!this._ok()) return;
    const ctx = this.ctx;
    const partials = [[0.5, 0.6], [1, 1], [1.19, 0.5], [1.5, 0.35], [2, 0.3], [2.51, 0.2], [3.0, 0.12]];
    const out = this._out(null, 0.32);
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + 0.2 + i * interval;
      for (const [m, a] of partials) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 196 * m;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5 / Math.sqrt(m));
        o.connect(g).connect(out); o.start(t); o.stop(t + 5);
      }
    }
  }
  thunder(dist = 0.5) {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this._brown(6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 - dist * 300;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.6 - dist, t + 0.1 + dist * 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 6);
  }
  owl() {
    if (!this._ok()) return;
    const ctx = this.ctx;
    const pos = { x: (Math.random() - 0.5) * 200, y: 12, z: (Math.random() - 0.5) * 200 };
    const out = this._out(pos, 0.5);
    [[0, 0.35], [0.5, 0.18], [0.75, 0.6]].forEach(([dt, len]) => {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(390, t); o.frequency.linearRampToValueAtTime(350, t + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
    });
  }
  howl() {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const pos = { x: (Math.random() - 0.5) * 300, y: 5, z: (Math.random() - 0.5) * 300 };
    const out = this._out(pos, 0.45);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(320, t); o.frequency.linearRampToValueAtTime(560, t + 0.8); o.frequency.setValueAtTime(560, t + 2.2); o.frequency.linearRampToValueAtTime(380, t + 3.4);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5; const lg = ctx.createGain(); lg.gain.value = 9; lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.6); g.gain.setValueAtTime(0.5, t + 2.4); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    o.connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + 3.6); lfo.stop(t + 3.6);
  }
  crow() {
    if (!this._ok()) return;
    const ctx = this.ctx;
    const pos = { x: (Math.random() - 0.5) * 120, y: 10, z: (Math.random() - 0.5) * 120 };
    const out = this._out(pos, 0.35);
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.35;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.2);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.25);
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    // Wind
    const w = ctx.createBufferSource(); w.buffer = this._brown(8); w.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.22;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 220;
    lfo.connect(lg).connect(wf.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.1;
    lfo2.connect(lg2).connect(wg.gain);
    w.connect(wf).connect(wg).connect(this.master);
    w.start(); lfo.start(); lfo2.start();
    // Dunkle Drone-Musik
    const notes = [55, 82.4, 110 * 1.059 ** 3];
    this.drones = notes.map((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0.09;
      o.connect(fl).connect(g).connect(this.music); o.start();
      return o;
    });
  }
  setMusic(level) {
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(level, this.ctx.currentTime, 1.2);
  }
  // Gruselige Klavier-Töne fürs Menü
  menuNote() {
    if (!this._ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const scale = [220, 233.1, 261.6, 277.2, 329.6, 349.2, 415.3, 440];
    const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.3 ? 0.5 : 1);
    for (const [m, a] of [[1, 0.25], [2, 0.08], [3, 0.04]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      o.connect(g).connect(this.music); o.start(t); o.stop(t + 3.6);
    }
  }
}
