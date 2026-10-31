// ------------------------------------------------------------------
//  Eingabe: Tastatur, Maus (Pointer Lock) und Touch
// ------------------------------------------------------------------
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mx = 0; this.my = 0;
    this.fireHeld = false;
    this.pressed = new Set();
    this.wheel = 0;
    this.sensitivity = 0.0022;
    this.touch = { active: false, moveId: null, lookId: null, mx: 0, my: 0, sx: 0, sy: 0, lx: 0, ly: 0 };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mx += e.movementX; this.my += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.pressed.add('KeyR');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fireHeld = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this._setupTouch();
  }

  get locked() { return document.pointerLockElement === this.canvas; }
  lock() {
    if (this.isTouch) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignorieren */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _setupTouch() {
    const tc = document.getElementById('touch');
    if (!tc) return;
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const area = document.getElementById('touch-look');
    const T = this.touch;
    const btn = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); up && up(); }, { passive: false });
    };
    btn('t-fire', () => (this.fireHeld = true), () => (this.fireHeld = false));
    btn('t-reload', () => this.pressed.add('KeyR'));
    btn('t-light', () => this.pressed.add('KeyL'));
    btn('t-grenade', () => this.pressed.add('KeyF'));
    btn('t-switch', () => this.pressed.add('KeyQ'));
    btn('t-sprint', () => (T.sprint = !T.sprint));
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      T.moveId = t.identifier;
      const r = stick.getBoundingClientRect();
      T.sx = r.left + r.width / 2; T.sy = r.top + r.height / 2;
      this._stickMove(t, knob);
    }, { passive: false });
    area.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      T.lookId = t.identifier; T.lx = t.clientX; T.ly = t.clientY;
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.moveId) this._stickMove(t, knob);
        if (t.identifier === T.lookId) { this.mx += (t.clientX - T.lx) * 1.6; this.my += (t.clientY - T.ly) * 1.6; T.lx = t.clientX; T.ly = t.clientY; }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.moveId) { T.moveId = null; T.mx = 0; T.my = 0; knob.style.transform = 'translate(-50%,-50%)'; }
        if (t.identifier === T.lookId) T.lookId = null;
      }
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
  }
  _stickMove(t, knob) {
    const T = this.touch;
    let dx = t.clientX - T.sx, dy = t.clientY - T.sy;
    const l = Math.hypot(dx, dy), max = 50;
    if (l > max) { dx *= max / l; dy *= max / l; }
    T.mx = dx / max; T.my = -dy / max;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // Liefert den Steuerungs-Zustand für diesen Frame
  read() {
    const k = this.keys;
    const T = this.touch;
    const c = {
      moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + T.mx,
      moveY: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + T.my,
      lookX: this.mx * this.sensitivity,
      lookY: this.my * this.sensitivity,
      fire: this.fireHeld || k.has('Space'),
      reload: this.pressed.has('KeyR'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || !!T.sprint,
      toggleLight: this.pressed.has('KeyL'),
      grenade: this.pressed.has('KeyF') || this.pressed.has('KeyG'),
      weapon: this.pressed.has('Digit1') ? 'pistol' : this.pressed.has('Digit2') ? 'rifle' : this.pressed.has('Digit3') ? 'launcher' : null,
      cycle: this.pressed.has('KeyQ') ? 1 : (this.wheel ? Math.sign(this.wheel) : 0),
    };
    this.wheel = 0;
    this.mx = 0; this.my = 0;
    this.pressed.clear();
    return c;
  }
  consume(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
}
