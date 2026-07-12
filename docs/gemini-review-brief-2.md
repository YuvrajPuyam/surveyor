# SURVEYOR — progress brief #2 for external criticism (2026-07-12)

**To the reviewer:** this is the second full snapshot of a hackathon project
(first brief: 2026-07-07; the event is days away). Everything below is real
and receipted; nothing is aspirational unless marked. Your job: find what is
still weak — in the artifacts, the demo, the claims, and the priorities.
Do not repeat generic advice. End with: (1) top 5 weaknesses ranked by
likelihood of costing the win, (2) the single judge question we would answer
worst TODAY, (3) what you would cut in the final days, (4) what is
underexploited.

---

## 1. What SURVEYOR is (unchanged thesis)

AI world generators (World Labs Marble) export photoreal **Gaussian splats**
(what cameras see) + an invisible simplified **collider mesh** (what physics
touches). Nobody checks the two agree. Where they diverge, robots inherit
the divergence: collider holes under perfect pixels, **ghost geometry**
(pixels with no physics), **phantom colliders** (physics with no pixels),
world-scale errors that silently poison depth labels. SURVEYOR runs physical
experiments inside the world (seeded probe rain, virtual LiDAR, two-way
splat-vs-collider divergence), then ships a **training-ready USD world for
Isaac Sim** — repaired geometry robots actually train on, a certificate as
its warranty (per-robot verdicts, every number with uncertainty + methods
line), and an executable training contract (spawns → resets, quarantine →
no-go masks, friction uncertainty → domain-randomization ranges). Lunar and
martian bases are the hero setting because they cannot be scanned — only
generated — and a generated world has no original to check against, which
is exactly why physical verification is the only route to trust.

## 2. What is DONE since the last brief (all receipted)

**The six-film set (`assets/isaac/`), all inside the certified world:**
1. `g3c-box-lift.mp4` — scripted Franka pick-and-place at lunar gravity,
   PHOTOREAL (NuRec splats), set-down −0.551 m vs −0.551 probe-measured.
2. `g4-policy-lift.mp4` — PRETRAINED rsl_rl policy does the lift with zero
   training (goal error 2.6 cm; it even recovers a knocked-off cube).
3. `g7a-rover-fp.mp4` / `g7a-rover-wide.mp4` — rover drives a 4.5 m
   probe-certified corridor; route chosen by physics probes at runtime.
4. `g7b-go2-walk-fp.mp4` / `g7b-go2-walk-wide.mp4` — **a Unitree Go2
   quadruped WALKING through the photoreal repaired world** (pretrained
   velocity policy, zero training, 1.10–1.44 m per run, never falls; 800
   frames/camera). Honest label everywhere: fixed forward command, no
   vision, no training on this world.

**The compositing unlock (was the #1 open technical unknown):** the NuRec
splat volume now occlusion-composites with mesh robots — root cause was an
empty `proxy` relationship on the Volume prim; linking it to the collider +
using verified-clear camera positions produced robot-plus-splats frames
(receipt: Go2 leg with cast shadow on the splat floor). A second real
constraint found: splat fog blinds cameras placed inside dense regions —
camera placement is now itself probe/precedent-driven.

**HD upgrade:** the hero world now renders its 500k-splat tier in BOTH the
browser viewer (verified: `splats (splat-500k.spz)`) and the Isaac pipeline
(500k NuRec usdz converted on-cluster, swapped into the pack; 100k kept as
backup). Fetched via a frozen-bundle-safe additive script — canonical
certificate hashes untouched.

**Cluster receipts (Purdue A10s, all gates G1–G6 PASS):**
- PhysX corroborates the Rapier-certified repaired floor to **1 mm**
  (static) and **0.3 mm** (dynamic contact-rich set-down at lunar g).
- Paired receipt: **raw world 0/15 nav goals vs repaired world 13/15.**
- G5: 500-frame labeled SDG dataset (RGB/depth/bbox/semseg), cameras masked
  to verified free space, rejections itemized (1,366 fog / 367 no-label).

**The Certified World Pack** (121 MB): one drag-into-Isaac USD (repaired
collider + 500k NuRec visuals + physics materials + spawn/quarantine prims;
NVIDIA `simready-validate` rules pass), the dataset, the policy + films,
the pip-installable Isaac Lab task (`Certified-Resupply-Rover-v0`), and
`certificate.json` (content-hash `6b2909f1`, byte-identical Node/browser).

**The app (live demo surface) — full bug sweep clean this week:**
- Beat 1→5 exercised end-to-end on BOTH hero worlds, zero console errors:
  survey → F certificate → agent repair with organic fail-revert-adapt →
  grade A → delivery run. The 89-defect outdoor certificate renders without
  jank.
- **Vision-driven twin run (the demo opener):** the raw-run rover now
  (a) SPAWNS only inside the splat rooms (visual-ground gate — collider
  extends past the visual envelope and used to spawn rovers in the void),
  (b) plans its crossing on the VISUAL surface, (c) physics decides. Hero
  receipts: habitat d-hole-3 — 13/16 sight-lines land on visual floor,
  median deviation **4 mm**, over a gap the collider doesn't have; moon
  d-hole-9 — 6/6 sight-lines, falls in 0.9 s. Spoken line, rendered from
  real numbers: "The cameras said floor. The collider said nothing."
- WASD/arrow fly navigation added (mouse-only was unusable); keybinds
  de-conflicted and the on-screen help corrected.
- 43/43 tests green; self-validation 96.8% recall (95% CI ≥ 85.6%),
  100% precision on a 27-world bench incl. out-of-taxonomy plants.

**Batch hero fishing:** `hero-fish.ts` certifies + ranks any fleet of
worlds mechanically; 2/6 current worlds qualify as heroes (the habitat AND
the moon world — the lunar hero matches the Artemis narrative).

**Process laws bought with failed runs (now in the runbook):** world-space
coords go on root-level prims (the /World +90° source-frame rotation
double-rotates raw USD authored in world coords); content must exist before
the first physics reset to render; Replicator's orchestrator hangs headless;
URDF import mutates open stages (import to file, reference in); cluster
Python must be written UTF-8 from Windows; every filming sbatch now
auto-encodes its MP4s (footage was once lost to a successor run's cleanup).

## 3. Known weaknesses TODAY (rank these)

1. **Film framing is candidate-grade, not final.** The Go2 wide shot is the
   proven framing; the rover wide angle came out foggy at 500k density and
   its hood cam ran before an eyeline fix. One more framing iteration per
   film is likely needed (cheap: runs self-bank their MP4s now). The Go2's
   own hood cam is blinded by splat fog (wide cam carries that film).
2. **Walk distance is modest and variable** (1.10–1.44 m per 800-step run
   at 0.3 m/s on a stepped ~3° deck; the rough-terrain policy stands still
   because its height-scanner reads garbage off USD terrain). It IS
   walking, honestly labeled — but a judge may ask why it doesn't stride
   across the room.
3. **Rehearsal lane untouched:** no timed dress rehearsals, no
   stage-laptop hash rehearsal, no fps number from the demo laptop.
   The app is verified; the humans are not.
4. **Publish lane not executed** (GitHub/HF/Devpost with the printed hash)
   — user-gated, staged, waiting.
5. **Hero fishing for Mars/Moon NASA-photo worlds still blocked** on the
   Marble app-vs-API credit split (casts staged; demo is NOT hero-blocked —
   two qualifying heroes exist).
6. **Policy-transfer correlation study still deferred by design** — the
   bounded claim ("predicts navmesh-level traversability under the
   disclosed model class — not policy transfer") plus the 0/15-vs-13/15
   paired receipt stand in.
7. **Rules-email status unrecorded** (deadline was Jul 8; pre-committed
   contingency exists if the answer was no/silence).

## 4. The demo as it stands (3:00, pack-first)

0:00 output first — robot working in a world that didn't exist this
morning; "download this exact pack now" → 0:25 twin run: the rover spawns
in the rooms, plans on what the cameras see, physics drops it through a
floor that is only pixels → 0:55 the instrument (probe rain, trust map,
grade; suspension lines where scale is unresolved) → 1:25 agent repair
with MISSION LOG (its own recorded reasoning; fitted-slab patch FAILS
re-inspection, reverts, mesh_fill holds; F→A, 81/81 outcomes; "the agent
never edits geometry — nine deterministic reversible tools, every choice
re-inspected") → 2:00 the certificate compiles into Isaac config; cut to
the films (arm, policy, rover, WALKING QUADRUPED) → 2:40 live delivery +
SHA-256 re-hashed on stage matching the pre-printed Devpost value.

## 5. Questions we want your hardest answers on

1. With the six films in hand, which ONE carries the demo, and does the
   pack-first structure still hold — or should the walking quadruped open?
2. Where does the narrative NOW overclaim relative to §2's receipts?
3. Is the 1.10 m walk a liability or an asset ("zero training, honest
   label") — and how would you frame it to a mixed creative/technical
   panel?
4. Given ~2–3 days: framing-polish the films, run the correlation study at
   small n, or rehearse — rank the three and defend the ranking.
5. What is the sharpest attack a World Labs or NVIDIA judge could still
   make, and what's the 15-second answer?
6. What are we not seeing because we're too close to it?
