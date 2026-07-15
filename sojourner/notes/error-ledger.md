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
