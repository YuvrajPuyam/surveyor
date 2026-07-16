# SOJOURNER ERROR LEDGER

Every error, artifact, or surprise on the images → world → mission-ready
pipeline, dated, with root cause and fix/workaround. This ledger is a primary
deliverable: it becomes the event-day risk map and the "what we learned"
slide.

Format per entry:

```
## E<N> — <one-line title>            (YYYY-MM-DD)
stage:     imaging | generation | ingest | cleanup | grid | planning | vision
symptom:   what we observed
cause:     root cause once known (or hypotheses, marked as such)
fix:       fix or workaround; NONE if open
carries:   what the event-day rebuild must do differently
```

---

## Known-in-advance risks (inherited from the SURVEYOR prototype, to confirm/deny on aerial worlds)

- **Open capture edges dominate outdoors:** probes/boxes roll off the edge of
  the reconstruction into free fall; anything touching the boundary needs the
  "left the surveyed area" exclusion discipline or it slanders the world.
- **Scale is weakly observable:** interiors used door-height priors; aerial
  worlds need known-dimension objects (road lane ~3.7 m, parking stall
  ~2.7 m, sports fields exact) or DEM/OSM cross-checks.
- **Splat density thins where the camera never looked:** expect unknown
  regions behind buildings/under trees (occlusion shadows) — these must land
  in the UNKNOWN voxel class, not free or occupied.
- **Collider is a lossy derived artifact:** expect phantom colliders from
  floaters and holes over low-texture ground (asphalt, water, grass).
- **Water and glass:** splats hallucinate, colliders do worse. Avoid sites
  with large water bodies for the first world.

---

## E1 — DroneMapper S3 bucket is requester-pays            (2026-07-15)
stage:     imaging
symptom:   all DroneMapper sample downloads (incl. Red Rocks Oblique) return
           S3 AccessDenied: "Anonymous users cannot invoke requests against
           Requester Pays buckets."
cause:     vendor moved sample hosting to requester-pays AWS policy
fix:       abandoned lane; switched to Poly Haven CC0 panos (below)
carries:   verify download access BEFORE committing to a dataset lane

## E2 — (resolution) Poly Haven panos carry GPS coordinates  (2026-07-15)
stage:     imaging
symptom:   (good surprise) Poly Haven's API exposes exact capture coords for
           outdoor HDRIs — Layer-2 ground truth is back on the table via
           Copernicus GLO-30 DEM (global 30 m) + OSM, despite no US 3DEP.
fix:       n/a — candidates shortlisted:
           - golden_gate_hills          (-28.5175, 28.6390)  42.4 MB  jpg
           - fouriesburg_mountain_lookout (-28.6130, 28.1971) 35.8 MB  jpg
           - drakensberg_solitary_mountain (-28.9423, 29.3254) 47.0 MB jpg
carries:   prefer sources whose metadata carries coordinates; the DEM
           elevation-profile check is the terrain ground truth

## E3 — Marble app worlds are invisible to the API           (2026-07-15)
stage:     ingest
symptom:   GET /marble/v1/worlds/<id> -> 404 "World not found" for an
           app-generated world; `marble.ts list` shows only API-created worlds
cause:     app account and API-key org are separate namespaces (same split
           as app credits vs API credits)
fix:       app export lane — download collider .glb + splat .spz from the
           app's export panel; `scripts/ingest-app-bundle.ts <worldId>`
           parses the spz into visual-points.f32 and writes metadata.json.
           NOTE: app exports ship NO vendor metric_scale_factor — the scale
           witnesses (door/ceiling priors are useless outdoors; DEM profile
           + known-dimension objects instead) must establish scale alone.
carries:   event-day plan must decide the lane up front; if app lane, bake
           the export+ingest step into the schedule

## E4 — Far-field visual with no collider (the pano-backdrop gap)  (2026-07-15)
stage:     cleanup / geometry
symptom:   Fouriesburg world (app export, 7f8eb141). Raw bounds:
             collider Y span 36 m  (-19.2 .. +16.9)  99,689 tris
             splat    Y span 122 m (-21.6 .. +100.7) 1,839,313 pts
           ~84 m of VISUAL geometry sits above the physical mesh; splat also
           bleeds ~20 m past the collider on X and Z.
cause:     single-pano generation splats the distant mountains + sky as
           far-field geometry, but the collider only meshes the near-field
           walkable ground shell. Photovisual world = 122 m bubble; physical
           world = 36 m ground slab.
fix:       for drone motion planning this is EXPECTED and must be HANDLED,
           not "repaired": the far-field splat is unreachable backdrop, not
           obstacle. Plan = clip the occupancy grid to the collider's Y band
           + a headroom margin; everything above = sky/unknown, never
           occupied. The divergence itself is a finding to SHOW (physical vs
           photovisual), not an error to erase.
carries:   aerial worlds need a "backdrop band" concept the interior worlds
           never did; the trust map's UNKNOWN class absorbs the far field.

## E5 — 274 x 324 m footprint blows the survey grid            (2026-07-15)
stage:     cleanup / performance
symptom:   ray grid at 0.1 m = 8.9M cells (cap 1.5M) -> auto-coarsens to
           ~0.24 m; first full-probe certify ran >10 min with no output
           (buffered/slow), re-run at 600 probes.
cause:     outdoor scenes are 100x the area of the interior test worlds;
           detection floor scales with the coarser cell.
carries:   event-day: pick probe count + cell size for the site's real
           extent; disclose the coarser detection floor (already automatic).

## E6 — Probe density flips a pass/fail verdict outdoors       (2026-07-15)
stage:     cleanup / certification
symptom:   same Fouriesburg world, two probe counts:
             2000 probes -> rover & quadruped floor_integrity FAIL (hole hit)
              600 probes -> both PASS (the 1 critical hole never sampled)
cause:     274x324 m footprint; at 600 probes the ~1 m hole is below the
           effective sampling density, so probe rain misses it.
fix:       scale probe count to world AREA, not a fixed number; the
           certificate's disclosed detection floor already warns of this,
           but here it changed a verdict, not just a confidence.
carries:   event-day: default probe count is tuned for interior worlds;
           outdoor sites need 2000+ (24 min runtime) or a coarser honest
           claim. Full 2000-probe run is the trustworthy one.

## E7 — VISUAL PROOF: phantoms ring the summit (occlusion shadows) (2026-07-15)
stage:     cleanup / evidence
symptom:   see proof/proof-defect-map.png — the 15,125 phantom colliders form
           a RING around the pano viewpoint: terrain hidden behind the
           near-field ridge from the single capture point. proof/
           proof-side-elevation.png shows the 84 m photovisual dome above the
           36 m physical slab (the summit cairn is the bright cluster).
cause:     single-viewpoint capture -> everything occluded from the pano
           point has visual gaps; the collider meshes it anyway.
fix:       for the drone map: the phantom ring = UNKNOWN voxels (never free,
           never trusted-occupied). Renderer: sojourner/proof/render-proof.py
           (reads bundle + certificate.json, no re-survey).
carries:   "distance from capture viewpoint" is a first-class trust prior
           for aerial worlds; also the interior-prior artifacts (metrology
           measuring boulder gaps as "doorways", scale 1.21x from a rock
           arch) show interior priors need an outdoor profile.

## E8 — Repair engine OOMs at 14,660-defect scale               (2026-07-15)
stage:     cleanup / repair
symptom:   sojourner-repair.ts: hole patched OK (slab y=-10.04), then Node
           heap exhaustion (exit 134) in the mass-quarantine loop; no export.
cause:     the operation stack + per-action bookkeeping were designed for
           interior worlds (tens of defects), not 15k outcomes in one pass.
fix:       OPEN — batch quarantine (one action, N defects) or raise
           --max-old-space-size; event rebuild should design for outdoor
           defect counts from day one.
carries:   defect COUNT is itself a scale axis; group-level operations
           (quarantine-by-region/type) beat per-defect ops outdoors.

## E9 — THE UNBUILT SUMMIT: launch terrain has no physics       (2026-07-15)
stage:     cleanup / geometry (see proof/proof-unbuilt-summit.png)
symptom:   30x30 m crop around the pano viewpoint: 1,218,318 splat points
           (66% of the whole visual world) vs 267 collider vertices — and
           those sit on the back-slope. The summit knoll incl. the cairn is
           visually solid ground with ZERO collider under it. The certifier
           flagged only its edges (59 ghost patches): the single-level,
           valley-anchored survey (floorY -10.14) cannot see an elevated
           terrace as "missing floor". Also explains the hole patch landing
           at y=-10.04 (global floor plane = valley height).
cause:     Marble meshed the valley shell but skipped the near-field knoll;
           certifier metrology is single-level by design (disclosed).
fix:       BUILDABLE: rasterize the 1.2M summit points into a heightfield
           collider (upper-quantile per cell, triangulate, merge) — the
           build_collider_from_splats tool; evidence overwhelming.
carries:   event-day MUST: multi-level / terrace-aware floor detection, and
           a "visual-mass vs collider-mass per region" check — the summit
           imbalance (1.2M : 267) is a one-line detector nobody had.

## E10 — RETRACTION of E9 + the frame bug that caused it        (2026-07-15)
stage:     evidence / tooling  (user-caught: "are you sure they aren't flipped?")
symptom:   E9 ("unbuilt summit", 1.2M pts vs 267 verts) and the "phantom
           shell floating above the summit" were artifacts of the ad-hoc
           proof RENDERER, not the world. The app-export GLB carries a root
           node matrix (uniform scale 0.6797, Y and Z FLIPPED, +3.056 m Y);
           the quick python parser read raw accessors and ignored it.
truth:     - repo loadColliderGlb applies node transforms correctly ->
             ALL certificate numbers were computed in the true frame and
             STAND (15,125 phantoms, 26% divergent, 59 ghosts, 1 hole, dome).
           - corrected summit crop: 653 collider verts at y -2..+1 under the
             splat ground at y~0 — the summit IS meshed (sparse, ~1.2 m).
           - global alignment: median visualTop-colliderTop = +0.44 m,
             58% of shared 1 m cells within +/-1 m. Physics follows terrain.
fix:       all proof images re-rendered in the corrected frame; 3D artifact
           republished; renderer scripts must ALWAYS apply glTF node
           transforms (matrix in scene graph, not in the accessors).
carries:   1) any ad-hoc reader of vendor files must respect the scene
           graph — add a frame-agreement smoke test (alignment score)
           BEFORE trusting any cross-representation claim; 2) the certifier
           itself never made this mistake — the lesson is about side
           tooling; 3) adversarial review of your own evidence works:
           the user's one-line skepticism caught what three renders missed.
