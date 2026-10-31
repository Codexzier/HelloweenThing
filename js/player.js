import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createSurvivor, pointBone, fadeTo } from './characters.js';
import { glowTexture } from './effects.js';
import { WEAPONS, WEAPON_ORDER, PICKUPS, weaponModel } from './weapons.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(game) {
    this.game = game;
    const { assets, scene } = game;
    this.char = createSurvivor(assets, 'survivorMaleB');
    scene.add(this.char.root);
    this.root = this.char.root;
    this.bones = this.char.bones;

    // Waffen (Kenney Weapon Pack) – ein Halter, darin je ein Modell pro Waffe
    this.gun = new THREE.Group();
    this.gunModels = {};
    for (const k of WEAPON_ORDER) {
      const m = weaponModel(assets, k);
      m.visible = false;
      this.gun.add(m);
      this.gunModels[k] = m;
    }
    scene.add(this.gun);

    // Mündungsfeuer
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,200,1)', 'rgba(255,140,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 3, 1.6) }));
    this.flash.scale.setScalar(0.9);
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 14, 1.6);
    scene.add(this.flashLight);

    // Taschenlampe
    this.torch = new THREE.SpotLight(0xfff1d0, 0, 42, 0.36, 0.55, 1.4);
    this.torch.castShadow = false;
    this.torch.shadow.mapSize.set(1024, 1024);
    this.torch.shadow.bias = -0.0008;
    scene.add(this.torch, this.torch.target);
    this.torchOn = true;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.reset();
  }

  reset() {
    const s = CONFIG.world.start;
    this.pos.set(s.x, 0, s.z);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.05;
    this.bodyYaw = 0;
    this.hits = 0;
    this.invulnUntil = 0;
    this.arsenal = { pistol: { ammo: WEAPONS.pistol.mag, reserve: Infinity } };
    this.weapon = 'pistol';
    this.grenades = 0;
    this.lastThrow = -10;
    this.reloadUntil = 0;
    this.lastShot = 0;
    this.stamina = 1;
    this.dead = false;
    this.deathT = 0;
    this.stepDist = 0;
    this.shake = 0;
    this.recoil = 0;
    this.flashT = 0;
    this.moving = false;
    this.char.model.rotation.set(0, 0, 0);
    this.char.model.position.set(0, 0, 0);
    this.root.position.copy(this.pos);
    this.root.visible = true;
    this.gun.visible = true;
    this._showWeapon();
    fadeTo(this.char, 'idle', 0);
  }

  get def() { return WEAPONS[this.weapon]; }
  get slot() { return this.arsenal[this.weapon]; }
  get ammo() { return this.slot.ammo; }
  get reserve() { return this.slot.reserve; }
  get reloading() { return this.game.time < this.reloadUntil; }

  _showWeapon() { for (const k of WEAPON_ORDER) this.gunModels[k].visible = k === this.weapon; }

  switchTo(key) {
    if (!this.arsenal[key] || key === this.weapon || this.dead) return;
    this.weapon = key;
    this.reloadUntil = 0;
    this.lastShot = this.game.time - this.def.cooldown + 0.25;
    this._showWeapon();
    this.game.audio.click(700, 0.2);
    this.game.audio.click(1100, 0.15, 0.08);
  }
  cycle(dir = 1) {
    const owned = WEAPON_ORDER.filter((k) => this.arsenal[k]);
    const i = owned.indexOf(this.weapon);
    this.switchTo(owned[(i + dir + owned.length) % owned.length]);
  }

  // Eingesammelter Gegenstand – Waffen werden sofort benutzt
  give(type) {
    if (type === 'grenade') {
      this.grenades = Math.min(PICKUPS.grenadeMax, this.grenades + PICKUPS.grenadesPerPickup);
      return `+${PICKUPS.grenadesPerPickup} Handgranaten  (F zum Werfen)`;
    }
    const def = WEAPONS[type];
    const had = !!this.arsenal[type];
    if (had) this.arsenal[type].reserve = Math.min(def.reserve * 2, this.arsenal[type].reserve + def.reserve);
    else this.arsenal[type] = { ammo: def.mag, reserve: def.reserve };
    this.weapon = '';
    this.switchTo(type);
    return had ? `Munition für ${def.name}!` : `${def.name} aufgenommen!`;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  damage(from) {
    const g = this.game;
    if (this.dead || g.time < this.invulnUntil) return false;
    this.hits++;
    this.invulnUntil = g.time + CONFIG.player.invulnMs / 1000;
    this.shake = 0.6;
    g.audio.hurt();
    g.ui.hurt(from, this);
    g.fx.hurt = 1;
    g.particles.burst(new THREE.Vector3(this.pos.x, 1.3, this.pos.z), 14, { color: new THREE.Color(0.45, 0.02, 0.02), speed: 2, up: 2, size: 0.12, life: 0.7 });
    // Rückstoss weg vom Angreifer
    const away = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    this.vel.addScaledVector(away, 7);
    if (this.hits >= CONFIG.player.maxHits) this.die();
    return true;
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    fadeTo(this.char, 'idle', 0.3);
    this.game.onPlayerDeath();
  }

  tryReload() {
    const s = this.slot;
    if (this.reloading || s.ammo >= this.def.mag || s.reserve <= 0 || this.dead) return;
    this.reloadUntil = this.game.time + this.def.reload;
    this.game.audio.reload();
  }

  _finishReload() {
    const s = this.slot;
    const take = Math.min(this.def.mag - s.ammo, s.reserve);
    s.ammo += take;
    if (s.reserve !== Infinity) s.reserve -= take;
    this.reloadUntil = 0;
  }

  throwGrenade() {
    const g = this.game;
    if (this.grenades <= 0 || g.time - this.lastThrow < 0.8 || this.dead) return;
    this.grenades--;
    this.lastThrow = g.time;
    const hand = this.bones.RightHand ? this.bones.RightHand.getWorldPosition(new THREE.Vector3()) : this.pos.clone().setY(1.5);
    hand.y = Math.max(hand.y, 1.4);
    const v = this.aimDir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 5.5, 0)).add(new THREE.Vector3(this.vel.x, 0, this.vel.z).multiplyScalar(0.5));
    g.projectiles.grenade(hand.addScaledVector(this.aimDir, 0.5), v);
  }

  update(dt, ctrl) {
    const g = this.game;
    const C = CONFIG.player;
    if (this.reloadUntil && g.time >= this.reloadUntil) this._finishReload();

    if (!this.dead) {
      // Blickrichtung
      this.yaw -= ctrl.lookX;
      this.pitch = THREE.MathUtils.clamp(this.pitch - ctrl.lookY, -1.0, 0.75);
      if (ctrl.toggleLight) { this.torchOn = !this.torchOn; g.audio.click(1200, 0.15); }
      if (ctrl.weapon) this.switchTo(ctrl.weapon);
      if (ctrl.cycle) this.cycle(ctrl.cycle);
      if (ctrl.grenade) this.throwGrenade();

      // Bewegung relativ zur Kamera
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      let mx = ctrl.moveX, my = ctrl.moveY;
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const sprinting = ctrl.sprint && my > 0.3 && this.stamina > 0.05;
      this.stamina = THREE.MathUtils.clamp(this.stamina + (sprinting ? -0.22 : 0.14) * dt, 0, 1);
      const speed = (sprinting ? C.sprintSpeed : C.walkSpeed) * (this.weapon === 'launcher' ? 0.9 : 1);
      const wantX = (fx * my + rx * mx) * speed, wantZ = (fz * my + rz * mx) * speed;
      const k = Math.min(1, dt * 12);
      this.vel.x += (wantX - this.vel.x) * k;
      this.vel.z += (wantZ - this.vel.z) * k;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      g.world.colliders.resolve(this.pos, 0.4);
      const R = CONFIG.world.radius, d = Math.hypot(this.pos.x, this.pos.z);
      if (d > R) { this.pos.x *= R / d; this.pos.z *= R / d; }

      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.moving = sp > 0.6;
      // Körperausrichtung & Animation
      let targetBody = this.yaw;
      let animScale = sp / 5.2;
      if (this.moving) {
        if (my < -0.2) { animScale = -animScale; }
        else if (Math.abs(mx) > 0.2) {
          const rel = Math.atan2(-mx, Math.max(0.1, my));
          targetBody = this.yaw + THREE.MathUtils.clamp(rel, -1.1, 1.1);
        }
        fadeTo(this.char, 'run', 0.15, animScale);
        this.char.actions.run.timeScale = animScale;
        this.stepDist += sp * dt;
        if (this.stepDist > (sprinting ? 2.0 : 1.6)) { this.stepDist = 0; g.audio.step(g.world.inVillage(this.pos) ? 1 : 0); }
      } else fadeTo(this.char, 'idle', 0.2);
      this.bodyYaw = lerpAngle(this.bodyYaw, targetBody, Math.min(1, dt * 10));

      // Schiessen / Nachladen
      if (ctrl.reload) this.tryReload();
      if (ctrl.fire && !this.reloading && g.time - this.lastShot > this.def.cooldown && !sprinting) {
        this.lastShot = g.time;
        if (this.ammo > 0) this.shoot();
        else if (this.reserve > 0) this.tryReload();
        else { g.audio.dryFire(); this._dropEmpty(); }
      }
      if (this.ammo === 0 && !this.reloading && g.time - this.lastShot > 0.35) {
        if (this.reserve > 0) this.tryReload(); else this._dropEmpty();
      }
      this.sprinting = sprinting;
    } else {
      this.deathT += dt;
      this.vel.multiplyScalar(0.9);
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.bodyYaw + Math.PI;
    this.char.mixer.update(dt);

    this.forward(this.aimDir);
    const B = this.bones;
    if (this.dead) {
      const k = Math.min(1, this.deathT * 1.8);
      this.char.model.rotation.x = -k * k * Math.PI / 2;
      this.char.model.position.y = k * 0.1;
    } else if (B.RightArm && !this.sprinting) {
      // Arme zielen in Blickrichtung (beidhändiger Griff)
      const aim = this.aimDir.clone();
      pointBone(B.RightArm, B.RightForeArm, aim);
      pointBone(B.RightForeArm, B.RightHand, aim);
      const hand = B.RightHand.getWorldPosition(new THREE.Vector3());
      // linke Hand greift bei Gewehr/Raketenwerfer weiter vorne
      const grip = hand.clone().addScaledVector(aim, this.weapon === 'pistol' ? 0.02 : 0.32);
      const shoulderL = B.LeftArm.getWorldPosition(new THREE.Vector3());
      const toGrip = grip.clone().sub(shoulderL).normalize();
      pointBone(B.LeftArm, B.LeftForeArm, toGrip.clone().lerp(aim, 0.25).normalize());
      const elbow = B.LeftForeArm.getWorldPosition(new THREE.Vector3());
      pointBone(B.LeftForeArm, B.LeftHand, grip.clone().sub(elbow).normalize());
    }

    // Waffe in die Hand
    if (B.RightHand) {
      const hand = B.RightHand.getWorldPosition(new THREE.Vector3());
      const dir = this.sprinting || this.dead ? new THREE.Vector3(-Math.sin(this.bodyYaw), -0.8, -Math.cos(this.bodyYaw)).normalize() : this.aimDir;
      this.gun.position.copy(hand).addScaledVector(dir, 0.05);
      // +Z der Gruppe zeigt in Zielrichtung
      this.gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), UP));
    }
    this.gun.visible = !this.dead || this.deathT < 0.3;

    // Mündungsfeuer
    this.flashT -= dt;
    const muzzle = this.muzzle();
    this.flash.position.copy(muzzle);
    this.flash.visible = this.flashT > 0;
    this.flash.scale.setScalar(this.weapon === 'pistol' ? 0.9 : 1.3);
    this.flash.material.rotation = Math.random() * 6;
    this.flashLight.position.copy(muzzle);
    this.flashLight.intensity = this.flashT > 0 ? 30 : 0;

    // Taschenlampe
    const tp = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.3);
    this.torch.position.copy(tp);
    this.torch.target.position.copy(tp).addScaledVector(this.aimDir, 10);
    this.torch.intensity = this.torchOn && !(this.dead && this.deathT > 0.4) ? 55 * (0.97 + Math.random() * 0.03) : 0;

    // Blinken bei Unverwundbarkeit
    const inv = g.time < this.invulnUntil && !this.dead;
    this.char.model.visible = !inv || Math.floor(g.time * 14) % 2 === 0;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.recoil = Math.max(0, this.recoil - dt * 6);
  }

  // Leere Spezialwaffe ablegen und zurück zur Pistole
  _dropEmpty() {
    if (this.weapon === 'pistol') return;
    const name = this.def.name;
    delete this.arsenal[this.weapon];
    this.weapon = '';
    this.switchTo('pistol');
    this.game.ui.toast(`${name}: keine Munition mehr.`, 2.5);
  }

  muzzle() {
    return this.gun.position.clone().addScaledVector(this.aimDir, this.def.muzzle).add(new THREE.Vector3(0, 0.04, 0));
  }

  shoot() {
    const g = this.game;
    const def = this.def;
    this.slot.ammo--;
    this.flashT = 0.05;
    this.recoil = 1;
    this.shake = Math.max(this.shake, def.rocket ? 0.35 : 0.12);
    this.pitch = Math.min(0.75, this.pitch + def.recoil);
    // Strahl von der Kamera durch das Fadenkreuz
    const cam = g.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const spread = def.rocket ? 0 : (this.moving ? def.spread[1] : def.spread[0]);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const minT = origin.distanceTo(this.pos.clone().setY(1.5)) * 0.9;
    const range = CONFIG.player.range;
    let tWorld = g.world.colliders.raycast(origin.clone().addScaledVector(dir, minT), dir, range) + minT;
    if (dir.y < -1e-4) tWorld = Math.min(tWorld, -origin.y / dir.y);
    const zh = g.zombies.raycast(origin, dir, Math.min(tWorld, range + minT), minT);
    const end = origin.clone().addScaledVector(dir, zh ? zh.t : Math.min(tWorld, range));

    if (def.rocket) {
      // Rakete fliegt vom Lauf zum Zielpunkt
      const m = this.muzzle();
      const rdir = end.clone().sub(m);
      if (rdir.lengthSq() < 4) rdir.copy(dir);
      g.projectiles.rocket(m, rdir.normalize());
      g.particles.burst(this.gun.position.clone().addScaledVector(this.aimDir, -0.6), 12, { color: new THREE.Color(0.35, 0.35, 0.35), speed: 1.2, up: 0.8, size: 0.5, life: 1, gravity: 0.5 });
    } else {
      g.audio.shot(def.sound);
      g.tracers.add(this.muzzle(), end);
      if (zh) {
        g.zombies.hit(zh.zombie, zh.head ? 99 : def.damage, end, dir, zh.head);
        g.ui.hitMarker(zh.head);
      } else if (tWorld < range) {
        g.sparks.burst(end, 6, { color: new THREE.Color(1.5, 1.1, 0.6), speed: 1.6, up: 1.5, size: 0.05, life: 0.35 });
        g.particles.burst(end, 5, { color: new THREE.Color(0.25, 0.22, 0.18), speed: 1, up: 1.2, size: 0.12, life: 0.6 });
      }
    }
    // Lärm lockt Zombies
    g.zombies.alert(this.pos);
  }

  // Kamera hinter der Schulter
  updateCamera(camera, dt) {
    const fwd = this.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.pos.clone().add(new THREE.Vector3(0, this.dead ? 1.0 : 1.62, 0)).addScaledVector(right, 0.55);
    let dist = this.dead ? 5 + Math.min(3, this.deathT) : 3.0;
    const back = fwd.clone().negate();
    const hit = this.game.world.colliders.raycast(pivot, back, dist);
    if (hit < dist) dist = Math.max(0.6, hit - 0.25);
    const pos = pivot.clone().addScaledVector(back, dist);
    pos.y = Math.max(0.4, pos.y);
    if (this.shake > 0) {
      const s = this.shake * 0.08;
      pos.x += (Math.random() - 0.5) * s; pos.y += (Math.random() - 0.5) * s; pos.z += (Math.random() - 0.5) * s;
    }
    camera.position.copy(pos);
    camera.lookAt(pivot.clone().addScaledVector(fwd, 20));
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
