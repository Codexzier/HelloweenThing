import * as THREE from 'three';

// ------------------------------------------------------------------
//  "Auto Spiel": der Computer steuert den Überlebenden
// ------------------------------------------------------------------
export class Autopilot {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.wp = 0;
    this.wander = null;
    this.wanderT = 0;
    this.strafe = 1;
    this.strafeT = 2;
    this.noise = new THREE.Vector3();
    this.noiseT = 0;
    this.target = null;
    this.reactT = 0;
  }

  control(dt) {
    const g = this.game;
    const p = g.player;
    const ctrl = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, reload: false, sprint: false, toggleLight: false };
    if (p.dead) return ctrl;
    const pos = p.pos;
    let desiredYaw = p.yaw, desiredPitch = -0.05;
    const move = new THREE.Vector3();

    if (!g.villageReached) {
      // Dem Weg ins Dorf folgen
      const pts = g.world.pathSamples;
      while (this.wp < pts.length - 1 && Math.hypot(pts[this.wp].x - pos.x, pts[this.wp].z - pos.z) < 4) this.wp++;
      const t = pts[Math.min(this.wp + 2, pts.length - 1)];
      move.set(t.x - pos.x, 0, t.z - pos.z).normalize();
      desiredYaw = Math.atan2(-move.x, -move.z);
      ctrl.sprint = true;
    } else {
      const alive = g.zombies.list.filter((z) => !z.dead);
      // nächstes Ziel wählen (mit kurzer Reaktionszeit)
      this.reactT -= dt;
      if (!this.target || this.target.dead || this.reactT <= 0) {
        let best = null, bd = Infinity;
        for (const z of alive) {
          let d = z.pos.distanceTo(pos);
          if (z.def.boss) d *= 0.8;
          if (d < bd) { bd = d; best = z; }
        }
        // je mehr Zombies in der Nähe, desto nervöser zielt der Bot
        const near = alive.filter((z) => z.pos.distanceTo(pos) < 12).length;
        const panic = 1 + near * 0.35 + g.kills * 0.01;
        if (best !== this.target) this.noise.set((Math.random() - 0.5) * 0.9 * panic, (Math.random() - 0.5) * 0.7 * panic, (Math.random() - 0.5) * 0.9 * panic);
        this.target = best;
        this.reactT = 0.35 + Math.random() * 0.45;
      }
      // Gefahren meiden
      let threat = Infinity;
      for (const z of alive) {
        const dx = pos.x - z.pos.x, dz = pos.z - z.pos.z;
        const d = Math.hypot(dx, dz);
        threat = Math.min(threat, d);
        if (d < 8) move.add(new THREE.Vector3(dx, 0, dz).multiplyScalar(1 / Math.max(0.5, d * d) * 3));
      }
      // im Dorf bleiben
      const dc = Math.hypot(pos.x, pos.z);
      if (dc > 16) move.add(new THREE.Vector3(-pos.x, 0, -pos.z).multiplyScalar((dc - 16) * 0.08 / dc));

      if (this.target) {
        const z = this.target;
        const aim = new THREE.Vector3(z.pos.x, z.def.head[0] - z.def.head[1] * 0.6, z.pos.z);
        this.noise.multiplyScalar(Math.pow(0.15, dt));
        aim.add(this.noise);
        const cam = g.camera.position;
        const dx = aim.x - cam.x, dy = aim.y - cam.y, dz = aim.z - cam.z;
        const hd = Math.hypot(dx, dz);
        desiredYaw = Math.atan2(-dx, -dz);
        desiredPitch = Math.atan2(dy, hd);
        const d = z.pos.distanceTo(pos);
        // seitlich ausweichen
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 1.5 + Math.random() * 2; }
        const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
        move.addScaledVector(right, this.strafe * (d < 10 ? 0.5 : 0.25));
        // feuern, wenn gut gezielt und freie Sicht
        const yawErr = Math.abs(angleDiff(p.yaw, desiredYaw));
        const pitchErr = Math.abs(p.pitch - desiredPitch);
        const tol = Math.atan2(z.def.body[2] * 0.8, Math.max(1, hd));
        if (yawErr < tol && pitchErr < tol * 1.5 && d < 42) {
          const dir = new THREE.Vector3(dx, dy, dz).normalize();
          const blocked = g.world.colliders.raycast(cam.clone().addScaledVector(dir, 3), dir, Math.max(0, Math.hypot(dx, dy, dz) - 3.5)) < Math.hypot(dx, dy, dz) - 3.5;
          if (!blocked) ctrl.fire = true;
          else move.addScaledVector(right, this.strafe * 0.8);
        }
        if (threat < 4.5 && alive.length > 2) ctrl.sprint = false;
      } else {
        // Umherlaufen und Umsehen
        this.wanderT -= dt;
        if (!this.wander || this.wanderT <= 0 || Math.hypot(this.wander.x - pos.x, this.wander.z - pos.z) < 2) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
          this.wander = new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
          this.wanderT = 4 + Math.random() * 3;
        }
        move.add(new THREE.Vector3(this.wander.x - pos.x, 0, this.wander.z - pos.z).normalize().multiplyScalar(0.6));
        desiredYaw = p.yaw + dt * 0.9; // langsam umsehen
      }
      if (p.ammo === 0 || (p.ammo < 5 && threat > 16)) ctrl.reload = true;
    }

    // Hindernissen ausweichen
    if (move.lengthSq() > 1e-4) {
      const l = Math.min(1, move.length());
      move.normalize();
      const C = g.world.colliders;
      if (!C.isFree(pos.x + move.x * 1.4, pos.z + move.z * 1.4, 0.45)) {
        for (const a of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6]) {
          const v = move.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
          if (C.isFree(pos.x + v.x * 1.4, pos.z + v.z * 1.4, 0.45)) { move.copy(v); break; }
        }
      }
      move.multiplyScalar(l);
      const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      ctrl.moveY = move.dot(f);
      ctrl.moveX = move.dot(r);
    }

    // sanft drehen
    const turn = 4 * dt;
    const dy = THREE.MathUtils.clamp(angleDiff(p.yaw, desiredYaw), -turn, turn);
    ctrl.lookX = -dy;
    ctrl.lookY = -THREE.MathUtils.clamp(desiredPitch - p.pitch, -turn, turn);
    return ctrl;
  }
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
