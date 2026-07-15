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

(entries start here)
