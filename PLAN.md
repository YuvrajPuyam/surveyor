# SURVEYOR — execution plan
### Worlds in Action Hack [02-LA]: SIGGRAPH Edition

> **The product in one paragraph.** A browser tool where you load an AI-generated
> 3D world and an AI agent walks through it, physically tests it, and produces two
> things: a **certificate** saying which parts of the world are trustworthy and
> which parts are fake, and a **repaired copy** with the problems fixed — ready
> for training robots in simulation. Generated worlds look perfect but are often
> physically broken (floors with holes in the physics, painted-on doors, wrong
> scale), and today nobody checks. Surveyor is the inspection and repair shop.
> Named after NASA's 1966–68 Surveyor program, which landed on the Moon to certify
> the ground before Apollo risked humans on it.

**Status (2026-07-04):** concept chosen after two ideation tournaments, a 5-idea
validation round (15 research agents), and a deep feasibility round (6 probes +
2 red-teams). This file is the single execution document. It supersedes
`D:\laplace\docs\HACKATHON_PLAYBOOK.md`.

---

## 1. The event

- **What:** 2-day hackathon in Los Angeles, immediately before SIGGRAPH 2026.
  Hosts: SensAI Hackademy, Poeia XR, Machine Cinema, FBRC.AI, AI LA.
  Sponsors/prizes: $10K pool, $2,000 World Labs API credits (land ~**Jul 14**),
  XGRIDS PortalCam, SIGGRAPH tickets.
- **Constraints:** ~28 real build hours on-site; 3-minute live demo; hostile
  venue wifi (assume nothing works — phone hotspot + offline replay mandatory).
- **Tracks we enter:** Best Agentic Interface & Systems (primary),
  Best World Models & 3D GenAI (secondary), 3D Reconstruction (if the scan beat
  is included).

## 2. Why this project (the priors it satisfies)

Decision function, ranked: (1) world-models & splats line; (2) **career signal**
— reads as Physical-AI engineering to a hiring audience; (3) **startup seed** —
nameable buyer; (4) max ONE unproven bet, gated early; (5) worlds must behave,
not just display; (6) product over stage; (7) unsaturated; (8) browser-first,
deterministic; (9) no destruction themes.

- **The nameable user:** robotics engineers importing generated worlds into
  NVIDIA Isaac Sim. NVIDIA's own tutorial tells them to validate scale by hand
  against a reference cube and drive a robot around to test the floor. Surveyor
  automates that documented manual ritual.
- **The career sentence:** "I built the trust layer for generated worlds — an
  agent that designs and runs physical experiments in a 3D world and reports
  verified numbers." (The Laplace thesis on a new substrate.)
- **Space framing:** the stress case for a general tool, not the scope. Space is
  where synthetic data isn't cheaper — it's the only option (the Mars base
  doesn't exist to photograph), and where you cannot test at destination
  gravity, so the experiment is the only ground truth. Earth is the product
  default; the Moon/Mars beats are the demo's flavor.

## 3. The two-file insight (how the whole thing works)

Every Marble world exports as two files:
- the **splat file** (`.spz`) — photoreal visuals, millions of colored 3D blobs;
- the **collider file** (`.glb`) — an invisible simplified physics shell (floors,
  walls as solid surfaces) that robots actually collide with.

Nobody verifies the two files agree. A wall can exist in the visuals with no
physics behind it; a floor can have a physics hole under perfect pixels. Every
Surveyor feature is some form of *measuring, exposing, or repairing the
disagreement between these two files* — plus scale, which the vendor ships as
metadata almost nobody applies.

## 4. What we build (all feasibility-confirmed)

1. **Viewer** — browser page: Spark (World Labs' open-source Three.js splat
   renderer) draws the visuals; Rapier (physics engine, WebAssembly) loads the
   collider. Deterministic fixed-timestep; physics in a Web Worker.
2. **Lie detector** — seeded probe rain (thousands of small physics bodies) +
   virtual-LiDAR raycasts. Output: the **trust map** painted onto the world —
   green *verified*, yellow *observed-only*, red *lying*. Every "lying" region is
   confirmed by raycast cross-check so engine tunneling can never masquerade as
   a collider hole.
3. **Metrology** — floor-plane fit, occupancy grid, floor-plan extraction,
   doorway/clearance measurement, splat-vs-collider divergence, scale estimate.
   **Every number carries an uncertainty range and a methods line.** Never raw
   centimeter claims.
4. **Two robot specs, per-robot verdicts** —
   - *Wheeled rover:* Rapier's built-in raycast-vehicle controller (suspension,
     engine, brakes — no hand-rolled physics). Certificate discloses the model
     class: rigid-body vehicle, Coulomb friction, no soil mechanics.
   - *Quadruped:* an honest **kinematic capability envelope** (footprint, max
     step height, max slope — anchored to ANYmal's published spec). Never
     animated, never implies gait simulation.
   - Demo verdict moment: the raised airlock sill **fails the rover, passes the
     quadruped**. Same world, two verdicts — sim-readiness is relative to the
     robot.
   - **Deployment payoff beat (live, closes the arc):** once re-certification
     passes, the rover spawns at a verified spawn point and autonomously runs a
     waypoint patrol on the certified navmesh — visibly driving OVER the
     patched floor and routing AROUND the quarantined zone. The certificate
     becomes observable robot behavior. Honest on-screen label: "navmesh
     waypoint-following" (no SLAM/vision claims — the Isaac clip carries the
     full-nav-stack evidence). Fallbacks in order: presenter-driven manual run
     → replay cassette. Cost: ~0.5-1 day (path-following controller; navmesh
     pathfinding and vehicle already exist).
5. **Repair pipeline** (no Marble cooperation required) —
   1. *Scale & alignment:* apply the vendor's own `metric_scale_factor` +
      ground-plane metadata (shipped with every world, rarely applied); rotate
      upright; floor to zero. Cross-check against door-height priors; disagree →
      certificate says so.
   2. *Hole patching:* offline Python (pymeshfix; Blender voxel remesh as
      sledgehammer) or proxy-collider insertion (invisible slabs fitted to splat
      density where visuals show surface but physics has none). Choose after
      inspecting real colliders (Day 2). No in-browser mesh surgery (only
      candidate lib is GPL — license poison).
   3. *Quarantine:* visual lies (painted-on door) are **excluded from the
      robot's allowed area**, not guessed at — roped off so no training episode
      touches the lie. Certificate marks "quarantined."
   4. *Spawn points:* recast-navigation navmesh with per-robot parameters
      (radius, height, maxClimb, slope) → verified spawn locations.
   5. *Export + re-certify:* corrected bundle (splats + fixed collider +
      certificate JSON + spawns) → full inspection reruns → before/after grade.
   - *Escalation without editing:* regenerate-and-replace via the public API
     (~$1.20/world) with an adjusted prompt; discard-and-retry is legitimate
     repair at these prices.
   - **Full scoped spec of the agentic repair loop: see §15 (appendix).**
6. **Gravity suite (corrected physics — see §6)** — one-click re-certification
   under Moon/Mars gravity showing honest deltas AND honest non-changes.
7. **Two agents on stage** (Mission Planner CUT — both red-teams: agent-washing) —
   - *Surveyor agent:* a scripted coverage sweep runs first (shown as ablation);
     the agent directs only the marginal probe budget via semantic hypotheses
     from rendered views ("that sill looks like a step; that door may be
     texture-only"). Interpretation is the wedge, not allocation.
   - *Repair agent:* diagnoses (mis-scaled world vs. genuinely raised sill?),
     picks the fix, re-certifies. **The demo includes one repair that fails
     first and visibly adapts** — first-try success reads as a script.
   - Hard rule (from Laplace): *agents never assert a number a tool didn't
     measure.* Tools measure; agents decide what to measure and interpret.
8. **Certifier self-validation** — 3–5 synthetic worlds with planted defects
   (known hole, 2× scale error, phantom wall, mis-height sill); certificate
   appendix reports our own detection precision/recall. Answers "who certifies
   the certifier?" in one sentence.
9. **MCP server + replay cassette** — the certify core runs headless in Node,
   exposed over MCP (pinned SDK v1.x — do NOT chase the v2 spec finalizing hack
   week), demoed from Claude Desktop over localhost (wifi-immune). Every run
   recorded as a JSONL trace keyed on (episode-id, call-index) — images
   content-addressed, clocks frozen, **never keyed on screenshot bytes** (WebGL
   differs across GPUs — byte-keyed caches fail silently at the venue). Replay
   is simultaneously the dead-wifi fallback, the deterministic demo mode, and
   the eval artifact. Rehearse on a second machine.

## 5. Pre-recorded evidence (real, not live)

- **Isaac receipt clip (~10s picture-in-picture):** same world in NVIDIA Isaac
  Sim on the Gilbreth cluster — Nav2 navigation stack, N≥20 paired goals, raw
  world vs repaired bundle, success rates on screen. Caption defines the "raw"
  condition, goal count, localization mode; logs published. Stock components
  (carter_navigation, Occupancy Map Generator, isaac_ros_navigation_goal); ROS2
  Humble, not Jazzy. Two cluster evenings, hard-capped (gates in §8).
- **Perseverance Mars world (~25s flourish):** a real NASA Mastcam-Z panorama →
  scripted conversion (they're cylindrical strips, −70°…+10° elevation — must be
  padded into a true 2:1 equirectangular with synthesized sky/nadir, ~2560px) →
  Marble panorama input → explorable Mars terrain, pre-generated, pre-certified,
  cached. **Never "certified live"** (5-min generation vs 3-min slot). The
  coarse-terrain collider moment is scripted ON PURPOSE as the trust map
  catching visual-only rocks — the risk is the thesis. Fallback: text-prompted
  Mars terrain. This conversion recipe is the plan's ONE sanctioned unproven
  bet (Gate E).

## 6. Physics corrections — never regress on these

- **The old claim is false:** "max climbable slope drops on Mars because
  traction scales with gravity." Under Coulomb friction the slope limit is
  atan(μ) — **gravity cancels** (traction μ·m·g·cosθ vs pull m·g·sinθ), and
  Rapier's traction clamp enforces exactly this. In the torque-limited regime
  the effect *reverses*. Real Mars rovers are slope-limited by loose soil, and
  even there the gravity effect is 5–10%.
- **Defensible gravity beats (these DO emerge in the engine):** stopping
  distance ≈2.6× longer on Mars (deceleration is μ·g); cornering slide-out and
  tipover at √g-scaled speeds; crest airtime at ~0.6× Earth speed; taller
  suspension ride height; slow ballistic probe arcs.
- **The certificate prints "unchanged under Mars gravity"** beside slope,
  static tipover, and reachability verdicts — the instrument knowing what
  gravity does NOT touch is the credibility moment.
- **The falsification beat is the new Act-2 centerpiece:** a bare LLM
  confidently guesses traction scales with gravity → Surveyor runs the
  experiment → the certificate corrects it. The whole product thesis in one
  shot. (Optional: a slope verdict may flip ONLY via a disclosed regolith-slip
  model calibrated to parabolic-flight data, and Earth↔Moon (20%+ effect), never
  Earth↔Mars (invisible). Yuv's call — see §11.)

## 7. Roadmap-only (talk with evidence, don't build)

- **Marble edit-writeback:** editing is app-only — the public API has zero
  edit/expand endpoints (verified against the OpenAPI spec). Roadmap line with
  teeth: the backend schema exposes inpaint-pano types the public endpoint
  doesn't accept — "we adopt it the day they ship it."
- **Chrome app-driving experiment:** an agent operating the Marble web app to
  perform edits (computer-use). One timeboxed evening (~Day 6–8), recorded, ToS
  checked first. If it works: a 15-second honest bonus clip + sponsor
  conversation ("here's the trace — can we have the endpoint?"). Never live,
  never load-bearing.
- **Warp GPU probe batching** (warp.sim deprecated; Newton too young — 1–2 day
  post-event item), **fleet certification factory** ("50 certified worlds" —
  plain pipeline script may make an N=5 gallery post-credits as backstage
  evidence), **WebMCP** (origin-trial only — cut).
- **Real-robot deployment (post-hack crown jewel):** certify a world scanned
  from a real space, train/evaluate a nav policy in it, deploy on physical
  hardware — the EmbodiedSplat-validated real→sim→real path (<10% transfer
  gap in the literature). Portfolio chapter, not a hackathon beat.

## 8. Ten-day pre-event plan (with dated gates)

Written for lead + one; extra teammates get generalist lanes (curation, Devpost,
video, rehearsal ops). Pre-event work = disclosed public open-source *library* +
content + science; the event *app* is written on-site.

- **Day 0 — Fri Jul 4 (today):** email organizers the written rules question
  (deadline Jul 8); strike the two falsified claims (gravity-traction slope,
  edit-writeback) from all documents; commit cut ladder + kill criteria as dated
  commitments; pre-write the 28-hour-only contingency scope; buy first $5 of
  Marble credits; kick off free-tier habitat generations tonight.
- **Day 1 — Sat Jul 5:** **GATE A (performance):** 100k-tri trimesh + 2,000
  probes in a Web Worker on the actual demo laptop — target 60fps, floor 30fps
  (fail → wave-batched probes ≤300, decimated colliders; parameters change,
  architecture doesn't). **GATE D1:** does a $0.12 draft world ship a collider?
  Kick off 3–5 standard habitat test worlds (one prompted WITH a raised airlock
  sill). Start the Mastcam-Z panorama conversion script.
- **Day 2 — Sun Jul 6:** science only (rules-safe): verify collider/splat share
  a coordinate frame; measure vendor scale metadata accuracy vs hand-measured
  door heights (**GATE D2**, decide Jul 7). Iterate panorama recipe on $0.12
  drafts. Write schemas: trace format, tool API, certificate (mandatory
  uncertainty-source fields), Act-2 verdict formulas.
- **Day 3 — Mon Jul 7:** metrology prototypes on free assets (throwaway code):
  RANSAC floor fit, occupancy, clearance sweeps, divergence. Finalize Act-2
  re-spec. Panorama iterations continue.
- **Day 4 — Tue Jul 8:** **GATE B (rules answer due).** Yes → init public repo
  (MIT/Apache), port prototypes: ingestion + probe engine v1. No/silence →
  execute contingency scope TODAY; don't build on hope.
- **Day 5 — Wed Jul 9:** probes to production (seeded rain, virtual LiDAR, CCD +
  raycast cross-check, trust-map binning). **Evening — GATE C (Isaac, 30 min):**
  container ≥5.0 on a gilbreth-h A10 node, sample kitchen PLY→USDZ, render one
  frame. Book both receipt evenings now (A10 contention is the real risk).
- **Day 6 — Thu Jul 10:** Repair Tier 1: apply vendor scale/ground metadata,
  bake transform (gltf-transform; mind OpenCV-convention sign flips), navmesh +
  spawn points, bundle export (NASA + "Generated using World Labs" attribution
  in the template). Choose hole-patch path after inspecting real colliders.
- **Day 7 — Fri Jul 11:** rover tuning, quadruped envelope, gravity-honest
  verdict suite, waypoint-following controller for the deployment payoff beat,
  certificate page (methods line under every number).
  **GATE E (panorama):** acceptable Mars terrain world by EOD (~10 drafts + 2
  standard runs allowed) or Act 3 falls back to text-prompted terrain and the
  Perseverance pipeline becomes a slide.
- **Day 8 — Sat Jul 12:** agent layer: tool API, Surveyor/Metrologist/Repair
  prompts, hero episode trimmed to 8–12 calls (numbers-not-pixels returns, 640px
  views, prompt caching from the first call). MCP end-to-end from Claude
  Desktop. Trace record/replay working. Evening reserved as the single permitted
  Isaac rebuild if Gate C failed.
- **Day 9 — Sun Jul 13:** content lock: hero worlds curated (sill verified by
  probes, not eyes); hand-verified scale on every hero world; self-validation
  suite built; Mars/Moon re-certification precomputed (a toggle on stage, never
  live compute).
- **Day 10 — Mon Jul 14:** credits land — read the API addendum first. Confirm
  headcount (kill criterion below). **GATE F:** one timeboxed day for the
  metric-depth cross-check spike. **GATE G:** one regeneration round-trip test
  (promote-only; default trajectory). Batch extra worlds on credits. Rehearse
  replay on a second machine.
- **Tail (Jul 15 → event):** Isaac evening #1 (import frozen bundle, occupancy
  map, Nav2 up); evening #2 (N≥20 paired goals, per-goal logs, record the clip).
  **GATE H — hard stop Jul 18:** no completed paired run → receipt becomes the
  bundle-download beat + NVIDIA-tutorial citation. SimReady CLI only if Isaac
  survived. Freeze assets/cassettes. ≥2 full dress rehearsals pre-event.

## 9. Event plan (28 hours)

H0–2 on-site repo + app shell consuming the published library; verify hotspot +
caches; assign lanes. H2–9 app UI (viewer, trust map, certificate, repair flow).
H9–14 agent choreography on the hero world (fails-then-adapts repair rehearsed;
cassettes recorded per beat). H14–18 gravity toggle (precomputed), robot spec
cards, Act-3 flourish + receipt PIP, full MCP run-through. **H18–20 REHEARSAL #1
with timer — features get cut, rehearsal time never does.** H20–23 backup video
off the working app; Devpost draft early. H23–26 REHEARSAL #2 offline/replay on
hotspot; REHEARSAL #3 vs hostile-judge teammate ("where's that error bar from?",
"why didn't slope change?", "hole or integrator artifact?"). H26–28 freeze,
submit. Nothing new after H26.

## 10. Kill criteria (pre-committed; fallback fires same day)

| Date | Gate | On failure |
|---|---|---|
| Jul 8 EOD | Rules: no written permission | 28-hour-only contingency scope |
| Jul 5 EOD | <30fps after fallbacks | Probes in waves ≤300; heightfield terrain |
| Jul 5 | Draft worlds ship no collider | Dev on standard tier; ≤12 pre-credit worlds |
| Jul 7 EOD | Vendor scale >30% off on 3/5 worlds | "Auto-rescale" → "scale verified, flagged"; hand-verified heroes |
| Jul 9 / Jul 12 / **Jul 18 hard** | Isaac gates | Receipt → PhysX waypoint harness honestly labeled, or citation+bundle beat |
| Jul 11 EOD | Panorama recipe fails | Text-prompted Mars terrain; recipe published as slide |
| Jul 14 EOD | Depth check >20% median error | Cross-check → roadmap slide |
| Jul 14 | Team = two people | Act 3 → cached flythrough; SimReady → slide; no stretch items |
| Dress rehearsal / H18–20 | Live episode >90s | Record-decisions / execute-tools-live split |
| H18–20 | Rehearsal over 3 min or crash | Cut order: Act-3 flourish, then gravity → video |

## 11. Open decisions (Yuv only)

1. Headcount confirmed by Jul 14 (plan assumes lead+one).
2. Rules email sent? Accept the contingency on "no"/silence?
3. Cluster evenings committed? Isaac receipt vs depth spike priority on collision?
4. Budget ceiling: $25 or $45 (realistic need ~$30–42)?
5. Exact event date/check-in; demo laptop + external display; second rehearsal machine?
6. The Moon trade: flip one slope verdict via disclosed regolith model
   (Earth↔Moon, visible) at cost to pure-Mars narrative — or dynamics-only?
7. Final wording: "certified" vs "measured under a disclosed model class" (README-grade claims are Yuv's call).
8. Demo-day Anthropic API key tier; hero episode on Sonnet-class vs Haiku-class (latency vs narration).

## 12. Budget

~$28 lean / $38–42 realistic / $45 cap, personal, pre-credits: $5 (Jul 4–5:
draft-collider check + ~35–40 panorama iterations at $0.12) + $15 (~Jul 6: test
worlds + hero candidates) + $10 optional (Jul 10–13: Perseverance candidates,
regen test, depth-pano calls capped $3) + $8–12 LLM dev spend (caching on from
line one) + $0 cluster + $0–10 hotspot. Free tier (4 generations) used first.
The ~$64 fifty-world batch: post-credits only.

## 13. Rules hygiene & attribution

- Public repo from Day 4 (MIT/Apache, dated commits, README: generic world-survey
  library). Event app written on-site, timestamped public commits from hour zero.
  Disclose twice: organizer email now, one pitch sentence on stage. Never rebase
  pre-event commits into the event window.
- NASA: credit "NASA/JPL-Caltech/ASU/MSSS" for source panoramas; no NASA
  insignia near AI imagery; generated worlds labeled AI-derived (per NASA media
  guidelines, outputs attributed to the AI product, not NASA).
- "Generated using World Labs" on every public asset; read the hackathon credits
  addendum before publishing anything made with event credits.

## 14. Reference facts (verified)


Marble API: self-serve, $1.00/1,250 credits, $5 min. Panorama world: $1.20
(marble-1.1) / $1.20–2.40 (1.1-plus, outdoor-capable) / **$0.12 (draft)**.
Async ~5 min. Outputs: SPZ splats (100k/500k/full) + collider GLB (~5k polys for
a room) + panorama + caption + **metric_scale_factor & ground-plane metadata**.
Editing: app-only, NOT in public API. Colliders: known "robot falls through
floor" failure class; −90° X rotation quirk; interiors strong, outdoor terrain
weak (their own robotics case study lists outdoor as future work). Free assets:
~41 sparkjs.dev sample splats; NVIDIA-tutorial rustic-kitchen SPZ+GLB pair.
Mastcam-Z: 52 public 360° Jezero panoramas (cylindrical, need padding), free
with credit. Rapier: DynamicRayCastVehicleController (built-in),
KinematicCharacterController. recast-navigation-js: active, per-agent navmesh
params. SimReady validator: pip-installable, USD-only, prop-scoped profiles —
scope to cherry-picked capabilities; never say "SimReady-certified."

---

## 15. Appendix — the agentic repair loop (scoped specification)

**Design principle:** the agent chooses from a CLOSED MENU of reversible,
deterministic repair operations; every action is verified by re-inspection
before it counts. The agent never edits geometry directly — tools operate,
the agent diagnoses, chooses, and adapts. This is what makes the loop
buildable in ~3 days, safe on stage, and honest in the Agentic track.

**The loop (per defect):**
CERTIFY → DIAGNOSE → PLAN → ACT → RE-CERTIFY (regional) → pass → next defect;
fail → REVERT + ADAPT (max 2 attempts) → exhausted → QUARANTINE or ESCALATE.
Every defect ends in exactly one recorded outcome: **fixed / quarantined /
escalated / accepted** (accepted = the agent concludes the finding is correct
as-is, e.g. a genuinely narrow doorway). Guaranteed termination; no defect
silently dropped; the certificate lists the outcome per defect.

**The complete tool menu (9 tools — the entire action space):**
READ: `get_certificate()` (structured defect list + evidence);
`inspect_region(defect_id)` (rendered views + splat-density-vs-collider stats);
`query_measurement(...)`.
ACT (deterministic, parameterized, reversible):
`apply_vendor_scale()` — apply Marble's scale metadata + ground alignment, bake
transform; `patch_hole(id, method)` — method ∈ {fitted_slab (invisible plane/box
fitted to splat surface), mesh_fill (offline Python watertight repair)};
`carve_opening(id)` — remove collider ONLY where visuals show opening AND probe
evidence supports passage (conservative, rarest tool); `quarantine(id)` —
exclude region from navmesh, mark certificate; `rebuild_navmesh_and_spawns()`;
`revert(action_id)` — repairs live on an operation stack; `recertify(scope)` —
regional (seconds, keeps the live loop fast) or full (end of session).

**The diagnosis fork (the genuinely agentic beat):** symptom "doorway 0.44m —
fails rover clearance" has three root causes with three different correct
actions: (a) global mis-scale → check door heights everywhere + vendor
metadata → `apply_vendor_scale()` fixes dozens of defects at once; (b)
genuinely narrow door → correct action is NO action, verdict stands; (c)
collider intrudes on a visually-open doorway → `carve_opening()`. The agent
picks the discriminating measurement first, then acts. One symptom,
evidence-driven fork, three tools — experiment-design reasoning on stage.

**The rehearsed fail-and-adapt beat:** fitted slab patches a floor hole →
regional re-certify reveals the slab juts into the adjacent doorway (new
clearance failure) → agent reads evidence, `revert()`, retries with
`patch_hole(mesh_fill)` → passes. Real system behavior, deliberately surfaced
on a hero defect chosen because it exhibits this; recorded as a replay
cassette. First-try success reads as theater; recovery reads as engineering.

**Scope fence:** IN — all of the above + the escalation DECISION (agent
recommends regeneration with an adjusted prompt; a pre-event example of a
regenerated-and-passed world is shown; the live demo never waits out a 5-min
generation). OUT (roadmap slide, stated) — Marble content editing (API gap
quoted), Chrome app-driving experiment, batch fleet repair.

**Build cost:** act-tools ~2 days (Day 6; primitives shared with certify);
agent loop + prompts ~1 day (Day 8); fail-adapt choreography + cassette ~0.5
day (Day 9/event). Live demo slice: ONE defect end-to-end live (~45-60s
including the failed attempt); everything else precomputed; cassette fallback.

**Pitch line:** "A closed-loop agentic system: the agent hypothesizes, acts
through a bounded tool set, and an independent physical instrument audits every
action before it counts — the same certifier we test against planted defects.
Every defect in every world ends in one of four audited outcomes."

---

## 16. Appendix — user flow (screen by screen)

1. **Load:** paste a Marble world ID (fetches the splat + collider files) or
   drag-and-drop. Pick robot spec (rover / quadruped presets, or custom:
   footprint, height, step-over, slope, camera height). Pick gravity
   (Earth default; Moon/Mars toggle).
2. **Meet the world:** walk/fly the photoreal world. Toggle **"show physics
   shell"** — wireframe overlays the visuals; the user SEES the two files
   disagree. (The premise, demonstrated before a word is spoken.)
3. **Survey:** three visible phases — (a) systematic sweep: agent capsule
   explores, floor plan draws itself; (b) seeded probe rain: contact tint =
   green, fall-through trails = red; (c) agent-directed probing with live
   reasoning log ("that sill looks like a step — measuring"). Trust map paints
   in real time: verified / observed-only / lying.
4. **Certificate:** grade + defect count; scale with error bars and methods
   line; floor plan with measurements; per-robot pass/fail rows (rover ✗ at
   sill, quadruped ✓); clickable defects (camera flies to evidence, replays
   the probe falling through); self-validation appendix (our precision/recall
   on planted defects).
5. **Repair:** agent proposes a plan in plain language (scale fix, patches,
   quarantine, spawns); user approves; watches it execute — including one fix
   that fails re-inspection and adapts (§15).
6. **Re-certificate:** survey reruns automatically; before/after side by side
   (C− → B+).
7. **Gravity flip:** Mars re-certification — braking/tipover numbers change,
   slope/reachability print "unchanged under Mars gravity"; the bare-LLM
   falsification panel.
8. **Deploy + export:** rover spawns at a verified point, patrols the certified
   navmesh (over the patch, around the quarantine); download the sim-ready
   bundle + Isaac import instructions, or share the certificate link.
9. **Second front door (MCP):** from Claude Desktop — "certify world X for a
   Go2-class robot" → same engine headless → grade, worst defects, bundle path.

Demo = this flow compressed: steps 2–6 + 8 on the hero habitat (~100s), step 7
(~45s), Mars flourish (~25s), Isaac receipt PIP (~10s), close (~10s).

## 17. Appendix — judge Q&A prep

**Q: "Why do you need Marble / World Labs at all?"**
Stage answer: *"Because a generated world has no original. A scan can be
checked against the real room — it exists. A generated world exists nowhere;
running physics experiments inside it is the only ground truth it can ever
have. And Marble is the only commercial world model that ships physics with
its worlds — the first generator whose output CAN be certified."*
Backing layers: (1) generated worlds are the only world source that scales and
the only source for places that don't exist yet; (2) $1 worlds consumed by
automated pipelines = no human QA in the loop = automated inspection becomes
mandatory; (3) the splat+collider two-file architecture creates exactly the
silent-disagreement failure class we certify; the API also powers repair
escalation (regenerate-and-replace). Judo on "your tool works on any 3D file":
agree — neutrality is what makes a trust layer credible; the scanned room is
our control group.

**Q: "What if Marble's output is already sim-ready?"**
Stage answer: *"That's an empirical question — nobody had measured it before
us. We did. [Corpus numbers.] But take NVIDIA's word, not ours: their official
import tutorial tells you to hand-check scale against a reference cube and has
a troubleshooting section literally titled 'robot falls through floor.' If the
output were sim-ready, that page wouldn't exist."*
Backing: vendor's own scale metadata must be applied; World Labs' case study
lists the gaps as future work; SimReady categories fail by construction (no
semantics/materials/articulation); ~5k-poly collider vs millions of splats =
divergence is structural; sim-readiness is robot-relative (the sill verdict)
and Marble revs monthly (moving target). Judo: *"if worlds become perfect,
Surveyor is how anyone knows — the certificate becomes the vendor's proof.
Aviation is the safest transport on Earth and every aircraft is still
inspected: stakes, not failure rates, justify the check."*

## 18. Appendix — team onboarding summary (paste-ready)

The event: 2-day hack in LA before SIGGRAPH, sponsored by World Labs (Marble:
photoreal 3D worlds from a prompt/photo) and XGRIDS. $10K pool + API credits;
~28 build hours; 3-minute live demo.

The project: **SURVEYOR — an inspection and repair shop for AI-generated
worlds.** Marble worlds look perfect but ship as two files — pretty visuals +
an invisible physics shell — and nobody checks whether they agree (floors with
physics holes under perfect pixels; painted-on doors). Robotics teams are
starting to train robots in these worlds; NVIDIA's official import guide makes
engineers check everything by hand. We automate that: a browser app where an
AI agent inspects a world (probe rain, color-coded trust map, measurements
with error bars), grades it pass/fail FOR A SPECIFIC ROBOT, repairs it (scale
fix, hole patches, quarantining the lies), re-inspects, and exports a
sim-ready bundle — closing with a rover autonomously patrolling the world it
just fixed. Space flavor: a Mars world generated from a real NASA Perseverance
panorama, and re-certification under Mars gravity with honest physics. Named
for NASA's 1966 Surveyor probes, which certified the Moon before Apollo.

Why this: validated by deep research (prior art / feasibility / demand) —
unclaimed niche, every component confirmed buildable, real buyer (robotics sim
teams), fully-offline demo (venue wifi can't kill us).

Logistics: ~10 prep days building the disclosed open-source core (rules
question filed with organizers), app built on-site; ~$30–45 personal API spend
before free credits land Jul 14; day-by-day plan with go/no-go gates — this
document.

Needed from each teammate: confirm you're in; state your comfort zone
(TypeScript/Three.js · Python · agent/LLM work · content + demo ops); block
the event weekend + a few evenings the week before.
