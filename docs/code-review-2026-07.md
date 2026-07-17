# Code review 2026-07 — deferred findings

Three parallel review agents swept src/, scripts/+bin/+mcp/, and app/src.
High-confidence fixes were applied immediately (see the commit that adds
this file). Everything below is REAL but deliberately deferred — each entry
says why. Ordered by risk.

## Deferred: core

- **Probe rim misclassification** (`src/certify/survey.ts` rested-branch has
  no AABB guard; a probe that rolled off an open edge but is above killY at
  timeout marks a clamped rim cell "verified" and feeds noise-floor
  calibration). *Deferred because:* fixing changes certificate bytes on
  affected worlds — needs a corpus re-run + hash re-stamp, not a drive-by.
- **No `escalate` outcome tool** — the agent prompt mandates
  fixed/quarantined/escalated/accepted, but no tool can record "escalated"
  (accept_defect writes only "accepted"). *Deferred because:* adding a tool
  changes the "closed 11-tool menu" narration; decide count vs. capability
  deliberately.
- **Dead code candidates** (grep-verified no callers): `aabbUnion`
  (core/geom), `Grid2D.set`, `TraceRecorder.storeBlob`,
  `MarbleClient.prepareUpload`, `probeStats.stepsPerSecond` (also the only
  nondeterministic survey value), `RepairToolInputs`/`RepairAction` types
  (dead AND drifted from the real menu), the always-true
  `drop >= CONTRADICTION_GAP_M` conjunct (evidencePolicy), decorative
  `DRIFT_STABLE_M` (extended). *Deferred:* removal churn vs. benefit — batch
  them in one cleanup PR.
- **Duplicated calibration logic** — the density-relative lie threshold
  (trustmap/defects) and the floor-claim gate (survey/metrology/extended ×3)
  are copy-paste triplicates; consolidate into shared helpers
  (value-preserving, hash-safe).
- **`defects.ts` countInRegion** is the same per-region full-grid scan
  pattern metrology just de-quadraticized — localize it before the next
  outdoor world with thousands of clusters.
- `clearance_violation` sits in the emit-able section of DefectTypeSchema
  but no certifier path emits it (annotate, don't move — hash).
- `inspectRegionImpl` triangle stat tests only the first vertex — rename or
  compute centroids.

## Deferred: scripts

- **align-stage.ts** (untracked, parallel session's tool): crashes writing
  its receipt when the pack has no `contract/` dir (mkdir missing), and its
  Visuals-prim body replacement assumes xformOp-only content. Fix before
  relying on it; then commit it.
- **Three USD builders overlap** (sojourner-usd hardwires empty
  spawns/quarantine; usd-pack reads them; make-pack does the full pack) — a
  fixed bundle with spawns silently loses them in the sojourner lane.
- **Exit-code drift**: usage errors exit 2 by convention but 1 in
  validate-*, worktree.mjs, inspect-bundle, make-training-contract,
  repair-agent, mcp/repair-server, g8-composed-gate.py.
- **No shared argv helper** — every script re-invents flag parsing with
  different failure modes (marble's `flag()` returns the next token even if
  it's another flag).
- `floor-width-analysis.ts` is Day-2-world-specific (hardcoded FLOOR_Y) —
  archive or delete.

## Deferred: app

- **Three.js resource leaks** on every rebuild path: live-defect boxes
  (rebuilt twice per recertify, geometries/materials never disposed),
  patrol teardown, twin-run visuals, highlightRegion. Add a dispose helper.
- **Coordinate-frame mixes that bite only after `apply_vendor_scale`**:
  highlightRegion always parents to worldGroup even for scene-coord live
  stops; anchorRegion compares scaled-world raycast Y against
  worldGroup-local regions.
- **Silent worker-failure hangs**: twinRun's pendingProbes never time out
  (stuck `probing` swallows every later R); workerClient has no failure
  latch after onerror (post-crash RPCs never settle — export button dead).
- **Per-frame full-mesh raycasts** (patrol floor height; anchorRegion ×200
  per recertify) — no BVH; jank on outdoor worlds.
- **Run-All vs setPlan race**: finalize inside runStep reassigns the panel's
  views while runAll iterates the orphaned array.
- Dead: workerClient certify()/inspectRegion()/carveOpening(),
  stepper.back(), NARRATE.patrol/HINT.patrol, "rover patrol started" LOG_RULE,
  buildPatrolRoute loop mode, missionLog.onToolResult.
- cassetteReplay's "183-event ≈35 s" doc vs main's "305-event 75.7 s" — one
  is stale.

## Verified healthy

- GLB handling: every consumer goes through loadColliderGlb (node transforms
  applied) — the historical raw-accessor mistake has not recurred.
- Measurement/certificate core: careful, deterministic, internally honest
  (agent's words). Canonical-hash discipline held through every fix applied.
