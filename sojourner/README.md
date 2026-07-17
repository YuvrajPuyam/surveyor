# PROJECT SOJOURNER

Real images → generated world → cleanup → **mission-ready terrain** for a
simulated drone: occupancy grid + navigation graph (obstacles / unknown
regions / waypoints), motion planning (k diverse paths, shortest / safest /
best-surveyed), vision-based navigation, and a mission dashboard (battery,
remaining distance, coverage).

Named for the first rover to drive on Mars — a machine that had to trust a
map made from afar.

**This directory is the pre-event exploration.** Concepts carry, code does
not: everything here is a personal-project prototype whose lessons get
rebuilt from scratch at the event ("no coding before the event" — the
submission is what gets written on-site).

## Pipeline under test

```
real images ──► Marble world (splat + collider)
                    │
                    ▼
             CLEANUP + VERIFY          Layer 1: internal consistency
             (artifacts, ghost           (splat vs collider, floaters,
              geometry, unknowns)         unknown regions)
                    │                  Layer 2: fidelity to reality
                    ▼                    (USGS DEM elevation profiles,
             occupancy voxel grid         OSM footprint overlap,
             free / occupied / UNKNOWN    known-dimension scale checks)
                    │
                    ▼
             nav graph + A* planning   cost = distance
             k diverse paths                + λ1·obstacle proximity
             replan on divergence           + λ2·unknown traversal
                    │                       + λ3·energy
                    ▼
             mission dashboard         battery · distance · coverage
```

## Goal of this prototype

1. Generate ONE world from real imagery and inventory every error class we
   hit on the way (see `notes/error-ledger.md` — the ledger IS the deliverable).
2. Get to a final output good enough for motion planning: voxel grid +
   waypoint graph with honest unknown-region labeling.
3. Learn which cleanup steps matter for AERIAL worlds vs the interior worlds
   the SURVEYOR prototype was built on (open capture edges will dominate).

## Generation lanes (credits law: never spend without explicit approval)

- **App lane (preferred for real photos):** generate in the Marble app with
  uploaded images, then ingest here with
  `npx tsx scripts/marble.ts download <worldId>` (asset downloads are free).
- **API lane:** `scripts/marble.ts image --uri <public-url>` — needs the
  image hosted at a public URL AND a funded API wallet
  (platform.worldlabs.ai/billing).

## Image sourcing rules

- OUR OWN photos/drone footage: always fine. Drop candidates in `images/`.
- Open aerial/ortho data: USGS NAIP, state orthoimagery — fine, and pairs
  with free ground truth (USGS 3DEP DEM, OpenStreetMap footprints).
- **Google Street View / Google Earth: NO** — ToS prohibit 3D reconstruction
  from their imagery.
- Pick sites FOR their ground truth: US campus / park / stadium with good
  OSM coverage (footprints + heights) and 3DEP lidar.

## Layout

```
sojourner/
  README.md              this file
  images/                candidate source images (gitignored if heavy)
  notes/error-ledger.md  every error we hit, dated, with the fix or workaround
  notes/site-shortlist.md candidate real-world sites + their ground-truth coverage
  grid/                  (later) occupancy-grid + nav-graph prototypes
```
