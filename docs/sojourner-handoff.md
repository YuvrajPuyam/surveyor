# SOJOURNER HANDOFF — context pack for a fresh Claude session running agents

Audience: a NEW Claude session (with agent-spawning) that has none of this
context. Everything needed is in this file; repo paths are given for
verification. Last updated 2026-07-17.

---

## 1. The project in one paragraph

**Sojourner** is a team hackathon project for *Worlds in Action Hack [02-LA],
SIGGRAPH edition* (Los Angeles, weekend of ~Jul 18 2026; hosts: SensAI
Hackademy, Poeia XR, Machine Cinema, FBRC.AI, AI LA; $10k pool + World Labs
API credits + XGRIDS PortalCam; tracks include agentic systems, world models
with 3D GenAI, 3D reconstruction). The pipeline: **real imagery → World Labs
Marble generated 3D world (gaussian splats + collider mesh) → certified
teardown (find where physics and visuals disagree) → deterministic repair →
a "flight map" (voxel occupancy grid with an honest UNKNOWN class) + nav-graph
data → a C++ drone path planner (distance, battery, obstacle clearance,
information gain) → vision-based navigation → mission dashboard.** The core
thesis, inherited from the SURVEYOR prototype: generated worlds look real but
aren't solid; a planner that trusts them blindly crashes; measurement +
honest-ignorance labeling + repair-with-receipts is the product.

## 2. Hard constraints (do not violate)

1. **Event rules:** "no coding before the event"; open-source dependencies
   ARE allowed. Strategy: SURVEYOR (the pre-event personal project) is the
   *baseline/reference*; the submission is rebuilt at the event. **Concepts
   carry, code doesn't** — no copy-paste from the private repo during the
   event; re-derive. Pre-generated Marble worlds/assets are allowed ("may
   fine-tune world models beforehand"). Disclose the structure in the pitch.
2. **Repos:** baseline = `github.com/YuvrajPuyam/surveyor` (private; BJWOODS
   has write). New team repo: **`sojourner`, created by BJWOODS** — surveyor
   code may be migrated there later as the open baseline.
3. **Terminology law:** never say a world is "lying" — vocabulary is
   **confirmed / observed / divergent**, plus *ghost geometry* (visible, no
   physics) and *phantom collider* (physics, never seen). Schema field
   `lyingPct` is frozen (hash), display always translates.
4. **Marble facts:** app account and API key are SEPARATE namespaces (app
   worlds 404 on the API; export .spz + collider .glb from the app UI
   instead). Never spend Marble credits without the owner's explicit OK.
   Never re-derive frozen bundle files (breaks certificate hashes).
5. **Imagery legality:** never Google Street View/Earth (ToS bans 3D
   reconstruction). Poly Haven CC0 panos are the proven source — their API
   exposes GPS coords (enables real-world ground truth via Copernicus GLO-30
   DEM + OSM).
6. **Receipts culture:** everything deterministic (seeded), every number a
   Measurement {value, uncertainty, basis, method}, certificates hashable,
   every repair reversible with a before/after receipt, every claim
   disclosed. This discipline caught our own bugs repeatedly — keep it.

## 3. What exists and works (verified)

### The certified pipeline (SURVEYOR repo, all committed, tests green)
- **Certify** (`src/certify/`): seeded probe rain + virtual LiDAR + two-way
  splat-vs-collider divergence with self-calibrated thresholds → metrology
  (RANSAC floor, doorways, sills) → typed defects → trust map → per-robot
  verdicts → graded certificate (A–F). Deterministic; byte-identical replays.
  Outdoor scale fixed (quadratic tail removed; 274×324 m world certifies in
  ~17 min at 2000 probes). `--extended` profile adds level audit, floater
  census, scale consensus, settling test, reachability. `--evidence-tiers`
  policy: phantoms with no visual evidence either way leave the defect list
  (stay in trust map as unwitnessed); bucket-capped grading.
- **Repair**: engine with closed 11-tool menu (patch_hole, carve_opening,
  quarantine, revert, regional recertify…) + standalone deterministic lane:
  `scripts/sojourner-fix.ts` (carve/patch-at-LOCAL-floor/defloat),
  `scripts/sojourner-ghostfix.ts` + `src/repair/splatCollider.ts`
  (build_collider_from_splats: ghost rocks get colliders FROM splat evidence,
  height-capped), `scripts/extended-repair.ts` (mesh hygiene + floaters).
- **Flight map** (`scripts/sojourner-grid.ts`): voxel grid, classes
  0=UNKNOWN 1=FREE 2=OCCUPIED 3=SKY, x-major `(x*NY+y)*NZ+z`, rules encode
  the teardown lessons (backdrop band → sky; occlusion ring → unknown;
  ghost matter → unknown, never free; splat-corroborated collider → occupied).
- **Package** (`scripts/sojourner-package.ts`): one zippable folder — world
  (collider.glb, world.spz, visual-points.f32, world.usda), certificate
  (json+md), flightmap (bin + meta + clearance.bin distance-to-obstacle +
  navgraph.json components/frontier), receipts, proof images, README with a
  C++ quickstart. **Validators** (`scripts/validate-certificate.ts`,
  `scripts/validate-flightmap.ts`) prove correctness independently
  (mutation-tested / self-tested; all green on the real package).

### The proven case study: Fouriesburg mountain world
- Source: Poly Haven CC0 pano `fouriesburg_mountain_lookout`
  (-28.6130, 28.1971), generated in the Marble app, app-export ingested.
- Raw teardown: grade F; 15,191 defects (15,125 phantom colliders forming an
  occlusion RING around the pano viewpoint, 59 ghost rocks, 1 hole, sills);
  26% divergent; 618 floaters; verified real error: a 13 m invisible physics
  rampart over camera-verified flat ground (carved), plus a visible mid-field
  ridge with physics 47 m below it.
- Fixes applied with receipts: holes 1→0 (patched at LOCAL floor +4.67 — the
  global-plane would have put it 11 m underground), floaters 618→0, rampart
  carved (95 tris), 21 ghost rocks solidified (+5,424 tris).
- Flight map: 4.3M voxels — 19.1% free (largest component 645,549 voxels),
  20% occupied, 42.1% unknown, 18.8% sky; 396,841 frontier voxels.
- Package validated end-to-end; ~108 MB.
- **Error ledger E1–E11** (branch `sojourner`, `sojourner/notes/error-ledger.md`)
  is a first-class deliverable: dataset-access failures, app/API namespace
  split, pano backdrop gap (84 m of visuals above the physical slab), probe
  density flipping verdicts, occlusion-ring proof, engine OOM at 15k defects,
  a retracted finding (frame bug in MY tooling caught by the user's
  skepticism — glTF node transforms must always be applied), and the
  invisible-rampart conviction.
- Viewer app: loads any bundle via `?world=/marble/<id>`, photoreal splats +
  wireframe + trust map + defect boxes ([B]) + defect tour ([J]) + clickable
  certificate defect list + live survey with progress bar + raw-run crash
  demo ([R]).

### Team
- **Yuvraj** — world pipeline (everything above).
- **Brandon (BJWOODS)** — C++ path planner: distance, battery use, obstacle
  clearance, information gain; defines drone constraints and mission
  waypoints. He consumes flightmap.bin/meta + clearance.bin + navgraph.json
  (deliberately world-derived only; constraints/waypoints are his).
- Further teammates possible (vision navigation, dashboard) — TBD.

## 4. The plan as it stands

1. Migrate/publish surveyor as the open baseline; build the event submission
   fresh in `sojourner` (rules-clean), consuming the baseline as a dependency
   or reference.
2. Event pipeline (all steps rehearsed): capture/ingest → certify →
   fix + ghostfix → grid → package → Brandon's planner plans k diverse paths
   (shortest / safest / best-surveyed) → fly the mission in the viewer/sim →
   dashboard (battery, distance, coverage, unknown-%).
3. Demo arc (draft): plan on the RAW world → drone hits the invisible rampart
   or falls through the hole → certify + repair with receipts → replan on the
   flight map → mission succeeds, honestly routing around UNKNOWN → live
   map-healing when the drone's camera contradicts the map (stretch).

## 5. THE PRODUCT IS THE OUTPUT, NOT THE SYSTEM

Hard-won SURVEYOR lesson, re-affirmed by the owner for Sojourner: judges and
customers buy the FINAL OUTPUT; the pipeline is only how we get there. Every
feature below is stated from the CONSUMER's side (a drone operator, a judge
watching, Brandon's planner). Agents must evaluate and extend THIS list —
system elegance only matters where it surfaces in the output.

### Draft final-output feature set (v0 — criticize/enlarge/refine THIS)

**A. A world you can trust** (the twin itself)
- A1 Photoreal, flyable digital twin of a REAL site from a single capture.
- A2 Physics ≡ visuals within a stated tolerance (repaired, with receipts):
     nothing visible is intangible, nothing invisible blocks you.
- A3 Every cubic meter labeled: confirmed / observed / unknown / sky.
- A4 "Certified against reality": generated terrain cross-checked against
     the real site's elevation data (DEM) and map data (OSM) at its real
     GPS coordinates — the feature no pure-generation project can copy.

**B. A map that admits ignorance** (the planner's input)
- B1 Voxel flight map + clearance field + nav-graph, 3-line load in C++.
- B2 The UNKNOWN class as a first-class feature: honest ignorance you can
     price into a route, not silent danger.
- B3 The frontier surface: WHERE flying next earns the most information.
- B4 Provenance chained to the certificate hash: every voxel answers
     "says who?"

**C. Missions, not just paths** (Brandon's layer)
- C1 k diverse routes with visible trade-offs: shortest / safest /
     best-surveyed, each with a cost receipt (meters, joules,
     meters-through-unknown).
- C2 Battery feasibility per route; reserve enforcement — plans that
     don't lie about range.
- C3 Policy knobs for unknown space (forbid / price / explore).

**D. The living mission** (the demo experience — likely the on-stage core)
- D1 Fly it: first/third-person photoreal flight of the planned mission.
- D2 Live dashboard: battery, distance remaining, coverage %, and
     UNKNOWN-% DROPPING as the drone looks around.
- D3 **The self-healing map**: mid-flight, the camera contradicts the map →
     divergence event → cell upgrades → live replan. The 42% unknown stops
     being a weakness and becomes the plot: THE DRONE FINISHES THE MAP.
- D4 Mission debrief: what this flight confirmed — the map's before/after
     as a receipt, ready to feed the next mission.

**E. Receipts as features** (the differentiator, kept from SURVEYOR)
- E1 The crash that sells it: same mission planned on the RAW world fails
     visibly (invisible rampart / fall-through) — before/after, live.
- E2 A certificate a human actually reads (grade, trust, verdicts, fine
     print) and a hash anyone can re-derive.
- E3 **Presentation before/after imagery — splats vs mesh misalignment.**
     "Why fixing the world mattered" is told in pictures: gaussian splats
     (what you see) overlaid with the collider mesh (what physics has),
     misaligned BEFORE, agreeing AFTER. Already rendered (in
     `assets/marble/7f8eb141-…/proof-*.png`, copies in the `sojourner`
     branch under `sojourner/proof/`):
     - `proof-phantom-rampart.png` — THE slide: blue visible-ground line vs
       orange physics line agreeing to ±0.1 m for ten meters, then a 13 m
       invisible physics wall over camera-verified flat ground (red zone),
       with the drone-impact annotation.
     - `proof-side-elevation.png` — the corrected side elevation: collider
       tracking terrain at ~0.4 m; the 84 m photovisual dome above the
       physical world (backdrop band).
     - `proof-defect-map.png` — top-down: 15k phantoms ringing the
       viewpoint (occlusion shadows made visible).
     - `proof-unbuilt-summit.png` — cross-section chart, physics-vs-visible
       per meter.
     - Interactive 3D versions exist (see §7 pointers): layer toggles ARE
       the before/after (PHANTOM off = post-repair preview).
     TO PRODUCE (small, high value): the true AFTER-fix re-renders on the
     `-fixed` bundle — the rampart chart with the orange wall GONE, and the
     ghost-rock crop with new collider hugging the visible rock. The
     renderer is `sojourner/proof/render-proof.py` (applies glTF node
     transforms — non-negotiable; see ledger E10); pair each AFTER with its
     BEFORE at identical crop/scale/axes so the slide is a diff, not two
     pictures.

Open product questions the missions below must answer:
- Which ONE of D3 / A4 / E1 is the killer feature to center the demo on?
- What does "done" look like for each feature at hackathon scope (must-have
  vs stretch), and who builds it (pipeline / planner / third teammate)?
- What's the output for someone who is NOT a drone person — what does a
  World Labs designer or a VFX judge take away in 30 seconds?

## 6. THE ASK — criticize, enlarge, refine (agent missions)

Spawn agents against the following. Each mission lists the questions it must
answer. Findings should be concrete (what to build/cut/say), not vibes.

All three missions operate on the §5 FEATURE SET first and the pipeline
second: a finding that doesn't change what the final output does, shows, or
proves is low value.

### Mission A — Criticize (red team)
Personas worth simulating: a robotics/graphics engineer judge (Sony devtech,
Tripo research), a World Labs insider (wants Marble shown at its best), a VC
(market for this?), and a hostile hacker-judge ("is this just A* on a voxel
grid?"). Known attack surface to probe harder:
1. Single world, single capture — does everything hinge on one pano? How bad
   is the story if the demo world misbehaves on-site?
2. The grade stays F even after repair (15k unwitnessed phantoms under the
   uncapped formula). Is `--evidence-tiers` the right story or does an
   F-graded "fixed" world confuse judges? What grade SHOULD a repaired
   outdoor world get?
3. The planner is unproven (no C++ code exists yet) — what is the minimum
   planner demo that is honest and impressive?
4. No real drone, no real sensor loop — is "the drone as evidence collector"
   vapor unless we simulate the camera contradicting the map?
5. Known technical attacks + drafted rebuttals exist for: static scenes,
   3DGS lacking geometric truth, PhysGaussian/unified representations,
   VRAM. Attack the rebuttals.
6. The 42% UNKNOWN number — strength (honesty) or weakness (uselessness)?
   Where is the line?
7. What breaks live? (Survey takes ~17 min — cannot run full on stage;
   the app once wedged on a 15k-defect tail; screenshots choke on the heavy
   splat page.)

### Mission B — Enlarge (what would make this bigger)
Evaluate feasibility × wow for, at minimum:
1. **Multi-view capture**: a second pano collapses the occlusion ring —
   quantify unknown-% reduction; is a two-pano world the killer before/after?
2. **Real-world ground truth (Layer 2)**: Copernicus DEM + OSM vs the
   generated terrain at the real site (coords known) — "certified against
   reality," possibly THE differentiator vs every other Marble project.
3. **Live map healing**: simulated drone camera raycasts the splat world,
   contradicts the flight map, upgrades UNKNOWN cells in flight — the
   information-gain loop made visible.
4. **Frontier-driven exploration demo**: plan a coverage mission that
   maximizes information gain; show unknown-% dropping live on the dashboard.
5. **The repair-lane theater**: before/after crash demo (raw run exists in
   the viewer today).
6. **Multi-robot verdicts** (drone vs rover vs quadruped on the same world) —
   already supported by the certifier; cheap breadth.
7. Others' ideas welcome: what would a Skild/Physical-Intelligence engineer
   want from this? What would make World Labs retweet it?

### Mission C — Refine (scope to a 2-day build)
1. Produce the hour-by-hour event plan: which pipeline stages are rebuilt
   fresh vs consumed as baseline; who builds what (Yuvraj pipeline, Brandon
   planner, third teammate?); integration checkpoints; the cut list ordered
   by "what dies first when behind."
2. The demo script: 3-minute beats, what runs LIVE vs pre-baked (with the
   receipts culture: pre-baked must be reproducible + hashed, and say so).
3. Naming/framing: "Sojourner" story (first Mars rover — a machine that had
   to trust a map made from afar). Tracks to enter. One-sentence pitch.
4. Risk register: Marble credits/app availability on-site, wifi-off
   fallbacks, the 17-min survey (pre-run? reduced-probe live run with
   disclosed detection floor?), team integration risk (C++ planner ↔ JSON/bin
   formats — schema is frozen and documented in the package README).

### Ground rules for all agents
- Respect the constraints in §2 (especially: event code freshness, imagery
  legality, terminology, credits).
- Prefer criticisms with a proposed fix and enlargements with a cost
  estimate. Cite which existing artifact (§3) each idea builds on.
- The error ledger's "carries" lines (E1–E11) are pre-answered lessons — do
  not re-propose what they already settle; build on them.

## 7. Pointers (verify anything here against these)

- Baseline repo: `github.com/YuvrajPuyam/surveyor` (private) — root README
  has quickstart/app/CLI; `docs/code-review-2026-07.md` lists known deferred
  debts; `docs/ENDGAME.md` is the OLD (pre-pivot, habitat-demo) locked spec —
  historical context only.
- Branch `sojourner` (worktree): `sojourner/README.md` charter,
  `sojourner/notes/error-ledger.md` (E1–E11), `sojourner/proof/` images.
- The validated mission package (structure + README with C++ quickstart):
  `assets/marble/7f8eb141-3486-4b39-a546-eb98c47ba351-fixed-package/`.
- Interactive 3D evidence (private artifacts, shareable from their menus):
  overview `claude.ai/code/artifact/0e15aae6-b920-41b4-a1bf-b014fd147070`,
  rampart `claude.ai/code/artifact/5167c9f0-8bf9-44d3-a413-efde5017c712`.
