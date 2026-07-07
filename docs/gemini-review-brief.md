# SURVEYOR — full project brief for external criticism

**To the reviewer:** you are being handed a complete, honest snapshot of a
hackathon project 10 days before its event. Your job is to find flaws —
in the concept, the narrative, the technology, the demo plan, the business
positioning, and the priorities. Be adversarial. We have already run
internal red-teams; do not repeat generic advice ("practice your pitch") —
find the things we are still wrong about. Where we state a number, ask
whether it proves what we claim it proves. At the end, give: (1) your top
5 weaknesses ranked by how likely they are to cost us the win, (2) the
single question a judge could ask that we would answer worst, (3) anything
you would cut, and (4) anything underexploited.

---

## 1. What SURVEYOR is

**An inspection and repair shop for AI-generated 3D worlds.**

AI world generators (World Labs Marble is our reference vendor) export a
world as two files that nobody checks against each other: a photoreal
**Gaussian splat** file (what cameras see) and an invisible simplified
**collider mesh** (what physics touches). Where the two disagree, robots
trained in these worlds inherit the disagreement: a floor can have a
physics hole under perfect pixels (**collider hole**), a wall can exist as
pixels with no physics behind it (**ghost geometry** — a vision policy
trained there learns an affordance that doesn't exist and *no training run
ever crashes to tell you*), physics can exist where nothing is visible
(**phantom collider**), and the entire world can be off metric scale
(silently poisoning every depth label and object-size distribution in a
synthetic dataset).

SURVEYOR runs physical experiments inside the world — seeded probe rain,
virtual LiDAR raycasts, a two-way splat-vs-collider divergence analysis —
and produces:

1. a **certificate**: per-region trust map (confirmed / observed /
   divergent), per-robot pass/fail verdicts, every number carrying an
   uncertainty range and a methods line (the schema makes a naked number
   unrepresentable);
2. a **repaired copy**: scale applied, holes patched (patches re-inspected
   by the same instruments), unrepairable regions quarantined, verified
   spawn points;
3. an **executable training contract**: spawns → reset poses, quarantine →
   no-go masks, friction uncertainty → domain-randomization ranges,
   compiled into NVIDIA Isaac Lab configuration.

Nothing is called a defect unless two independent instruments agree;
nothing is called repaired until the same instruments pass it again.
Named for NASA's 1966–68 Surveyor program, which landed on the Moon to
certify the ground before Apollo risked humans on it.

**One-line pitch:** "World models generate the pixels; SURVEYOR certifies
the physics; Isaac trains the robot — the certificate is the contract
between them."

## 2. The event and objective

- **Event:** "Worlds in Action" hackathon, Los Angeles, immediately before
  SIGGRAPH 2026 (mid-July 2026; today is 2026-07-07). ~28 build hours
  on-site, 3-minute live demo, hostile venue wifi assumed.
- **Tracks entered:** Best Agentic Interface & Systems (primary), Best
  World Models & 3D GenAI (secondary), 3D Reconstruction (opportunistic).
- **Judge panel:** creative-tech heavy (XR, film, generative AI hosts) —
  not primarily roboticists. Sponsors include World Labs ($2,000 API
  credits) and XGRIDS (PortalCam scanner prize).
- **Rules posture:** the certifier core is a public open-source library
  built and disclosed *before* the event (organizer email sent; answer due
  Jul 8); the event app is built on-site. Disclosed twice, on stage with
  pride.
- **Objectives, ranked:** win the primary track; read as serious
  Physical-AI engineering to a hiring audience; seed a real product
  (a neutral trust layer for generated worlds).

## 3. The final output (what we decided actually sells)

We deliberately pivoted from "impressive process" to a holdable artifact —
the **Certified World Pack**, publicly downloadable before judging:

```
artemis-supply-hab-pack/
├── world/            ONE USD file — drag into Isaac Sim, press Play
│                     (NuRec splat visuals + repaired collider with
│                     provenance-tagged patch triangles + SimReady physics
│                     materials + spawn/quarantine prims)
├── dataset/          ~5,000 labeled frames via Replicator — no geometric
│                     poisoning (no ghost-geometry labels, no clipped
│                     cameras, scale-true depth)
├── policy/           trained lift checkpoint + the task video
├── contract/         pip-installable Isaac Lab task:
│                     `--task Certified-Resupply-Rover-v0`
└── certificate.json  the warranty + self-validation appendix (CIs) +
                      SimReady rule report + SHA-256
```

**Hero world:** "Artemis Supply Hab" — a Marble-generated lunar habitat
interior with an open airlock and raised sill onto regolith (indoor =
generator's strong domain; outdoor = the stress case; the sill = the
per-robot verdict moment). **Hero task:** a resupply run — arm loads a
crate onto a rover (recorded in Isaac at 1.62 m/s²), rover delivers it
across the repaired floor, around the quarantined ghost shelf, over the
sill, to a surface depot (live in the browser). **The twin run** opens the
demo: same rover, same route, raw uncertified world — it falls through the
floor within seconds.

**The 3:00 demo (pack-first structure):** 0:00 output first (robot already
working; "download this exact pack now") → 0:25 twin-run failure in the
raw world → 0:55 the instrument (probe rain, trust map painting, grade) →
1:25 agent repair with MISSION LOG (its own reasoning on screen; its
fitted-slab patch FAILS re-inspection, reverts, re-patches — the certifier
audits our own repairs; F→A, 81/81 outcomes) → 2:00 the certificate
compiles into Isaac config, cut to the box-lift footage ("nothing
hand-placed") → 2:40 live delivery + SHA-256 re-hashed on stage matching
the one printed on our Devpost before the event.

## 4. What is BUILT and VERIFIED (with receipts)

**The instrument (headless TypeScript/Node core, 41 tests green):**
- Survey: seeded probe rain + virtual LiDAR grid + two-way divergence;
  the honesty invariant (a fall-through only counts as a hole if an
  independent raycast agrees) is enforced in code.
- Self-validation bench: 27 synthetic worlds, 31 planted defects including
  out-of-taxonomy plants — recall 96.8% (95% CI ≥ 85.6%, exact
  Clopper-Pearson), precision 100% (CI ≥ 90.5%), one disclosed miss.
- Outdoor recalibration: survey judged only inside the splat capture
  envelope. Moon world: 1,053 spurious defects → 89; bench CIs unchanged.
- Grades rank real worlds (station D, habitat/canyon/moon F) instead of
  saturating.
- Determinism: same seed → byte-identical certificate, tested; the Node
  CLI and the browser produce the same SHA-256 (verified this week).
- Scale verification: vendor metadata cross-checked against an independent
  door-height estimate (habitat: vendor ×1.624 vs ours ×1.60); metric
  verdicts are SUSPENDED while a scale defect is unresolved.
- Instrument #3: a monocular-depth audit as an imagery-side cross-check
  (depth used in repair/audit only — never in detection, where a depth
  model's always-hallucinate-a-surface behavior would mask the very holes
  we exist to find).

**The repair agent (real episode, replayable):**
- Claude-driven, closed 11-tool menu, operation stack with revert; on the
  real hero world it went **F → A with 81/81 defect outcomes recorded**
  (fixed / quarantined / accepted), including an ORGANIC fail-and-adapt:
  its fitted-slab patch created a new 0.48 m step, regional re-inspection
  caught it, the agent reverted and re-patched with mesh_fill, which held.
  Recorded as a deterministic replay cassette; the repaired bundle and the
  whole pack rebuild from the repo + cassette alone.

**The app (browser viewer, rehearsed end-to-end this week):**
- Spark splat renderer + Rapier physics; five-beat staged flow; trust map
  painting live; certificate panel with content-hash chip; MISSION LOG
  replaying the agent's reasoning wifi-free; repair plan executing live
  (the fail-and-adapt banner fired organically in rehearsal); before/after
  card explaining why re-measuring at true scale grows the defect count
  (21 → 66); rover delivery run. Full Beat 1→5 rehearsal PASSED.

**The NVIDIA/Isaac lane (Purdue Gilbreth A10 cluster, all receipts real):**
- G1/G2: container + GPU + Isaac Lab 2.3 working headless via
  SLURM/apptainer; compute nodes have no internet (all assets offline).
- G3a: a rigid body rests on the repaired floor at a certificate-verified
  spawn — **PhysX corroborates the Rapier-certified geometry to 1 mm**
  (the cross-engine transfer receipt).
- G3b: Franka pick-and-place inside the pack at lunar gravity — set-down
  **0.3 mm** from the probe-measured surface.
- G3c: the same choreography **captured on camera** — 816 frames, encoded:
  `assets/isaac/g3c-box-lift.mp4` (27.2 s). This took a 16-job debugging
  saga; root cause was a coordinate-frame double-rotation of the camera
  (documented; the physics was never wrong).
- USD pack assembler + validator: ALL RULES PASS (Z-up/units explicit,
  collision APIs, spawns outside quarantine, certificate sha in layer
  metadata). SimReady validator rules run and reported (we never claim
  "SimReady-certified" — no environment profile exists).
- PREFLIGHT CLI: `surveyor certify <bundle> --min-grade B` with exit codes
  and a self-contained report.html.

**Feasibility (externally verified against current docs, sources logged):**
NuRec splat rendering in Isaac Sim is a vendor-blessed path (NVIDIA
published a Marble→Isaac blog); pretrained lift checkpoint verified
downloadable; lunar gravity is one config field; A10s are the only
RT-core GPUs on our cluster and are supported; livestreaming from the
cluster is ruled out (recorded-but-real is the plan, disclosed).

## 5. Terminology discipline (project law)

Never "lying." Regions are **confirmed / observed / divergent**; defects
are **ghost geometry** (visual without physics) and **phantom colliders**
(physics without visuals). The grade "predicts navmesh-level
traversability under the disclosed model class — not policy transfer"
(printed on the certificate). Friction values are assigned priors with
disclosed ranges, not measurements. Recorded demo beats are disclosed as
recorded, with pride.

## 6. Customer & competitive picture (honest)

**Simulated customer discovery** (5 evidence-grounded personas built from
real forum threads — NOT real interviews yet; real ones are a to-do):
- Converted: an indie Marble→Isaac tinkerer (ADOPT — "the eslint of
  generated worlds"), an AMR sim engineer (PILOT — "the repaired copy is
  the product; delete my import-checklist wiki page"; wants
  `surveyor certify --robot her_amr.yaml` in CI and it must find the
  defect she already knows about), an SDG/perception engineer (PILOT —
  verified metric scale ± uncertainty alone justifies integration; scale
  errors poison depth labels and surface weeks later).
- Passed: a locomotion PhD (blind policies never see pixels; wants a
  benchmark, not a tool) and a sim-infra buyer (no generated assets in
  production yet; would convert on a verdict-vs-task-success correlation
  study; prices open-core support at "$12k/yr no-brainer").

**Competitive map:** NVIDIA's own blog imports Marble into Isaac by hand
with zero verification (validates the pipeline, removes integration
novelty — the certification layer is the only part they don't have).
Niantic Scaniverse now ships phone-scan → "simulation-ready" USDZ with an
auto-generated mesh — capture-to-sim transport is commoditizing, with no
metric scale, no materials, no per-robot verdicts, no repair, no
verification. NVIDIA SimReady Foundation open-sourced machine-checkable
asset validation rules — generic checks are commoditized; our defensible
layer is splat-specific fidelity, per-robot task-conditioned verdicts, and
audited repair. GaussGym (Berkeley) owns pixels-to-locomotion training in
splat worlds — we certify worlds, including theirs. NVIDIA Cosmos
generates *video* worlds; in NVIDIA's own architecture Omniverse holds
physics ground truth and Cosmos paints video on top — receipt line:
"Cosmos dreams worlds; SURVEYOR decides whether a robot may move in, and
signs the certificate."

**Position:** the more vendors ship unverified "sim-ready" worlds, the
bigger the market for a neutral third-party verifier (a vendor grading its
own output is marketing, not metrology). Verification demand rises as
generation gets cheap, because scale is exactly when humans stop looking.

## 7. Known weaknesses (we know; judge us anyway)

1. **The hero world cannot truthfully speak the marquee sill line.** The
   rover-fails/quadruped-passes contrast exists on a bench world but NOT
   on the current hero (its worst step fails both robots). Fallback
   (pre-committed): Beat 3 uses the hole+ghost contrast + the
   verdict-suspension line; the sill contrast waits for a generated hero
   world specced to carry it — which is currently BLOCKED (see next).
2. **Hero fishing is blocked on credits plumbing:** Marble app credits and
   API credits are separate wallets; the API wallet is empty. Unblock =
   user generates 2 worlds in the app (staged, ~5 min) or funds the API.
3. **No downstream-correlation study yet.** The single artifact every
   internal judge and simulated customer demanded — "does the grade
   predict task success?" — does not exist. Planned at small n on the
   cluster; until then the certificate's claim is deliberately bounded.
4. **The box-lift video shows a collider-gray world** (the NuRec splat
   conversion — the pack's photoreal visuals inside Isaac — is still
   pending; it's the one missing pack artifact). Camera is also a tight
   ~24° telephoto; composition could be improved.
5. **Customer discovery is simulated, not real.** Zero human interviews
   logged. The interview guide and venue list exist.
6. **Self-validation is self-authored.** CIs and out-of-taxonomy plants
   mitigate; a human-labeled real-world bench does not exist.
7. **Single-vendor input dependency** (Marble) for generated worlds,
   though the ingestion is format-generic and a scanned-world control
   (rustic-kitchen) is planned as the neutrality beat.
8. **The agentic-track exposure:** the live in-app repair is a scripted
   plan executor; the real agent episode is replayed (disclosed as
   RECORDED REPLAY). Anti-agent-washing framing is our choice; a judge
   may still discount it.
9. **Gate B (rules permission) is unanswered as of Jul 7**; deadline
   Jul 8 EOD. On "no"/silence a pre-committed 28-hour-only contingency
   scope fires.

## 8. Next steps (locked queue)

**Cluster lane:** G4 — pretrained Isaac Lab lift checkpoint running in the
pack at lunar g (wow-layer over the scripted run; fine-tune ≤300 iters if
floaty). G5 — Replicator dataset (~5,000 labeled frames) masked to
verified free space (known landmine documented: the Replicator
orchestrator hangs headless; camera-sensor path only). NuRec .usdz
conversion (splat visuals into Isaac; also fixes the gray movie).
Optional: N≈10–20 paired nav goals raw vs repaired (the small-n receipt).

**App/demo lane:** splice the box-lift MP4 into Beat 5′; hero-check any
new worlds (`the certificates pick the hero` — a world is the hero only if
a validated twin-run failure route derives mechanically); 2+ timed dress
rehearsals; Devpost with the pack download + printed SHA-256.

**User lane (deadlines):** rules answer Jul 8 EOD; generate the two
NASA-photo worlds (Mars Jezero, Apollo Station 6) in the Marble app and
hand over world IDs; a foreground-browser fps number for the demo laptop;
3–5 REAL customer conversations; confirm the organizers' open-source
World Model Unity Kit applies to this edition (a certificate-overlay in
the judges' own tool is staged as a judge-alignment beat).

**Explicitly cut:** full Mission Control UI chrome, drivable first-person
mode, PR-review UI shell, ONNX-in-browser sim2sim, Mars flourish, MCP
stage time, live cluster streaming, any further instrument tightening
beyond what the pack needs.

## 9. Questions we want your hardest answers on

1. Where does the narrative overclaim relative to the receipts in §4?
2. Is the pack-first demo structure right for a creative-tech judge panel,
   or does it bury the visual wow too late/early?
3. Is "the certificate is the contract" defensible against "the generators
   will just get better" — and where is that argument weakest?
4. Which §7 weakness would you attack first from a judge's seat, and
   what's the least-cost mitigation in 10 days?
5. Is there a stronger final artifact than the Certified World Pack given
   the same components?
6. What are we not seeing because we're too close to it?
