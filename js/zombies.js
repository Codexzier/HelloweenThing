import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createSurvivor, createBlocky, pointBone, fadeTo } from './characters.js';
import { glowTexture } from './effects.js';

const _red = new THREE.Color();

// ------------------------------------------------------------------
//  Zombie-Typen
// ------------------------------------------------------------------
const TYPES = {
  walker: { kind: 'fbx', hp: 3, speed: [1.5, 2.3], radius: 0.38, head: [1.62, 0.21], body: [0.25, 1.45, 0.36], anim: 0.55, name: 'Zombie' },
  ghoul: { kind: 'glb', key: 'graveyard/character-zombie', scale: 2.1, hp: 2, speed: [2.3, 3.0], radius: 0.42, head: [1.32, 0.42], body: [0.05, 0.95, 0.36], walk: 'walk', walkScale: 1.25, name: 'Ghul' },
  skeleton: { kind: 'glb', key: 'graveyard/character-skeleton', scale: 2.1, hp: 1, speed: [3.3, 4.0], radius: 0.38, head: [1.15, 0.38], body: [0.05, 0.85, 0.32], walk: 'sprint', walkScale: 1, name: 'Skelett' },
  vampire: { kind: 'glb', key: 'graveyard/character-vampire', scale: 2.7, hp: 14, speed: [3.0, 3.2], radius: 0.55, head: [1.75, 0.5], body: [0.05, 1.25, 0.48], walk: 'sprint', walkScale: 0.8, name: 'Vampir', boss: true },
};

// ------------------------------------------------------------------
//  Navigations-Feld (Breitensuche vom Spieler aus)
// ------------------------------------------------------------------
class NavField {
  constructor(colliders, half = 170, cell = 1.5) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil(half * 2 / cell);
    const n = this.n;
    this.blocked = new Uint8Array(n * n);
    this.dist = new Float32Array(n * n).fill(Infinity);
    this.queue = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      this.blocked[j * n + i] = (Math.hypot(x, z) > CONFIG.world.radius || !colliders.isFree(x, z, 0.45)) ? 1 : 0;
    }
  }
  idx(x, z) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  center(k, out) { const i = k % this.n, j = (k / this.n) | 0; return out.set(-this.half + (i + 0.5) * this.cell, 0, -this.half + (j + 0.5) * this.cell); }
  build(target) {
    const n = this.n, D = this.dist, B = this.blocked, Q = this.queue;
    D.fill(Infinity);
    let s = this.idx(target.x, target.z);
    if (s < 0) return;
    if (B[s]) { // nächstes freies Feld
      let best = -1;
      for (let r = 1; r < 4 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const k = s + b * n + a; if (k >= 0 && k < n * n && !B[k]) { best = k; } }
      if (best < 0) return;
      s = best;
    }
    const N = n * n, inQ = this.inQ || (this.inQ = new Uint8Array(N));
    inQ.fill(0);
    let h = 0, t = 0, cnt = 0;
    D[s] = 0; Q[t] = s; t = (t + 1) % N; cnt++; inQ[s] = 1;
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (cnt > 0) {
      const k = Q[h]; h = (h + 1) % N; cnt--; inQ[k] = 0;
      const i = k % n, j = (k / n) | 0;
      const d = D[k];
      for (const [di, dj, c] of nb) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj * n + ii;
        if (B[kk]) continue;
        if (c > 1 && (B[j * n + ii] || B[jj * n + i])) continue; // keine Ecken schneiden
        const nd = d + c;
        if (nd < D[kk]) {
          D[kk] = nd;
          if (!inQ[kk]) { inQ[kk] = 1; Q[t] = kk; t = (t + 1) % N; cnt++; }
        }
      }
    }
  }
  // Richtung zum nächsten Feld Richtung Spieler
  next(x, z, out) {
    const k = this.idx(x, z);
    if (k < 0 || this.dist[k] === Infinity) return false;
    const n = this.n, i = k % n, j = (k / n) | 0;
    let best = this.dist[k], bk = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      const ii = i + a, jj = j + b;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj * n + ii;
      if (this.dist[kk] < best) { best = this.dist[kk]; bk = kk; }
    }
    if (bk < 0) return false;
    this.center(bk, out);
    return true;
  }
  reachable(x, z) { const k = this.idx(x, z); return k >= 0 && this.dist[k] < Infinity; }
}

// ------------------------------------------------------------------
//  Zombie-Verwaltung inkl. Spawn-Logik
// ------------------------------------------------------------------
export class Zombies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nav = new NavField(game.world.colliders);
    this.navTimer = 0;
    this.eyeMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,60,40,1)', 'rgba(255,0,0,0)', 32), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 0.6, 0.4) });
    this.pool = { walker: [], ghoul: [], skeleton: [], vampire: [] };
    this.reset();
  }

  reset() {
    for (const z of this.list) this._release(z);
    this.list = [];
    this.active = false;
    this.interval = CONFIG.spawn.startIntervalMs;
    this.timer = 0;
    this.spawned = 0;
    this.nextBoss = 25;
  }

  // Spawn-Start: sobald der Spieler das Dorf erreicht
  activate() {
    if (this.active) return;
    this.active = true;
    this.timer = 0; // der erste Zombie kommt sofort
  }

  _create(type) {
    const def = TYPES[type];
    const pool = this.pool[type];
    let e = pool.pop();
    if (!e) {
      const g = this.game;
      if (def.kind === 'fbx') e = createSurvivor(g.assets, Math.random() < 0.5 ? 'zombieA' : 'zombieC', 0.08);
      else e = createBlocky(g.assets, def.key, def.scale);
      e.type = type;
      e.def = def;
      e.eyes = [new THREE.Sprite(this.eyeMat), new THREE.Sprite(this.eyeMat)];
      for (const s of e.eyes) { s.scale.setScalar(type === 'vampire' ? 0.22 : 0.14); e.root.add(s); }
      e.materials = [];
      e.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.userData.base = o.material.emissive.clone(); e.materials.push(o.material); } });
    }
    for (const m of e.materials) m.emissive.copy(m.userData.base);
    e.model.rotation.set(0, 0, 0);
    e.model.position.set(0, 0, 0);
    e.root.visible = true;
    e.current = null;
    e.mixer.stopAllAction();
    return e;
  }

  _release(z) {
    this.game.scene.remove(z.root);
    this.pool[z.type].push(z);
  }

  _pickType() {
    const kills = this.game.kills;
    if (kills >= this.nextBoss && !this.list.some((z) => z.type === 'vampire' && !z.dead)) { this.nextBoss += 25; return 'vampire'; }
    const u = Math.random();
    if (kills >= 15 && u < 0.18) return 'skeleton';
    if (kills >= 5 && u < 0.45) return 'ghoul';
    return 'walker';
  }

  spawn(p, type = this._pickType()) {
    const z = this._create(type);
    const def = TYPES[type];
    z.pos = new THREE.Vector3(p.x, 0, p.z);
    z.vel = new THREE.Vector3();
    z.hp = def.hp;
    const diff = Math.min(1, this.game.kills / 60);
    z.speed = THREE.MathUtils.lerp(def.speed[0], def.speed[1], Math.random()) * (1 + diff * 0.35);
    z.dead = false;
    z.deadT = 0;
    z.attackCd = 0;
    z.stagger = 0;
    z.hitFlash = 0;
    z.groanT = 1 + Math.random() * 4;
    z.facing = Math.atan2(this.game.player.pos.x - p.x, this.game.player.pos.z - p.z);
    z.stuckT = 0;
    z.side = Math.random() < 0.5 ? 1 : -1;
    z.alerted = 0;
    z.root.position.copy(z.pos);
    z.root.rotation.y = z.facing;
    z.eyes.forEach((e) => (e.visible = true));
    this.game.scene.add(z.root);
    if (def.kind === 'fbx') { fadeTo(z, 'run', 0, def.anim * z.speed / 1.9); z.mixer.setTime(Math.random()); }
    else fadeTo(z, def.walk, 0, def.walkScale);
    this.list.push(z);
    this.spawned++;
    if (def.boss) this.game.ui.toast('Ein Vampir erhebt sich aus der Gruft …');
    this.game.audio.groan(new THREE.Vector3(p.x, 1.5, p.z), def.boss ? 0.6 : 1, 1.6);
    return z;
  }

  // Spawn-Punkt in 50 m Entfernung, ausserhalb des Sichtfelds
  findSpawnPoint() {
    const g = this.game;
    const cam = g.camera;
    cam.updateMatrixWorld();
    const P = g.player.pos;
    const D = CONFIG.spawn.distance;
    const m = 1 + CONFIG.spawn.viewMargin;
    const v = new THREE.Vector3();
    const camYaw = Math.atan2(-g.player.aimDir.x, -g.player.aimDir.z);
    const tries = [];
    for (let i = 0; i < 36; i++) tries.push(camYaw + Math.PI + (Math.random() - 0.5) * Math.PI * 1.6);
    for (const a of tries) {
      const x = P.x - Math.sin(a) * D, z = P.z - Math.cos(a) * D;
      if (!g.world.inBounds(x, z, 3)) continue;
      if (!g.world.colliders.isFree(x, z, 0.6)) continue;
      if (!this.nav.reachable(x, z)) continue;
      let visible = false;
      for (const y of [0.1, 1.0, 2.0]) {
        v.set(x, y, z).project(cam);
        if (v.z < 1 && v.z > -1 && Math.abs(v.x) < m && Math.abs(v.y) < m) { visible = true; break; }
      }
      if (!visible) return { x, z };
    }
    return null;
  }

  alert(pos) { for (const z of this.list) if (!z.dead && z.pos.distanceTo(pos) < 60) z.alerted = 3; }

  update(dt) {
    const g = this.game;
    const player = g.player;
    // Navigation regelmässig neu berechnen
    this.navTimer -= dt;
    if (this.navTimer <= 0) { this.nav.build(player.pos); this.navTimer = 0.4; }

    // Spawn-Timer: Intervall startet bei 5 s und wird jedes Mal 100 ms kürzer
    if (this.active && !player.dead && g.state === 'playing') {
      this.timer -= dt * 1000;
      const alive = this.list.filter((z) => !z.dead).length;
      if (this.timer <= 0 && alive < CONFIG.spawn.maxAlive) {
        const p = this.findSpawnPoint();
        if (p) {
          this.spawn(p);
          this.timer += this.interval;
          this.timer = Math.max(this.timer, 0);
          this.interval = Math.max(CONFIG.spawn.minIntervalMs, this.interval - CONFIG.spawn.decrementMs);
        }
      }
    }

    const tmp = new THREE.Vector3();
    const P = player.pos;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      const def = z.def;
      z.mixer.update(dt);
      if (z.dead) {
        z.deadT += dt;
        if (def.kind === 'fbx') {
          const k = Math.min(1, z.deadT * 2.2);
          z.model.rotation.x = -k * k * Math.PI / 2;
        }
        if (z.deadT > 3) z.root.position.y = -(z.deadT - 3) * 0.5;
        if (z.deadT > 5.5) { this._release(z); this.list.splice(i, 1); }
        continue;
      }
      z.attackCd -= dt;
      z.stagger -= dt;
      z.alerted -= dt;
      const dx = P.x - z.pos.x, dz = P.z - z.pos.z;
      const dist = Math.hypot(dx, dz);
      // Ziel bestimmen: direkt oder über Navigationsfeld
      let tx = dx / (dist || 1), tz = dz / (dist || 1);
      if (dist > 6 && this.nav.next(z.pos.x, z.pos.z, tmp)) {
        const nx = tmp.x - z.pos.x, nz = tmp.z - z.pos.z, nl = Math.hypot(nx, nz) || 1;
        tx = nx / nl; tz = nz / nl;
      }
      // Abstand zu anderen Zombies
      let sx = 0, sz = 0;
      for (const o of this.list) {
        if (o === z || o.dead) continue;
        const ox = z.pos.x - o.pos.x, oz = z.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        const md = z.def.radius + o.def.radius + 0.2;
        if (d2 < md * md && d2 > 1e-6) { const d = Math.sqrt(d2); sx += ox / d * (md - d); sz += oz / d * (md - d); }
      }
      let speed = z.speed * (z.alerted > 0 ? 1.12 : 1);
      if (z.stagger > 0) speed *= 0.1;
      if (player.dead) speed *= 0.4;
      const desiredX = tx * speed, desiredZ = tz * speed;
      z.vel.x += (desiredX - z.vel.x) * Math.min(1, dt * 4);
      z.vel.z += (desiredZ - z.vel.z) * Math.min(1, dt * 4);
      const ox = z.pos.x, oz = z.pos.z;
      z.pos.x += z.vel.x * dt + sx * 0.5;
      z.pos.z += z.vel.z * dt + sz * 0.5;
      g.world.colliders.resolve(z.pos, def.radius);
      // Feststecken erkennen
      const moved = Math.hypot(z.pos.x - ox, z.pos.z - oz);
      if (moved < speed * dt * 0.25 && dist > 2) {
        z.stuckT += dt;
        if (z.stuckT > 0.4) { z.pos.x += -tz * z.side * speed * dt; z.pos.z += tx * z.side * speed * dt; g.world.colliders.resolve(z.pos, def.radius); }
        if (z.stuckT > 2.5) { z.side = -z.side; z.stuckT = 0; }
      } else z.stuckT = Math.max(0, z.stuckT - dt);

      // Drehen
      const face = dist < 4 ? Math.atan2(dx, dz) : Math.atan2(z.vel.x, z.vel.z);
      let d = face - z.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      z.facing += d * Math.min(1, dt * 6);
      z.root.position.copy(z.pos);
      z.root.rotation.y = z.facing;

      // Animationen
      if (def.kind === 'fbx') {
        if (z.current) z.current.timeScale = def.anim * Math.max(0.4, Math.hypot(z.vel.x, z.vel.z)) / 1.9;
        // klassische Zombie-Haltung: Arme nach vorne
        const B = z.bones;
        if (B.RightArm) {
          const f = new THREE.Vector3(Math.sin(z.facing), -0.15 + Math.sin(g.time * 3 + i) * 0.08, Math.cos(z.facing)).normalize();
          pointBone(B.RightArm, B.RightForeArm, f, 0.9);
          pointBone(B.LeftArm, B.LeftForeArm, f, 0.9);
          pointBone(B.RightForeArm, B.RightHand, f, 0.8);
          pointBone(B.LeftForeArm, B.LeftHand, f, 0.8);
        }
      } else if (z.attackCd <= 0.6 && z.attackCd > 0 && def.walk) {
        fadeTo(z, 'attack-melee-right', 0.1, 1.4);
      } else fadeTo(z, def.walk, 0.2, def.walkScale * (z.stagger > 0 ? 0.3 : 1));

      // Augen leuchten
      const hy = def.head[0], fwdOff = def.kind === 'fbx' ? 0.17 : def.head[1] * 0.95;
      const ey = def.kind === 'fbx' ? hy + 0.04 : hy + 0.02;
      z.eyes[0].position.set(-0.07 * (def.boss ? 2 : 1) * (def.kind === 'fbx' ? 1 : 1.6), ey, fwdOff);
      z.eyes[1].position.set(0.07 * (def.boss ? 2 : 1) * (def.kind === 'fbx' ? 1 : 1.6), ey, fwdOff);

      // Treffer-Aufblitzen
      if (z.hitFlash > 0) {
        z.hitFlash -= dt;
        for (const m of z.materials) m.emissive.copy(m.userData.base).add(_red.setRGB(Math.max(0, z.hitFlash) * 4, 0, 0));
      }

      // Stöhnen
      z.groanT -= dt;
      if (z.groanT <= 0) { z.groanT = 3 + Math.random() * 6; if (dist < 45) g.audio.groan(new THREE.Vector3(z.pos.x, 1.5, z.pos.z), def.boss ? 0.55 : (def.kind === 'fbx' ? 1 : 1.3), 1 + Math.random()); }

      // Angriff
      if (dist < def.radius + 0.4 + 0.45 && z.attackCd <= 0 && !player.dead) {
        z.attackCd = 1.2;
        if (player.damage(z.pos)) {
          z.stagger = 0.5;
          z.vel.set(-dx / dist * 4, 0, -dz / dist * 4);
        }
      }
    }
  }

  // Strahl gegen Zombies (Kopf = Kugel, Körper = Zylinder)
  raycast(o, d, maxT, minT = 0) {
    let best = null;
    for (const z of this.list) {
      if (z.dead) continue;
      const def = z.def;
      const hc = new THREE.Vector3(z.pos.x, def.head[0], z.pos.z);
      const th = raySphere(o, d, hc, def.head[1]);
      if (th > minT && th < maxT && (!best || th < best.t)) best = { zombie: z, t: th, head: true };
      const tb = rayCyl(o, d, z.pos.x, z.pos.z, def.body[2], def.body[0], def.body[1]);
      if (tb > minT && tb < maxT && (!best || tb < best.t - 0.05)) best = { zombie: z, t: tb, head: false };
    }
    return best;
  }

  hit(z, dmg, point, dir, head) {
    const g = this.game;
    z.hp -= dmg;
    z.hitFlash = 0.15;
    z.stagger = 0.25;
    z.vel.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 2.5);
    g.audio.zombieHit(point);
    const col = z.type === 'skeleton' ? new THREE.Color(0.8, 0.78, 0.7) : new THREE.Color(0.35, 0.03, 0.02);
    g.particles.burst(point, head ? 26 : 14, { color: col, speed: head ? 2.6 : 1.6, up: 2, size: 0.12, life: 0.9 });
    if (z.hp <= 0) this.kill(z, head);
  }

  kill(z, head) {
    const g = this.game;
    z.dead = true;
    z.deadT = 0;
    for (const m of z.materials) m.emissive.copy(m.userData.base);
    if (z.def.kind === 'glb') { fadeTo(z, 'die', 0.1, 1); if (z.current) { z.current.setLoop(THREE.LoopOnce); z.current.clampWhenFinished = true; } }
    else if (z.current) z.current.paused = true;
    z.eyes.forEach((e) => (e.visible = false));
    g.audio.zombieDie(new THREE.Vector3(z.pos.x, 1, z.pos.z));
    if (z.type !== 'skeleton') g.decals.add(z.pos.x, z.pos.z, z.def.boss ? 3 : 1.7);
    g.onKill(z, head);
  }
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return Infinity;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return Infinity;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : Infinity;
}
