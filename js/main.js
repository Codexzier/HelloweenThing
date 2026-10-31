import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Assets } from './assets.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Zombies } from './zombies.js';
import { Autopilot } from './autopilot.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { UI } from './ui.js';
import { Scoreboard } from './scoreboard.js';
import { Projectiles, Pickups } from './weapons.js';
import { Particles, Tracers, Decals, GroundFog, Bats, Lightning, createPostFX } from './effects.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1200);
    this.audio = new AudioFX();
    this.input = new Input(this.canvas);
    this.scoreboard = new Scoreboard();
    this.assets = new Assets();
    this.ui = new UI(this);
    this.state = 'loading';
    this.time = 0;       // Spielzeit (läuft nur während des Spiels)
    this.t = 0;          // globale Zeit (Atmosphäre)
    this.kills = 0;
    this.playTime = 0;
    this.auto = false;
    this.villageReached = false;
    this.fx = { hurt: 0 };
    this.clock = new THREE.Clock();
    this.amb = { owl: 12, crow: 20, howl: 35, note: 2, heart: 0 };
  }

  async init() {
    this.ui.show('loading');
    await this.assets.loadAll((p) => this.ui.setLoading(p));
    this.ui.setLoading(1);
    await new Promise((r) => setTimeout(r, 30));
    this.world = new World(this.scene, this.assets);
    this.world.build();
    this.particles = new Particles(this.scene, 1600, false);
    this.sparks = new Particles(this.scene, 500, true);
    this.tracers = new Tracers(this.scene);
    this.decals = new Decals(this.scene);
    this.groundFog = new GroundFog(this.scene);
    this.bats = new Bats(this.scene);
    this.lightning = new Lightning((d) => this.audio.thunder(d));
    this.player = new Player(this);
    this.zombies = new Zombies(this);
    this.projectiles = new Projectiles(this);
    this.pickups = new Pickups(this);
    this.autopilot = new Autopilot(this);
    this.post = createPostFX(this.renderer, this.scene, this.camera);
    let q = null;
    try { q = localStorage.getItem('ycna.quality'); } catch (e) { /* */ }
    q = q || (this.input.isTouch ? 'low' : 'high');
    document.getElementById('quality').value = q;
    this.setQuality(q);
    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('pointerlockchange', () => {
      if (this.state === 'playing' && !this.auto && !this.input.locked && !this.input.isTouch && !this.player.dead) this.pause();
    });
    addEventListener('keydown', (e) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.state === 'playing' && (this.auto || !this.input.locked || e.code === 'KeyP') && !(e.target instanceof HTMLInputElement)) this.pause();
      else if (e.code === 'KeyP' && this.state === 'paused') this.resume();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    this.canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.auto && !this.input.locked) this.input.lock(); });
    this.player.root.visible = false;
    this.player.gun.visible = false;
    this.state = 'menu';
    this.ui.show('menu');
    // ein erstes Rendern, damit Shader kompiliert sind
    this.renderer.compile(this.scene, this.camera);
    this.loop();
    window.__game = this;
  }

  setQuality(q) {
    this.quality = q;
    try { localStorage.setItem('ycna.quality', q); } catch (e) { /* */ }
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 1));
    const shadows = q !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    if (this.world) {
      this.world.setLowLights(q === 'low');
      const sm = q === 'high' ? 2048 : 1024;
      const ms = this.world.moonLight.shadow;
      if (ms.mapSize.x !== sm) { ms.mapSize.set(sm, sm); if (ms.map) { ms.map.dispose(); ms.map = null; } }
    }
    if (this.player) this.player.torch.castShadow = false;
    if (this.post) this.post.setBloom(q !== 'low');
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    if (this.particles) {
      const s = h * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
      this.particles.material.uniforms.scale.value = s;
      this.sparks.material.uniforms.scale.value = s;
    }
  }

  // ---------------- Spielablauf ----------------
  onAction(a) {
    switch (a) {
      case 'new': this.startGame(false); break;
      case 'auto': this.startGame(true); break;
      case 'again': this.startGame(this.auto); break;
      case 'scores': this.ui.show('scores'); this.ui.renderScores(this.scoreboard); break;
      case 'back': this.ui.show('menu'); break;
      case 'resume': this.resume(); break;
      case 'pause': this.pause(); break;
      case 'menu': this.toMenu(); break;
      default: break;
    }
  }

  startGame(auto) {
    this.audio.init();
    this.auto = auto;
    this.kills = 0;
    this.playTime = 0;
    this.time = 0;
    this.villageReached = false;
    this.deathTimer = 0;
    this.player.reset();
    this.zombies.reset();
    this.projectiles.reset();
    this.pickups.reset();
    this.autopilot.reset();
    this.particles.clear();
    this.sparks.clear();
    this.decals.clear();
    this.fx.hurt = 0;
    this.state = 'playing';
    this.ui._last = {};
    this.ui.show(null);
    document.getElementById('touch').classList.toggle('hidden', !(this.input.isTouch && !auto));
    this.audio.setMusic(0.12);
    this.audio.bell(12, 1.0);
    this.ui.intro('<b>00:00</b><span>Mitternacht.</span><em>Folge dem Weg ins Dorf.</em>', 6.5);
    if (!auto) this.input.lock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.ui.show('pause');
    this.audio.setMusic(0.2);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.show(null);
    this.audio.setMusic(0.12);
    if (!this.auto) this.input.lock();
    this.clock.getDelta();
  }
  toMenu() {
    this.state = 'menu';
    this.input.unlock();
    this.zombies.reset();
    this.projectiles.reset();
    this.pickups.reset();
    this.player.root.visible = false;
    this.player.gun.visible = false;
    this.player.torch.intensity = 0;
    document.getElementById('touch').classList.add('hidden');
    this.audio.setMusic(0.35);
    this.ui.show('menu');
  }

  onKill(z, head) {
    this.kills++;
    this.ui.kill(head);
    if (this.kills % 10 === 0) this.ui.toast(`${this.kills} Zombies erledigt. Es werden mehr …`);
  }

  onPlayerDeath() {
    this.deathTimer = 2.8;
    this.audio.setMusic(0.4);
    this.ui.toast('Sie haben dich …', 2.5);
  }

  async gameOver() {
    this.state = 'gameover';
    this.input.unlock();
    document.getElementById('touch').classList.add('hidden');
    let can = false;
    if (!this.auto) can = await this.scoreboard.qualifies(this.kills, this.playTime);
    this.ui.gameOver(this, can);
  }

  async submitScore(name) {
    try { localStorage.setItem('ycna.name', name); } catch (e) { /* */ }
    const res = await this.scoreboard.submit(name, this.kills, this.playTime);
    this.ui.submitted(res.error || (res.rank ? `Gespeichert – Platz ${res.rank} von ${this.scoreboard.cfg.maxEntries}!` : 'Gespeichert!'));
  }

  // ---------------- Hauptschleife ----------------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const g = this;
    const player = this.player;

    if (this.state === 'playing' || this.state === 'gameover') {
      if (this.state === 'playing') this.time += dt;
      const ctrl = this.state === 'playing' ? (this.auto ? this.autopilot.control(dt) : this.input.read()) : { moveX: 0, moveY: 0, lookX: 0, lookY: 0 };
      if (this.state === 'playing' && this.auto) this.input.read();
      player.update(dt, ctrl);
      if (!this.villageReached && this.world.inVillage(player.pos)) {
        this.villageReached = true;
        this.zombies.activate();
        this.ui.toast('Das Dorf … viel zu still hier.');
        this.audio.howl();
      }
      this.zombies.update(dt);
      this.projectiles.update(dt);
      this.pickups.update(dt);
      if (!player.dead && this.state === 'playing') this.playTime += dt;
      player.updateCamera(this.camera, dt);
      if (player.dead && this.state === 'playing') {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.gameOver();
      }
      this.ui.hud(this);
    } else if (this.state === 'menu' || this.state === 'loading') {
      // Kamerafahrt um das Dorf
      const a = this.t * 0.04 + 0.6;
      this.camera.position.set(Math.sin(a) * 42, 11 + Math.sin(this.t * 0.1) * 2, Math.cos(a) * 42);
      this.camera.lookAt(6, 4, 0);
      this.amb.note -= dt;
      if (this.amb.note <= 0) { this.amb.note = 1.6 + Math.random() * 3; this.audio.menuNote(); }
    }

    if (window.__debugCam) { this.camera.position.fromArray(window.__debugCam[0]); this.camera.lookAt(...window.__debugCam[1]); }
    const focus = this.state === 'menu' ? new THREE.Vector3(0, 0, 0) : player.pos;
    this.lightning.update(dt);
    this.world.update(dt, this.t, this.camera.position, focus, this.lightning.flash);
    this.groundFog.update(this.t, this.camera.position);
    this.bats.update(this.t);
    this.particles.update(dt);
    this.sparks.update(dt);
    this.tracers.update(dt);
    this.decals.update(dt);
    this.ui.update(dt);

    // Atmosphäre
    const A = this.amb;
    A.owl -= dt; A.crow -= dt; A.howl -= dt;
    if (A.owl <= 0) { A.owl = 18 + Math.random() * 25; this.audio.owl(); }
    if (A.crow <= 0) { A.crow = 25 + Math.random() * 30; this.audio.crow(); }
    if (A.howl <= 0) { A.howl = 45 + Math.random() * 50; this.audio.howl(); }
    const low = this.state === 'playing' && !player.dead ? Math.max(0, (player.hits - (CONFIG.player.maxHits - 3)) / 2) : 0;
    if (low > 0) {
      A.heart -= dt;
      if (A.heart <= 0) { A.heart = low >= 1 ? 0.6 : 0.85; this.audio.heartbeat(low >= 1 ? 1.3 : 1); }
    }
    this.fx.hurt = Math.max(0, this.fx.hurt - dt * 1.6);
    const u = this.post.fx.uniforms;
    u.time.value = this.t;
    u.hurt.value = this.fx.hurt;
    u.lowHealth.value = THREE.MathUtils.lerp(u.lowHealth.value, player.dead ? 1 : low, Math.min(1, dt * 3));
    u.fade.value = this.state === 'gameover' ? Math.min(0.55, u.fade.value + dt * 0.3) : 0;

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.audio.setListener(this.camera.position, fwd);
    void g;
    this.post.composer.render(dt);
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'Fehler beim Laden: ' + e.message;
});
