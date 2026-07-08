# SURVEYOR — FINAL review brief (2026-07-07 night)

**To the reviewer:** two jobs, clearly separated. (1) Check the PLAN in
Part A for design flaws before we build it. (2) Give a final verdict on the
finished end-to-end project in Part B — what it sells, whether the claims
hold, what a judge breaks. Construction is otherwise COMPLETE; assume
everything in Part B exists on disk with the receipts stated.

---

# PART A — proposed new feature (NOT yet built): Instrument #4, the vision-traversal audit

## What the user asked for
"A vision model that moves through the entire world."

## What we propose to build
A deterministic instrument in which a **vision-guided agent sweeps every
part of the world it believes walkable — believing ONLY what cameras see —
while physics adjudicates every cell.** Output: a world-wide
vision-trust map + one headline number.

- **Vision surface:** a heightfield built from splat centers (0.25 m cells,
  floor-band median heights) — the same math that already powers the
  vision-driven twin run (C12), where a rover planned on this surface and
  fell through a collider hole at step 591, on camera.
- **Vision-walkable set:** cells with enough visual floor evidence and
  step-continuity to neighbors (≤0.3 m), flood-filled from the
  certificate's verified spawns = everywhere a vision planner would go.
- **Physics adjudication per cell:** a vertical ray against the collider at
  each vision-walkable cell.
  - |collider − visual| ≤ 0.35 m → **AGREE** (vision survives here)
  - no collider support → **BETRAYAL-FALL** (ghost floor: robot drops)
  - collider far above visual floor → **BETRAYAL-BLOCK** (phantom mass:
    robot collides with air it cannot see)
- **Outputs:** `vision-audit.json` sidecar — agreement %, betrayal cell
  clusters with coordinates and kinds, reachable-coverage %, headline:
  *"a vision-planning robot covering everything it sees is betrayed at N
  locations in this world; in the repaired world: M (target 0 on the
  navmesh)."* Raw-vs-repaired pair is the demo beat.

## Hard constraints (already committed to)
1. **Sidecar only.** The canonical certificate hashes are printed/locked
   (f68e3de1 raw, 6b2909f1 repaired). This instrument must not change one
   byte of certificate output — verified by re-running certify before/after
   and comparing shas.
2. `src/` + `scripts/` + tests only; the browser app is owned by a parallel
   session (viewer overlay is a later, separate step).
3. Deterministic (seeded, no clocks), tested on the synthetic bench:
   planted-hole world → betrayals localize to the planted hole; clean
   control → zero betrayals; byte-identical JSON across runs.

## Honest scope lines (will be printed in the artifact)
- "Vision" here = geometric evidence from splat centers (the world's visual
  content), not a neural network looking at rendered images. It is the
  strongest *deterministic* form of "plans on what cameras show"; the
  neural version is a stated non-goal for the event.
- Cell-level adjudication, 2.5D (one floor level per cell), same known
  limits as the survey.
- It does not add new defect *detection* (probes+rays already find these
  regions); its contribution is EMBODIED CONSEQUENCE at world scale — the
  same facts expressed as "where a vision robot dies," which is the
  language judges and vision-robotics buyers actually speak.

## Questions for you on Part A
A1. Is the 0.35 m agree-tolerance defensible, or should it derive from the
    certificate's own detection floor?
A2. Betrayal-BLOCK via a single vertical ray will miss phantom walls
    BETWEEN cells (lateral obstruction). Cheap fix or acceptable scope line?
A3. Any way this instrument could CONTRADICT the existing trust map and
    embarrass us on stage? (They derive from the same evidence — but the
    thresholds differ.)
A4. Is the headline number honest as phrased? Tighten it if not.
A5. Given ~10 days and that construction is otherwise done: build this, or
    is it scope creep past the locked ENDGAME? (It requires an ENDGAME edit
    by our own rules.)

---

# PART B — the finished project, end to end (everything below EXISTS)

## The one-paragraph sell
**SURVEYOR is the trust layer between AI world generators and robot
training.** Generated 3D worlds ship as photoreal splats plus an invisible
physics collider that nobody checks against each other; where they
disagree, robots learn things that are false — and vision policies never
crash to reveal it. Surveyor runs physical experiments inside the world,
grades it per-robot with error bars, repairs it through an auditable agent,
compiles the certificate into executable training configuration, and ships
the result as a **Certified World Pack**: one downloadable folder
containing the world, the training data, the policy, the videos, and the
warranty. Pitch spine: *"World models generate the pixels. Surveyor
certifies the physics. Isaac trains the robot. The certificate is the
contract between them."*

## What is being sold, concretely
1. **To judges (hackathon, 3-min demo):** the full arc — generate →
   certify → repair → train → deploy — with a live browser demo (survey,
   trust map, agent repair with organic fail-and-adapt, rover delivery)
   and recorded-but-real Isaac footage, closed by a cryptographic
   determinism stunt (re-hash the certificate live against the pre-printed
   Devpost hash).
2. **To the market (post-event):** the repaired copy + headless CLI
   (`surveyor certify <bundle> --min-grade B`, CI exit codes) — per our
   customer-discovery panel, "the eslint of generated worlds"; open core,
   paid support/certification-as-deliverable.
3. **To the ecosystem (roadmap):** the certificate as the interchange
   contract of the real-to-sim economy; the defect-outcome ledger as the
   compounding data asset.

## The pipeline with receipts (all on disk, all committed)
| Stage | Receipt |
|---|---|
| Certify | 41/41 tests; recall 96.8% (95% CI ≥85.6%, n=31, incl. out-of-taxonomy plants), precision 100% (CI ≥90.5%); byte-identical certificates across runs AND runtimes (Node sha == browser sha == f68e3de1) |
| Repair | LLM agent, 9 reversible tools, F→A, 81/81 outcomes incl. un-staged fail-revert-adapt; whole repaired bundle regenerates from repo + cassette (re-proven today byte-exactly after a drift incident) |
| Cross-engine | PhysX corroborates the Rapier-certified repaired floor to 1 mm (G3a) |
| Robot, scripted | Franka pick-and-place at lunar g, set-down 0.3 mm from probe-measured surface, on video inside the photoreal splats (G3c, 27 s) |
| Robot, LEARNED | NVIDIA's pretrained lift policy, zero training, never saw this world: grasps and delivers to 2.6 cm of goal at lunar g — after RECOVERING from knocking the crate to the floor (G4, 14 s video); rollouts byte-deterministic across 3 runs |
| Data | 500 labeled frames (RGB/depth/bbox/semseg), labeled crates at verified spawns, cameras in certified free space, every frame provably contains an annotated object, 1,733 rejections itemized in the manifest (G5) |
| Vision-vs-physics, embodied | C12 twin run: rover plans on the splat-derived visual floor, physics decides — falls through the collider hole at step 591; narration: "The cameras said floor. The collider said nothing." |
| The PACK | assets/packs/artemis-supply-hab-pack: 121 MB, 21 files — world (USD + NuRec splats), dataset, policy (+ both videos + inference reference), executable contract (spawns→resets, quarantine→masks, friction ranges→DR), certificate + self-validation + validator report, HASHES.txt stamped last, header = certificate content-hash 6b2909f1 |

## Honest limits (stated in the artifacts themselves)
- Grade predicts navmesh-level traversability under a disclosed model
  class — NOT policy transfer. The grade↔outcome correlation study (G6)
  was scoped out; it is the strongest judge question with the weakest
  answer.
- The scripted demo robot is scripted and says so; the learned one is
  state-based, not vision-based.
- Splat visuals are 100k-tier (soft); dataset is teaser-scale.
- Single-vendor input format today (Marble); SimReady Foundation
  commoditizes generic asset checks — our moat is splat-specific fidelity,
  per-robot verdicts, audited repair, and the ledger.
- Earth-g episode of G4 fumbled without recovering; lunar passed. Stated,
  not hidden.

## What remains (no construction)
Publish the pack (GitHub/HF/Devpost — user-gated), stage-laptop hash
rehearsal, dress rehearsals, organizer rules answer (overdue), customer
conversations (zero real ones yet).

## Questions for you on Part B
B1. Final verdict: does the collection of receipts above actually support
    the one-paragraph sell? Name any claim that outruns its receipt.
B2. The three questions a hostile technical judge asks, ranked by damage,
    with the best honest answer we can give from existing artifacts only.
B3. Is the pack — as listed — the right THING to sell, or is there a
    cheaper reframe of the same artifacts that sells better?
B4. If you had ONE more day of build time (and only one), what single
    addition most increases win probability: Part A's vision-traversal
    audit, a G6 mini-correlation (few nav goals raw-vs-repaired), or
    something else entirely?
B5. What in this brief would you delete as noise before the team memorizes
    it?
