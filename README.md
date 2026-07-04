# Surveyor

**An inspection and repair shop for AI-generated 3D worlds.**

Generated worlds ship as two files that nobody checks against each other: a
photoreal splat file and an invisible simplified physics shell. A floor can
have a physics hole under perfect pixels; a door can be painted on. Robots
train in these worlds anyway. Surveyor runs physical experiments inside a
world — seeded probe rain, virtual LiDAR, divergence analysis — and produces a
**certificate** (which parts are trustworthy, which are lying, with
uncertainty ranges and methods lines under every number) and a **repaired
copy** (scale applied, holes patched, lies quarantined, verified spawn
points), graded per robot: the same 0.15 m sill fails a small rover and
passes a quadruped.

Named for NASA's 1966–68 Surveyor program, which landed on the Moon to
certify the ground before Apollo risked humans on it.

## Status

Pre-event core library for the Worlds in Action hackathon (SIGGRAPH 2026).
Headless-first: everything here runs in Node with no browser and no network.

```
npm install
npm test                 # 8 regression tests incl. byte-identical determinism
npm run make:synthetic   # write the planted-defect validation worlds to assets/generated/
npm run self-validate    # certifier vs its own test bench: precision/recall
npm run certify -- assets/generated/syn-kitchen-sink --gravity mars
npm run mcp              # MCP server over stdio (Claude Desktop front door)
```

Current self-validation on the 27-world bench (31 planted defects, including
adversarial classes outside the certifier's taxonomy — frame mismatch, local
mis-scale — and defects at the detection floor):
**recall 96.8% (95% CI ≥ 85.6%), precision 100% (95% CI ≥ 90.5%)**, zero
false positives on clean controls, one honest miss (local sub-region
mis-scale — disclosed as a scope limitation). Confidence intervals are
one-sided Clopper-Pearson and ship on the certificate itself.

Field-validated: the first real Marble world's vendor scale factor (1.624)
was independently recovered by door-height metrology at 1.60 [1.44..1.76],
and a subscription-billed headless agent episode repaired the world F → A
with all 81 defect outcomes recorded (cassette in `traces/`).

## Architecture

```
src/core       schemas (zod), PRNG, geometry, grids     — every number is a Measurement
src/ingest     GLB collider IO, synthetic defect worlds, bundle format
src/physics    Rapier wrapper (deterministic fixed timestep, WASM)
src/certify    survey (probes + rays + divergence) → metrology → defects → trust map → verdicts → certificate
src/validation self-validation: planted defects vs detections, precision/recall
src/trace      replay cassette (JSONL, content-addressed blobs, frozen clocks)
agents/        Surveyor + Repair agent prompts, 9-tool closed repair menu
mcp/           MCP stdio server: list_worlds / certify_world / get_certificate
docs/          rules email, 28-hour contingency scope
```

Honesty invariants (enforced in code, not prose):

- A probe fall-through only counts as a hole if an independent raycast at the
  same point also passes through — engine tunneling can never masquerade as a
  collider hole.
- The `Measurement` schema makes raw centimeter claims unrepresentable: value
  + uncertainty range + basis + methods line, always.
- Slope verdicts print **"unchanged under Mars gravity"** — the Coulomb slope
  limit is atan(µ); gravity cancels. Stopping distance changes (~2.6x on
  Mars) and the certificate says which is which.
- Every certificate ships with the self-validation appendix: the certifier's
  own precision/recall on worlds with planted defects.

## Attribution

Sample worlds generated using World Labs Marble carry "Generated using World
Labs". Mars panoramas: NASA/JPL-Caltech/ASU/MSSS, converted; generated worlds
are AI-derived, not NASA imagery.
