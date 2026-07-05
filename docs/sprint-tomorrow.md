# SPRINT: running product by EOD tomorrow (Jul 6)

Supersedes day-by-day pacing in PLAN.md. The headless core is DONE (certify,
repair engine, agent, MCP, self-validation 96.8% CI≥85.6, real-world F→A
episode, Isaac contract). What "running" means:

**Open browser → load real Marble world → survey runs live (trust map paints)
→ certificate panel → click repair plan → fail-and-adapt visible → re-certify
→ grade improves → rover patrols certified navmesh.**

## Wave 1 (running now — workflow wf_1acf4fd9-669)
viewer scaffold (app/) + adversarial review + 2-world corpus

## Wave 2 (launch when wave 1 lands) — browser integration
Key fact: src/certify/* and src/repair/engine.ts are fs-free — they run in a
Web Worker as-is (Rapier compat is isomorphic). Only ingestion is node-bound:
- browser GLB: three GLTFLoader -> TriMesh (positions+indices merge)
- browser SPZ: DecompressionStream("gzip") replaces node:zlib (same header parse)
Lanes (parallelizable):
A. certify-in-worker: worker wraps certifyWorld + RepairEngine; postMessage
   protocol {certify, getCert, patchHole, revert, recertify, quarantine,
   accept, spawns, exportJSON}; progress events stream probe batches for
   live painting
B. trust-map painting: per-cell states need EXPORT from trustmap.ts (add
   cells array to TrustMap result; render as instanced quads at floor height)
C. certificate panel UI: defects list w/ evidence + methods lines, verdict
   rows (rover fail / quadruped pass highlight), grade badge, disclosures
D. repair UI: plan proposal (from agent prompt or scripted order:
   scale→holes→quarantine), buttons drive worker engine; show
   fail-and-adapt when regional recertify returns newDefects
E. patrol: waypoint follower over spawns list w/ simple steering on the
   navmesh-free floor cells; drives OVER patch, AROUND quarantine boxes
F. wire real bundle: assets/marble/7188e250... via vite publicDir

## Wave 3 (tomorrow) — polish + Gate A on laptop + demo dry run
fps HUD numbers on the demo laptop; five-beat dry run against
docs/demo-five-beats.md; record backup video; commit tags.

## Constraints that stay non-negotiable
- tests stay green (npm test, 18)
- determinism (seeded), uncertainty+methods lines on every number
- honesty invariants (raycast cross-check, reachability masking, noise floor)
