# Site shortlist — first real-world generation target

## Dataset lanes (no own photos — 2026-07-15 research)

Marble accepts single image, multi-image (with directional positioning),
360 pano, and video <100 MB (app lane). Ranked for our needs:

| # | Source | What | License | Geotagged? | Marble input | Layer-2 GT pairing |
|---|---|---|---|---|---|---|
| 1 | [ODM sample data](https://github.com/OpenDroneMap/ODMdata) — e.g. [Aukerman](https://github.com/OpenDroneMap/odm_data_aukerman), [Seneca](https://github.com/OpenDroneMap/odm_data_seneca) | real drone photo sets, oblique+nadir, EXIF GPS | open (per-repo) | YES (EXIF) | multi-image (pick 4–8 obliques) | EXCELLENT: exact coords → USGS 3DEP + OSM |
| 2 | [Wikimedia Commons 360° equirectangular panos](https://commons.wikimedia.org/wiki/Category:360%C2%B0_panoramas_with_equirectangular_projection) | real outdoor sites, single-file panos | CC-BY / CC0 per file | many (coord map) | pano (cleanest generation) | GOOD when geotagged |
| 3 | [Poly Haven outdoor panos](https://polyhaven.com/all) | pro-quality outdoor panos | CC0 (cleanest) | mostly NO | pano | WEAK (location often unstated) |
| 4 | [DroneMapper samples](https://dronemapper.com/sample_data/) | 45 oblique images (CO sites) | free samples | yes | multi-image | good |
| 5 | [OpenAerialMap](https://openaerialmap.org/) | CC-BY 4.0 orthoimagery | CC-BY 4.0 | yes | POOR input (nadir → flat world) | use as GT layer instead |

**Recommendation:** lane 1 (ODM Aukerman or Seneca) for the mission story +
ground truth; lane 2 pano as the low-risk generation fallback (single-file
input generates most reliably). OpenAerialMap serves as a ground-truth
overlay, not as generation input.

## HILLY TERRAIN constraint (2026-07-15) — ranked picks

User wants hilly terrain (right call: makes the DEM elevation-profile check
and the climb-energy cost term load-bearing).

| Pick | Dataset | Terrain | Why |
|---|---|---|---|
| **1** | **DroneMapper "Red Rocks Oblique"** (Red Rocks CO, 45 images, OBLIQUE, EXIF GPS) | steep ridge | the only hilly set that is also oblique — Marble's preferred viewpoint; CO = excellent 3DEP lidar |
| 2 | DroneMapper "Adobe Buttes" (Delta CO, 531 nadir) | hilly buttes | big set, but nadir-only input generates flatter worlds |
| 3 | DroneMapper "Poker Flats" (Alaska, 602 nadir) | mountainous | dramatic, weaker OSM ground truth |
| 4 | Wikimedia geotagged mountain-overlook pano | hilly | single-file fallback lane |

ODM's hilly candidates (Helenenschacht forest roadway, Ziegeleipark quarry)
are weaker: forest canopy confuses splats; the quarry set is 7,169 images.

Selection criteria (in priority order):
1. We can legally source imagery (own photos > open aerial; never Google).
2. Free ground truth exists: USGS 3DEP lidar/DEM + dense OSM footprints.
3. Bounded, drone-mission-shaped: obstacles + open corridors + a reason to
   plan paths (campus quad, park with structures, stadium surrounds).
4. No large water/glass surfaces (splat pathology magnets) for world #1.

| Candidate | Imagery lane | Ground truth | Mission story | Notes |
|---|---|---|---|---|
| Purdue campus quad (user has access) | own phone photos, walk-around | 3DEP (Indiana lidar is excellent), OSM dense | "inspection drone crosses campus, avoids buildings/trees" | user is on-site; easiest legal imagery |
| Local park w/ pavilion | own photos | 3DEP + OSM (sparser) | waypoint patrol, coverage mode | fewer occlusion shadows |
| Stadium exterior | own photos (public areas) | OSM excellent (footprint + height) | perimeter survey mission | big clean scale reference |

Decision: ____ (fill after imagery test)

## Capture tips for Marble input (from vendor guidance + prototype experience)
- Many overlapping photos sweeping the space beat a few wide shots.
- Keep the horizon steady; avoid people/moving cars in frame.
- Midday diffuse light > harsh shadows (shadows bake into splats).
- For a pano lane: a single 360 pano generates cleanly (`marble.ts pano`).

## DECISION (2026-07-15, after visual inspection of the three panos)

**Selected: `fouriesburg_mountain_lookout`** (-28.6130, 28.1971, CC0, 8192x4096).
Near-field wins: boulders/ledges/brush = drone-scale obstacles, drop-offs on
all sides, and a BRICK CAIRN on the summit = natural inspection waypoint
("fly to the structure, survey, return"). Single-pano Marble worlds are
near-field-rich / far-field-backdrop, so near-field structure decides.
- runner-up: golden_gate_hills (gorge obstacle but flat foreground)
- pass: drakensberg_solitary_mountain (smooth grass plateau)

Next: upload fouriesburg_mountain_lookout.jpg to the Marble app (pano mode)
→ world ID → `npx tsx scripts/marble.ts download <id>` → certify --extended
→ error ledger.
