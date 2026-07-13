# UX flow experiments — five interaction philosophies for SURVEYOR

**Date:** 2026-07-05 · **Status:** concept exploration for founder review — nothing here is committed
**Baseline referenced throughout:** PLAN.md §16 (9-step linear viewer flow), `docs/demo-five-beats.md` (staged demo), the existing Spark viewer (density-anchored camera, wireframe toggle, capped defect boxes, trust-map painting, certificate/repair panels, rover patrol, five-beat stepper).

**Vocabulary (hard rule, applied throughout):** worlds have **confirmed / observed / divergent** regions, **ghost geometry** (visual without physics), **phantom colliders** (physics without visuals). Never "lying."

---

## Why restructure at all — three tensions in the current flow

1. **The current flow is a guided tour, and customer discovery says the product is an artifact.** Dana, Ken, and Tomasz all consume files (repaired bundle, masks, exit codes), not screens. The 9-step viewer flow serves nobody in §2 of `customer-discovery.md` directly — it serves the *demo*.
2. **The most differentiated asset — the agent's reasoning and the fail-and-adapt episode — is currently one panel among many**, not the organizing principle of the interface.
3. **Repair provenance and selective trust** ("which triangles are measured and which are your patch") have no home in a linear wizard; they need a review surface.

Each concept below picks one of these tensions and builds the whole interface around it.

---

# Concept 1 — PREFLIGHT

**Philosophy:** *The terminal is the product; the browser is a renderer for artifacts already on disk.* The eslint of generated worlds.

**Primary persona:** Ken (`npx surveyor certify`, ADOPT-within-the-hour) and Dana (headless CI gate). This is the mandated headless/CI concept — and per customer discovery §2.1, arguably the real product.

### Flow (7 states — mostly not screens)

1. **Invoke:** `npx surveyor certify ./world --robot go2.yaml --gravity earth`. No login, no server, no network (matches the headless-first core that already exists as `npm run certify`).
2. **Progress:** survey phases stream as terminal lines — sweep, probe rain, divergence pass — each with counts (`probes 4,096 · contact 91.2% · divergent regions 3`). Deterministic, so identical every run.
3. **Verdict block:** grade, per-robot pass/fail table, scale line with uncertainty and methods, top-3 defects, and **exit code 0/1/2** (pass / observed-only warnings / divergent fail). The exit code IS Dana's product.
4. **Repair:** `surveyor repair ./world --plan` prints the proposed operation stack in plain language; `--apply` executes with the fail-and-adapt loop streaming (`fitted_slab → regional recertify FAILED (new 0.48 m step) → revert → mesh_fill → holds`).
5. **Artifacts on disk:** `certificate.json`, `repaired/` bundle, `training-contract/` (Isaac config), and a **self-contained `report.html`** — zero-dependency, openable from disk, emailable.
6. **The report page** (the only "UI"): grade header, per-robot table, defect list; each defect row expands into an embedded 3D evidence view at a pre-baked camera pose (reusing the existing viewer as a component). Deep-linkable: `report.html#defect-12`.
7. **CI mode:** `--ci` adds GitHub Actions annotations + JUnit XML; a `certified: A (go2)` badge for READMEs. World bundles get certified the way code gets linted — on every regeneration.

### Wireframes

**State 3 — terminal verdict block:**

```
$ npx surveyor certify ./moon-hab --robot go2.yaml --robot rover.yaml
  ▸ sweep .......... floor plan 214 m², 96% coverage          [3.1s]
  ▸ probe rain ..... 4,096 probes, contact 91.2%              [8.4s]
  ▸ divergence ..... 3 divergent regions, 1 ghost wall        [4.7s]
  ▸ metrology ...... scale 1.60 [1.44..1.76] via door-height  [1.2s]

  CERTIFICATE  moon-hab  ·  seed 42  ·  byte-identical ✓
  ─────────────────────────────────────────────────────
  GRADE  F        confirmed 71%   observed 22%   divergent 7%
  ROBOT VERDICTS
    go2 (quadruped)   PASS   sill 0.15m within envelope
    rover             FAIL   sill 0.15m > step-over 0.10m
                      FAIL   collider hole H3 on route floor
  TOP DEFECTS
    D1  ghost geometry   wall @ (4.1, 0, 2.2)   affordance risk
    D2  collider hole    1.2 m² floor gap        fall-through
    D3  scale divergence vendor 1.624 vs measured 1.60±0.16

  → certificate.json · repaired? run: surveyor repair ./moon-hab
  → report.html (open in any browser)
  exit code 2 (divergent regions present)
```

**State 6 — report.html:**

```
┌──────────────────────────────────────────────────────────────┐
│  SURVEYOR CERTIFICATE          moon-hab · 2026-07-05 · seed 42│
│  GRADE F → A (repaired)     [Download bundle] [Isaac config]  │
├──────────────────────────────────────────────────────────────┤
│  ROBOT     BEFORE   AFTER    BLOCKING DEFECT                  │
│  go2       PASS     PASS     —                                │
│  rover     FAIL     PASS     sill D4 (was > envelope)         │
├──────────────────────────────────────────────────────────────┤
│  DEFECTS (7)                        self-validation appendix ▸│
│  ▸ D1 ghost geometry — wall without physics      [divergent]  │
│  ▾ D2 collider hole — 1.2 m² floor gap           [repaired]   │
│    ┌──────────────────────────┐  measured: 1.2 m² ± 0.1      │
│    │   (embedded 3D view at   │  method: probe + raycast     │
│    │    evidence camera pose) │  cross-check, n=38           │
│    │    [replay probe fall]   │  repair: mesh_fill (after    │
│    └──────────────────────────┘  fitted_slab reverted)       │
└──────────────────────────────────────────────────────────────┘
```

**What it makes easy** (that the current flow makes hard): adoption in the hour (Ken's literal quote); gating hundreds of worlds in CI; sharing a certificate with someone who will never run the app; trusting the tool (artifact-first, no theater); scriptability against the whole 27-world bench.

**What it sacrifices:** live survey spectacle; the agent's reasoning as an experience; anything real-time. The browser never *does* anything — it only shows what already happened.

**3-minute demo mapping:** surprisingly viable as a *beat*, not the whole demo: 20 seconds of live terminal (deterministic + offline = zero stage risk), then the report opens and beats 3–5 continue inside its embedded viewer. As the *whole* demo it would lose the creative-tech panel.

**Build cost: S.** The engine, CLI entry points, and viewer all exist. Work = a verdict-block formatter, a static report template embedding the existing viewer, exit codes, and `--ci` emitters.

---

# Concept 2 — THE READING ROOM

**Philosophy:** *The world is a patient; the user is the radiologist.* Nothing is asserted without an image, a measurement, and an uncertainty — the whole UI is a hanging protocol for reading scans of a world.

**Primary persona:** Priya (buyer who needs eval evidence) and, through the export tab, Tomasz (masks and scalars). This is the trust-maximizing concept.

### Flow (7 screens)

1. **Intake.** Patient banner: world ID, vendor, generation date, splat/collider file fingerprints. The robot spec is framed as the **referral question**: "Cleared for Go2-class quadruped, lunar gravity?" Gravity = the ordered protocol.
2. **Scan queue.** The survey runs as ordered *studies*: Probe Series, LiDAR Series, Divergence Study, Metrology. Each completes with a thumbnail and a timestamp. (Same engine phases as today, reframed as imaging acquisitions.)
3. **Reading pane** — the heart. A 2×2 hanging protocol: photoreal splat | collider shell | **divergence overlay** (heatmap where the two disagree) | trust map (confirmed / observed / divergent). One synced 3D cursor: point at a wall in the splat pane, the crosshair lands on *nothing* in the collider pane — ghost geometry read the way a radiologist reads a lesion, by pane comparison.
4. **Findings list.** Each finding: class (ghost geometry / phantom collider / step / hole / scale divergence), measurement with uncertainty range, method line, evidence frame, per-robot severity. Click → all four panes fly to the finding.
5. **Impression.** The certificate rendered as a signed radiology report: FINDINGS / IMPRESSION ("world is NOT cleared for rover-class; cleared for quadruped-class with quarantine") / RECOMMENDATIONS (the repair plan). Self-validation appendix = the instrument's calibration record, exactly Tomasz's 9-of-10-scenes trust test.
6. **Treatment plan.** Repairs as prescriptions with expected outcomes; approve individually or all. Execution streams; the fitted_slab failure appears as an **adverse reaction → treatment revised** entry.
7. **Follow-up study.** Post-repair re-scan hung *next to the prior* — "prior vs current," delta regions flagged. Discharge summary = export (bundle, masks, Isaac contract).

### Wireframe — screen 3, reading pane

```
┌ PATIENT: moon-hab · Marble · 2026-07-05     REFERRAL: Go2, lunar g ┐
├──────────────────────────────┬─────────────────────────────────────┤
│  SPLAT (what cameras see)    │  COLLIDER (what physics believes)   │
│                              │                                     │
│      ▓▓▓▓ wall ▓▓▓▓          │        · · (nothing) · ·            │
│         +  ← cursor          │           +  ← synced cursor        │
│                              │                                     │
├──────────────────────────────┼─────────────────────────────────────┤
│  DIVERGENCE OVERLAY          │  TRUST MAP                          │
│   ░░░░▒▒▓▓ hot ▓▓▒▒░░░░      │   ████ confirmed  ▒▒ observed       │
│   (splat/collider disagree)  │   ▓▓ divergent                      │
├──────────────────────────────┴─────────────────────────────────────┤
│ FINDINGS  ▸D1 ghost wall 3.1m² · no return in collider · divergent │
│           ▸D2 floor gap 1.2m²±0.1 · probe+ray n=38    → [read]     │
└─────────────────────────────────────────────────────────────────────┘
```

**What it makes easy:** building buyer-grade trust (every claim is visually cross-examined); reviewing findings one at a time with evidence; before/after comparison as a first-class ritual; the "certificate is a platform, fields are products" insight — the Impression screen has export tabs per persona.

**What it sacrifices:** pace (reading is deliberate — dangerous in 3 minutes); the robot is offstage until discharge; four simultaneous splat viewports is a real perf/VRAM risk (mitigation: one live 3D pane + three synced 2D renders).

**3-minute demo mapping:** workable but slower: beat 1 = the two top panes disagreeing at one cursor (actually a *stronger* ghost-geometry reveal than wireframe toggle), beat 2 = scan queue filling, beat 3 = findings row with two robot columns, beat 4 = adverse-reaction entry, beat 5 = follow-up study + patrol clip. Risk: judges experience it as an enterprise tool, not a wow.

**Build cost: M–L.** Multi-pane synced cameras is new; divergence heatmap overlay is new; everything else reskins existing panels. L if all four panes are live 3D; M with the one-live-pane mitigation.

---

# Concept 3 — MISSION CONTROL

**Philosophy:** *The agent is the spacecraft; the user is Houston.* The UI is telemetry, an anomaly board, and GO/NO-GO flight rules built around the agent's live reasoning stream. Named Surveyor, staged like 1966.

**Primary persona:** the judges (this is the radically demo-optimized concept). Secondary: Dana reviewing an automated overnight run as an ops log.

### Flow (7 states, one persistent screen with modes)

1. **Pre-launch.** Mission card: world, robot spec, gravity. A walkable "visual inspection" of the photoreal world; the wireframe toggle is framed as *switching to the engineering camera* — beat 1 lives here. Big **GO FOR SURVEY** button.
2. **Survey ops.** Center: world view auto-following the survey. Left rail: the agent's reasoning stream, humanized ("that sill reads like a step — measuring"). Bottom: telemetry strip with live counters — probes fired, contact %, regions confirmed/observed/divergent climbing. Trust map paints in the center view.
3. **Anomaly board.** Each defect arrives as a chip lighting up on a board (capped, severity-ordered — the existing 200-box discipline becomes a feature: the board triages). Click a chip → camera flies to evidence, probe-fall replay.
4. **FLIGHT RULES — GO/NO-GO.** The sill verdict gets its own full-screen moment: two rows, two physical checks, opposite outcomes. This is the marquee "sim-readiness is relative to the robot" sentence given protected screen time, not just narration time.
5. **Repair ops.** Agent proposes; user issues **GO FOR REPAIR**. Ops log streams each operation. When fitted_slab fails regional recertify, a red **ANOMALY** banner fires, the board gets a new chip *created by our own repair*, and the log shows revert → mesh_fill → holds. The whole interface exists to make this 45 seconds legible.
6. **Mission complete.** Grade F → A stamped; the 81/81 defect-outcome ledger scrolls; rover deploys from a verified spawn and patrols (over the patch, around the quarantined ghost geometry). "Mission elapsed time 2:47."
7. **Debrief.** Certificate + artifacts + the replay-cassette scrubber — the existing trace/JSONL cassette becomes a user-facing flight recorder, which is also exactly the replay-decisions/execute-live demo discipline made native.

### Wireframes

**State 2/5 — the persistent ops screen:**

```
┌ SURVEYOR MISSION CONTROL      moon-hab · go2 · 1.62 m/s²  MET 01:14 ┐
├───────────────┬─────────────────────────────────────┬───────────────┤
│ REASONING     │                                     │ ANOMALY BOARD │
│ ▸ sweep done, │                                     │ ■ D1 ghost    │
│   3 rooms     │        [ 3D WORLD VIEW ]            │   geometry    │
│ ▸ sill @ door │      trust map painting…            │ ■ D2 floor    │
│   reads like  │      ▓ confirmed ▒ observed         │   hole        │
│   a step —    │      ░ divergent                    │ ■ D3 scale    │
│   measuring   │                                     │   divergence  │
│ ▸ 0.15 m      │                                     │ □ D4 sill     │
│   [0.13..0.17]│                                     │               │
├───────────────┴─────────────────────────────────────┴───────────────┤
│ TELEMETRY  probes 4,096 · contact 91.2% · conf 71% obs 22% div 7%   │
│                     [ ✓ GO FOR REPAIR ]  [ HOLD ]                    │
└──────────────────────────────────────────────────────────────────────┘
```

**State 4 — GO/NO-GO flight rules:**

```
┌──────────────── FLIGHT RULES — SILL D4 (0.15 m ± 0.02) ─────────────┐
│                                                                      │
│   ROVER        step-over 0.10 m      ██ NO-GO ██   sill > envelope  │
│   QUADRUPED    traversal env 0.30 m  ── GO ──      clears w/ margin │
│                                                                      │
│        same world · same sill · two verdicts                        │
│        sim-readiness is relative to the robot                       │
└──────────────────────────────────────────────────────────────────────┘
```

**What it makes easy:** the 3-minute story (states map 1:1 onto the five beats); making the *agent* the visible star (the differentiator vs NVIDIA's blog is the certification layer — this UI keeps it on screen every second); brand coherence with the Surveyor/NASA name; stage discipline (cassette scrubber = rehearsal tool and Q&A prop in one).

**What it sacrifices:** self-serve depth — Houston doesn't wander; free exploration and dense data inspection get demoted to Debrief. Headless personas get nothing from it (pair it with Concept 1). Risk of feeling like a skin if the telemetry isn't all real (it is — every counter already exists in the engine).

**3-minute demo mapping:** it *is* the demo. Beat 1 = pre-launch engineering camera; beat 2 = survey ops; beat 3 = flight rules; beat 4 = ANOMALY banner; beat 5 = mission complete. The existing stepper (Space/1–5) survives as the mode switcher.

**Build cost: M.** No new engine work, no new 3D capabilities. Work = layout chrome (rails, telemetry strip, anomaly board), the flight-rules screen, banner states, and cassette scrubber UI. Closest concept to the code that exists today.

---

# Concept 4 — THE CHANGESET

**Philosophy:** *A repaired world is a pull request against the raw world.* Survey findings are review comments, repairs are commits, the certificate is CI status, and export is the merge.

**Primary persona:** Dana (repair provenance — "which triangles are measured and which are your patch"; selective trust; audit trail) and Priya (governance: nothing merges without review).

### Flow (6 screens)

1. **Repo view.** Worlds as repos. A certified world shows an open PR: **"surveyor-bot wants to merge 7 operations into moon-hab/main."** Uncertified worlds show a red status: `certification: F — 3 divergent regions`.
2. **PR overview.** Auto-written description (the agent's plan in plain language). **Checks panel:** Certification F → A ✓ · determinism (byte-identical re-run) ✓ · per-robot status checks (rover ✗→✓, quadruped ✓→✓) · self-validation appendix linked. Branch protection rule: *cannot merge with unquarantined divergent regions.*
3. **Changes tab.** The operation stack as a changed-files list:
   `apply_vendor_scale` · `patch_hole_D2 (fitted_slab) — REVERTED` · `patch_hole_D2 (mesh_fill)` · `quarantine_ghost_wall_D1` · `verify_spawn_points ×4`.
   Selecting one opens the **3D diff**: raw | repaired with a wipe slider; patched triangles tinted as patches (repair provenance, shipped in the mesh view — the thing Dana asked for that the ledger only half-delivers).
4. **Op detail.** Before/after measurements (doorway 1.27 → 2.02 m), method line, the regional-recertify result that gates the op, a comment thread, and a per-op **Request changes → revert** (the engine's revert + regional recertify already support exactly this).
5. **Timeline tab.** The episode as commit history — *including the reverted fitted_slab commit*. Fail-and-adapt stops being narration and becomes durable, inspectable history: the instrument caught its own repair, and the record shows it.
6. **Merge.** Approve → merge = export repaired bundle + certificate + Isaac contract; the merge-commit message is the certificate summary. The defect-outcome ledger (the moat slide) accrues one more entry per merged op.

### Wireframe — screen 3, changes tab

```
┌ PR #1  Repair moon-hab: F → A          surveyor-bot → moon-hab/main ┐
│ ✓ certification A   ✓ determinism   ✓ rover   ✓ quadruped   Merge ▾ │
├──────────────────────┬───────────────────────────────────────────────┤
│ OPERATIONS (7)       │  patch_hole_D2 (mesh_fill)                    │
│ ✓ apply_vendor_scale │  ┌─────────────────┬─────────────────┐        │
│ ⟲ patch_hole_D2      │  │  RAW            │  REPAIRED       │        │
│   (fitted_slab)      │  │   floor gap     │   ▒▒patch▒▒     │        │
│   REVERTED — created │  │   ░░hole░░      │   (triangles    │        │
│   0.48 m step        │  │                 │    tinted =     │        │
│ ✓ patch_hole_D2      │  │       ◄──wipe──►│    provenance)  │        │
│   (mesh_fill)        │  └─────────────────┴─────────────────┘        │
│ ✓ quarantine_D1      │  doorway 1.27 m → 2.02 m ± 0.05               │
│ ✓ spawn_points ×4    │  regional recertify: HOLDS                    │
│                      │  [Request changes ⟲ revert]  [Approve op ✓]   │
└──────────────────────┴───────────────────────────────────────────────┘
```

**What it makes easy:** selective acceptance of repairs; provenance in the exported mesh; team workflows (a sim lead approves what a bot proposed — Priya's governance story); the audit trail as a product surface; the defect-outcome ledger becomes visible product, not a moat slide.

**What it sacrifices:** the survey itself is offstage — a PR exists only after the work is done, so beats 1–2 have no natural home; first-run wow for a creative panel; it presumes git-native users (fine for Dana, alienating for others).

**3-minute demo mapping:** medium-poor as the whole demo, exceptional for beat 4: the reverted commit sitting in history is the most credible possible telling of fail-and-adapt. Best used as one screen inside another concept's flow.

**Build cost: M–L.** The engine already has the operation stack, revert, and regional recertify — the model *is* a changeset today. Cost is UI: the synced 3D diff (L if split view, M with the single-viewport wipe slider), checks panel, timeline.

---

# Concept 5 — FIRST STEPS

**Philosophy:** *You ARE the robot.* Don't show the certificate — make the judge feel the defect through the robot's body, then feel the repair under its wheels.

**Primary persona:** the creative-tech judge panel (the second demo-optimized concept, from the presence/embodiment direction); Ken as the tinkerer who wants to poke the world.

### Flow (7 screens)

1. **Choose your robot.** Rover / quadruped card select, envelope stats on the cards (step-over, footprint, slope). The choice will visibly matter later — that's the setup for the sill payoff.
2. **Drop-in (raw world).** Third-person drive in the photoreal world. HUD splits perception from physics: *what your cameras see* vs *what the collider reports*. A ground-truth ribbon under the robot tints confirmed / observed / divergent as you drive over it.
3. **The incident.** You drive toward a visible wall — and roll straight through it (ghost geometry), or clip against invisible mass in open space (phantom collider). Time freezes. Incident card: **"Your cameras trained on a wall that was never there. No training run would ever crash to tell you."** (Beat 1's opening line, embodied.)
4. **Call the Surveyor.** Hand control to the agent; the survey happens *around you* while your robot stands in the world — probe rain lands nearby, trust map paints the actual floor under your wheels.
5. **The verdict, first-person.** Your robot's pass/fail is painted on the world: red no-go volumes at the sill and holes. Switch robot on the fly → the no-go volumes re-paint. The sill verdict as a felt experience: the same doorway turns from red to green when you become the quadruped.
6. **Repair watch.** Patches materialize in front of you. The fitted_slab visibly creates a step at your feet that your rover can't climb — the instrument flags it, the slab dissolves, mesh_fill flows in smooth. Fail-and-adapt happens *to you*.
7. **Victory lap.** Drive the exact route that broke you: over the patch, around the quarantined ghost wall. F → A stamp. Export.

### Wireframe — screen 2/3, drive HUD + incident

```
┌──────────────────────────────────────────────────────────────────────┐
│                     [ THIRD-PERSON WORLD VIEW ]                       │
│                                                                       │
│                  ▓▓▓▓▓ visible wall ▓▓▓▓▓                             │
│                        ⚠ no collider return                           │
│                          ┌─────┐                                      │
│                          │ 🤖  │ →                                    │
│              ═══════ ground ribbon ═══════                            │
│              ▓▓conf▓▓▒▒obs▒▒░░divergent░░                             │
├──────────────────────────────────────────────────────────────────────┤
│ CAMERAS SEE: wall, 2.1 m ahead     PHYSICS REPORTS: open space        │
│                                              [WASD drive · R robot]   │
├──────────────────────────────────────────────────────────────────────┤
│ ✋ INCIDENT — you just drove through a wall.                           │
│    Ghost geometry: visuals without physics. A vision policy trained   │
│    here learns an affordance that doesn't exist.  [Call the Surveyor] │
└──────────────────────────────────────────────────────────────────────┘
```

**What it makes easy:** presence — the premise ("pixels don't match physics") is *experienced* in the first 20 seconds, no narration needed; memorability with a mixed panel; the per-robot verdict as the strongest possible version of beat 3; XR-adjacent judges (Poeia XR, Machine Cinema) see their own presence-break framing on screen.

**What it sacrifices:** measurement rigor gets demoted to a HUD line — the error bars, methods lines, and self-validation appendix (the credibility engine with robotics judges) have no natural stage; the CI persona entirely; live driving on stage is pilot-error risk (mitigation: the incident route is scripted/recorded-input, disclosed like everything else); determinism of the demo depends on input discipline.

**3-minute demo mapping:** excellent and different — beats 1/3/4/5 all land harder; beat 2 (survey + certifier stats) lands softer and would need the incident card to carry the recall/CI numbers as a caption. Total restructure of the committed script.

**Build cost: L.** The viewer has navmesh patrol, not direct drive: needs a Rapier character controller wired to input against the real collider, HUD, incident scripting and freeze-frame, no-go volume painting, robot hot-swap. The physics lib supports all of it; it's new app code with real polish demands.

---

# Comparison

| Concept | Philosophy | Persona fit | Demo fit (3 min, mixed panel) | Build cost | Risk |
|---|---|---|---|---|---|
| 1 PREFLIGHT | CLI is the product, UI renders artifacts | **Ken/Dana: excellent** · Tomasz good · judges weak alone | Good as one beat; weak as whole demo | **S** | **Low** — deterministic, offline, engine exists |
| 2 READING ROOM | Diagnostic workstation, evidence-first | **Priya: excellent** · Tomasz good · Dana ok | Medium — credible but slow; wow risk | M–L | Medium — multi-pane splat perf; pacing |
| 3 MISSION CONTROL | Live-ops around the agent's reasoning | **Judges: excellent** · Dana ok (ops log) · headless none | **Excellent — maps 1:1 onto five beats** | **M** | Low-med — chrome on existing code; all telemetry real |
| 4 CHANGESET | Repaired world as reviewable PR | **Dana: excellent** (provenance) · Priya strong | Poor alone; **best-in-class for beat 4** | M–L | Medium-high — 3D diff perf; survey offstage |
| 5 FIRST STEPS | You are the robot; defects are felt | Creative judges: excellent · Ken ok · rigor personas weak | Very high wow · restructures committed script | **L** | **High** — live drive, new controller, polish burn |

---

# Ranked recommendation

**1. MISSION CONTROL — build it as the demo shell.** It is the only concept that is simultaneously (a) an evolution of the committed five-beat flow rather than a rewrite ten days out, (b) a structure whose *entire purpose* is to keep the differentiator — the certification layer and the agent's reasoning — on screen every second (the pipeline-v2 strategic note says exactly this: keep the certificate visibly doing work or we've demoed NVIDIA's blog post), and (c) brand-coherent with the Surveyor name the pitch already leans on. The anomaly board, GO/NO-GO screen, and ANOMALY banner give beats 3 and 4 dedicated visual moments they currently borrow from panels. Cost M, telemetry all real, cassette scrubber doubles as rehearsal infrastructure.

**2. PREFLIGHT — build it regardless, in parallel.** It's size S, and it's what customer discovery says the product actually is ("the repaired copy / headless CLI is the product; the certificate as a document is packaging"). Concretely: the verdict block, exit codes, and `report.html`. On stage it's a 15-second flex ("and everything you just watched is `npx surveyor certify` — here's the exit code your CI gates on"), in Q&A it's the answer to Dana-shaped judges, and after the hackathon it's the launch post. Mission Control on stage + Preflight in hand covers both axes no single concept covers.

**3. CHANGESET — steal its best organ now; make it the post-hackathon north star.** Don't build the PR shell for the demo. Do render the operation stack as a commit timeline *with the reverted fitted_slab visible in history* inside Mission Control's repair-ops state (small work — the operation stack and revert already exist in the engine), and tint patched triangles in the viewer (repair provenance, Dana's direct ask, partially shipped as a ledger). As a product direction, review-and-merge is the strongest answer to how a team — rather than a demo audience — actually consumes repairs.

**4. FIRST STEPS — steal the incident, skip the restructure.** A scripted 8-second first-person clip of a robot rolling through the ghost wall (recorded input, disclosed) would upgrade beat 1 from "toggle wireframe" to "watch the presence break." Full drivable embodiment is the best concept here for a different event — one with booth time and no 3-minute clock — and the worst risk profile for this one.

**5. READING ROOM — file for the sales deck.** Its hanging-protocol trust ritual is the right interface for a Priya-stage pilot evaluation, and the synced-cursor two-pane ghost-geometry reveal is a genuinely better *explanation* of the core defect than anything currently built. But it optimizes for deliberate reading, and this event sells 180 seconds of certainty. Keep the concept; spend nothing on it before SIGGRAPH.

**The combined shape:** Mission Control shell over the existing viewer, Preflight CLI + report as the artifact story, Changeset's commit-timeline and patch-tinting embedded in the repair beat, First Steps' scripted incident clip as beat 1's opener. That is one coherent build (M + S + two small organs) that serves the judges on stage, the engineers in Q&A, and the customers in the launch post — without betting the committed demo on new physics-facing code.
