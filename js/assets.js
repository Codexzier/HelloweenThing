import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

THREE.Cache.enabled = true;

// Alle verwendeten Modelle (Kenney Kits, CC0)
export const MODEL_LIST = {
  graveyard: [
    'pine', 'pine-crooked', 'pine-fall', 'pine-fall-crooked', 'trunk', 'trunk-long', 'rocks', 'rocks-tall',
    'iron-fence-border', 'iron-fence-border-gate', 'iron-fence-border-column', 'iron-fence-damaged', 'border-pillar',
    'gravestone-bevel', 'gravestone-broken', 'gravestone-cross', 'gravestone-cross-large', 'gravestone-decorative',
    'gravestone-roof', 'gravestone-round', 'gravestone-wide', 'gravestone-debris', 'grave', 'grave-border',
    'crypt-large', 'crypt-large-roof', 'crypt-large-door', 'crypt-small', 'crypt-small-roof', 'crypt',
    'lightpost-single', 'lightpost-double', 'lantern-candle', 'candle', 'candle-multiple',
    'pumpkin', 'pumpkin-carved', 'pumpkin-tall', 'pumpkin-tall-carved', 'coffin', 'coffin-old',
    'shovel-dirt', 'shovel', 'urn-round', 'urn-square', 'pillar-obelisk', 'cross-column', 'cross', 'cross-wood',
    'fire-basket', 'altar-stone', 'bench-damaged', 'hay-bale', 'debris', 'debris-wood', 'road',
    'fence', 'fence-damaged', 'stone-wall', 'stone-wall-damaged', 'stone-wall-column',
    'character-zombie', 'character-skeleton', 'character-vampire', 'character-ghost',
  ],
  town: [
    'wall', 'wall-door', 'wall-window-shutters', 'wall-window-small', 'wall-window-round', 'wall-broken',
    'wall-wood', 'wall-wood-door', 'wall-wood-window-shutters', 'wall-wood-window-small', 'wall-wood-broken',
    'roof', 'roof-high', 'chimney', 'fountain-round', 'fountain-center', 'stall', 'stall-red', 'stall-green',
    'stall-bench', 'cart', 'cart-high', 'lantern', 'tree-high', 'tree-high-crooked', 'tree-crooked',
    'rock-large', 'rock-wide', 'fence', 'fence-broken', 'hedge', 'windmill', 'wheel', 'banner-red', 'poles',
    'planks', 'overhang',
  ],
  survival: [
    'tree-tall', 'tree-autumn-tall', 'tree-trunk', 'tree-log', 'tree-log-small', 'grass', 'grass-large',
    'rock-a', 'rock-b', 'rock-c', 'barrel', 'barrel-open', 'box', 'box-large', 'box-large-open', 'chest',
    'campfire-pit', 'campfire-stand', 'tent-canvas', 'signpost', 'signpost-single', 'bucket', 'resource-wood',
    'fence-fortified', 'workbench', 'bedroll',
  ],
  weapons: ['pistol', 'machinegun', 'rocketlauncher', 'grenade', 'ammo_rocket'],
};

export class Assets {
  constructor() {
    this.models = new Map();      // key -> gltf
    this.kitMaterials = new Map();
    this.textures = {};
    this.character = null;        // FBX Basis-Modell
    this.clips = {};              // idle/run/jump
  }

  async loadAll(onProgress) {
    const gltf = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const jobs = [];
    let done = 0;
    let total = 0;
    const tick = () => { done++; onProgress && onProgress(done / total); };

    for (const [kit, names] of Object.entries(MODEL_LIST)) {
      for (const name of names) {
        total++;
        jobs.push(gltf.loadAsync(`assets/models/${kit}/${name}.glb`).then((g) => {
          this._prepare(kit, g);
          this.models.set(`${kit}/${name}`, g);
          tick();
        }).catch((e) => { console.warn('Modell fehlt', kit, name, e); tick(); }));
      }
    }

    // Animierter Charakter (FBX) + Skins
    const fbxManager = new THREE.LoadingManager();
    // Das FBX referenziert eine Textur, die nicht mitgeliefert wird – auf einen Skin umleiten
    fbxManager.setURLModifier((url) => (/\.(png|jpg|jpeg|tga)$/i.test(url) && !url.includes('/skins/')) ? 'assets/characters/skins/survivorMaleB.png' : url);
    const fbxLoader = new FBXLoader(fbxManager);
    total++;
    jobs.push(fbxLoader.loadAsync('assets/characters/characterMedium.fbx').then((m) => { this.character = m; tick(); }));
    for (const a of ['idle', 'run', 'jump']) {
      total++;
      jobs.push(fbxLoader.loadAsync(`assets/characters/animations/${a}.fbx`).then((m) => {
        const clip = m.animations.find((c) => !c.name.includes('Targeting')) || m.animations[0];
        this.clips[a] = clip;
        tick();
      }));
    }
    for (const s of ['survivorMaleB', 'survivorFemaleA', 'zombieA', 'zombieC']) {
      total++;
      jobs.push(texLoader.loadAsync(`assets/characters/skins/${s}.png`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        this.textures[s] = t;
        tick();
      }));
    }
    await Promise.all(jobs);
  }

  // Ersetzt die Materialien eines Kits durch ein gemeinsames Material (spart Draw-State)
  _prepare(kit, g) {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      if (kit === 'weapons') {
        o.material = new THREE.MeshLambertMaterial({ color: src.color ? src.color.clone() : 0x444444 });
        return;
      }
      let mat = this.kitMaterials.get(kit);
      if (!mat) {
        const map = src.map || null;
        if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
        mat = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
        this.kitMaterials.set(kit, mat);
      }
      o.material = mat;
    });
  }

  get(key) { return this.models.get(key); }
}
