# Vanguard Wing — co-op 3D browser starfighter

An arcade space-combat game for 1–4 players, inspired by early-2000s console starfighter games
(mission objectives, bonus objectives and medals, three ship classes). All ships, characters and
missions are original.

## Play
- **Quick Play** joins an open wing or creates one. **Create Wing** gives you a 4-letter code / invite link.
- The wing leader picks the mission and difficulty, then launches. Empty slots get AI wingmates.
- Shared reserve ships: when you're shot down you relaunch after 5 s while reserves last.

| Ship | Role | Secondary |
|---|---|---|
| Lancer | Interceptor | Lock-on seeker missiles |
| Warden | Heavy fighter | Flak burst |
| Hammer | Bomber | Plasma bombs (splash) |

Missions: **Outpost Siege** (planet canyon defense), **Convoy Intercept** (asteroid belt),
**Fall of the Ravager** (capital-ship assault). Each has 2 bonus objectives → bronze/silver/gold.

### Controls
Mouse = virtual stick · W/S throttle · A/D roll · LMB/Space cannons · RMB/F secondary ·
Shift boost · T/R target · C camera · Enter chat · Esc menu · M mute. Gamepads supported.

## Tech
- `server/` — Node.js HTTP + WebSocket (`ws`) server. Authoritative 30 Hz mission sim (enemy AI,
  projectiles, objectives); players are client-authoritative for their own flight.
- `shared/` — config + deterministic world data (terrain, asteroids, dreadnought) used by both sides.
- `public/` — Three.js client (procedural models, bloom, synthesized audio, canvas HUD).

```bash
npm install
npm start          # http://localhost:3000
npm test           # headless 2-bot smoke test of all missions
```
Deploys on Railway as-is (`npm start`, listens on `$PORT`, health check `/health`).

## Railway features used
- **Two services** in one project: `vanguard-wing` (Node game server) and `vanguard-forum` (PHP + SQLite, built from `forum/`).
- **Volumes:** `/data` on each service (admin content, flags, metrics history; forum database and sessions).
- **Bucket** `vanguard-media`: admin media library (images, GLB ship models) served same-origin at `/media/…`.
- **Studio (v2.0):** `shared/gamecontent.js` validates and applies admin-made content on both the server and the browser: custom ships, custom missions (run by `SCRIPTS.custom` in `server/sim.js`), liveries, model markers, environments (panoramas, terrain textures, heightmaps), sounds and scheduled events. The admin pages live in `public/js/admin-studio.js`, `admin-pages.js` and `admin-missions.js`.
- **Preview drafts:** `/data/preview.json` holds a draft only signed-in admins see. Preview wings run their simulation with the draft swapped in (`inContext()` in `server/index.js`), so balance changes can be flown without touching live players.
- **Forum pilot pass:** the forum's `/game-link` signs `{callsign, role, expiry}` with `GAME_LINK_SECRET` (set the same value on both services); the game verifies it to unlock role-locked liveries.
- **Custom models:** every slot in `MODEL_SLOTS` (`shared/config.js`) can use a GLB from the media bucket; `public/js/models.js` fits it to the built-in size. `.obj` packages are converted to GLB in the browser (`public/js/obj-convert.js`), so the game only ever loads GLB.
- **Game tuning:** `shared/tuning.js` lists every live-tunable value (ships, weapons, enemies, difficulty, mission texts, colours, camera, skies). Overrides are saved with the site content on the `/data` volume and pushed to every open game over the WebSocket, so balance and looks change without a redeploy.
- **Feature flags:** `vw.mission.*`, `vw.ship.*`, `vw.event.*`, read with the `railway` SDK when `RAILWAY_TOKEN`
  (a project token) is set; admin overrides win and every change is pushed live to players.
- **Metrics:** in-process request/error/latency/memory/CPU/game-loop metrics plus Railway's CPU/memory/network
  via the public GraphQL API (same `RAILWAY_TOKEN`) on the admin "Server health" page.
- **PR environments:** every pull request can get a temporary copy (enable in Project Settings → Environments);
  the game shows a PREVIEW ribbon there. CI (`.github/workflows/ci.yml`) runs the co-op smoke test on PRs.
