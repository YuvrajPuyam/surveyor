# ENDGAME — the locked end-to-end spec

**Status (2026-07-05): LOCKED.** This is the final shape of the project. It
supersedes the *structure* of `demo-five-beats.md` (pack-first ordering) and
absorbs the panel's resolver actions and `pipeline-v2.md`'s gates. Scope
changes below require editing this file first — if it isn't in ENDGAME, we
don't build it.

**The test for every remaining hour:** does this make the pack better, or
does it make the process more defensible? **Pack wins.**

---

## 1. The final output (what sells)

**Input: one sentence. Output: a working robot, its training data, and the
receipt.** Deliverable — the **Certified World Pack**, publicly downloadable
from the Devpost before judging:

```
artemis-supply-hab-pack/
├── world/            artemis_supply_hab.usd — ONE file, drag into Isaac Sim,
│                     press Play: NuRec splats (visuals) + repaired collider
│                     (static tri-mesh, patch triangles provenance-tagged) +
│                     SimReady physics materials + spawn/quarantine prims
├── dataset/          ~5,000 labeled frames (RGB/depth/seg) via Replicator —
│                     zero geometric poisoning: no ghost-geometry labels,
│                     no clipped cameras, scale-true depth
├── policy/           trained lift checkpoint (+ ONNX) + task video
├── contract/         Isaac Lab task package: pip-install → 
│                     `--task Certified-Resupply-Rover-v0` just works
│                     (spawns→resets, quarantine→termination masks,
│                     friction uncertainty→DR ranges, gravity→sim cfg)
└── certificate.json  the warranty: what is verified, to what tolerance,
                      for which robot + self-validation appendix (CIs)
                      + SimReady validator rule report + SHA-256
```

Distribution: GitHub release + Hugging Face repo (dataset/checkpoint/USD).
Pitch line: **"Marble gives you a world in five minutes. We give you a robot
working in it — plus the training data — before your coffee is done."**

## 2. Hero world + task (locked)

**World — "Artemis Supply Hab":** Marble-generated lunar habitat interior
(storage bay, shelving, crates) with an **open airlock and raised metal sill**
onto sunlit regolith. Composed at the threshold so both sides sit inside the
fidelity envelope. Draft-tier iterations ($0.12) until one candidate carries:
a real collider hole OR plantable route defect, a ghost-geometry element, the
vendor scale factor, and a sill with a genuine rover/quadruped verdict
contrast. **The certificates pick the hero — Beat 3 is spoken only if the
loaded world's own certificate renders it.** Fallback: two-world pair
(existing habitat interior + moon exterior, cut at the airlock).
Earth-variant (generated warehouse loading dock) is the customer-conversation
twin — same pipeline, different prompt.

**Task — the resupply run:** move a supply crate from the storage bay to a
surface depot marker.
1. **Arm (Franka), recorded in Isaac at 1.62 m/s²:** crate from shelf to
   rover cargo bed. Pretrained lift checkpoint (verified downloadable);
   scripted RMPflow pick-and-place is the cannot-fail fallback.
2. **Rover, live in the browser:** drives the crate over the patched floor,
   around the quarantined ghost shelf, over the airlock sill, out to the
   depot on the certified navmesh.

**Twin run (the opening):** same rover, same route, RAW world — drops through
the floor / clips the ghost shelf within seconds. Deterministic, rehearsable.

## 3. The demo (3:00, pack-first — locked structure)

| Time | Beat | Content |
|---|---|---|
| 0:00 | **Output first** | Robot already running the resupply route; pack contents on screen; "this pack, hash on screen, goes up for download today" (present-tense download line unlocks AFTER the publish lane runs) |
| 0:25 | **Twin run** | Raw world failure. Two files nobody checks: ghost geometry, phantom colliders; "no training run ever crashes to tell you" |
| 0:55 | **The instrument** | Probe rain + virtual LiDAR + two-way divergence; two independent instruments per claim; trust map paints tested-&-solid / seen-not-tested / divergent (speak the on-screen legend words); grade + top defects |
| 1:25 | **Agent repair (MISSION LOG)** | Reasoning on screen from the cassette; scale-first diagnosis (doorways 1.27→2.02 m); patch FAILS regional recheck → revert → mesh_fill → holds; "the certifier audits our own repairs"; F→A, 75/75 outcomes (read off the screen) |
| 2:00 | **Certificate executes** | JSON→Isaac Lab config on screen 5 s; cut to Isaac footage: arm lift at lunar g, "nothing hand-placed"; per-robot sill verdict; "slope: unchanged under lunar gravity — a tool that faked physics would have moved it" |
| 2:40 | **Close** | Rover completes delivery live; SHA-256 pre-printed on Devpost re-hashed live, match; pipeline sentence; pride disclosure (pre-event open-source library) |

Q&A ammunition tier (NOT timed beats): falsification split-panel, neutrality
beat (rustic-kitchen scan certificate), outdoor recalibration before/after
card, Unity Kit certificate overlay, MCP, Mars flourish.

## 4. Build queue (strict order)

### Claude lane (code)
| # | Item | Bar | Est |
|---|---|---|---|
| C1 | Outdoor recalibration: survey judged only inside splat capture envelope; outside = "outside surveyed area", never a defect. Bench CIs must hold | moon-world spurious majors collapse; 27-world bench green | 1 d |
| C2 | Grade dynamic range (with C1): real worlds must rank (station > moon) | two real worlds get different grades | 0.5 d |
| C3 | **Canonical re-certification**: one run, all four worlds + hero candidates; replace stale certificates; re-record cassette; browser count == certificate count == cassette count | one number set everywhere | 0.5 d |
| C4 | Hero selection + Beat-3 truth: pick the world whose certificate renders the sill contrast; else rewrite Beat 3 to a contrast that exists | spoken sentence == `verdictsSummary()` output on the loaded world | 0.5 d |
| C5 | Copy-truth batch (humanize.ts): only sentences the new demo speaks | check ids real; accept-card derived from verdicts; denominators explicit | 0.5 d |
| C6 | Twin run choreography (raw-world failure + certified delivery route) | 20-s deterministic failure clip + live certified run | 1 d |
| C7 | MISSION LOG panel: stream cassette reasoning into Beat-4 UI, wifi-off | agent's own lines drive visible tool executions | 1 d |
| C8 | USD pack assembler: root stage (NuRec ref + collider w/ CollisionAPI + physics materials + spawn/quarantine prims; metersPerUnit/Z-up explicit) + SimReady validator report | fresh Isaac Sim: drag in → Play → rover stands on floor | 1 d |
| C9 | Isaac Lab task package around `certificateToIsaac()` | `--task Certified-Resupply-Rover-v0` trains/plays | 1 d |
| C10 | Determinism hash chip + Devpost hash | live re-run matches printed hash | 0.25 d |
| C11 | PREFLIGHT polish: `npx surveyor certify` exit codes + self-contained report.html | Ken's one-liner works on a clean machine | 1 d |

### Gemini-review additions (2026-07-07 external critique triage)
| # | Item | Bar | Est |
|---|---|---|---|
| C12 | **Vision-driven twin run**: the raw-run rover PLANS on the visual surface (splat-derived ground) and physics decides what it hits — upgrades the twin run from "navmesh rover finds the hole" to a direct demonstration of the poisoning thesis ("the planner sees pixels; physics sees the collider"). Honest on-screen label required | raw world: rover routes over visually-continuous floor and falls through the collider hole / is betrayed by ghost geometry; certified world: quarantine mask reroutes it, delivery completes | 1 d |
| C13 | **Batch hero fishing**: wrapper around marble.ts + certify + hero-check — cast N draft worlds, download, certify all, rank by validated twin-run failure routes ("the certificates pick the hero", mechanically, at fleet scale). Works in rank-only mode on already-downloaded bundles while the API wallet is empty | one command ranks any set of bundles; casts fire the moment credits unblock | 0.5 d |
| C14 | **Pitch-clarity sentence** (a hostile expert reviewer misread the architecture; judges will too): "the agent never edits geometry — it chooses from a closed menu of eleven tools (three read-only, eight deterministic reversible actions), and the instrument re-inspects every choice before it counts." Add to demo doc + README | sentence present in demo script Beat 4 and README | 0.1 d |
| C15 | **Q&A arsenal — the dynamic-contact receipt**: rehearse Gemini's three "breaking questions"; the answer to "static concordance ≠ dynamic fidelity" is G3b (contact-rich grip/lift/set-down in PhysX on the REPAIRED geometry, 0.3 mm at lunar g — also refutes "LLM patches explode solvers"), bounded by the printed non-claim ("not policy transfer") | answers written into demo doc Q&A section | 0.25 d |

### Sequencing lock + wording law (Gemini consistency round, 2026-07-07)

**The frozen dependency chain — no artifact is recorded before its inputs
are locked, and nothing is hashed before everything is frozen:**
1. **VISUAL TIER LOCKED: 100k is final.** The 500k re-render is CUT (zero
   rework risk beats a sharper background; the movie already reads).
2. G4 (policy video) and G5 (dataset — **500-frame teaser is the target**,
   scale up only if the evening has spare time) record against the locked
   visuals.
3. Pull the NuRec usdz into the LOCAL shipped pack; re-validate.
4. Assemble the final pack folder.
5. Stamp `HASHES.txt` on the frozen folder — LAST — then publish.

**Two hashes, never conflated:** the Devpost prints the **certificate
content-hash** (tier-independent; stable across re-renders). `HASHES.txt`
is the pack-file manifest, stamped in step 5. The stage re-hash beat uses
the certificate hash only — and the pre-printed value MUST be generated on
the exact demo laptop + browser that re-hashes it live (rehearse this).

**Wording law (zero ad-lib room):**
- Beat 3 sill line, verbatim: *"This specific 0.09 m sill fails the rover
  and passes the quadruped."* NEVER "this world fails the rover" — the
  world-level verdict fails both robots. (0.09 m is the hero-fish measured
  post-scale value; 0.15 m was a stale planning example — do not say it.)
- Beat 5′ video: **G4 policy video if G4 passes; else the G3c scripted
  video captioned "zero training required."** G3c remains a permanent
  artifact (fallback + the dynamic-contact receipt) either way.
- Gravity caption on the lift footage: *"gravity: 1.62 m/s² — set to the
  lunar mission profile."* Do NOT say "set by the pack's training
  contract" — the shipped pack contract certifies earth 9.81. Say "the
  habitat," never "moon base," unless the lunar hero world (f1f4e6b3) is
  the world on screen.
- **Lunar-contract receipt (2026-07-12):** both heroes re-certified locally
  under `--gravity moon --seed 1234` — side-by-side files, canonical earth
  certs untouched. Habitat hero `274782d1…`, moon world `622a1ded…`
  (`docs/validation/*-certificate-moon.json`). The receipt shows gravity
  changes MEASURED verdicts, not just a label: rover braking 0.14 m → 0.87 m,
  quadruped 0.06 m → 0.39 m (~6× at 1.62 m/s²), slope verdict unchanged —
  exactly what honest physics predicts. If asked "your films are lunar but
  your certificate is earth": both contracts exist, hashes printable.
- Twin-run label, verbatim mechanism: *"planning surface derived from
  splat centers (visual heightfield); physics runs on the collider."*

### Final-review resolutions (2026-07-07 night, external check on the finished project)

- **Instrument #4 (vision-traversal audit): SHELVED, not built.** Verdict
  accepted on all five design questions: a hardcoded agree-tolerance
  contradicts the per-robot verdicts (a 0.3 m phantom step would read AGREE
  while the certificate fails the rover on 0.09 m); single vertical rays
  miss lateral phantom walls; threshold drift between it and the trust map
  is a live on-stage contradiction risk; and C12 already demonstrates the
  concept embodied. **Adopted instead:** the twin-run narration gains the
  vocabulary — *"betrayal by fall"* (ghost floor) and *"betrayal by block"*
  (phantom mass) — and the phrase "vision-planning robot" is banned in
  favor of *"a geometric planner relying on the visual surface."*
- **Claim-softening law (B1):** we have PROVEN robots physically fail in
  unverified worlds (kinematic failure, on camera). "Policies learn false
  things" is the mechanism at stake, not a receipt — speak it only as
  "would learn," and answer the gap with the approved line: *"Surveyor is
  the prerequisite filter — physics solvers violently reject non-manifold
  ghost geometry; certification is mandatory before valid RL can even
  begin. The transfer-correlation study is the next receipt."*
- **Sell reframe (B3):** lead with the EXECUTABLE CONTRACT, not the
  document — for the agentic track the product is an **automated
  domain-randomization engine** that emits valid Isaac Lab configuration
  (spawns→resets, quarantine→masks, friction uncertainty→DR ranges); the
  certificate is its audit trail. The pack stays as-is; the emphasis moves.
- **Stage-narrative cuts (B5):** the ecosystem/roadmap bullet is OUT of the
  3:00 and the memorized spine; the G4 Earth-g fumble detail is OUT of
  narration (kept in logs/README as an honest note) — the lunar
  fumble-chase-recover story stays, it is the lunar run's own arc.
- **C16: DONE — raw 0/15, repaired 13/15.** Fifteen BFS navmesh routes
  (clearance-eroded grid, waypoint chains, endpoints = verified spawns +
  seeded certified-floor samples), one driven-sphere controller, seed 1234,
  deterministic. Every route falls within a meter on the raw collider (the
  certified spawns sit above raw holes); 13 complete on the repaired one
  (2 honest `blocked`). Artifact: `paired-receipt.json` in the pack's
  contract/ (manifest re-stamped; certificate header hash unchanged —
  sha ritual re-verified f68e3de1). Bench test: same route falls on the
  planted hole, arrives on the intact floor, byte-deterministic (43/43
  suite green). Code: `src/validation/pairedGoals.ts`,
  `scripts/paired-receipt.ts`.

### Cluster lane (Gilbreth evenings, priority order per pipeline-v2 P1–P8)
| # | Item | Gate |
|---|---|---|
| G1 | First hour: `sinteractive -p a10`, `nvidia-smi` driver check, container pin, net test | **P1 — decides the whole Isaac layer** |
| G2 | Hero world ply→USDZ visual QA + drag-in pack test | P2/P3 |
| G3 | Scripted pick-and-place recording at 1.62 m/s² (guaranteed ending) | P4 |
| G4 | Pretrained lift checkpoint in the pack world (wow layer; fine-tune ≤300 iters if floaty) | P5 |
| G5 | Replicator SDG: ~5,000 frames, cameras masked to verified free space | P6 |
| G6 | Twin-run paired receipt if time: N≈10–20 nav goals raw vs repaired, honest caveats | stretch |
| G7 | **Traversal films in the repaired photoreal world, FP + TP cameras**: (a) G7a driven rover crossing the repaired floor — first-person + third-person chase recorded simultaneously (honest label: "driven rigid body on certified ground"); (b) G7b quadruped WALKING via pretrained Isaac Lab velocity policy (Go2/Anymal checkpoint, zero training) in the pack stage, same two-camera rig — blocked on offline-fetching robot USD + checkpoint to scratch | both camera streams non-blank + traversal completes; quadruped falls back to rover-only if assets unfetchable | user-directed (this session) |

### User lane (calendar — deadlines, not dependencies)
- Rules answer **Jul 8 EOD** (else contingency fires, pre-committed)
- Book both Gilbreth evenings **now**; G1 in the first one
- Gate-A fps number from the actual demo laptop, written into HANDOFF
- Draft-tier hybrid prompts tonight (~5 × $0.12) so hero candidates exist when C1–C3 can grade them honestly
- Unity Kit access + confirm it applies to the SIGGRAPH edition
- 3–5 real customer conversations (guide + venues in `customer-discovery.md`)

## 5. Kill criteria / fallbacks (same-day, pre-committed)
| Failure | Fallback |
|---|---|
| P1 driver too old | Isaac beats → any borrowed RTX ≥12 GB machine; else pipeline demoted to slides, browser demo stands alone |
| NuRec conversion artifacts unresolved | Isaac beats render collider-world; splat visuals stay browser-side; recentering preflight shipped regardless |
| No hero world with sill contrast | Beat 3 rewritten around hole+ghost contrast (which every candidate has); sill demoted to Q&A |
| Lift checkpoint misbehaves at lunar g | Scripted pick-and-place footage only; caption "zero training required" |
| SDG evening lost | Pack ships with a 500-frame teaser set; full dataset post-event |
| Live rover run flaky at rehearsal | Cassette replay, disclosed; twin-run failure clip is pre-recorded anyway |

## 6. Explicitly cut / deferred
Full Mission Control chrome (MISSION LOG panel only) · Reading Room UX ·
First Steps drivable embodiment (the scripted incident clip survives as the
twin run) · Changeset PR shell (commit-timeline + patch-tint only if hours
remain) · ONNX-in-browser sim2sim · falsification live panel (Q&A card) ·
Mars flourish · MCP stage time · any Unity work beyond the certificate
overlay · further instrument tightening beyond C1–C5.

## 7. Claims ledger (nothing is spoken until its bucket clears)
- **True today:** bench CIs (96.8% recall, CI ≥85.6%, n=31); F→A episode,
  75/75 outcomes incl. organic fail-revert-adapt (regenerate any spoken count from the artifact); byte-identical determinism
  (tested); gravity-invariant slope verdict (tested); headless CLI; Isaac
  contract compiler.
- **After C1–C3:** one defect count everywhere; outdoor before/after; grades
  that rank real worlds.
- **After C4 + world curation:** the Beat-3 sill sentence.
- **After G1–G5:** Isaac footage, dataset, drag-in pack moment, twin-run
  receipt.

## 8. The pitch spine (memorize)
Open: *"That base didn't exist this morning."*
Middle: *"Nothing is called a defect unless two independent instruments
agree; nothing is called repaired until the same instruments pass it again."*
Execute: *"Every parameter of this training run came from the certificate —
nothing hand-placed."*
Close: *"World models generate the pixels. Surveyor certifies the physics.
Isaac trains the robot. The certificate is the contract between them."*
