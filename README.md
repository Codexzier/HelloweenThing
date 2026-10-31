# You can't not alive.

Ein kleines Halloween-Zombie-Survival-Spiel für den Browser (three.js, ohne Build-Schritt).

> Mitternacht. Du bist ein Überlebender mit einer Pistole. Du startest im Wald, auf dem Weg ins kleine Dorf.
> Neben dem Dorf liegt der Friedhof. Sobald du das Dorf erreichst, kommen sie.

**Spielen:** https://codexzier.github.io/HelloweenThing/ (nachdem GitHub Pages aktiviert wurde, siehe unten)

## Spielregeln

- Du startest im Wald und folgst dem Weg ins Dorf. Der **erste Zombie** erscheint erst, wenn du das Dorf erreicht hast.
- Danach kommt alle **5 Sekunden** ein neuer Zombie. Jedes Intervall wird um **100 ms kürzer** (Untergrenze 0,8 s, einstellbar in `js/config.js`).
- Neue Zombies erscheinen **50 m** vom Spieler entfernt und **nur dort, wo du gerade nicht hinschaust** (ausserhalb des Kamera-Sichtfelds).
- Jeder erledigte Zombie zählt +1 im **Zombie Count**. Kopfschüsse töten sofort.
- Nach **5 Treffern** durch Zombies ist das Spiel vorbei.

## Steuerung

| Taste | Aktion |
| --- | --- |
| `W A S D` / Pfeiltasten | Bewegen |
| Maus | Umsehen / Zielen |
| Linksklick (oder Leertaste) | Schiessen |
| `R` / Rechtsklick | Nachladen |
| `Shift` | Sprinten |
| `F` | Taschenlampe an/aus |
| `Esc` / `P` | Pause |

Auf Touch-Geräten gibt es einen virtuellen Stick sowie Feuer-, Nachlade-, Licht- und Sprint-Buttons.

## Menü

- **Neues Spiel**: Du steuerst selbst.
- **Auto Spiel**: Der Computer steuert den Überlebenden (läuft ins Dorf, zielt, schiesst, lädt nach, weicht aus). Bot-Runden werden nicht ins Scoreboard eingetragen.
- **Scoreboard**: Die 20 besten Runden (Zombie Count, danach Überlebenszeit).

## Inhalte & Effekte

- Wald mit Weg, Dorf mitten im Wald (Häuser aus Modulteilen, Brunnen, Marktstände, Überlebenden-Lager mit Lagerfeuer, Windmühle), Friedhof mit Eisenzaun, Gräbern, Grüften, Feuerkörben und Laternen.
- Vier Gegnertypen: **Zombie** (Survivor-Modell mit Zombie-Skin), **Ghul**, schnelles **Skelett**, und alle 25 Kills ein **Vampir**-Boss.
- Vollmond mit Halo und Mondlicht-Schatten, Sternenhimmel, Wolkenschleier, Nebel und animierter Bodennebel.
- Blitze mit Donner, Fledermäuse, Irrlichter im Wald, ein Geist auf dem Friedhof, flackernde Kürbisse und Laternen.
- Taschenlampe, Mündungsfeuer, Leuchtspuren, Blut-Partikel und -Flecken, Trefferanzeige, Schadensrichtung.
- Postprocessing: Bloom, Vignette, Filmkorn, chromatische Aberration, rote Ränder bei niedriger Gesundheit.
- Sounds komplett prozedural per WebAudio: Schüsse, Nachladen, Zombie-Stöhnen (3D-positioniert), Herzschlag, Kirchenglocke um Mitternacht, Wind, Eule, Krähen, Wolfsgeheul, Donner und eine düstere Menü-Musik.

## GitHub Pages einrichten

Die Seite ist rein statisch – es gibt keinen Build-Schritt.

1. Den Branch nach `main` mergen.
2. Im Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“** wählen.
3. Der Workflow `.github/workflows/pages.yml` veröffentlicht die Seite bei jedem Push auf `main` (oder manuell über *Actions → Deploy to GitHub Pages → Run workflow*).

Alternativ geht auch **Source: „Deploy from a branch“ → `main` / `(root)`** – die Datei `.nojekyll` ist bereits vorhanden.

Lokal testen (ES-Module brauchen einen Webserver):

```bash
python3 -m http.server 8000
```

Danach http://localhost:8000 öffnen.

## Scoreboard: lokal oder global?

Deine Vermutung ist richtig:

- Ohne Server kann eine statische GitHub-Pages-Seite Daten **nur im Browser des Spielers** speichern (`localStorage`). Jeder Spieler sieht dann nur seine eigenen Ergebnisse auf seinem Gerät.
- Für eine **gemeinsame Bestenliste**, die bei allen die letzten/besten 20 Einträge zeigt, braucht es eine Datenbank in der Cloud.

Das Spiel unterstützt beides. Standard ist `local`. Für eine globale Bestenliste mit [Supabase](https://supabase.com) (kostenloser Plan reicht):

1. Projekt bei Supabase anlegen.
2. Im **SQL Editor** den Inhalt von [`supabase/scores.sql`](supabase/scores.sql) ausführen (legt die Tabelle `scores` mit Row-Level-Security an: jeder darf lesen und eintragen, aber nichts ändern oder löschen).
3. Unter **Project Settings → API** die *Project URL* und den *anon public key* kopieren.
4. In `js/config.js` eintragen:

   ```js
   export const SCOREBOARD = {
     provider: 'supabase',
     supabaseUrl: 'https://DEIN-PROJEKT.supabase.co',
     supabaseAnonKey: 'DEIN_ANON_KEY',
     table: 'scores',
     maxEntries: 20,
   };
   ```

Der *anon key* ist dafür gedacht, öffentlich im Browser zu stehen – die Sicherheit kommt über die Row-Level-Security-Regeln. Wichtig zu wissen: Weil das Spiel komplett im Browser läuft, kann ein technisch versierter Spieler theoretisch gefälschte Punktzahlen direkt an die Datenbank schicken. Für ein Hobby-Spiel ist das meist in Ordnung; die SQL-Datei begrenzt zumindest Namenslänge und Wertebereiche. Ist Supabase nicht erreichbar, fällt das Spiel automatisch auf die lokale Liste zurück.

## Eigene Sounds (z. B. Kenney Audio)

Alle Sounds werden prozedural erzeugt. Wer lieber echte Samples möchte (z. B. aus den Kenney-Paketen *Interface Sounds*, *Impact Sounds* oder *Sci-Fi Sounds*), legt die Dateien unter `assets/audio/` ab und trägt sie in `js/config.js` unter `CUSTOM_SOUNDS` ein, z. B.:

```js
export const CUSTOM_SOUNDS = {
  shot: 'assets/audio/shot.ogg',
  reload: 'assets/audio/reload.ogg',
  click: 'assets/audio/click.ogg',
  hover: 'assets/audio/hover.ogg',
  hurt: 'assets/audio/hurt.ogg',
};
```

## Projektstruktur

```
index.html            Menü, HUD, Overlays
css/style.css         Gestaltung
js/config.js          Spielregeln, Scoreboard- und Sound-Konfiguration
js/main.js            Spielablauf und Hauptschleife
js/world.js           Wald, Weg, Dorf, Friedhof, Licht, Himmel, Kollisionen
js/player.js          Überlebender, Kamera, Pistole, Taschenlampe
js/zombies.js         Gegner, Wegfindung, Spawn-Regeln
js/autopilot.js       Computergesteuerter Spieler („Auto Spiel“)
js/effects.js         Partikel, Bodennebel, Fledermäuse, Blitze, Postprocessing
js/audio.js           Prozedurale Sounds (WebAudio)
js/scoreboard.js      Lokale / Supabase-Bestenliste
assets/               Kenney-Modelle (CC0)
vendor/three/         three.js r170 (MIT) – lokal eingebunden, kein CDN nötig
supabase/scores.sql   Tabelle für die globale Bestenliste
```

## Credits

- 3D-Modelle: [Kenney](https://kenney.nl) – Graveyard Kit, Fantasy Town Kit, Survival Kit, Weapon Pack, Animated Characters Survivors (alle CC0)
- Engine: [three.js](https://threejs.org) (MIT)
- Schriften: Creepster und Special Elite über Google Fonts (OFL)
