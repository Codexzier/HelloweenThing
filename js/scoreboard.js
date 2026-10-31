import { SCOREBOARD } from './config.js';

// ------------------------------------------------------------------
//  Bestenliste: lokal (localStorage) oder global (Supabase)
// ------------------------------------------------------------------
const LS_KEY = 'ycna.scores.v1';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; }
}
function saveLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* privater Modus */ }
}
function sortScores(a, b) { return b.kills - a.kills || b.time - a.time; }

export function sanitizeName(n) {
  return (n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Namenlos';
}

export class Scoreboard {
  constructor() {
    this.cfg = SCOREBOARD;
    this.remote = this.cfg.provider === 'supabase' && this.cfg.supabaseUrl && this.cfg.supabaseAnonKey;
  }
  get modeLabel() { return this.remote ? 'Globale Bestenliste (Online)' : 'Lokale Bestenliste (nur dieser Browser)'; }

  _headers() {
    return { apikey: this.cfg.supabaseAnonKey, Authorization: `Bearer ${this.cfg.supabaseAnonKey}`, 'Content-Type': 'application/json' };
  }

  async top() {
    const n = this.cfg.maxEntries;
    if (this.remote) {
      try {
        const url = `${this.cfg.supabaseUrl}/rest/v1/${this.cfg.table}?select=name,kills,time,created_at&order=kills.desc,time.desc&limit=${n}`;
        const r = await fetch(url, { headers: this._headers() });
        if (!r.ok) throw new Error(r.status);
        const rows = await r.json();
        return { ok: true, rows: rows.map((x) => ({ name: x.name, kills: x.kills, time: x.time, date: x.created_at })) };
      } catch (e) {
        return { ok: false, rows: loadLocal().sort(sortScores).slice(0, n), error: 'Online-Bestenliste nicht erreichbar – zeige lokale Einträge.' };
      }
    }
    return { ok: true, rows: loadLocal().sort(sortScores).slice(0, n) };
  }

  // Gibt den Rang zurück (1-basiert) oder null, wenn nicht in den Top 20
  async submit(name, kills, time) {
    const entry = { name: sanitizeName(name), kills: kills | 0, time: Math.round(time), date: new Date().toISOString() };
    const list = loadLocal();
    list.push(entry);
    list.sort(sortScores);
    saveLocal(list.slice(0, 100));
    if (this.remote) {
      try {
        const r = await fetch(`${this.cfg.supabaseUrl}/rest/v1/${this.cfg.table}`, {
          method: 'POST',
          headers: { ...this._headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({ name: entry.name, kills: entry.kills, time: entry.time }),
        });
        if (!r.ok) throw new Error(r.status);
      } catch (e) {
        return { rank: null, error: 'Konnte nicht online speichern – lokal gespeichert.' };
      }
    }
    const { rows } = await this.top();
    const idx = rows.findIndex((r) => r.name === entry.name && r.kills === entry.kills && r.time === entry.time);
    return { rank: idx >= 0 ? idx + 1 : null };
  }

  async qualifies(kills, time) {
    const { rows } = await this.top();
    if (rows.length < this.cfg.maxEntries) return kills > 0;
    const last = rows[rows.length - 1];
    return kills > last.kills || (kills === last.kills && time > last.time);
  }
}
