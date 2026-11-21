# Credits

Terrain and asteroid textures are CC0 scans from [Poly Haven](https://polyhaven.com),
imported and processed in Blender (resized to 1024px, OpenGL normal maps):

| Game file | Poly Haven asset | Author |
|---|---|---|
| terrain_sand_* | [Red Sand](https://polyhaven.com/a/red_sand) | Rohit Seervi |
| terrain_rock_* | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) | Rob Tuytel |
| terrain_cliff_* | [Marble Cliff 03](https://polyhaven.com/a/marble_cliff_03) | Amal Kumar |
| asteroid_* | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Dario Barresi, Rico Cilliers |

`hull_panels_*` is an original procedural sci-fi panel material built in Blender (tileable
panel grid, rivets, grime) and baked with Cycles to albedo + tangent-space normal maps.

## Models

`public/models/lancer.glb` is an original Lancer interceptor modelled in Blender for this game
(needle nose, forward-swept wings with wingtip cannons, twin engine pods, V-tail).
Material names drive the in-game look: `*Hull`, `*Accent` (player colour), `*Dark`, `*Canopy`,
`*Glow`; empties named `engine_*` get engine flares. Any ship can be swapped to a GLB by adding it
to `SHIP_FILES` in `public/js/models.js`.
