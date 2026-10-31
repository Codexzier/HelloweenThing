import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ------------------------------------------------------------------
//  Prozedurale Texturen
// ------------------------------------------------------------------
const texCache = new Map();
export function glowTexture(inner = 'rgba(255,220,150,1)', outer = 'rgba(255,120,20,0)', size = 128) {
  const key = inner + outer + size;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/,[\d.]+\)$/, ',0.6)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function flameTexture() {
  if (texCache.has('flame')) return texCache.get('flame');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s * 0.62, 2, s / 2, s * 0.55, s * 0.48);
  grd.addColorStop(0, 'rgba(255,250,210,1)');
  grd.addColorStop(0.25, 'rgba(255,190,70,0.9)');
  grd.addColorStop(0.6, 'rgba(230,80,10,0.45)');
  grd.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(s / 2, 0);
  g.bezierCurveTo(s * 0.95, s * 0.45, s * 0.9, s, s / 2, s);
  g.bezierCurveTo(s * 0.1, s, s * 0.05, s * 0.45, s / 2, 0);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set('flame', t);
  return t;
}

function bloodTexture() {
  if (texCache.has('blood')) return texCache.get('blood');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(70,4,6,0.95)';
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * s * 0.32;
    const rr = 4 + Math.random() * (i < 6 ? 26 : 10);
    g.beginPath();
    g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, rr, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set('blood', t);
  return t;
}

// ------------------------------------------------------------------
//  Feuer (Lagerfeuer, Feuerkorb, Fackeln)
// ------------------------------------------------------------------
export class Fire {
  constructor(scene, pos, { size = 1, light = true, lightIntensity = 14, lightDistance = 16 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.size = size;
    this.flames = [];
    const mat = new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.6, 1.1) });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(mat);
      s.userData = { phase: Math.random(), speed: 0.9 + Math.random() * 0.6, ox: (Math.random() - 0.5) * 0.35 * size, oz: (Math.random() - 0.5) * 0.35 * size };
      this.group.add(s);
      this.flames.push(s);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,160,60,0.9)', 'rgba(255,80,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    glow.scale.setScalar(3.2 * size);
    glow.position.y = 0.4 * size;
    this.group.add(glow);
    this.glow = glow;
    if (light) {
      this.light = new THREE.PointLight(0xff8a3a, lightIntensity, lightDistance, 1.6);
      this.light.position.y = 0.9 * size;
      this.baseIntensity = lightIntensity;
      this.group.add(this.light);
    }
    scene.add(this.group);
  }
  update(dt, t) {
    for (const f of this.flames) {
      const u = f.userData;
      const k = (t * u.speed + u.phase) % 1;
      f.position.set(u.ox * (1 - k), k * 1.1 * this.size, u.oz * (1 - k));
      const sc = (1 - k) * 0.9 * this.size + 0.15;
      f.scale.set(sc * 0.8, sc * 1.25, 1);
      f.material.opacity = 1;
    }
    const flick = 0.75 + 0.25 * Math.sin(t * 17.3) * Math.sin(t * 7.1 + 1.3) + (Math.random() - 0.5) * 0.12;
    if (this.light) this.light.intensity = this.baseIntensity * flick;
    this.glow.material.opacity = 0.4 + 0.2 * flick;
  }
}

// ------------------------------------------------------------------
//  Partikel (Blut, Funken, Erde, Glut)
// ------------------------------------------------------------------
export class Particles {
  constructor(scene, max = 1500, additive = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('acolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: `attribute float size; attribute vec4 acolor; varying vec4 vC; uniform float scale;
        void main(){ vC = acolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.15, d) * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  setScale(h) { this.material.uniforms.scale.value = h * 0.5; }
  spawn(p, v, color, size, life, gravity = -9) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = 1;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
  }
  burst(p, n, { color, speed = 3, up = 2, size = 0.12, life = 0.8, gravity = -9, spread = 1 }) {
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      v.set((Math.random() - 0.5) * 2 * speed * spread, Math.random() * up + up * 0.3, (Math.random() - 0.5) * 2 * speed * spread);
      c.copy(color).multiplyScalar(0.7 + Math.random() * 0.5);
      this.spawn(p, v, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; this.vel[i * 3 + 1] = 0; }
      this.col[i * 4 + 3] = Math.min(1, this.life[i] / this.maxLife[i] * 2);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.acolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

// ------------------------------------------------------------------
//  Bodennebel – mehrere Schichten mit animiertem Rauschen
// ------------------------------------------------------------------
export class GroundFog {
  constructor(scene) {
    this.layers = [];
    const noise = `
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }`;
    const heights = [0.12, 0.45, 0.85, 1.35];
    heights.forEach((h, idx) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          color: { value: new THREE.Color(0x56648a) },
          opacity: { value: 0.16 - idx * 0.025 },
          center: { value: new THREE.Vector3() },
          layer: { value: idx },
          density: { value: 1 },
        },
        vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `${noise}
          uniform float time; uniform vec3 color; uniform float opacity; uniform vec3 center; uniform float layer; uniform float density;
          varying vec3 vW;
          void main(){
            vec2 p = vW.xz * (0.045 + layer*0.01) + vec2(time*0.025, time*0.017) * (1.0 + layer*0.6);
            float n = fbm(p + fbm(p*0.7 + time*0.01));
            n = smoothstep(0.32, 0.82, n);
            float d = length(vW.xz - center.xz);
            float fade = 1.0 - smoothstep(55.0, 95.0, d);
            float nearFade = smoothstep(0.5, 5.0, d);
            float a = n * opacity * fade * nearFade * density;
            if (a < 0.003) discard;
            gl_FragColor = vec4(color, a);
          }`,
        transparent: true,
        depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 1, 1), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = h;
      m.renderOrder = 3;
      m.frustumCulled = false;
      scene.add(m);
      this.layers.push(m);
    });
  }
  update(t, cam) {
    for (const m of this.layers) {
      m.position.x = Math.round(cam.x / 10) * 10;
      m.position.z = Math.round(cam.z / 10) * 10;
      m.material.uniforms.time.value = t;
      m.material.uniforms.center.value.copy(cam);
    }
  }
}

// ------------------------------------------------------------------
//  Fledermäuse
// ------------------------------------------------------------------
export class Bats {
  constructor(scene, count = 18) {
    this.bats = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x050507, side: THREE.DoubleSide });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.08, 0.55, 0.05, -0.15, 0.45, 0, 0.12, 0, 0, 0.1, 0.45, 0, 0.12, 0.2, -0.02, 0.18], 3));
    wingGeo.computeVertexNormals();
    const bodyGeo = new THREE.SphereGeometry(0.09, 6, 4);
    bodyGeo.scale(1, 0.8, 1.8);
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, mat));
      const l = new THREE.Mesh(wingGeo, mat);
      const r = new THREE.Mesh(wingGeo, mat);
      r.scale.x = -1;
      g.add(l, r);
      g.scale.setScalar(1.3 + Math.random() * 0.8);
      const graveyard = i < count * 0.6;
      g.userData = {
        l, r,
        cx: graveyard ? 54 + (Math.random() - 0.5) * 20 : (Math.random() - 0.5) * 30,
        cz: graveyard ? -6 + (Math.random() - 0.5) * 20 : (Math.random() - 0.5) * 30,
        rad: 6 + Math.random() * 14,
        h: 9 + Math.random() * 14,
        sp: (0.35 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
        ph: Math.random() * Math.PI * 2,
        flap: 14 + Math.random() * 8,
      };
      scene.add(g);
      this.bats.push(g);
    }
  }
  update(t) {
    for (const b of this.bats) {
      const u = b.userData;
      const a = u.ph + t * u.sp;
      const wob = Math.sin(t * 1.3 + u.ph) * 3;
      b.position.set(u.cx + Math.cos(a) * (u.rad + wob), u.h + Math.sin(t * 2 + u.ph) * 1.5, u.cz + Math.sin(a) * (u.rad + wob));
      b.rotation.y = -a + (u.sp > 0 ? 0 : Math.PI);
      const f = Math.sin(t * u.flap + u.ph) * 0.9;
      u.l.rotation.z = f;
      u.r.rotation.z = -f;
    }
  }
}

// ------------------------------------------------------------------
//  Irrlichter im Wald
// ------------------------------------------------------------------
export class Wisps {
  constructor(scene, points) {
    this.items = [];
    const mat = new THREE.SpriteMaterial({ map: glowTexture('rgba(170,255,230,1)', 'rgba(40,160,200,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 2.2, 2.0) });
    for (const p of points) {
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.7);
      s.userData = { x: p.x, z: p.z, ph: Math.random() * 10, r: 2 + Math.random() * 4 };
      scene.add(s);
      this.items.push(s);
    }
  }
  update(t) {
    for (const s of this.items) {
      const u = s.userData;
      s.position.set(u.x + Math.sin(t * 0.3 + u.ph) * u.r, 1.2 + Math.sin(t * 1.1 + u.ph) * 0.5, u.z + Math.cos(t * 0.23 + u.ph * 2) * u.r);
      const pulse = 0.55 + 0.45 * Math.sin(t * 2.3 + u.ph);
      s.scale.setScalar(0.35 + pulse * 0.45);
    }
  }
}

// ------------------------------------------------------------------
//  Leuchtspuren der Schüsse
// ------------------------------------------------------------------
export class Tracers {
  constructor(scene) {
    this.items = [];
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.4, 1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      scene.add(line);
      this.items.push({ line, life: 0 });
    }
    this.i = 0;
  }
  add(a, b) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    const p = it.line.geometry.attributes.position;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
    it.life = 0.07;
  }
  update(dt) {
    for (const it of this.items) {
      it.life -= dt;
      it.line.material.opacity = Math.max(0, it.life / 0.07) * 0.9;
    }
  }
}

// ------------------------------------------------------------------
//  Blutflecken auf dem Boden
// ------------------------------------------------------------------
export class Decals {
  constructor(scene, max = 40) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: bloodTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0 }));
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.items.push({ m, life: 0 });
    }
    this.i = 0;
  }
  add(x, z, s = 1.6) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    it.m.position.set(x, 0.03 + this.i * 0.0005, z);
    it.m.rotation.y = Math.random() * Math.PI * 2;
    it.m.scale.setScalar(s * (0.8 + Math.random() * 0.5));
    it.m.visible = true;
    it.life = 40;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life -= dt;
      it.m.material.opacity = Math.min(0.9, it.life / 5);
      if (it.life <= 0) it.m.visible = false;
    }
  }
  clear() { for (const it of this.items) { it.m.visible = false; it.life = 0; } }
}

// ------------------------------------------------------------------
//  Blitze
// ------------------------------------------------------------------
export class Lightning {
  constructor(onThunder) {
    this.next = 18 + Math.random() * 20;
    this.flash = 0;
    this.seq = [];
    this.onThunder = onThunder;
  }
  update(dt) {
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 25 + Math.random() * 40;
      let tt = 0;
      this.seq = [];
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { this.seq.push([tt, 0.5 + Math.random() * 0.7]); tt += 0.06 + Math.random() * 0.15; }
      this.time = 0;
      const dist = Math.random();
      setTimeout(() => this.onThunder && this.onThunder(dist), 400 + dist * 2500);
    }
    if (this.seq.length) {
      this.time += dt;
      let f = 0;
      for (const [st, s] of this.seq) {
        const k = this.time - st;
        if (k >= 0 && k < 0.18) f = Math.max(f, s * (1 - k / 0.18));
      }
      this.flash = f;
      if (this.time > 1.5) { this.seq = []; this.flash = 0; }
    }
  }
}

// ------------------------------------------------------------------
//  Postprocessing: Bloom + Vignette/Körnung/Schadens-Effekt
// ------------------------------------------------------------------
export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.55, 0.82);
  composer.addPass(bloom);
  const fx = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      hurt: { value: 0 },
      lowHealth: { value: 0 },
      grain: { value: 0.035 },
      fade: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time, hurt, lowHealth, grain, fade; varying vec2 vUv;
      void main(){
        vec2 uv = vUv; vec2 c = uv - 0.5; float r = length(c);
        float ca = 0.0012 + hurt * 0.008 + lowHealth*0.002;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + c * ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - c * ca).b;
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(l), lowHealth * 0.55);
        float v = smoothstep(0.82, 0.22, r);
        col *= mix(0.28, 1.0, v);
        float pulse = 0.6 + 0.4 * sin(time * 6.0);
        float redA = hurt * smoothstep(0.15, 0.7, r) * 0.9 + lowHealth * 0.35 * smoothstep(0.3, 0.75, r) * pulse;
        col = mix(col, vec3(0.35, 0.0, 0.0), clamp(redA, 0.0, 1.0));
        float g = fract(sin(dot(uv * vec2(1234.5, 987.6) + fract(time) * 50.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        col += g * grain;
        col *= 1.0 - fade;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  composer.addPass(fx);
  composer.addPass(new OutputPass());
  return {
    composer, bloom, fx,
    setSize(w, h) { composer.setSize(w, h); bloom.setSize(w / 2, h / 2); },
    setBloom(on) { bloom.enabled = on; },
  };
}
