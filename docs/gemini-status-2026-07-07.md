# SURVEYOR — status + remaining plan (2026-07-07 evening) — CONSISTENCY REVIEW

**To the reviewer (Gemini):** this is NOT a request for general criticism —
we ran that round already and triaged it (your C12–C15 additions are now
built). This round has ONE job: **review the status and the remaining plan
for confusion, contradiction, stale claims, and sequencing mistakes.** We
were recently bitten by plan drift (a demo beat contradicted its own
world's data; a "patched" script silently wasn't). Check that every claim
below is consistent with every other claim, that the remaining plan is
ordered correctly, and that nothing stated as DONE is quietly load-bearing
on something listed as REMAINING. Flag anything ambiguous enough that two
team members could read it differently.

Event: ~Jul 18 (SIGGRAPH-edition hackathon, World Labs-sponsored).
Today: Jul 7. Budget: 2 people part-time + free cluster standby time.

---

## A. The product in one paragraph

SURVEYOR inspects and repairs AI-generated 3D worlds so robots can train in
them. A Marble world ships as photoreal splats + an invisible physics
collider that nobody checks against each other. Surveyor runs physical
experiments inside the world (probe rain, virtual LiDAR, visual-vs-physics
divergence, an image-depth audit), grades it with per-robot verdicts and
error bars, repairs it through an LLM agent restricted to nine
deterministic reversible tools (every action re-inspected), and compiles
the certificate into an executable Isaac Lab training contract. Final
deliverable: the **Certified World Pack** — one downloadable folder: world
USD + labeled dataset + policy + task video + certificate.

## B. Current status — DONE, with receipts

| # | Item | Receipt |
|---|---|---|
| 1 | Instrument (probes + LiDAR + divergence + depth-audit + metrology + per-robot verdicts + trust map) | 41/41 tests; byte-identical certificates across runs AND runtimes (Node CLI sha == browser sha) |
| 2 | Self-validation | 27 synthetic worlds, 31 planted defects incl. out-of-taxonomy: recall 96.8% (95% CI ≥85.6%), precision 100% (CI ≥90.5%), one disclosed miss; prints on every certificate |
| 3 | Outdoor recalibration | moon world false-defects 1053→89; bench CIs unchanged; before/after kept as change-control record |
| 4 | Agent repair | hero world F→A, 81/81 recorded outcomes incl. organic fail-revert-adapt (its slab patch created a new step; the certifier caught its own repair); replayable cassette; repaired bundle regenerates from repo+cassette alone |
| 5 | Browser demo app | 5-beat staged flow rehearsed end-to-end live once (survey → F cert → repair w/ live fail-and-adapt → A → delivery); MISSION LOG replays the agent's own reasoning (disclosed as recorded); copy-truth pass done |
| 6 | Vision-driven twin run (C12) | rover PLANS on the splat-derived visual floor, physics decides: falls through the collider hole at step 591 on the hero world; narration verified |
| 7 | Hero fishing (C13) | `hero-fish.ts --scan`: 2/6 worlds qualify (habitat 7188e250 + moon f1f4e6b3); habitat has 2 sills in the rover-fail/quadruped-pass band → per-SILL Beat-3 contrast truthfully speakable (world-level verdict still fails both robots — the spoken line must be per-sill) |
| 8 | Pitch/Q&A hardening (C14/C15) | architecture line in Beat 4 + README; Gemini's three breaking questions answered with receipts in demo doc |
| 9 | Isaac cross-engine receipt (G3a) | PhysX corroborates Rapier-certified repaired floor to 1 mm at a certified spawn |
| 10 | Robot task, physics (G3b) | Franka picks 6 cm crate shelf→bed inside the pack at 1.62 m/s²; set-down 0.3 mm from probe-measured surface |
| 11 | Robot task, ON CAMERA (G3c) | 27.2 s video `assets/isaac/g3c-box-lift.mp4` (H.264): the lift **inside the photoreal Marble splat visuals** (NuRec payload active), same physics receipt |
| 12 | NuRec conversion pipeline | 3dgrut built on the cluster; hero splats → `hero-100k.usdz` renders in-container (Volume/OmniNuRecFieldAsset) |
| 13 | USD pack assembler + validator | all rules pass (Z-up, metersPerUnit, collision APIs, 10 spawns outside 22 quarantine boxes, certificate sha in layer metadata) |
| 14 | PREFLIGHT CLI | `surveyor certify <bundle> --min-grade B`, CI exit codes, self-contained report.html |
| 15 | G4 prerequisite | pretrained lift checkpoint downloaded to cluster (rsl_rl, Isaac 5.1) |

Known honest limits (stated, not hidden): the demo robot is scripted (RMPflow
on probe-measured targets), NOT vision-based or learned — G4 upgrades this to
a pretrained policy. Grade correlation to training outcomes is unproven (G6,
stretch). Splat background is soft (100k tier; 500k upgrade staged). Repair
agent diagnoses from measured stats, not rendered views (upgrade shelved).

## C. Remaining plan — in execution order

**Cluster lane (order fixed: each feeds the next):**
1. **G4 — pretrained lift policy in the pack world** at lunar g, recorded.
   Checkpoint on cluster. Fallback pre-committed: scripted footage captioned
   "zero training required". (~1 evening)
2. **G5 — Replicator SDG dataset**: ~5,000 labeled frames (RGB/depth/seg),
   cameras masked to certified free space. Known constraints baked in:
   camera-sensor path only (`rep.orchestrator.step()` hangs headless);
   world-space coords on ROOT-level prims (the coordinate law). Fallback:
   500-frame teaser. (~1 evening)
3. **(Optional quality) 500k splat re-render**: `MARBLE_TIER=500k` download
   (free; awaiting user go) → existing converter → re-render the movie.
4. **(Stretch) G6 — paired receipt**: N≈10–20 nav goals raw vs repaired,
   honest caveats. Only if evenings remain.

**Packaging lane (after G4/G5):**
5. Pull NuRec usdz into the LOCAL shipped pack + re-validate + HASHES.txt.
6. Assemble final pack folder (world/dataset/policy/contract/certificate).
7. Publish: GitHub release + Hugging Face + Devpost page with certificate
   SHA-256 printed BEFORE the event (prerequisite for the live re-hash beat).

**Demo lane (small, words + splicing):**
8. Splice the photoreal MP4 into Beat 5′.
9. Beat-3 line switched to the per-SILL contrast wording (see B.7 nuance).
10. Q&A-tier extras ONLY if hours remain: rustic-kitchen neutrality
    certificate, Unity Kit overlay (gated on kit access), recalibration card.
11. Timed dress rehearsals (event window).

**User lane (calendar, no code substitute):**
12. Rules answer — **deadline Jul 8 EOD (tomorrow)**; contingency
    pre-committed on silence.
13. Gate-A fps number (open the viewer in a foreground browser once).
14. Unity Kit access + SIGGRAPH-edition confirmation.
15. 3–5 real customer conversations (guide exists; zero real ones done).
16. Optional: Mars/Moon Marble APP generations (hero already exists — this
    is narrative upside, not a blocker).

**Explicitly cut (do not resurrect):** Mission Control chrome, Reading Room
UX, drivable embodiment, Changeset PR shell, ONNX-in-browser, live
falsification panel, Mars flourish, MCP stage time, Unity beyond overlay,
instrument tightening beyond what's shipped.

## D. What we want from you (consistency review ONLY)

1. **Contradictions:** any claim in B that conflicts with another claim in
   B, or with the plan in C? (Example of the class we fear: a demo line
   that the named hero world's own data cannot render.)
2. **Stale-claim risk:** anything in B that the work in C could silently
   invalidate (e.g., does the 500k re-render invalidate the published
   hash? does G5 change the pack contents after HASHES.txt is stamped?) —
   tell us the correct ORDER to avoid re-doing artifacts.
3. **Sequencing errors:** is anything in C ordered such that a later step
   forces redoing an earlier one? What is the correct dependency chain for
   steps 3, 5, 6, 7 in particular?
4. **Ambiguity audit:** any sentence two team members could read
   differently? Rewrite it the way we should say it.
5. **Scope check:** with ~10 days and 2 part-time people, is anything in C
   that should move to the cut list — and is anything on the cut list that
   the status in B now makes cheap enough to resurrect?
6. **The single riskiest untested assumption** in the remaining plan.

Do NOT re-litigate the concept, market, or demo narrative — that round is
closed and triaged. Consistency and sequencing only.
