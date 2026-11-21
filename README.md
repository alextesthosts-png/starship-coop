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
- **Feature flags:** `vw.mission.*`, `vw.ship.*`, `vw.event.*`, read with the `railway` SDK when `RAILWAY_TOKEN`
  (a project token) is set; admin overrides win and every change is pushed live to players.
- **Metrics:** in-process request/error/latency/memory/CPU/game-loop metrics plus Railway's CPU/memory/network
  via the public GraphQL API (same `RAILWAY_TOKEN`) on the admin "Server health" page.
- **PR environments:** every pull request can get a temporary copy (enable in Project Settings → Environments);
  the game shows a PREVIEW ribbon there. CI (`.github/workflows/ci.yml`) runs the co-op smoke test on PRs.
