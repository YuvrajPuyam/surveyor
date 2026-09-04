# SURVEYOR — external review brief

**You are reviewing a hackathon project. Be adversarial.** Attack the concept,
the technology, the narrative, the market logic, and the demo plan. Assume the
builders are too close to it. Everything below is honest, including known
weaknesses. Today is ~July 7, 2026; the event is in ~11 days.

---

## 1. What the project is

**SURVEYOR: an inspection and repair shop for AI-generated 3D worlds.**

World models (World Labs **Marble**) generate photoreal 3D worlds in minutes
for ~$1.20. Each world ships as two files nobody checks against each other:

- a **splat file** — photoreal visuals (millions of colored 3D gaussians)
- a **collider file** — an invisible simplified physics shell robots touch

Where they disagree you get **ghost geometry** (visible walls with no physics)
and **phantom colliders** (physics with nothing visible). A floor can have a
physics hole under perfect pixels. A robot trained in such a world learns
things that are false — and for vision policies, *no training run ever
crashes to reveal it*. Nobody in the ecosystem verifies this today: NVIDIA's
own Marble→Isaac Sim tutorial says to hand-scale the world against a
reference cube and eyeball the alignment.

Surveyor runs **physical experiments inside the world** — thousands of seeded
probe drops, virtual-LiDAR raycasts, a two-way visual-vs-physics divergence
analysis — and produces:

1. a **certificate**: grade, per-robot pass/fail verdicts (the same 0.15 m
   sill fails a small rover and passes a quadruped), every number with an
   uncertainty range and a methods line, plus the instrument's own
   self-validation appendix (precision/recall with confidence intervals on a
   27-world bench of planted defects);
2. a **repaired copy**: vendor scale applied, holes patched, unrepairable
   regions quarantined, verified spawn points;
3. an **executable training contract**: certificate → Isaac Lab config
   (spawns→reset poses, quarantine→no-go masks, friction uncertainty→
   domain-randomization ranges, gravity→sim config).

Pitch line: *"World models generate the pixels. Surveyor certifies the
physics. Isaac trains the robot. The certificate is the contract between
them."*

## 2. Objective

Win at the "Worlds in Action" hackathon (SIGGRAPH 2026 edition, World
Labs-sponsored; primary track: Best Agentic Interface & Systems). Secondary:
seed a real product and a career signal in Physical AI. The final deliverable
is a **Certified World Pack** — one downloadable folder: Isaac-ready USD
world + labeled dataset + policy + task video + certificate — publicly
downloadable before judging.

## 3. What is DONE (all committed, tests green)

- **The instrument** (TypeScript + Rapier physics, deterministic): probe
  rain + raycast cross-check (a hole only counts if two independent
  instruments agree), divergence analysis with a per-world self-calibrated
  threshold, metrology (floor fit, doorways, scale estimate vs vendor
  metadata), per-robot verdicts, defect synthesis, trust map
  (confirmed/observed/divergent), certificate with content-hash.
  **Byte-identical determinism** across runs AND across runtimes (Node CLI
  and browser produce the same sha256).
- **Self-validation**: 27 synthetic worlds, 31 planted defects (including
  out-of-taxonomy plants): recall 96.8% (95% CI ≥85.6%), precision 100%
  (CI ≥90.5%), one disclosed miss. Prints on every certificate.
- **Outdoor recalibration**: the instrument originally misfired on outdoor
  worlds (979 false defects on a moon world — probes landing outside the
  splat capture envelope). Diagnosed, fixed (survey confined to the capture
  envelope), bench unchanged. Before/after kept as a change-control record.
- **Agent repair loop**: a RECORDED LLM-agent episode repairs the hero world
  F→A — 75 defects, 75 recorded outcomes (fixed / quarantined / accepted),
  including an organic fail-revert-adapt (its slab patch created a new step;
  the certifier caught its own repair; it reverted and used a different
  method). Replayable cassette; the whole repaired bundle regenerates from
  repo + cassette alone.
- **Browser viewer/demo app** (Three.js + Spark splat renderer): 5-beat
  staged flow rehearsed end-to-end live — survey → F certificate → repair
  with live fail-and-adapt → grade A → rover delivery run on the certified
  navmesh. Honest copy verified (suspension of metric verdicts while scale
  unresolved, explicit denominators, defect-count growth explained).
- **PREFLIGHT CLI**: `surveyor certify <bundle> --min-grade B` with CI exit
  codes + self-contained report.html.
- **NVIDIA/Isaac pipeline on Purdue's Gilbreth A10 cluster:**
  - **G3a**: rigid body rests on the repaired floor at a certified spawn —
    **PhysX corroborates the Rapier-certified geometry to 1 mm**
    (cross-engine transfer receipt).
  - **G3b/G3c**: Franka arm (RMPflow, scripted) picks a crate off a shelf
    and sets it on a rover bed **inside the Certified World Pack at lunar
    gravity (1.62 m/s²)** — set-down within ~0.5 mm of the probe-measured
    surface. **27-second video exists** (816 frames, H.264). The robot is
    NOT vision-based and we say so: scripted controller on probe-measured
    targets; the demonstrated artifact is the world, not the brain.
  - USD pack assembler passes all validation rules (Z-up, metersPerUnit,
    collision APIs, spawns outside quarantine, certificate sha embedded).
- **Feasibility verified with sources** for the remaining pipeline: NuRec
  splat rendering in Isaac (NVIDIA's own Marble blog documents the exact
  workflow), pretrained lift checkpoint (verified downloadable), Replicator
  SDG, A10 support.

## 4. Known weaknesses (found by our own red-team panels; be harsher)

- **The demo's marquee "sill fails rover, passes quadruped" contrast does
  not exist on the current hero world** — its steps fail both robots. The
  beat currently uses a fallback (hole+ghost contrast). A generated hero
  world with a real contrast is still being fished for.
- **Grade correlation evidence is missing**: nothing yet proves a certified
  world trains a measurably better robot (the "verdict predicts task
  success" study everyone demands — judges and simulated customers alike).
- **The video's world connection is provable but not yet visible**: the
  Marble world renders as gray geometry (its photoreal splat layer awaits
  NuRec conversion — in progress); the manipulation props (shelf/crate) are
  ours, not generated.
- **Single-vendor dependency**: only Marble ships splat+collider pairs
  today; NVIDIA (SimReady validation rules) or World Labs could ship
  first-party checks.
- **The certifier's own physics is Rapier**, not the PhysX robots train in
  (mitigated by the 1 mm G3a concordance receipt, not eliminated).
- **The agentic-track live demo** replays a *recorded* agent episode
  (disclosed honestly on screen); the live engine executes tools, but the
  reasoning is a cassette.
- **Scale estimate** rests on a door-height prior — circular on worlds
  without doors; on outdoor worlds it's suppressed rather than solved.
- Market risk per our simulated customer panel: 2 PILOT / 2 POLITE-PASS /
  1 ADOPT; adopters want the repaired copy + headless CLI, not the
  certificate document; willingness to pay $12–40k/yr open-core support at
  best; generation is so cheap ($1.20/world) that "regenerate and filter"
  may beat "repair."

## 5. Next steps (priority order, ~11 days)

1. **NuRec conversion** (in progress): splat→PLY→USDZ so the pack carries
   photoreal visuals and the robot video shows the *generated world*, not
   gray geometry.
2. **Hero fishing** (blocked on credits): two NASA-photo worlds (Mars
   Jezero, Apollo 17) generated in the Marble app → certify → the
   certificates pick the hero (a world only wins if a validated twin-run
   failure route derives).
3. **G4**: pretrained RL lift checkpoint (state-based) in the pack world —
   the "zero training needed" wow layer over the scripted run.
4. **G5**: Replicator synthetic-data generation — labeled frames from
   cameras masked to certified free space (the vision-training story).
5. **Twin run staging**: same rover, raw world (falls through hole) vs
   certified world (completes delivery) — the 30-second thesis.
6. Demo assembly per the locked 3-minute script (pack-first: output first,
   twin run, instrument, agent repair, certificate-executes, hash receipt).
7. User-lane: organizer rules answer (deadline was Jul 8), demo-laptop fps
   check, real customer conversations (guide exists; zero real ones done).

## 6. What we want from you

1. The three weakest load-bearing claims, and the question a judge would
   ask that breaks each.
2. Holes in the market logic we haven't listed.
3. Anything in the demo plan that reads as theater or overclaim.
4. What you would CUT with 11 days left — and what single thing you would
   add that we haven't thought of.
5. Steelman the strongest competitor response (World Labs ships validation;
   NVIDIA extends SimReady to environments) and tell us if our wedge
   survives it.
