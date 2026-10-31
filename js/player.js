import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createSurvivor, pointBone, fadeTo } from './characters.js';
import { glowTexture } from './effects.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(game) {
    this.game = game;
    const { assets, scene } = game;
    this.char = createSurvivor(assets, 'survivorMaleB');
    scene.add(this.char.root);
    this.root = this.char.root;
    this.bones = this.char.bones;

    // Pistole (Kenney Weapon Pack)
    const pg = assets.get('weapons/pistol');
    this.pistol = new THREE.Group();
    if (pg) {
      const m = pg.scene.clone(true);
      m.scale.setScalar(0.8);
      m.rotation.y = Math.PI; // Lauf zeigt nach -Z der Gruppe
      m.position.set(0, -0.09, 0.02);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.pistol.add(m);
    }
    scene.add(this.pistol);

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
    this.yaw = 0;
    this.pitch = -0.05;
    this.bodyYaw = 0;
    this.hits = 0;
    this.invulnUntil = 0;
    this.ammo = CONFIG.player.magazine;
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
    this.pistol.visible = true;
    fadeTo(this.char, 'idle', 0);
  }

  get reloading() { return this.game.time < this.reloadUntil; }

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
    if (this.reloading || this.ammo >= CONFIG.player.magazine || this.dead) return;
    this.reloadUntil = this.game.time + CONFIG.player.reloadMs / 1000;
    this.game.audio.reload();
  }

  update(dt, ctrl) {
    const g = this.game;
    const C = CONFIG.player;
    if (this.reloadUntil && g.time >= this.reloadUntil && this.ammo < C.magazine) { this.ammo = C.magazine; this.reloadUntil = 0; }

    if (!this.dead) {
      // Blickrichtung
      this.yaw -= ctrl.lookX;
      this.pitch = THREE.MathUtils.clamp(this.pitch - ctrl.lookY, -1.0, 0.75);
      if (ctrl.toggleLight) { this.torchOn = !this.torchOn; g.audio.click(1200, 0.15); }

      // Bewegung relativ zur Kamera
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      let mx = ctrl.moveX, my = ctrl.moveY;
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const sprinting = ctrl.sprint && my > 0.3 && this.stamina > 0.05;
      this.stamina = THREE.MathUtils.clamp(this.stamina + (sprinting ? -0.22 : 0.14) * dt, 0, 1);
      const speed = sprinting ? C.sprintSpeed : C.walkSpeed;
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
      if (ctrl.fire && !this.reloading && g.time - this.lastShot > C.fireCooldownMs / 1000 && !sprinting) {
        this.lastShot = g.time;
        if (this.ammo > 0) this.shoot(); else { g.audio.dryFire(); this.tryReload(); }
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
      const shoulderL = B.LeftArm.getWorldPosition(new THREE.Vector3());
      const toHand = hand.clone().addScaledVector(aim, 0.02).sub(shoulderL).normalize();
      pointBone(B.LeftArm, B.LeftForeArm, toHand.clone().lerp(aim, 0.25).normalize());
      const elbow = B.LeftForeArm.getWorldPosition(new THREE.Vector3());
      pointBone(B.LeftForeArm, B.LeftHand, hand.clone().sub(elbow).normalize());
    }

    // Pistole in die Hand
    if (B.RightHand) {
      const hand = B.RightHand.getWorldPosition(new THREE.Vector3());
      const dir = this.sprinting || this.dead ? new THREE.Vector3(-Math.sin(this.bodyYaw), -0.8, -Math.cos(this.bodyYaw)).normalize() : this.aimDir;
      this.pistol.position.copy(hand).addScaledVector(dir, 0.07);
      this.pistol.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), dir.clone().negate(), UP));
    }
    this.pistol.visible = !this.dead || this.deathT < 0.3;

    // Mündungsfeuer
    this.flashT -= dt;
    const muzzle = this.muzzle();
    this.flash.position.copy(muzzle);
    this.flash.visible = this.flashT > 0;
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

  muzzle() {
    return this.pistol.position.clone().addScaledVector(this.aimDir, 0.24).add(new THREE.Vector3(0, 0.04, 0));
  }

  shoot() {
    const g = this.game;
    this.ammo--;
    this.flashT = 0.05;
    this.recoil = 1;
    this.shake = Math.max(this.shake, 0.12);
    this.pitch = Math.min(0.75, this.pitch + 0.012);
    g.audio.shot();
    // Strahl von der Kamera durch das Fadenkreuz
    const cam = g.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const spread = (this.moving ? 0.012 : 0.004);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const minT = origin.distanceTo(this.pos.clone().setY(1.5)) * 0.9;
    const range = CONFIG.player.range;
    let tWorld = g.world.colliders.raycast(origin.clone().addScaledVector(dir, minT), dir, range) + minT;
    if (dir.y < -1e-4) tWorld = Math.min(tWorld, -origin.y / dir.y);
    const zh = g.zombies.raycast(origin, dir, Math.min(tWorld, range + minT), minT);
    const end = origin.clone().addScaledVector(dir, zh ? zh.t : Math.min(tWorld, range));
    g.tracers.add(this.muzzle(), end);
    if (zh) {
      g.zombies.hit(zh.zombie, zh.head ? 99 : 1, end, dir, zh.head);
      g.ui.hitMarker(zh.head);
    } else if (tWorld < range) {
      g.sparks.burst(end, 6, { color: new THREE.Color(1.5, 1.1, 0.6), speed: 1.6, up: 1.5, size: 0.05, life: 0.35 });
      g.particles.burst(end, 5, { color: new THREE.Color(0.25, 0.22, 0.18), speed: 1, up: 1.2, size: 0.12, life: 0.6 });
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
