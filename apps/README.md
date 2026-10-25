# Lokaler App-Katalog

LegionOS liest App-Manifeste ausschließlich aus diesem Projektordner. Im Entwicklungsmodus wird der `apps/`-Ordner neben `src-tauri/` verwendet. Gebaute Anwendungen enthalten denselben Ordner als Tauri-Ressource.

## Manifestformat

Jeder direkte Unterordner enthält genau eine `manifest.json` mit diesen Feldern:

```json
{
  "id": "snake",
  "name": "Snake",
  "version": "1.0.0",
  "description": "Klassisches Snake im futuristischen Legion-Design.",
  "icon": "snake",
  "type": "internal",
  "entry": "snake"
}
```

IDs, Typen und Einstiegspunkte müssen im Programm registriert sein. Interne Apps verwenden fest eingebundene LegionOS-Komponenten; Manifestwerte können keine Programme oder Pfade vorgeben. Unterstützte Icons sind `settings`, `note`, `spark`, `snake`, `pong` und `roadwatch`. Es werden keine Skripte oder beliebigen Einstiegspfade aus Manifesten geladen.

Manifeste müssen gültiges UTF-8-JSON sein und höchstens 64 KiB umfassen. Unbekannte Felder, ungültige oder doppelte IDs, ungültige SemVer-Versionen und nicht unterstützte Typen/Einstiegspunkte werden abgewiesen. Der Katalog zeigt solche Einträge mit einer Fehlermeldung, ohne den Start von LegionOS zu verhindern.

Installierte App-IDs werden in `phone.json` unter `installedApps` gespeichert. Namen, Beschreibungen und Versionen werden bei jedem Start erneut aus den lokalen Manifesten gelesen.

## Registrierte Apps

- `settings`: Einstellungen
- `notes`: Notizen
- `demo`: Demo
- `focus`: Fokus
- `snake`: Snake Arcade (zunächst nicht installiert)
- `pong`: Pong gegen die LegionOS-KI (zunächst nicht installiert)
- `spotify`: Spotify Desktop (zunächst nicht installiert)
- `roadwatch`: RoadWatch Live-VTC-Übersicht (zunächst nicht installiert)

Snake verwendet die fest registrierte interne Komponente `apps/snake/SnakeApp.tsx`; die Spielregeln liegen in `apps/snake/game.ts`. Der persönliche Rekord wird im lokalen WebView-Speicher unter `legion-os.snake.high-score.v1` gespeichert.

Pong verwendet die fest registrierte interne Komponente `apps/pong/PongApp.tsx`; Bewegung, Kollisionen und Punktestand liegen in `apps/pong/game.ts`. Der persönliche Rekord wird lokal unter `legion-os.pong.best-score.v1` gespeichert.

Spotify verwendet einen fest registrierten nativen Windows-Launcher für den URI `spotify:`. Es läuft in einem eigenen nativen Fenster und wird nicht als internes LegionOS-Fenster verwaltet. Die Deinstallation entfernt nur `spotify` aus `phone.json`; sie deinstalliert nicht die Spotify-Anwendung.

RoadWatch ist als interne LegionOS-Komponente eingebettet. Die TruckersMP-ID und VTC-ID werden in den LegionOS-Einstellungen gespeichert und für die TruckersMP- und ETS2Map-API verwendet. Die Datenabfrage läuft über Rust; das RoadWatch-Fenster bleibt ein internes React-Fenster und benötigt keine separate RoadWatch-Installation.
