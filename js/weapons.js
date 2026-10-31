import * as THREE from 'three';
import { CONFIG } from './config.js';
import { glowTexture } from './effects.js';

// ------------------------------------------------------------------
//  Waffen-Definitionen (Modelle aus dem Kenney Weapon Pack)
//  offset: verschiebt das Modell so, dass der Griff in der Hand liegt
// ------------------------------------------------------------------
export const WEAPONS = {
  pistol: {
    name: 'Pistole', key: 'Digit1', model: 'weapons/pistol', scale: 0.8, offset: [0, -0.075, 0.075],
    mag: 12, reserve: Infinity, cooldown: 0.21, reload: 1.4, damage: 1, spread: [0.004, 0.012], muzzle: 0.2, recoil: 0.012, sound: 'pistol',
  },
  rifle: {
    name: 'Gewehr', key: 'Digit2', model: 'weapons/machinegun', scale: 1.3, offset: [0, -0.1, 0.06],
    mag: 30, reserve: 150, cooldown: 0.1, reload: 1.8, damage: 2, spread: [0.006, 0.02], muzzle: 0.42, recoil: 0.007, sound: 'rifle',
  },
  launcher: {
    name: 'Raketenwerfer', key: 'Digit3', model: 'weapons/rocketlauncher', scale: 1.1, offset: [0, -0.16, 0.09],
    mag: 1, reserve: 7, cooldown: 0.5, reload: 2.0, rocket: true, muzzle: 0.6, recoil: 0.05, sound: 'rocket',
  },
};
export const WEAPON_ORDER = ['pistol', 'rifle', 'launcher'];

export const PICKUPS = {
  rifleFirstAt: 180,        // nach 3 Minuten: Gewehr am Brunnen
  launcherFirstAt: 360,     // nach 3 weiteren Minuten: Raketenwerfer
  weaponRespawn: 120,       // danach liegt dort regelmässig Nachschub
  grenadeEvery: [22, 40],   // Sekunden zwischen zufälligen Handgranaten im Dorf
  grenadeMaxOnGround: 3,
  grenadesPerPickup: 2,
  grenadeMax: 9,
};

// Erzeugt ein ausgerichtetes Waffenmodell (Lauf zeigt nach +Z)
export function weaponModel(assets, key, scaleMul = 1) {
  const def = WEAPONS[key];
  const group = new THREE.Group();
  const g = assets.get(def.model);
  if (g) {
    const m = g.scene.clone(true);
    m.scale.setScalar(def.scale * scaleMul);
    m.position.set(def.offset[0] * scaleMul, def.offset[1] * scaleMul, def.offset[2] * scaleMul);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(m);
  }
  return group;
}

// ------------------------------------------------------------------
//  Raketen, Handgranaten und Explosionen
// ------------------------------------------------------------------
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.light = new THREE.PointLight(0xff9040, 0, 30, 1.5);
    game.scene.add(this.light);
    this.lightT = 0;
    this.flashes = [];
    const mat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,230,160,1)', 'rgba(255,90,10,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 2.6, 1.2) });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      game.scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    this.fi = 0;
  }

  reset() {
    for (const p of this.list) this.game.scene.remove(p.mesh);
    this.list = [];
    this.light.intensity = 0;
    for (const f of this.flashes) { f.s.visible = false; f.t = 0; }
  }

  rocket(origin, dir) {
    const g = this.game;
    const mesh = new THREE.Group();
    const src = g.assets.get('weapons/ammo_rocket');
    if (src) {
      const m = src.scene.clone(true);
      m.scale.setScalar(1.3);
      m.position.z = -0.25;
      mesh.add(m);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,220,140,1)', 'rgba(255,90,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2, 1) }));
    glow.scale.setScalar(0.9);
    glow.position.z = -0.35;
    mesh.add(glow);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    g.scene.add(mesh);
    this.list.push({ type: 'rocket', mesh, pos: origin.clone(), vel: dir.clone().multiplyScalar(42), life: 3 });
    g.audio.rocket();
  }

  grenade(origin, vel) {
    const g = this.game;
    const mesh = new THREE.Group();
    const src = g.assets.get('weapons/grenade');
    if (src) {
      const m = src.scene.clone(true);
      m.scale.setScalar(1.5);
      m.position.y = -0.12;
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      mesh.add(m);
    }
    mesh.position.copy(origin);
    g.scene.add(mesh);
    this.list.push({ type: 'grenade', mesh, pos: origin.clone(), vel: vel.clone(), fuse: 1.8, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    g.audio.throwGrenade();
  }

  update(dt) {
    const g = this.game;
    const C = g.world.colliders;
    const tmp = new THREE.Vector3();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      let boom = false;
      if (p.type === 'rocket') {
        p.life -= dt;
        const step = p.vel.length() * dt;
        const dir = tmp.copy(p.vel).normalize();
        // Hindernisse und Boden
        const tw = C.raycast(p.pos, dir, step);
        const zh = g.zombies.raycast(p.pos, dir, step + 0.3, 0);
        let t = step;
        if (tw < t) { t = tw; boom = true; }
        if (zh && zh.t < t + 0.3) { t = Math.min(t, zh.t); boom = true; }
        p.pos.addScaledVector(dir, t);
        if (p.pos.y <= 0.05) { p.pos.y = 0.05; boom = true; }
        if (p.life <= 0 || !g.world.inBounds(p.pos.x, p.pos.z, -20)) boom = true;
        p.mesh.position.copy(p.pos);
        // Rauchspur
        const back = p.pos.clone().addScaledVector(dir, -0.4);
        g.sparks.spawn(back, new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)), new THREE.Color(2.5, 1.4, 0.5), 0.25, 0.18, 0);
        g.particles.spawn(back, new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6), new THREE.Color(0.3, 0.3, 0.32), 0.5, 1.2, 0.3);
        if (boom) this.explode(p.pos, 6.5, 14);
      } else {
        p.vel.y -= 18 * dt;
        const ox = p.pos.x, oz = p.pos.z;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.12) {
          p.pos.y = 0.12;
          if (Math.abs(p.vel.y) > 2) g.audio.clink(p.pos);
          p.vel.y *= -0.35;
          p.vel.x *= 0.6; p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.6);
        }
        if (p.pos.y < 2.5 && C.resolve(p.pos, 0.12)) {
          // vom Hindernis abprallen
          p.vel.x *= -0.45; p.vel.z *= -0.45;
          if (Math.hypot(p.pos.x - ox, p.pos.z - oz) > 1) { p.pos.x = ox; p.pos.z = oz; }
        }
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
        p.fuse -= dt;
        if (p.fuse <= 0) { boom = true; this.explode(p.pos, 7, 12); }
      }
      if (boom) { g.scene.remove(p.mesh); this.list.splice(i, 1); }
    }
    // Explosions-Licht und Blitz
    this.lightT -= dt;
    this.light.intensity = Math.max(0, this.lightT) * 260;
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t -= dt;
      const k = Math.max(0, f.t / 0.35);
      f.s.scale.setScalar(4 + (1 - k) * 6);
      f.s.material.opacity = k;
      if (f.t <= 0) f.s.visible = false;
    }
  }

  explode(pos, radius, damage) {
    const g = this.game;
    const at = new THREE.Vector3(pos.x, Math.max(0.3, pos.y), pos.z);
    // Schaden an Zombies (nimmt zum Rand hin ab)
    for (const z of [...g.zombies.list]) {
      if (z.dead) continue;
      const d = Math.hypot(z.pos.x - at.x, z.pos.z - at.z);
      if (d > radius) continue;
      const dir = new THREE.Vector3(z.pos.x - at.x, 0.3, z.pos.z - at.z).normalize();
      const dmg = Math.max(1, Math.round(damage * (1 - (d / radius) * 0.6)));
      g.zombies.hit(z, dmg, new THREE.Vector3(z.pos.x, 1.1, z.pos.z), dir, false);
      if (!z.dead) z.vel.addScaledVector(dir, 6);
    }
    // Effekte
    g.sparks.burst(at, 70, { color: new THREE.Color(2.6, 1.3, 0.4), speed: 7, up: 6, size: 0.22, life: 0.7, gravity: -6 });
    g.sparks.burst(at, 30, { color: new THREE.Color(3, 2.4, 1.2), speed: 3, up: 3, size: 0.4, life: 0.35, gravity: 0 });
    g.particles.burst(at, 40, { color: new THREE.Color(0.18, 0.17, 0.17), speed: 2.5, up: 2.5, size: 1.0, life: 2.2, gravity: 0.8 });
    g.particles.burst(new THREE.Vector3(at.x, 0.1, at.z), 25, { color: new THREE.Color(0.22, 0.17, 0.11), speed: 4, up: 7, size: 0.2, life: 1.2, gravity: -12 });
    this.light.position.set(at.x, at.y + 1.2, at.z);
    this.lightT = 0.45;
    const f = this.flashes[this.fi];
    this.fi = (this.fi + 1) % this.flashes.length;
    f.s.position.copy(at).y += 0.6;
    f.s.visible = true;
    f.t = 0.35;
    g.decals.add(at.x, at.z, radius * 0.45, true);
    g.audio.explosion(at);
    const dp = g.player.pos.distanceTo(at);
    g.player.shake = Math.max(g.player.shake, Math.max(0, 1.2 - dp / 22));
    g.zombies.alert(at);
  }
}

// ------------------------------------------------------------------
//  Einsammelbare Gegenstände
// ------------------------------------------------------------------
const BEAM = { rifle: new THREE.Color(0.5, 1.6, 2.4), launcher: new THREE.Color(2.4, 0.7, 0.3), grenade: new THREE.Color(0.6, 2.2, 0.6) };

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    const geo = new THREE.CylinderGeometry(0.55, 0.9, 9, 16, 1, true);
    geo.translate(0, 4.5, 0);
    this.beamGeo = geo;
    this.ringGeo = new THREE.RingGeometry(0.7, 0.95, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.reset();
  }

  reset() {
    for (const it of this.items) this.game.scene.remove(it.group);
    this.items = [];
    this.rifleAt = PICKUPS.rifleFirstAt;
    this.launcherAt = PICKUPS.launcherFirstAt;
    this.grenadeT = 15;
  }

  spawn(type, x, z) {
    const g = this.game;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const holder = new THREE.Group();
    if (type === 'grenade') {
      const src = g.assets.get('weapons/grenade');
      for (const [ox, oz] of [[-0.15, 0], [0.15, 0.05]]) {
        if (!src) break;
        const m = src.scene.clone(true);
        m.scale.setScalar(2.2);
        m.position.set(ox, 0, oz);
        holder.add(m);
      }
      holder.position.y = 0.5;
    } else {
      const m = weaponModel(g.assets, type, 1.5);
      m.rotation.y = Math.PI / 2;
      holder.add(m);
      holder.position.y = 1.1;
    }
    group.add(holder);
    const col = BEAM[type];
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: type === 'grenade' ? 0.12 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    if (type === 'grenade') beam.scale.set(0.6, 0.35, 0.6);
    group.add(beam);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.05;
    group.add(ring);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.scale.setScalar(type === 'grenade' ? 1.6 : 2.6);
    glow.position.y = holder.position.y;
    group.add(glow);
    g.scene.add(group);
    const it = { type, group, holder, beam, ring, x, z, t: Math.random() * 6 };
    this.items.push(it);
    return it;
  }

  update(dt) {
    const g = this.game;
    const P = PICKUPS;
    const R = CONFIG.world.village;
    if (g.state === 'playing') {
      if (this.rifleAt !== null && g.playTime >= this.rifleAt) {
        this.rifleAt = null;
        this.spawn('rifle', R.x, R.z + 4.4);
        g.ui.toast(g.player.arsenal.rifle ? 'Am Brunnen liegt Munition fürs Gewehr!' : 'Am Brunnen liegt ein Gewehr!', 4.5);
        g.audio.pickupReady();
      }
      if (this.launcherAt !== null && g.playTime >= this.launcherAt) {
        this.launcherAt = null;
        this.spawn('launcher', R.x, R.z - 4.4);
        g.ui.toast(g.player.arsenal.launcher ? 'Am Brunnen liegen neue Raketen!' : 'Am Brunnen liegt ein Raketenwerfer!', 4.5);
        g.audio.pickupReady();
      }
      if (g.villageReached) {
        this.grenadeT -= dt;
        if (this.grenadeT <= 0) {
          this.grenadeT = P.grenadeEvery[0] + Math.random() * (P.grenadeEvery[1] - P.grenadeEvery[0]);
          if (this.items.filter((i) => i.type === 'grenade').length < P.grenadeMaxOnGround) {
            const spot = this._randomSpot();
            if (spot) this.spawn('grenade', spot.x, spot.z);
          }
        }
      }
    }
    const pl = g.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.holder.rotation.y += dt * 1.6;
      it.holder.position.y = (it.type === 'grenade' ? 0.5 : 1.1) + Math.sin(it.t * 2.2) * 0.12;
      it.ring.scale.setScalar(1 + Math.sin(it.t * 3) * 0.08);
      it.beam.material.opacity = (it.type === 'grenade' ? 0.1 : 0.18) * (0.75 + 0.25 * Math.sin(it.t * 4));
      if (g.state === 'playing' && !pl.dead && Math.hypot(pl.pos.x - it.x, pl.pos.z - it.z) < 1.5) {
        this.collect(it);
        g.scene.remove(it.group);
        this.items.splice(i, 1);
      }
    }
  }

  _randomSpot() {
    const g = this.game;
    const V = CONFIG.world.village;
    for (let n = 0; n < 30; n++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 18;
      const x = V.x + Math.sin(a) * r, z = V.z + Math.cos(a) * r;
      if (g.world.colliders.isFree(x, z, 0.9) && g.zombies.nav.reachable(x, z)) return { x, z };
    }
    return null;
  }

  collect(it) {
    const g = this.game;
    const msg = g.player.give(it.type);
    g.audio.pickup();
    g.ui.toast(msg, 3);
    if (it.type === 'rifle') this.rifleAt = g.playTime + PICKUPS.weaponRespawn;
    if (it.type === 'launcher') this.launcherAt = g.playTime + PICKUPS.weaponRespawn;
  }
}
