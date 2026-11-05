# Local App Catalog

LegionOS reads app manifests only from this project directory. In development mode, it uses the `apps/` folder next to `src-tauri/`. Packaged applications include the same folder as a Tauri resource.

## Manifest format

Each direct subfolder contains one `manifest.json` with these fields:

```json
{
  "id": "snake",
  "name": "Snake",
  "version": "1.0.0",
  "description": "Classic Snake with a futuristic Legion look.",
  "icon": "snake",
  "type": "internal",
  "entry": "snake"
}
```

IDs, types, and entry points must be registered in the program. Internal apps use built-in LegionOS components; manifest values cannot specify programs or paths. Supported icons are `settings`, `note`, `spark`, `snake`, `pong`, `invaders`, `snowman`, `roadwatch`, `radio`, and `music`. Manifests cannot load scripts or arbitrary entry paths.

Manifests must be valid UTF-8 JSON and no larger than 64 KiB. Unknown fields, invalid or duplicate IDs, invalid SemVer versions, and unsupported types or entry points are rejected. The catalog displays invalid entries with an error message without preventing LegionOS from starting.

Installed app IDs are saved in `phone.json` under `installedApps`. Names, descriptions, and versions are read from the local manifests again at every startup.

## Registered apps

- `settings`: Settings
- `notes`: Notes
- `demo`: Demo
- `focus`: Focus
- `snake`: Snake Arcade (not installed by default)
- `pong`: Pong against the LegionOS AI (not installed by default)
- `space-invaders`: Space Invaders retro arcade shooter (not installed by default)
- `snowman-hate-you`: Snowman Hate You (not installed by default)
- `roadwatch`: RoadWatch live VTC overview (not installed by default)
- `radio`: Internet radio directory and player (not installed by default)
- `spotify-player` (folder `apps/spotify/`): personal Spotify player; visible only when a local, Git-ignored `spotify.local.json` exists (see `apps/spotify/README.md`)

Snake uses the fixed, registered internal component `apps/snake/SnakeApp.tsx`; its game rules are in `apps/snake/game.ts`. The personal high score is stored in local WebView storage under `legion-os.snake.high-score.v1`.

Pong uses the fixed, registered internal component `apps/pong/PongApp.tsx`; movement, collisions, and scoring are in `apps/pong/game.ts`. The personal high score is stored locally under `legion-os.pong.best-score.v1`.

Space Invaders uses the fixed, registered internal component `apps/space-invaders/SpaceInvadersApp.tsx`; movement, hits, enemy formations, boss fights, and game state are in `apps/space-invaders/game.ts`. The personal high score is stored locally under `legion-os.space-invaders.best-score.v1`.

Snowman Hate You is a standalone 2D winter rage platformer with jumps, gaps, and snowmen that throw snowballs. Its fixed, registered internal component is in `apps/snowman-hate-you/SnowmanHateYouApp.tsx`; movement and collision rules are in `game.ts`. The farthest distance is stored locally under `legion-os.snowman-hate-you.best-distance.v1`.

RoadWatch is embedded as an internal LegionOS component. The TruckersMP ID and VTC ID are stored in LegionOS settings and used with the TruckersMP and ETS2Map APIs. Rust fetches the data; the RoadWatch window remains an internal React window and does not require a separate RoadWatch installation.

Radio queries the Radio Browser directory through a Rust client with a descriptive User-Agent, resolves playback through the station click counter, and plays the returned HTTP(S) stream in a persistently mounted LegionOS audio player. Music can therefore continue while the Radio window is minimized or inactive; playback stops when Radio is closed or uninstalled. Availability and supported formats depend on the station. No additional radio software or account is required.
