# Adversarial review triage (wf_1acf4fd9-669 — 6/6 CONFIRMED by verifier)

Fixed and committed earlier:

1. **HIGH — quarantine revert never removes zones** (object-identity filter). Fixed: quarantine keyed by defectId.
2. **MEDIUM — L1 chamfer used as Euclidean clearance** (up to 1.41× inflated `clearanceM`, ~4 mm real margin for the rover preset). Fixed: diagonal (octile) chamfer.

Fixed 2026-07-05 (evening) — all four implemented with per-finding regression
tests in `test/review-findings.test.ts` (22/22 green). Fixes as landed:

3. LSQ slope-plane fallback when RANSAC has zero inliers (honest tilt → slope
   verdict evaluates real terrain); `certifyWorld` catches the too-few-columns
   throw into an F-grade "Unsurveyable" certificate with the reason disclosed.
4. Tunneling cross-check ray now spans dropY → killY (the probe's full travel).
5. `maxGridCells` budget (default 1.5M): cell size coarsens proportionally,
   certificate discloses the coarser detection floor. Never crashes.
6. Explicit AABB-footprint check before the claim-zone test: out-of-AABB exits
   are "left the world", never fall-throughs.

27-world bench acceptance (recall/precision CIs) runs together with the
outdoor-calibration change — one bench run covers both. Original findings:

3. **MEDIUM — zero-inlier RANSAC → NaN floor plane + false-pass slope verdict.**
   `metrology.ts:89,113-115`. `|ny| < 0.95` rejects every candidate plane on a
   uniformly >18.2° sloped world → `bestInliers = []` → NaN height/uncertainty
   (serializes as `null`, violates MeasurementSchema) and sill classification
   evaluates a fictitious y=0 plane. Sibling: throw at `metrology.ts:69`
   propagates uncaught through `certifyWorld` — crash instead of a graded
   certificate on axis-swapped colliders.
   *Fix sketch:* zero-inlier fallback = gravity-projected robust median plane
   (or best-of-rejected with disclosed uncertainty); catch the throw into an
   F-grade "unsurveyable" certificate with a methods line. Canyon-relevant.

4. **MEDIUM-LOW — tunneling cross-check ray too short on low-relief worlds.**
   `survey.ts:395`. Ray bottom is `surfaceY + 1.0 + stagger − worldHeight`,
   above the surface when `worldHeight < 1.0 + stagger` (≤1.15 m) → tunneling
   probe's cross-check misses existing geometry → misclassified as
   `fallConfirmed`, violating the header invariant. *Fix:* extend ray to
   `killY` (length `dropY − killY`). Bench never hits the window (3 m walls).

5. **MEDIUM-LOW — no AABB/cell-count guard before grid allocation.**
   `survey.ts:86-88`, `grid.ts:16-17`. A cm-scale export (the scale-defect
   class itself) → 600M cells ≈ 62 GB across ~13 channels + castDownProfile
   per cell → OOM/hang before the scale defect is synthesized. *Fix:* cap
   total cells; above the cap, coarsen cell size proportionally and disclose
   the coarser detection floor in the methods lines (never crash).

6. **LOW — index clamping defeats off-world-edge exclusion.**
   `survey.ts:398-399`, `grid.ts:29-33`. `Grid2D.index` clamps out-of-range
   coords to border cells, so a probe that rolls off an open edge evaluates
   `inClaimZone` on the clamped RIM cell → recorded as `fallConfirmed` on the
   rim — exactly the case the code comment claims is excluded. Open-edged
   terrain patches (moon/canyon) are the trigger; the walled bench can't see
   it. *Fix:* explicit in-bounds check before the claim-zone test; out-of-AABB
   exits are "left the world", never fall-throughs.

Verifier note kept for honesty: #2's body-overlap requires footprint radius
>~0.362 m, which no shipped preset uses — the shipped impact was margin
collapse + inflated exported clearance, not overlap.
