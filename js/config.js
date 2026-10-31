// ------------------------------------------------------------
//  "You cannot survive" – zentrale Spiel-Konfiguration
// ------------------------------------------------------------

export const CONFIG = {
  spawn: {
    startIntervalMs: 5000,   // erstes Intervall: alle 5 Sekunden ein Zombie
    decrementMs: 100,        // jedes Intervall wird um 100 ms kürzer
    minIntervalMs: 800,      // Untergrenze, damit das Intervall nie 0 wird
    distance: 50,            // Zombies erscheinen 50 m vom Spieler entfernt
    viewMargin: 0.12,        // zusätzlicher Rand (NDC) – Spawn nur ausserhalb des Sichtfelds
    maxAlive: 70,
  },
  player: {
    maxHits: 5,              // nach 5 Treffern ist das Spiel vorbei
    walkSpeed: 4.4,
    sprintSpeed: 6.8,
    invulnMs: 1100,
    magazine: 12,
    reloadMs: 1400,
    fireCooldownMs: 210,
    range: 90,
  },
  world: {
    radius: 158,             // begehbarer Radius
    village: { x: 0, z: 0, r: 30 },
    graveyard: { x: 54, z: -6 },
    start: { x: 0, z: 140 },
  },
};

// ------------------------------------------------------------
//  Scoreboard
//  provider: 'local'    -> nur im Browser (localStorage)
//            'supabase' -> globale Bestenliste über Supabase (siehe README.md)
// ------------------------------------------------------------
export const SCOREBOARD = {
  provider: 'local',
  supabaseUrl: '',        // z. B. 'https://xyzcompany.supabase.co'
  supabaseAnonKey: '',    // öffentlicher "anon" Key
  table: 'scores',
  maxEntries: 20,
};

// ------------------------------------------------------------
//  Optionale eigene Sounddateien (z. B. von kenney.nl).
//  Ist ein Eintrag gesetzt, wird die Datei statt des
//  synthetisierten Sounds verwendet. Beispiel:
//    shot: 'assets/audio/shot.ogg'
// ------------------------------------------------------------
export const CUSTOM_SOUNDS = {
  // shot: 'assets/audio/shot.ogg',
  // reload: 'assets/audio/reload.ogg',
  // click: 'assets/audio/click.ogg',
};
