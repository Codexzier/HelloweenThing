import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Fire, glowTexture, Wisps } from './effects.js';

// Maßstäbe der Kenney-Kits (1 Einheit im Kit -> Meter)
const T = 3.0;   // Fantasy Town Kit (1 Wand-Zelle = 3 m)
const G = 2.1;   // Graveyard Kit
const SV = 3.2;  // Survival Kit

export function makeRng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------
//  Kollisionen (2D-Kreise und gedrehte Boxen mit Höhe)
// ------------------------------------------------------------------
export class Colliders {
  constructor() {
    this.list = [];
    this.cell = 8;
    this.grid = new Map();
    this.stamp = 1;
  }
  _cells(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i * 4099 + j);
  }
  _insert(col) {
    this.list.push(col);
    this._cells(col.x, col.z, col.br, (k) => {
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(col);
    });
    return col;
  }
  addCircle(x, z, r, h = 3) { return this._insert({ type: 0, x, z, r, h, br: r, s: 0 }); }
  addBox(x, z, hw, hd, rot = 0, h = 3) {
    return this._insert({ type: 1, x, z, hw, hd, h, cos: Math.cos(rot), sin: Math.sin(rot), br: Math.hypot(hw, hd), s: 0 });
  }
  query(x, z, r, fn) {
    const st = ++this.stamp;
    this._cells(x, z, r, (k) => {
      const a = this.grid.get(k);
      if (!a) return;
      for (const c of a) { if (c.s !== st) { c.s = st; fn(c); } }
    });
  }
  // schiebt pos (x/z) aus allen Hindernissen heraus
  resolve(pos, r) {
    let hit = false;
    this.query(pos.x, pos.z, r + 0.5, (c) => {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      if (c.type === 0) {
        const d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m) {
          hit = true;
          if (d > 1e-5) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; } else pos.x += m;
        }
      } else {
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx));
        const cz = Math.max(-c.hd, Math.min(c.hd, lz));
        let px = lx - cx, pz = lz - cz;
        const d = Math.hypot(px, pz);
        if (d >= r) return;
        hit = true;
        let nx, nz;
        if (d > 1e-6) { nx = cx + px / d * r; nz = cz + pz / d * r; } else {
          // im Inneren: kürzester Weg nach draussen
          const ox = c.hw - Math.abs(lx), oz = c.hd - Math.abs(lz);
          if (ox < oz) { nx = Math.sign(lx || 1) * (c.hw + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (c.hd + r); }
        }
        pos.x = c.x + nx * c.cos + nz * c.sin;
        pos.z = c.z - nx * c.sin + nz * c.cos;
      }
    });
    return hit;
  }
  isFree(x, z, r) {
    let free = true;
    const p = { x, z };
    this.query(x, z, r + 0.5, (c) => {
      if (!free) return;
      const dx = p.x - c.x, dz = p.z - c.z;
      if (c.type === 0) { if (Math.hypot(dx, dz) < c.r + r) free = false; } else {
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
        if (Math.hypot(lx - cx, lz - cz) < r) free = false;
      }
    });
    return free;
  }
  // Strahl gegen Hindernisse: liefert Distanz oder Infinity
  raycast(o, d, maxDist) {
    let best = maxDist;
    const st = ++this.stamp;
    const step = this.cell * 0.5;
    const visit = (k) => {
      const a = this.grid.get(k);
      if (!a) return;
      for (const c of a) {
        if (c.s === st) continue;
        c.s = st;
        const t = c.type === 0 ? rayCylinder(o, d, c) : rayBox(o, d, c);
        if (t < best) best = t;
      }
    };
    for (let s = 0; s <= maxDist + step; s += step) {
      const x = o.x + d.x * s, z = o.z + d.z * s;
      const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) visit((i + a) * 4099 + (j + b));
      if (s > best) break;
    }
    return best;
  }
}

function rayCylinder(o, d, c) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return Infinity;
  const b = 2 * (ox * d.x + oz * d.z);
  const cc = ox * ox + oz * oz - c.r * c.r;
  if (cc < 0) return Infinity; // Ursprung innerhalb
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return Infinity;
  const y = o.y + d.y * t;
  return (y >= 0 && y <= c.h) ? t : Infinity;
}

function rayBox(o, d, c) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const lox = ox * c.cos - oz * c.sin, loz = ox * c.sin + oz * c.cos;
  const ldx = d.x * c.cos - d.z * c.sin, ldz = d.x * c.sin + d.z * c.cos;
  let tmin = -Infinity, tmax = Infinity;
  const slab = (oo, dd, lo, hi) => {
    if (Math.abs(dd) < 1e-9) return oo >= lo && oo <= hi;
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lox, ldx, -c.hw, c.hw)) return Infinity;
  if (!slab(o.y, d.y, 0, c.h)) return Infinity;
  if (!slab(loz, ldz, -c.hd, c.hd)) return Infinity;
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : Infinity;
}

// ------------------------------------------------------------------
//  Instanzierte Platzierung von Kit-Modellen (in Kacheln für Culling)
// ------------------------------------------------------------------
class Placer {
  constructor(assets, parent) {
    this.assets = assets;
    this.parent = parent;
    this.buckets = new Map();
    this.boxes = new Map();
    this.chunks = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }
  bbox(key) {
    if (this.boxes.has(key)) return this.boxes.get(key);
    const g = this.assets.get(key);
    const b = g ? new THREE.Box3().setFromObject(g.scene) : new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    this.boxes.set(key, b);
    return b;
  }
  // Matrix direkt hinzufügen
  addMatrix(key, m, { cast = true, chunk = 85 } = {}) {
    if (!this.assets.get(key)) return;
    const x = m.elements[12], z = m.elements[14];
    const ci = Math.floor(x / chunk), cj = Math.floor(z / chunk);
    const bk = `${key}|${ci}|${cj}|${cast ? 1 : 0}`;
    let b = this.buckets.get(bk);
    if (!b) { b = { key, cast, list: [], cx: (ci + 0.5) * chunk, cz: (cj + 0.5) * chunk }; this.buckets.set(bk, b); }
    b.list.push(m.clone());
  }
  add(key, x, y, z, rotY = 0, scale = 1, opts = {}) {
    const sx = Array.isArray(scale) ? scale[0] : scale, sy = Array.isArray(scale) ? scale[1] : scale, sz = Array.isArray(scale) ? scale[2] : scale;
    this._e.set(opts.rx || 0, rotY, opts.rz || 0);
    this._q.setFromEuler(this._e);
    this._m.compose(this._v.set(x, y, z), this._q, this._s.set(sx, sy, sz));
    this.addMatrix(key, this._m, opts);
    return this._m;
  }
  // platziert so, dass die Bounding-Box-Mitte (x/z) auf (x, z) liegt
  addCentered(key, x, y, z, rotY = 0, scale = 1, opts = {}) {
    const b = this.bbox(key);
    const cx = (b.min.x + b.max.x) / 2 * scale, cz = (b.min.z + b.max.z) / 2 * scale;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const wx = cx * c + cz * s, wz = -cx * s + cz * c;
    return this.add(key, x - wx, y, z - wz, rotY, scale, opts);
  }
  flush() {
    const tmp = new THREE.Matrix4();
    for (const b of this.buckets.values()) {
      const g = this.assets.get(b.key);
      g.scene.updateMatrixWorld(true);
      const group = new THREE.Group();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, b.list.length);
        b.list.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, o.matrixWorld)));
        im.castShadow = b.cast;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      });
      group.userData.cx = b.cx;
      group.userData.cz = b.cz;
      this.parent.add(group);
      this.chunks.push(group);
    }
    this.buckets.clear();
  }
}

// ------------------------------------------------------------------
//  Welt
// ------------------------------------------------------------------
export class World {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.colliders = new Colliders();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.placer = new Placer(assets, this.root);
    this.fires = [];
    this.flickerLights = [];
    this.glowSprites = [];
    this.animated = [];
    this.rng = makeRng(1031);
    this.villageCenter = new THREE.Vector3(CONFIG.world.village.x, 0, CONFIG.world.village.z);
    const gy = CONFIG.world.graveyard;
    this.gy = { x: gy.x, z: gy.z, hw: 8 * G, hd: 7 * G };
    this.moonDir = new THREE.Vector3(0.42, 0.5, -0.76).normalize();
    this.ammoSpots = [];
  }

  build() {
    this._buildPath();
    this._buildSkyAndLights();
    this._buildGround();
    this._buildVillage();
    this._buildGraveyard();
    this._buildStartCamp();
    this._buildForest();
    this.placer.flush();
    this.wisps = new Wisps(this.scene, this._wispPoints());
    this._buildGhost();
  }

  // ---------------- Weg vom Wald ins Dorf ----------------
  _buildPath() {
    const pts = [
      [0, 146], [5, 124], [-4, 102], [4, 80], [-3, 58], [1, 40], [0, 24], [0, 10],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.pathCurve = new THREE.CatmullRomCurve3(pts);
    this.pathSamples = this.pathCurve.getSpacedPoints(220);
    const g = this.gy;
    this.gravePath = [new THREE.Vector3(20, 0, 2), new THREE.Vector3(30, 0, -3), new THREE.Vector3(g.x - g.hw - 1, 0, g.z)];
  }
  distToPath(x, z) {
    let m = Infinity;
    for (const p of this.pathSamples) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < m) m = d; }
    for (let i = 0; i < this.gravePath.length - 1; i++) m = Math.min(m, segDist2(x, z, this.gravePath[i], this.gravePath[i + 1]));
    return Math.sqrt(m);
  }

  // ---------------- Himmel, Mond, Sterne, Licht ----------------
  _buildSkyAndLights() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x0a1220, 0.0175);
    this.fogBase = 0.0175;

    const skyMat = new THREE.ShaderMaterial({
      uniforms: { moonDir: { value: this.moonDir }, flash: { value: 0 }, time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 moonDir; uniform float flash; uniform float time; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 horizon = vec3(0.045, 0.07, 0.115);
          vec3 zenith = vec3(0.004, 0.008, 0.022);
          vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, h));
          float md = max(dot(d, moonDir), 0.0);
          col += vec3(0.35, 0.45, 0.7) * (pow(md, 600.0) * 0.9 + pow(md, 40.0) * 0.12 + pow(md, 6.0) * 0.05);
          float disc = smoothstep(0.99895, 0.99915, md);
          float crat = n3(d * 160.0) * 0.6 + n3(d * 420.0) * 0.4;
          vec3 moon = vec3(2.6, 2.55, 2.3) * (0.78 + 0.22 * crat);
          col = mix(col, moon, disc);
          // Wolkenschleier
          vec3 cp = d / max(h, 0.08);
          float cl = n3(vec3(cp.xz * 1.2 + time * 0.01, 1.0)) * 0.6 + n3(vec3(cp.xz * 3.0 - time * 0.015, 2.0)) * 0.4;
          cl = smoothstep(0.55, 0.95, cl) * smoothstep(0.02, 0.25, h);
          col = mix(col, vec3(0.06, 0.07, 0.1) + vec3(0.25,0.3,0.4) * pow(md, 8.0), cl * 0.75);
          col += flash * vec3(0.55, 0.6, 0.8) * (0.4 + h);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Sterne
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const r = makeRng(77);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const s = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * s * 700, y * 700, Math.sin(th) * s * 700], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // Licht
    this.hemi = new THREE.HemisphereLight(0x4a5f8f, 0x0d1016, 0.75);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x1a2236, 0.35);
    scene.add(this.ambient);
    const moon = new THREE.DirectionalLight(0xaec4ff, 1.35);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.04;
    scene.add(moon);
    scene.add(moon.target);
    this.moonLight = moon;
  }

  // ---------------- Boden-Textur ----------------
  _buildGround() {
    const SIZE = 440, RES = 2048;
    const c = document.createElement('canvas');
    c.width = c.height = RES;
    const g = c.getContext('2d');
    const k = RES / SIZE;
    const X = (x) => (x + SIZE / 2) * k, Z = (z) => (z + SIZE / 2) * k;
    const r = makeRng(5);
    g.fillStyle = '#121a10';
    g.fillRect(0, 0, RES, RES);
    const pal = ['#17230f', '#1c2a14', '#22311a', '#11170d', '#2a2918', '#1b1b12', '#0f140c', '#26301a'];
    for (let i = 0; i < 9000; i++) {
      g.globalAlpha = 0.18 + r() * 0.2;
      g.fillStyle = pal[(r() * pal.length) | 0];
      g.beginPath();
      g.arc(r() * RES, r() * RES, 2 + r() * 14, 0, Math.PI * 2);
      g.fill();
    }
    // Laub / Nadeln
    for (let i = 0; i < 14000; i++) {
      g.globalAlpha = 0.25;
      g.fillStyle = r() < 0.5 ? '#3a2a14' : '#2d3a1a';
      g.fillRect(r() * RES, r() * RES, 1.5, 1.5);
    }
    // Dorfplatz
    g.globalAlpha = 1;
    let grd = g.createRadialGradient(X(0), Z(0), 0, X(0), Z(0), 34 * k);
    grd.addColorStop(0, 'rgba(52,48,40,1)');
    grd.addColorStop(0.75, 'rgba(40,38,28,0.9)');
    grd.addColorStop(1, 'rgba(30,34,22,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(X(0), Z(0), 34 * k, 0, Math.PI * 2); g.fill();
    // Pflaster
    g.fillStyle = '#4a4740';
    g.beginPath(); g.arc(X(0), Z(0), 13 * k, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 2600; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 13;
      g.fillStyle = r() < 0.5 ? '#57534a' : '#3b3934';
      g.globalAlpha = 0.8;
      g.beginPath(); g.arc(X(Math.cos(a) * rr), Z(Math.sin(a) * rr), 0.9 + r() * 1.3, 0, Math.PI * 2); g.fill();
    }
    // Friedhof
    const gy = this.gy;
    g.globalAlpha = 0.85;
    g.fillStyle = '#1e1a14';
    g.fillRect(X(gy.x - gy.hw), Z(gy.z - gy.hd), gy.hw * 2 * k, gy.hd * 2 * k);
    for (let i = 0; i < 1500; i++) {
      g.globalAlpha = 0.3;
      g.fillStyle = r() < 0.5 ? '#2a3018' : '#151309';
      g.beginPath(); g.arc(X(gy.x - gy.hw + r() * gy.hw * 2), Z(gy.z - gy.hd + r() * gy.hd * 2), 1 + r() * 4, 0, Math.PI * 2); g.fill();
    }
    // Wege
    const strokePath = (pts, w) => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [ww, col, a] of [[w * 1.7, '#241f15', 0.5], [w * 1.25, '#33291b', 0.75], [w, '#3e3222', 0.9]]) {
        g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = ww * k;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
        g.stroke();
      }
    };
    strokePath(this.pathSamples, 3.6);
    strokePath(this.gravePath, 3.0);
    // Fussspuren/Steinchen auf Wegen
    for (const p of this.pathSamples) {
      for (let i = 0; i < 4; i++) {
        g.globalAlpha = 0.5; g.fillStyle = r() < 0.5 ? '#4d4030' : '#2a2216';
        g.fillRect(X(p.x + (r() - 0.5) * 3), Z(p.z + (r() - 0.5) * 3), 2, 2);
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    // Äusserer Boden (über die Textur hinaus)
    const outer = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.69, 900, 32, 1), new THREE.MeshLambertMaterial({ color: 0x0e140c }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    this.root.add(outer);
  }

  // ---------------- Häuser aus Modulteilen ----------------
  _house({ x, z, rot, len = 3, stories = 1, wood = false, high = false, lit = 0, broken = 0 }) {
    const P = this.placer;
    const r = this.rng;
    const H = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
    const piece = (key, lx, ly, lz, prot) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prot), new THREE.Vector3(T, T, T));
      P.addMatrix(key, new THREE.Matrix4().multiplyMatrices(H, m));
      return m;
    };
    const pre = wood ? 'town/wall-wood' : 'town/wall';
    const win = () => (r() < 0.5 ? `${pre}-window-shutters` : `${pre}-window-small`);
    const doorJ = Math.floor(len / 2);
    const litWindows = [];
    for (let s = 0; s < stories; s++) {
      const y = s * T;
      for (let j = 0; j < len; j++) {
        const lz = (j - (len - 1) / 2) * T;
        // Vorderseite (+x, zum Platz)
        let key = s === 0 && j === doorJ ? `${pre}-door` : win();
        if (broken && r() < 0.25 && key !== `${pre}-door`) key = `${pre}-broken`;
        piece(key, T / 2, y, lz, 0);
        if (key.includes('window') && litWindows.length < lit) litWindows.push([T / 2, y, lz, 0]);
        // Rückseite
        piece(r() < 0.4 ? win() : pre, -T / 2, y, lz, Math.PI);
      }
      for (let i = 0; i < 2; i++) {
        const lx = (i - 0.5) * T;
        piece(r() < 0.5 ? win() : pre, lx, y, -(len - 1) / 2 * T, Math.PI / 2);
        piece(r() < 0.5 ? win() : pre, lx, y, (len - 1) / 2 * T, -Math.PI / 2);
      }
    }
    const roofKey = high ? 'town/roof-high' : 'town/roof';
    for (let j = 0; j < len; j++) {
      const lz = (j - (len - 1) / 2) * T;
      piece(roofKey, -T / 2, stories * T, lz, 0);
      piece(roofKey, T / 2, stories * T, lz, Math.PI);
    }
    if (r() < 0.7) piece('town/chimney', -T / 2, stories * T + 0.2, -(len - 1) / 2 * T, 0);
    // beleuchtete Fenster (warmes Licht von innen)
    for (const [lx, ly, lz] of litWindows) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.45) }));
      const v = new THREE.Vector3(lx - 0.35, ly + T * 0.55, lz).applyMatrix4(H);
      glow.position.copy(v);
      glow.rotation.y = rot + Math.PI / 2;
      this.root.add(glow);
      this.flickerLights.push({ mesh: glow, base: glow.material.color.clone(), ph: r() * 10 });
    }
    this.colliders.addBox(x, z, T + 0.05, len * T / 2 + 0.05, rot, stories * T + 2);
    // Kürbis vor der Tür
    const front = new THREE.Vector3(T + 1.1, 0, 0.9).applyMatrix4(H);
    if (r() < 0.8) this._pumpkin(front.x, front.z, true);
  }

  _pumpkin(x, z, carved = true, light = false) {
    const r = this.rng;
    const key = carved ? (r() < 0.5 ? 'graveyard/pumpkin-carved' : 'graveyard/pumpkin-tall-carved') : (r() < 0.5 ? 'graveyard/pumpkin' : 'graveyard/pumpkin-tall');
    this.placer.add(key, x, 0, z, r() * Math.PI * 2, G * 1.3);
    if (carved) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,170,60,1)', 'rgba(255,90,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 1.2, 0.8) }));
      s.position.set(x, 0.45, z);
      s.scale.setScalar(1.3);
      this.root.add(s);
      this.glowSprites.push({ s, base: 1.3, ph: r() * 10 });
      if (light) {
        const l = new THREE.PointLight(0xff8a30, 3, 6, 1.8);
        l.position.set(x, 0.6, z);
        this.root.add(l);
        this.flickerLights.push({ light: l, base: 3, ph: r() * 10 });
      }
    }
  }

  _lamp(x, y, z, withLight, color = 0xffc070, intensity = 9, dist = 16) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,230,170,1)', 'rgba(255,150,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.8, 1.2) }));
    s.position.set(x, y, z);
    s.scale.setScalar(1.6);
    this.root.add(s);
    this.glowSprites.push({ s, base: 1.6, ph: this.rng() * 10 });
    if (withLight) {
      const l = new THREE.PointLight(color, intensity, dist, 1.7);
      l.position.set(x, y - 0.2, z);
      this.root.add(l);
      this.flickerLights.push({ light: l, base: intensity, ph: this.rng() * 10 });
    }
  }

  _buildVillage() {
    const P = this.placer;
    const r = this.rng;
    const houses = [
      [36, 22, 3, 1, false, false, 2, 0], [130, 22, 2, 2, true, true, 1, 0], [166, 23, 3, 1, false, false, 2, 1],
      [202, 22, 2, 2, false, true, 0, 1], [240, 22, 3, 1, true, false, 1, 0], [280, 23, 2, 1, false, false, 0, 1],
      [318, 22, 3, 2, true, true, 2, 0],
    ];
    for (const [phi, R, len, stories, wood, high, lit, broken] of houses) {
      const a = phi * Math.PI / 180;
      const x = Math.sin(a) * R, z = Math.cos(a) * R;
      this._house({ x, z, rot: Math.atan2(z, -x), len, stories, wood, high, lit, broken });
    }
    // Brunnen
    P.add('town/fountain-round', 0, 0, 0, 0, T * 1.1);
    P.add('town/fountain-center', 0, 0, 0, 0, T * 1.1);
    this.colliders.addCircle(0, 0, 3.4, 1.0);
    // Laternen
    for (const phi of [45, 135, 225, 315]) {
      const a = phi * Math.PI / 180;
      const x = Math.sin(a) * 9.5, z = Math.cos(a) * 9.5;
      P.add('town/lantern', x, 0, z, a, 2.2);
      this.colliders.addCircle(x, z, 0.3, 3);
      this._lamp(x, 3.15, z, phi !== 135, 0xffb860, 10, 18);
    }
    // Marktstände, Karren, Kisten
    const ring = (phi, R) => { const a = phi * Math.PI / 180; return [Math.sin(a) * R, Math.cos(a) * R, Math.atan2(Math.cos(a) * R, -Math.sin(a) * R)]; };
    let [x, z, rot] = ring(72, 14);
    P.addCentered('town/stall-red', x, 0, z, rot + Math.PI / 2, T);
    this.colliders.addBox(x, z, 1.0, 1.6, rot + Math.PI / 2, 2.5);
    [x, z, rot] = ring(292, 14);
    P.addCentered('town/stall-green', x, 0, z, rot + Math.PI / 2, T);
    this.colliders.addBox(x, z, 1.0, 1.6, rot + Math.PI / 2, 2.5);
    [x, z, rot] = ring(258, 15);
    P.addCentered('town/cart', x, 0, z, rot + 0.4, T * 0.9);
    this.colliders.addBox(x, z, 0.5 * T * 0.9, 0.7 * T * 0.9, rot + 0.4, 1.6);
    [x, z, rot] = ring(185, 14.5);
    P.addCentered('town/cart-high', x, 0, z, rot - 0.3, T * 0.9);
    this.colliders.addBox(x, z, 0.5 * T * 0.9, 0.7 * T * 0.9, rot - 0.3, 2);
    // Überlebenden-Lager mit Lagerfeuer
    const cx = -9, cz = 8;
    P.add('survival/campfire-pit', cx, 0, cz, 0, SV * 1.4);
    P.add('survival/campfire-stand', cx, 0, cz, 0.3, SV * 1.4);
    this.colliders.addCircle(cx, cz, 0.7, 1);
    this.fires.push(new Fire(this.scene, new THREE.Vector3(cx, 0.1, cz), { size: 1.1, lightIntensity: 26, lightDistance: 22 }));
    P.add('survival/tent-canvas', cx - 4.5, 0, cz + 3.5, 0.8, SV * 1.6);
    this.colliders.addCircle(cx - 4.5, cz + 3.5, 1.4, 2);
    P.add('survival/bedroll', cx + 2.6, 0, cz + 2.4, -0.6, SV * 1.2, { cast: false });
    P.add('survival/tree-log', cx - 2.4, 0.15, cz - 1.0, 0.4, SV * 1.2);
    P.add('survival/tree-log', cx + 2.2, 0.15, cz - 1.4, -0.5, SV * 1.2);
    for (const [bx, bz, k] of [[cx - 1, cz + 4.6, 'survival/barrel'], [cx - 0.2, cz + 5.2, 'survival/barrel-open'], [cx + 1.4, cz + 4.8, 'survival/box-large'], [cx + 4.5, cz - 2.5, 'survival/chest'], [cx + 5.5, cz - 1.5, 'survival/box']]) {
      P.add(k, bx, 0, bz, r() * 6, SV);
      this.colliders.addCircle(bx, bz, 0.45, 1.2);
      this.ammoSpots.push(new THREE.Vector3(bx, 0, bz));
    }
    // Barrikaden am Dorfeingang
    for (const [bx, bz, br] of [[-6, 29, 0.3], [6.5, 28.5, -0.35], [24, 9, 1.4], [25, -9, 1.8], [-27, 6, 1.6]]) {
      P.addCentered('survival/fence-fortified', bx, 0, bz, br, SV * 1.5);
      this.colliders.addBox(bx, bz, 0.25 * SV * 1.5 * 2, 0.25, br, 1.6);
    }
    // Holzzäune und Heuballen
    for (let i = 0; i < 5; i++) {
      const a = (300 + i * 7) * Math.PI / 180;
      P.addCentered('town/fence', Math.sin(a) * 30, 0, Math.cos(a) * 30, a + Math.PI / 2, T, { cast: true });
    }
    for (const [hx, hz] of [[14, 15], [15.5, 13.5], [-16, -12], [12, -16]]) {
      P.add('graveyard/hay-bale', hx, 0, hz, r() * 3, G * 1.4);
      this.colliders.addCircle(hx, hz, 0.8, 1.2);
    }
    // Kürbisse rund um den Platz
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, rr = 11 + r() * 4;
      this._pumpkin(Math.sin(a) * rr, Math.cos(a) * rr, r() < 0.7, i < 1);
    }
    // ein paar knorrige Bäume im Dorf
    for (const [tx, tz] of [[-18, -20], [19, 20], [-24, 15], [8, -27]]) {
      P.add('town/tree-high-crooked', tx, 0, tz, r() * 6, 3.2);
      this.colliders.addCircle(tx, tz, 0.6, 6);
    }
    // Windmühle im Norden
    this._windmill(-4, -38);
  }

  _windmill(x, z) {
    const P = this.placer;
    const rot = 0.25;
    const H = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
    const piece = (key, lx, ly, lz, prot) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(lx, ly, lz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prot), new THREE.Vector3(T, T, T));
      P.addMatrix(key, new THREE.Matrix4().multiplyMatrices(H, m));
    };
    for (let s = 0; s < 3; s++) {
      for (const [lx, lz] of [[-T / 2, -T / 2], [T / 2, -T / 2], [-T / 2, T / 2], [T / 2, T / 2]]) {
        const y = s * T;
        if (lx > 0) piece(s === 0 && lz > 0 ? 'town/wall-door' : (s === 2 ? 'town/wall-window-small' : 'town/wall'), lx, y, lz, 0); else piece('town/wall', lx, y, lz, Math.PI);
        if (lz < 0) piece('town/wall', lx, y, lz, Math.PI / 2); else piece(s === 1 ? 'town/wall-window-small' : 'town/wall', lx, y, lz, -Math.PI / 2);
      }
    }
    for (const lz of [-T / 2, T / 2]) { piece('town/roof-high', -T / 2, 3 * T, lz, 0); piece('town/roof-high', T / 2, 3 * T, lz, Math.PI); }
    this.colliders.addBox(x, z, T, T, rot, 12);
    // Flügel (drehen sich)
    const sails = this.assets.get('town/windmill').scene.clone(true);
    sails.scale.setScalar(T * 1.25);
    const hub = new THREE.Vector3(T + 0.6, 2.4 * T, 0).applyMatrix4(H);
    sails.position.copy(hub);
    sails.rotation.y = rot;
    sails.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(sails);
    this.animated.push((dt) => { sails.rotation.x += dt * 0.25; });
  }

  // ---------------- Friedhof ----------------
  _buildGraveyard() {
    const P = this.placer;
    const r = this.rng;
    const { x: gx, z: gz, hw, hd } = this.gy;
    // Zaun
    const nx = Math.round(hw * 2 / G), nz = Math.round(hd * 2 / G);
    const fence = (i) => (r() < 0.15 ? 'graveyard/iron-fence-damaged' : 'graveyard/iron-fence-border');
    for (let i = 0; i < nx; i++) {
      const x = gx - hw + G / 2 + i * G;
      P.addCentered(fence(i), x, 0, gz - hd, 0, G);
      P.addCentered(fence(i), x, 0, gz + hd, Math.PI, G);
    }
    const gateJ = [Math.floor(nz / 2) - 1, Math.floor(nz / 2)];
    for (let j = 0; j < nz; j++) {
      const z = gz - hd + G / 2 + j * G;
      P.addCentered(fence(j), gx + hw, 0, z, Math.PI / 2, G);
      if (!gateJ.includes(j)) P.addCentered(fence(j), gx - hw, 0, z, -Math.PI / 2, G);
    }
    for (const [px, pz] of [[gx - hw, gz - hd], [gx + hw, gz - hd], [gx - hw, gz + hd], [gx + hw, gz + hd], [gx - hw, gz - G], [gx - hw, gz + G]]) {
      P.add('graveyard/border-pillar', px, 0, pz, 0, G * 1.15);
    }
    // offenes Tor
    for (const side of [-1, 1]) {
      const hx = gx - hw, hz = gz + side * G;
      const dx = -0.75, dz = side * 0.66;
      const l = Math.hypot(dx, dz);
      P.add('graveyard/iron-fence-border-gate', hx + dx / l * G / 2, 0, hz + dz / l * G / 2, Math.atan2(-dz / l, dx / l) + (side > 0 ? 0 : 0), G);
    }
    const C = this.colliders;
    C.addBox(gx, gz - hd, hw, 0.2, 0, 2);
    C.addBox(gx, gz + hd, hw, 0.2, 0, 2);
    C.addBox(gx + hw, gz, 0.2, hd, 0, 2);
    C.addBox(gx - hw, gz - (hd + G) / 2, 0.2, (hd - G) / 2, 0, 2);
    C.addBox(gx - hw, gz + (hd + G) / 2, 0.2, (hd - G) / 2, 0, 2);

    // Mittelweg
    for (let x = gx - hw + 0.84; x < gx + hw - 7; x += 1.68) {
      for (const dz of [-0.84, 0.84]) P.add('graveyard/road', x, 0, gz + dz, 0, G, { cast: false });
    }
    // Gräber
    const stones = ['gravestone-bevel', 'gravestone-cross', 'gravestone-cross-large', 'gravestone-decorative', 'gravestone-roof', 'gravestone-round', 'gravestone-wide', 'cross', 'cross-wood'];
    const rows = [4.8, 8.8, 12.5];
    for (let k = 0; k < 8; k++) {
      const x = gx - hw + 4.2 + k * 3.1;
      for (const side of [-1, 1]) {
        for (const rz of rows) {
          const z = gz + side * rz;
          const u = r();
          if (u < 0.1) continue;
          const headZ = z + side * 1.45;
          const rotS = (side < 0 ? 0 : Math.PI) + (r() - 0.5) * 0.3;
          if (u < 0.2) {
            P.add('graveyard/gravestone-broken', x, 0, headZ, rotS, G);
            P.add('graveyard/gravestone-debris', x + 0.3, 0, headZ - side * 0.4, r() * 6, G, { cast: false });
          } else {
            const s = stones[(r() * stones.length) | 0];
            P.addCentered(`graveyard/${s}`, x, 0, headZ, rotS, G * (0.9 + r() * 0.2), { rz: (r() - 0.5) * 0.15 });
          }
          C.addCircle(x, headZ, 0.5, 1.6);
          if (u > 0.9) {
            // offenes Grab
            P.add('graveyard/grave-border', x, 0, z, 0, G, { cast: false });
            P.add('graveyard/shovel-dirt', x + 1.3, 0, z, r() * 6, G);
            P.add('graveyard/coffin-old', x - 1.3, 0, z - side * 0.3, 0.2, G);
          } else {
            P.add(r() < 0.5 ? 'graveyard/grave' : 'graveyard/grave-border', x, 0, z, (r() - 0.5) * 0.1, G, { cast: false });
          }
          const d = r();
          if (d < 0.18) this._pumpkin(x + 0.6, headZ - side * 0.7, r() < 0.6);
          else if (d < 0.32) P.add(r() < 0.5 ? 'graveyard/candle-multiple' : 'graveyard/candle', x - 0.5, 0, headZ - side * 0.6, r() * 6, G);
          else if (d < 0.38) P.add(r() < 0.5 ? 'graveyard/urn-round' : 'graveyard/urn-square', x + 0.5, 0, headZ - side * 0.5, r() * 6, G);
        }
      }
    }
    // Grosse Gruft
    const cs = G * 1.35;
    const cxp = gx + hw - 4.4;
    P.add('graveyard/crypt-large', cxp, 0, gz, -Math.PI / 2, cs);
    P.add('graveyard/crypt-large-roof', cxp, 1.0 * cs, gz, -Math.PI / 2, cs);
    P.add('graveyard/crypt-large-door', cxp - 1.2 * cs, 0, gz, -Math.PI / 2, cs);
    C.addBox(cxp, gz, 1.2 * cs, 0.95 * cs, 0, 5);
    for (const s of [-1, 1]) {
      P.add('graveyard/candle-multiple', cxp - 1.2 * cs - 0.8, 0, gz + s * 1.2, 0, G);
      P.add('graveyard/urn-round', cxp - 1.2 * cs - 0.5, 0, gz + s * 1.9, 0, G);
      // kleine Grüfte
      const sx = gx + hw - 3.2, sz = gz + s * (hd - 3.6);
      P.add('graveyard/crypt-small', sx, 0, sz, -Math.PI / 2, G * 1.2);
      P.add('graveyard/crypt-small-roof', sx, 1.0 * G * 1.2, sz, -Math.PI / 2, G * 1.2);
      C.addBox(sx, sz, 0.75 * G * 1.2, 0.75 * G * 1.2, 0, 4);
    }
    this._lamp(cxp - 1.2 * cs - 0.8, 0.5, gz - 1.2, false);
    this._lamp(cxp - 1.2 * cs - 0.8, 0.5, gz + 1.2, false);
    // Feuerkörbe
    for (const s of [-1, 1]) {
      const fx = cxp - 5.2, fz = gz + s * 2.6;
      P.add('graveyard/fire-basket', fx, 0, fz, 0, G * 1.3);
      C.addCircle(fx, fz, 0.35, 1);
      this.fires.push(new Fire(this.scene, new THREE.Vector3(fx, 0.25, fz), { size: 0.55, light: s < 0, lightIntensity: 14, lightDistance: 16 }));
    }
    // Laternenpfähle entlang des Weges
    for (const [lx, lz, light] of [[gx - hw + 2.4, gz - 2.6, true], [gx - hw + 2.4, gz + 2.6, false], [gx - 1, gz + 2.6, true], [gx + 6, gz - 2.6, false]]) {
      P.add('graveyard/lightpost-single', lx, 0, lz, Math.PI / 2, G * 1.15);
      C.addCircle(lx, lz, 0.25, 3);
      this._lamp(lx, 2.75, lz, light, 0x9fd8ff, 7, 14);
    }
    // Deko
    P.add('graveyard/pillar-obelisk', gx + 2, 0, gz - 3.4, 0, G * 1.3); C.addCircle(gx + 2, gz - 3.4, 0.45, 3);
    P.add('graveyard/cross-column', gx - 6, 0, gz + 3.4, 0, G * 1.2); C.addCircle(gx - 6, gz + 3.4, 0.45, 3);
    P.add('graveyard/bench-damaged', gx - 9, 0, gz - 3.2, 0, G * 1.2); C.addBox(gx - 9, gz - 3.2, 1, 0.4, 0, 1);
    P.add('graveyard/altar-stone', cxp - 3.4, 0, gz, Math.PI / 2, G * 1.2); C.addBox(cxp - 3.4, gz, 0.45, 0.7, 0, 1.2);
    for (const [tx, tz, k] of [[gx - hw + 1.6, gz - hd + 1.6, 'pine-crooked'], [gx - hw + 1.6, gz + hd - 1.6, 'pine-fall-crooked'], [gx + 4, gz + hd - 1.4, 'pine-crooked'], [gx - 3, gz - hd + 1.4, 'pine-fall-crooked']]) {
      P.add(`graveyard/${k}`, tx, 0, tz, r() * 6, 3.4);
      C.addCircle(tx, tz, 0.6, 6);
    }
    // Steinmauer-Ruine ausserhalb
    for (let i = 0; i < 6; i++) P.add(i % 3 === 2 ? 'graveyard/stone-wall-damaged' : 'graveyard/stone-wall', gx - hw - 6 + i * G, 0, gz - hd - 6, 0, G);
    C.addBox(gx - hw - 6 + 2.5 * G, gz - hd - 6.1, 3 * G, 0.3, 0, 1.5);
  }

  // ---------------- Startlager im Wald ----------------
  _buildStartCamp() {
    const P = this.placer;
    const s = CONFIG.world.start;
    P.add('survival/tent-canvas', s.x - 5, 0, s.z + 4, 2.4, SV * 1.6);
    this.colliders.addCircle(s.x - 5, s.z + 4, 1.4, 2);
    P.add('survival/campfire-pit', s.x - 2.5, 0, s.z + 1.5, 0, SV * 1.4);
    this.fires.push(new Fire(this.scene, new THREE.Vector3(s.x - 2.5, 0.05, s.z + 1.5), { size: 0.35, lightIntensity: 5, lightDistance: 8 }));
    P.add('survival/tree-log', s.x - 4.2, 0.15, s.z + 0.5, 1.2, SV * 1.2);
    // Wegweiser zum Dorf
    P.add('survival/signpost', s.x + 3, 0, s.z - 10, 0.3, SV * 1.4);
    this.colliders.addCircle(s.x + 3, s.z - 10, 0.25, 2);
    const sign = this._textSprite('DORF ↑', '#e8d6b0');
    sign.position.set(s.x + 3, 2.2, s.z - 10);
    this.root.add(sign);
    const sign2 = this._textSprite('FRIEDHOF →', '#e8d6b0');
    sign2.position.set(19, 2.2, 6);
    P.add('survival/signpost-single', 19, 0, 6, -0.3, SV * 1.4);
    this.root.add(sign2);
  }

  _textSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(40,24,12,0.85)';
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#1a0f06'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58);
    g.font = 'bold 34px Georgia, serif';
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0x8a8fa0 }));
    s.scale.set(2.2, 0.55, 1);
    return s;
  }

  // ---------------- Wald ----------------
  _isClear(x, z, margin = 0) {
    const v = CONFIG.world.village;
    if (Math.hypot(x - v.x, z - v.z) < 35 + margin) return false;
    if (Math.hypot(x + 4, z + 38) < 9 + margin) return false; // Windmühle
    const g = this.gy;
    if (Math.abs(x - g.x) < g.hw + 4 + margin && Math.abs(z - g.z) < g.hd + 4 + margin) return false;
    if (Math.abs(x - (g.x - g.hw - 1)) < 12 && Math.abs(z - (g.z - g.hd - 6)) < 4) return false; // Mauerruine
    const s = CONFIG.world.start;
    if (Math.hypot(x - s.x, z - s.z) < 9 + margin) return false;
    if (this.distToPath(x, z) < 4.5 + margin) return false;
    return true;
  }

  _buildForest() {
    const P = this.placer;
    const r = makeRng(42);
    const trees = [
      ['graveyard/pine', 3.3, 4.8, 3], ['graveyard/pine-crooked', 3.3, 4.8, 2.2], ['graveyard/pine-fall', 3.2, 4.4, 1],
      ['graveyard/pine-fall-crooked', 3.2, 4.4, 0.9], ['town/tree-high', 2.6, 3.8, 1.6], ['town/tree-high-crooked', 2.6, 3.8, 1.6],
      ['survival/tree-tall', 4.4, 6.4, 1.4], ['survival/tree-autumn-tall', 4.4, 6.4, 0.8], ['graveyard/trunk-long', 2.6, 4.2, 0.5],
    ];
    const wsum = trees.reduce((a, t) => a + t[3], 0);
    const pick = () => { let u = r() * wsum; for (const t of trees) { u -= t[3]; if (u <= 0) return t; } return trees[0]; };
    const hash = new Map();
    const cell = 3.4;
    const near = (x, z) => {
      const i = Math.floor(x / cell), j = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = hash.get((i + a) * 9973 + (j + b));
        if (l) for (const [px, pz] of l) if ((px - x) ** 2 + (pz - z) ** 2 < cell * cell) return true;
      }
      return false;
    };
    const R = 195;
    let placed = 0;
    for (let n = 0; n < 26000 && placed < 1900; n++) {
      const x = (r() * 2 - 1) * R, z = (r() * 2 - 1) * R;
      const d = Math.hypot(x, z);
      if (d > R) continue;
      // Dichte: in Spielfeld-Nähe lockerer, am Rand dicht
      const dens = d > 150 ? 1 : 0.55;
      if (r() > dens) continue;
      if (!this._isClear(x, z)) continue;
      if (near(x, z)) continue;
      const k = Math.floor(x / cell) * 9973 + Math.floor(z / cell);
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push([x, z]);
      const [key, s0, s1] = pick();
      const s = s0 + r() * (s1 - s0);
      P.add(key, x, 0, z, r() * Math.PI * 2, s, { rz: (r() - 0.5) * 0.08 });
      if (d < 175) this.colliders.addCircle(x, z, 0.55, 8);
      placed++;
    }
    // Unterholz: Gras, Steine, Stümpfe, Stämme
    for (let n = 0; n < 1400; n++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 120;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x, z) < 12) continue;
      P.add(r() < 0.6 ? 'survival/grass-large' : 'survival/grass', x, 0, z, r() * 6, 3 + r() * 2.5, { cast: false });
    }
    for (let n = 0; n < 260; n++) {
      const x = (r() * 2 - 1) * 160, z = (r() * 2 - 1) * 160;
      if (!this._isClear(x, z, 1) || Math.hypot(x, z) > 160) continue;
      const u = r();
      if (u < 0.35) { P.add(r() < 0.5 ? 'graveyard/rocks' : 'graveyard/rocks-tall', x, 0, z, r() * 6, G * (1 + r())); this.colliders.addCircle(x, z, 0.9, 1); }
      else if (u < 0.55) { P.add('survival/tree-trunk', x, 0, z, r() * 6, SV * 1.6); this.colliders.addCircle(x, z, 0.4, 0.8); }
      else if (u < 0.75) { P.add('survival/tree-log', x, 0.15, z, r() * 6, SV * 1.4); }
      else if (u < 0.88) { P.add(['survival/rock-a', 'survival/rock-b', 'survival/rock-c'][(r() * 3) | 0], x, 0, z, r() * 6, SV * 1.6); this.colliders.addCircle(x, z, 0.7, 1); }
      else { P.add('town/rock-large', x, 0, z, r() * 6, 1.6 + r()); this.colliders.addCircle(x, z, 1.3, 2); }
    }
    // Pilz-ähnliche Kürbisse am Weg
    for (let i = 10; i < this.pathSamples.length - 30; i += 22) {
      const p = this.pathSamples[i];
      this._pumpkin(p.x + (i % 2 ? 2.8 : -2.8), p.z, r() < 0.5);
    }
  }

  _wispPoints() {
    const r = makeRng(9);
    const out = [];
    while (out.length < 10) {
      const x = (r() * 2 - 1) * 110, z = (r() * 2 - 1) * 140;
      if (this._isClear(x, z) && Math.hypot(x, z) < 140) out.push({ x, z });
    }
    return out;
  }

  // ---------------- Geist auf dem Friedhof ----------------
  _buildGhost() {
    const g = this.assets.get('graveyard/character-ghost');
    if (!g) return;
    const ghost = g.scene.clone(true);
    ghost.scale.setScalar(G * 1.3);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.9, 1.2), transparent: true, opacity: 0.45, depthWrite: false, fog: true });
    ghost.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
    this.scene.add(ghost);
    const mixer = new THREE.AnimationMixer(ghost);
    const clip = g.animations.find((a) => a.name === 'idle') || g.animations[0];
    if (clip) mixer.clipAction(clip).play();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(180,220,255,0.8)', 'rgba(100,150,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    glow.scale.setScalar(3.5);
    glow.position.y = 0.6;
    ghost.add(glow);
    this.ghost = { obj: ghost, mixer, mat, glow, t: 0 };
  }

  // ---------------- Pro Frame ----------------
  update(dt, t, camPos, playerPos, flash) {
    for (const f of this.fires) f.update(dt, t);
    for (const fl of this.flickerLights) {
      const k = 0.85 + 0.15 * Math.sin(t * 9 + fl.ph) * Math.sin(t * 3.7 + fl.ph * 2);
      if (fl.light) fl.light.intensity = fl.base * k;
      if (fl.mesh) fl.mesh.material.color.copy(fl.base).multiplyScalar(k);
    }
    for (const g of this.glowSprites) g.s.scale.setScalar(g.base * (0.9 + 0.1 * Math.sin(t * 8 + g.ph)));
    for (const a of this.animated) a(dt, t);
    this.wisps && this.wisps.update(t);
    // Himmel folgt der Kamera
    this.sky.position.copy(camPos);
    this.stars.position.copy(camPos);
    this.sky.material.uniforms.flash.value = flash;
    this.sky.material.uniforms.time.value = t;
    this.hemi.intensity = 0.75 + flash * 3.5;
    // Schattenkamera folgt dem Spieler (auf Texel gerastert)
    const snap = 90 / 2048;
    const px = Math.round(playerPos.x / snap) * snap, pz = Math.round(playerPos.z / snap) * snap;
    this.moonLight.target.position.set(px, 0, pz);
    this.moonLight.position.set(px + this.moonDir.x * 120, this.moonDir.y * 120, pz + this.moonDir.z * 120);
    this.moonLight.intensity = 1.35 + flash * 4;
    // Kacheln weit weg ausblenden
    for (const c of this.placer.chunks) {
      const d = Math.hypot(c.userData.cx - camPos.x, c.userData.cz - camPos.z);
      c.visible = d < 165;
    }
    // Geist
    if (this.ghost) {
      const gh = this.ghost;
      gh.t += dt;
      const { x: gx, z: gz } = this.gy;
      const a = gh.t * 0.12;
      const p = new THREE.Vector3(gx - 2 + Math.cos(a) * 10, 0.6 + Math.sin(gh.t * 1.7) * 0.25, gz + Math.sin(a * 2) * 7);
      const dir = p.clone().sub(gh.obj.position);
      gh.obj.position.copy(p);
      if (dir.lengthSq() > 1e-6) gh.obj.rotation.y = Math.atan2(dir.x, dir.z);
      const dp = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
      const vis = THREE.MathUtils.clamp((dp - 6) / 10, 0, 1);
      gh.mat.opacity = 0.45 * vis * (0.75 + 0.25 * Math.sin(t * 3));
      gh.glow.material.opacity = 0.5 * vis;
      gh.mixer.update(dt);
    }
  }

  // Niedrige Qualität: nur die wichtigsten Punktlichter
  setLowLights(low) {
    for (const f of this.flickerLights) if (f.light) f.light.visible = !low;
    this.fires.forEach((f, i) => { if (f.light && i >= 2) f.light.visible = !low; });
  }

  inVillage(p) { return Math.hypot(p.x - this.villageCenter.x, p.z - this.villageCenter.z) < CONFIG.world.village.r; }
  inBounds(x, z, margin = 0) { return Math.hypot(x, z) < CONFIG.world.radius - margin; }
}

function segDist2(x, z, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
  const px = a.x + vx * t - x, pz = a.z + vz * t - z;
  return px * px + pz * pz;
}
