import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.5 1.2 4.4 2.6.9-1.4 2.3-2.6 4.4-2.6 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.screens = ['loading', 'menu', 'scores', 'pause', 'gameover'];
    this.hearts = $('hearts');
    this.hearts.innerHTML = Array.from({ length: CONFIG.player.maxHits }, () => `<i class="heart">${HEART}</i>`).join('');
    this.toastT = 0;
    this.hitT = 0;
    this.dmgT = 0;
    this.introT = 0;
    this._last = {};
    // Buttons
    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', (e) => { e.preventDefault(); game.audio.init(); game.audio.uiClick(); game.onAction(b.dataset.action); });
      b.addEventListener('mouseenter', () => game.audio.uiHover());
    });
    $('name-form').addEventListener('submit', (e) => { e.preventDefault(); game.submitScore($('name').value); });
    try { $('name').value = localStorage.getItem('ycna.name') || ''; } catch (e) { /* */ }
    $('volume').addEventListener('input', (e) => game.audio.setVolume(+e.target.value));
    $('quality').addEventListener('change', (e) => game.setQuality(e.target.value));
    $('sens').addEventListener('input', (e) => { game.input.sensitivity = 0.0008 + +e.target.value * 0.004; });
  }

  show(name) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', !(name === null || name === 'pause' || name === 'gameover'));
    document.body.dataset.screen = name || 'game';
  }

  setLoading(p) {
    $('load-bar').style.width = `${Math.round(p * 100)}%`;
    $('load-text').textContent = p < 1 ? `Lade die Nacht … ${Math.round(p * 100)} %` : 'Baue Welt …';
  }

  hud(g) {
    const p = g.player;
    const set = (id, v) => { if (this._last[id] !== v) { this._last[id] = v; $(id).textContent = v; } };
    set('kills', String(g.kills));
    set('ammo-mag', String(p.ammo));
    set('ammo-res', p.reserve === Infinity ? '∞' : String(p.reserve));
    set('weapon-name', p.def.name);
    set('gren', String(p.grenades));
    if (this._last.gn !== p.grenades) {
      if (p.grenades > (this._last.gn || 0)) { const e = $('grenades'); e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }
      this._last.gn = p.grenades;
    }
    $('grenades').classList.toggle('empty', p.grenades === 0);
    const owned = ['pistol', 'rifle', 'launcher'].filter((k) => p.arsenal[k]).map((k, i) => `${k}:${k === p.weapon}`).join();
    if (this._last.owned !== owned) {
      this._last.owned = owned;
      const labels = { pistol: '1 Pistole', rifle: '2 Gewehr', launcher: '3 Rakete' };
      $('weapons-owned').innerHTML = ['pistol', 'rifle', 'launcher'].filter((k) => p.arsenal[k]).map((k) => `<span class="${k === p.weapon ? 'on' : ''}">${labels[k]}</span>`).join('');
    }
    const clockMin = Math.floor(g.playTime);
    set('clock', `${String(Math.floor(clockMin / 60) % 24).padStart(2, '0')}:${String(clockMin % 60).padStart(2, '0')}`);
    const lost = p.hits;
    if (this._last.hits !== lost) {
      this._last.hits = lost;
      [...this.hearts.children].forEach((h, i) => h.classList.toggle('lost', i >= CONFIG.player.maxHits - lost));
    }
    $('reload-hint').classList.toggle('show', p.reloading);
    $('ammo').classList.toggle('low', p.ammo <= 3);
    $('stamina').firstElementChild.style.width = `${p.stamina * 100}%`;
    $('stamina').classList.toggle('show', p.stamina < 0.99);
    $('crosshair').classList.toggle('moving', p.moving);
    $('autobadge').classList.toggle('hidden', !g.auto);
    let obj = '';
    if (!g.villageReached) obj = 'Folge dem Weg ins Dorf …';
    else if (g.kills === 0 && g.zombies.list.length < 2) obj = 'Sie kommen. Dreh dich nicht um …';
    set('objective', obj);
    set('interval', g.villageReached ? `Nächster Zombie: alle ${(g.zombies.interval / 1000).toFixed(1)} s` : '');
  }

  update(dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').className = ''; }
    if (this.dmgT > 0) { this.dmgT -= dt; $('damage-dir').style.opacity = Math.max(0, this.dmgT); }
    if (this.introT > 0) { this.introT -= dt; if (this.introT <= 0) $('intro').classList.remove('show'); }
  }

  toast(msg, t = 3.5) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); this.toastT = t; }
  intro(html, t = 6) { const el = $('intro'); el.innerHTML = html; el.classList.add('show'); this.introT = t; }
  hitMarker(head) { const el = $('hitmarker'); el.className = ''; void el.offsetWidth; el.className = head ? 'show head' : 'show'; this.hitT = 0.25; }

  kill(head) {
    const el = document.createElement('div');
    el.className = 'kf';
    el.textContent = head ? '+1  KOPFSCHUSS' : '+1';
    $('killfeed').appendChild(el);
    setTimeout(() => el.remove(), 1400);
    const k = $('killcount');
    k.classList.remove('pop'); void k.offsetWidth; k.classList.add('pop');
  }

  hurt(from, player) {
    const dx = from.x - player.pos.x, dz = from.z - player.pos.z;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const el = $('damage-dir');
    el.style.transform = `translate(-50%,-50%) rotate(${a}rad)`;
    el.style.opacity = 1;
    this.dmgT = 1.2;
    const h = this.hearts.children[CONFIG.player.maxHits - player.hits];
    if (h) { h.classList.add('break'); setTimeout(() => h.classList.remove('break'), 600); }
    document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake');
  }

  async renderScores(scoreboard, highlight) {
    $('scores-mode').textContent = scoreboard.modeLabel;
    const body = $('scores-body');
    body.innerHTML = '<tr><td colspan="4" class="muted">Lade …</td></tr>';
    const { rows, error } = await scoreboard.top();
    $('scores-error').textContent = error || '';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="4" class="muted">Noch keine Einträge. Überlebe die Nacht!</td></tr>'; return; }
    body.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (highlight && highlight === i + 1) tr.className = 'me';
      const cells = [`${i + 1}.`, r.name, String(r.kills), fmtTime(r.time)];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      body.appendChild(tr);
    });
  }

  gameOver(g, canSubmit) {
    $('go-kills').textContent = g.kills;
    $('go-time').textContent = fmtTime(g.playTime);
    const m = Math.floor(g.playTime);
    $('go-clock').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} Uhr`;
    $('name-form').classList.toggle('hidden', !canSubmit);
    $('submit-msg').textContent = g.auto ? 'Auto Spiel – Bot-Runden werden nicht ins Scoreboard eingetragen.' : (canSubmit ? 'Trag dich in die Bestenliste ein:' : 'Leider nicht unter den Top 20.');
    this.show('gameover');
    if (canSubmit) setTimeout(() => $('name').focus(), 50);
  }
  submitted(msg) { $('name-form').classList.add('hidden'); $('submit-msg').textContent = msg; }
}
