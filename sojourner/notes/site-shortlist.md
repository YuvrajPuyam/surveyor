# Site shortlist — first real-world generation target

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
