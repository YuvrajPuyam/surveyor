# SURVEYOR — session pickup (2026-07-07)

## ⏸ CHECKPOINT 3 (2026-07-12) — HD + G7 films, read FIRST

- **HD DONE both sides:** browser renders splat-500k.spz (verified, dev HUD);
  pack usdz swapped to 500k (59MB; BACKUP-100k.usdz kept). New additive
  fetcher `scripts/fetch-splat-tier.ts` (frozen-bundle-safe).
- **COMPOSITING PROVEN:** Go2 leg + its shadow on the splat floor in a wide
  frame (proxy REL + wide static cam at proven eye). The open question died.
- **Go2 WALKED 1.44 m** (flat brain @0.3 m/s, 800 steps, no fall) — but that
  run's frames were rm'd by the next submission. **NEW LAW: sbatches now
  auto-encode mp4s per run (g7X-{fp,tp}-job<ID>.mp4); never lose footage
  again.** g7a's current run banked: g7a-{fp,tp}-BANKED.mp4 on scratch.
- Framing truths at 500k: the g3c-proven aim is now FOG (denser splats);
  the g7b walk-line framing (crisp wall + robot) is the best recipe. g7b
  hood cam can read blank at spawn — guard relaxed to both-blank.
- **In queue: job 11264207** (g7b walk re-run, auto-encodes). After it:
  pull mp4s → eyeball → iterate g7a wide framing toward the g7b recipe
  (aim across the walk/drive line from the proven eye, NOT down-corridor)
  → final films into assets/isaac/.
- Viewer: WASD/arrow fly navigation shipped (V=wireframe, G=dev now);
  foreground check pending (RAF suspended in hidden tabs).

## ⏸ PAUSE CHECKPOINT 2 (2026-07-09) — G7 traversal films, read first

> **FINAL STATE (context-exhausted handoff, 2026-07-09):** jobs
> 11243376/11243377 (UTF-8 fix — LAW: write cluster python with
> encoding='utf-8'; cp1252 em-dashes = instant SyntaxError). **g7a PASS
> mechanically but TP frame still olive splat-murk — proxy REL alone does
> NOT composite the chase cam; rover still invisible.** Next levers, in
> order: (1) camera placement OUT of the dense shell (TP rides at
> body+(-1.9,0,1.1) — at spawn that's inside the wall fuzz; try low/close
> chase (-1.0,0,0.45) or a STATIC root-level rail cam beside the corridor
> watching the drive), (2) `omni:nurec:useProxyTransform`/volume depth
> settings, (3) BANKABLE: gray-world mode (deactivate Visuals +
> visible-ize collider — the proven g3c recipe; guaranteed rover films).
> **g7b: ran full 800 steps, no fall, 800 frames/cam CAPTURED, cameras see
> photoreal content (fp 119, tp 213) — but rough policy only STOOD
> (0.08 m; height-scanner likely reads garbage off USD terrain). Footage
> may still cut as 'Go2 standing/shifting in the certified photoreal
> world'. Next: eyeball + encode the 800 frames; for a real WALK try flat
> ckpt at 0.3 m/s on the corridor, or fix the scanner (RayCaster target
> pattern -> the referenced collider mesh path).** Encode recipe in Live
> Thread 1 (mpeg4 -q:v 2; no libx264 on login node).

> **UPDATE (later 2026-07-09, iteration 4):** NuRec `proxy` REL found via
> dbg7 (empty relationship on the Volume prim `/World/Visuals/gauss/gauss`)
> and linked to the collider in BOTH scripts → **first photoreal
> robot-camera frame captured** (g7b chase cam, real Marble texture).
> g7b: render ticks fixed EMPTY cameras (out-of-band sensors need explicit
> env.sim.render() in isaaclab envs); env.close() before app.close() (else
> 25-min teardown hang); Go2 WALKED 0.69 m (flat ckpt, far spawn — outside
> splat envelope y∈[-3.3,12.4]!) then 0.29 m on the rover corridor — flat
> policy trips on the stepped 3° deck → **rough checkpoint fetched**
> (go2-assets/go2-rough-checkpoint.pt) + rough-first cfg + terrain
> curriculum DISABLED (terrain_levels — assumes a generator; USD terrain
> has none). g7a: sbatch stale-results bug fixed (rm results first);
> latest mystery = apptainer failed 3× pre-python (no results file at
> all) — g7a.out head from jobs 11243368/11243369 (watcher b7rqqndm6)
> names the error. Quadruped spawn NOTE: spawns[-1] sits OUTSIDE the
> visual envelope; spawns[0] (rover corridor) is inside.

**Goal (user-directed):** rover + walking Go2 quadruped traversing the
REPAIRED photoreal world, FP + TP recordings. `isaac/cluster/g7a.py` /
`g7b.py` (+ sbatch). ENDGAME G7 entry exists.

- **g7a rover: G7A_PASS mechanically** (arrives, 166 frames/cam, tracking
  guard green, direction probing picks the 4.5 m certified corridor) —
  **but the footage is unusable: NuRec volume does not occlusion-composite
  with mesh prims.** FP = clear gray (facing out of the splat envelope /
  volume not drawn); TP = uniform olive fuzz (camera inside splat cloud,
  and THE ROVER IS INVISIBLE in a frame aimed at it). The g3c box-lift mp4
  predates the NuRec conversion — mesh+active-splats compositing has NEVER
  been proven on this stack.
- **NEXT EXPERIMENT (first move):** link the collider as the NuRec field's
  PROXY mesh (the Marble→Isaac guide's occlusion step — relationship on the
  OmniNuRecFieldAsset / Volume prim under /World/Visuals; inspect its attrs
  with a 3-min dbg job listing properties). If proxy linkage fixes
  compositing → g7a/g7b/g3c all inherit photoreal. **Bankable fallback
  (proven g3c recipe): deactivate /World/Visuals + visible-ize collider —
  gray-world films TODAY, photoreal upgrade later.** Also: route/cameras
  should face INTO the splat interior (drive the certified corridor
  REVERSED: spawn at (0.30,-0.91), drive +Y toward (0.30,3.59)).
- **g7b Go2 walk: 3 iterations in, every hard stage PASSED** (env-in-pack,
  nested PhysicsScene defused, checkpoint loaded, base link found, cameras
  init). Last fix: get_observations returns bare obs (not tuple). Job
  11243023 in queue — check `g7b-results.txt`. Same NuRec compositing
  caveat applies to its footage.
- Camera laws learned (in code): inverse-scale rig proxy under scaled prims
  (LookAt shears under non-uniform scale); near-clip 0.05 (USD default 1 m
  eats the world); cameras as children of physics bodies DO track (Fabric).
- Go2 assets offline at `/scratch/.../go2-assets/` (go2.usd +
  Props/instanceable_meshes.usd + rsl_rl flat checkpoint). Rough-terrain
  checkpoint = same URL pattern if the flat policy stumbles on stepped floor.

## ⏸ PAUSE CHECKPOINT (end of 2026-07-07 session) — read this first

- **G3c CLOSED**: `assets/isaac/g3c-box-lift.mp4` exists (27.2 s box-lift in
  the pack at lunar g). Root cause + coordinate law in Live Thread 1 below.
- **Gemini external critique triaged** → ENDGAME "Gemini-review additions"
  C12–C15. Brief lives at `docs/gemini-review-brief.md` (reusable for any
  external reviewer).
- **C12 vision-driven twin run: DONE + VERIFIED live in the viewer.**
  New `app/src/visualGround.ts` (visual-floor heightfield from splat
  centers); twinRun plans crossings on the VISUAL surface, physics decides.
  Hero-world receipt: route d-hole-3, **vision 13/16 sight-lines on visual
  floor, median Δ 4 mm across a gap the collider doesn't have**, rover fell
  at step 591. Narration verified: "planned on what the cameras see…" →
  fall → "The cameras said floor. The collider said nothing." App tsc clean.
- **C13 batch hero fishing: DONE + maiden run clean.** `hero-fish.ts --scan
  assets/marble` → **2/6 HEROES: the habitat 7188e250 AND the moon world
  f1f4e6b3** (post-recalibration: 18 holes, 4 in-band sills, validated
  twin-run route — a LUNAR hero fits the Artemis narrative). Nuance
  unlocked: the habitat has 2 sills IN the rover-fail/quadruped-pass band
  (0.09 m post-scale) — a **per-sill Beat-3 contrast is truthfully
  speakable** (point at the sill, not the world-level verdict, which still
  fails both on the 0.56 m worst step).
- **C14 + C15 DONE**: architecture line ("the agent never edits geometry —
  nine deterministic reversible tools, every choice re-inspected") in
  Beat 4 + README invariants; Q&A arsenal in demo-five-beats.md — the three
  Gemini breaking questions answered with receipts (G3b = the
  dynamic-contact answer). 41/41 tests green. **Gemini triage complete.**
- **User lane unchanged and urgent:** rules answer **Jul 8 EOD**; two Marble
  APP generations (Mars/Moon NASA photos — casts staged in Live Thread 2)
  then `hero-fish.ts --download <ids>`; foreground-browser fps number;
  Unity Kit access.
- **NuRec conversion: DONE (later this session).** 3dgrut installed on
  Gilbreth (`install-3dgrut.sh`; fixes: UV path, conda-base leak, slangtorch,
  TORCH_CUDA_ARCH_LIST=8.6 set AFTER venv activate, ply_to_usd patched
  `NuRecExporter(export_cameras=False)`). `hero-100k.usdz` (11.6 MB) sits at
  `canonical-pack/world/nurec/<worldId>.usdz` on the cluster — **dbg6 proved
  it RENDERS** (Volume/OmniNuRecFieldAsset, warm photoreal tones; PNG receipt).
  Local: `hero-100k.ply` conversion via `npx @playcanvas/splat-transform`.
- **PHOTOREAL G3c: DONE (resumed session).** Job 11222304 turned out to have
  run the OLD script (the pre-pause `.replace` patch silently didn't match —
  lesson: verify the marker string on BOTH ends before submitting). Re-run
  as job 11222317 with verified patch: `NuRec visuals active: True`,
  G3C_PASS, 816 frames — **`assets/isaac/g3c-box-lift.mp4` is now the
  photoreal version** (Franka + crate inside the Marble habitat splats,
  same -0.551 physics receipt, H.264).
- **100k splats are blurry in the render** — the hero bundle only has the
  100k tier. `scripts/marble.ts` now takes `MARBLE_TIER=500k` env override
  (uncommitted-then-committed this session; the 500k download itself was NOT
  run — user paused). 500k → ply → `nurec-convert.sbatch` → sharper movie.
- **CLUSTER LANE COMPLETE (G1–G5, later this session).**
  - **G4_PASS**: the PRETRAINED rsl_rl lift policy (hand-rolled inference,
    36-dim obs matching the checkpoint exactly, no Nucleus) grasps and
    delivers the crate at LUNAR gravity in the pack — lift 0.379 m, goal
    2.6 cm, zero training; it even RECOVERS from knocking the cube to the
    floor. Winning fix: teleport the ROBOT BASE so cube−base = 0.0550
    measured (props can't be moved mid-sim; the policy only sees relative
    state). Video: `assets/isaac/g4-policy-lift.mp4` (14 s H.264).
    Camera law addendum: splat fog constrains camera placement — reuse
    verified-clear eyes; 28 mm lens for vertical coverage.
  - **G5_PASS**: 500-frame labeled SDG teaser (RGB/depth/bbox2d/semseg),
    labeled crates at verified spawns, eyes above verified spawns,
    bbox-required gate (every frame provably sees a crate), rejections
    itemized (1366 fog / 367 no-label), seed 1234. Tarball being pulled to
    `assets/packs/g5-dataset.tar.gz` (gitignored — ships via HF/Release).
  - Process hardening now standard: ASCII-only cluster scripts + compile
    check on BOTH ends before submit; sbatch clears stale results files.
- **THE PACK IS ASSEMBLED**: `assets/packs/artemis-supply-hab-pack/`
  (121 MB, 21 files, gitignored): world/ (usda + nurec usdz + validator
  reports), dataset/ (500-frame tar + manifest), policy/ (checkpoint + both
  videos + inference-reference.py), contract/, certificate.json,
  self-validation.json, report.html, HASHES.txt stamped LAST (header =
  certificate content-hash 6b2909f1, the Devpost value). Beat 5′ spliced
  into demo-five-beats.md with the verbatim caption + Beat-3 sill wording.
- **DRIFT INCIDENT + CURE (read before touching any bundle):** a casual
  marble.ts re-download regenerated visual-points.f32 with the current
  parser and broke every canonical hash (21→25 defects, f68e3de1→cfc6d0ad).
  Healed byte-exactly by regenerating the f32 with the era-correct parser
  from git history (`git show 7aa3e067:src/ingest/spz.ts`) — receipt that
  Marble server bytes never changed. **marble.ts now REFUSES to overwrite
  an existing bundle** (frozen instrument inputs; MARBLE_FORCE=1 to
  override). The regen recipe lives in this incident note.
- **REMAINING:** publish (GitHub release + HF + Devpost page printing the
  certificate content-hash — USER-GATED, outward-facing) → stage-laptop
  hash rehearsal → dress rehearsals. The build queue is otherwise EMPTY.

Read this first, then `HANDOFF.md` for the full canonical brief. This file is
the *delta* since the last big handoff: the cluster G3 arc and the two live
threads worth a fresh pair of hands.

---

## TL;DR — where we are

- **Code lane C1–C11: DONE** (41 tests green). **Instrument #3 (pano-depth
  audit): DONE.** Nothing outstanding there.
- **Cluster G3 arc: physics COMPLETE, one render bug open.**
  - **G3a PASS** — rigid body rests on the repaired floor at a
    certificate-verified spawn; PhysX matches the Rapier-certified geometry to
    **1 mm**. (`isaac/cluster/g3a.{py,sbatch}`)
  - **G3b PASS** — Franka (bundled URDF) + RMPflow (bundled config) picks a
    6 cm crate off a shelf and sets it on the rover bed inside the pack stage
    at lunar gravity 1.62 m/s²; set-down **0.3 mm** from the probe-measured
    bed. (`isaac/cluster/g3b.{py,sbatch}`, committed)
  - **G3c — PHYSICS PASS, FRAMES BLANK.** Same choreography, `G3C_PASS`, 816
    PNGs captured at 1280×720 — **but every frame is uniform gray**. Capture
    *plumbing* works; the render sees an empty stage. **This is the one live
    bug.** (`g3c.{py,sbatch}` in scratchpad — NOT yet committed.)
- **Hero fishing (Mars/Moon worlds): still blocked** on the Marble **API**
  credit bucket. No progress possible without one of the three unblocks below.

---

## LIVE THREAD 1 — G3c blank frames — **CLOSED (G3C_PASS with real pixels)**

> **RESOLVED 2026-07-07 after a 16-job bisect saga. The renderer was never
> broken. The camera was.** The pack's `/World` root carries the documented
> +90° X source-frame rotation (Y-up→Z-up); the capture camera + its
> diagnostic marker were authored UNDER /World using already-converted Z-up
> world coordinates → double-rotated together into empty space. The marker
> always rendered (it rides with the camera); the world never did (it was
> where the camera wasn't). Physics was correct throughout because
> isaacsim's `position=` args are world-frame (parent-compensating) and the
> robot sits at root level.
>
> **THE COORDINATE LAW (runbook, applies to G4/G5 and every future capture
> job):** world-space coordinates go on ROOT-LEVEL prims. Anything authored
> under `/World` is in the pack's source frame. isaacsim object `position=`
> compensates; raw `UsdGeom`/`XformCommonAPI` authoring does NOT.
>
> Final artifact: `assets/isaac/g3c-box-lift.mp4` (27.2 s, 816 frames,
> 1280×720@30) — Franka picks the crate off the shelf and sets it on the
> rover bed inside the Certified World Pack at 1.62 m/s², set-down
> −0.551 m vs −0.551 m probe-measured. FRANKA logo legible on the gripper.
> Encode recipe: login node `bash -lc 'module load ffmpeg'`, then
> `ffmpeg -framerate 30 -i g3c-frames/frame_%05d.png -c:v mpeg4 -q:v 2
> -pix_fmt yuv420p out.mp4` (this spack ffmpeg has NO libx264).
>
> Hard-won side-findings, all still true: `rep.orchestrator.step()` hangs
> headless (G5 must use the Camera-sensor path); `URDFParseAndImportFile`
> into the OPEN stage mutates+saves the .usda (always import to a dest_path
> file and reference it); default USD camera is a ~24° telephoto (50 mm) —
> compose accordingly; judge frames by CENTER-region spread (border lines
> fool full-frame checks); one `world.reset()`, no stops, park probes
> instead of removing them.

**Symptom:** `G3C_PASS` (physics + 816 frames written), but sampled frames
(`frame_00010/00330/00500` pulled to scratchpad) are pure `#d0d0d0` — no
robot, no props, no world. Uniform clear-color = nothing rasterized into the
annotator buffer.

**Two clues in the log:**
1. `world meshes made visible: 1` — the traversal found only **one**
   `UsdGeom.Mesh` outside `/panda`. The pack's *visual* geometry is a **NuRec
   `.usdz` payload** (at `/World/Visuals`) that is **not present/resolved** on
   the cluster (this was the "NuRec payload warning" from the G3-boot gate —
   by design, we never converted it). So the world itself has ~no renderable
   surface, only the collider.
2. BUT the Franka and the 3 colored cuboids (shelf/bed/crate) have their own
   render meshes and **still don't appear** → this is a **render-capture
   failure**, not just missing world geometry. Leading hypotheses, in order:
   - **RTX/annotator warmup**: `cam.get_rgba()` may be returning the clear
     buffer before the RTX path has populated. Current code does 8 warmup
     `world.step(render=True)` then one snap. Try many more `app.update()` /
     render ticks before the first real read, and confirm a non-uniform frame
     *before* running the whole 27 s.
   - **Wrong capture API**: swap the `Camera.get_rgba()` path for the
     Replicator writer path — `omni.replicator.core` `render_product` +
     `BasicWriter(rgb=True)` (or `AnnotatorRegistry.get_annotator("rgb")` +
     `annot.get_data()` after `rep.orchestrator.step()`), which is the
     better-trodden headless-SDG route and also derisks G5.
   - **Renderer not RTX in headless**: may need explicit
     `--/renderer/enabled='rtx'` / `--/omni/replicator/...` carb settings or
     an `app.update()` loop between physics steps so the render graph ticks.

**Fastest debug loop:** a tiny throwaway script — enable_cameras, add a dome
light + one big bright cuboid *right in front of* the camera, warmup N ticks,
snap ONE frame, print `rgba.mean()` and per-channel spread. Sweep N and the
capture API until the frame is non-uniform. THEN port the winner back into
g3c. Don't re-run the full 3 min choreography to test the render path.

**Also worth doing once it renders:** give the world some visible substance so
the shot isn't the robot floating in void — either a large ground plane at the
measured floor, or make the collider mesh a proper lit surface. The certified
collider *is* the honest thing to show (that's the whole product), so
rendering the collider in surveyor-gray under good light is on-brand.

**When frames are real:** assemble the MP4 (ffmpeg on the login node, or pull
frames and encode locally). That's the demo's guaranteed ending as pixels.

---

## LIVE THREAD 2 — Hero fishing (Mars/Moon), blocked

Goal: cast the two NASA photos → Marble worlds → certify → `hero-check`, then
expand via the pano-chain ladder (world's own 360° pano fed back in to grow
terrain beyond the source photo). Base set is meant to be cheap
`marble-1.0-draft`.

**Blocker:** every `worlds:generate` returns **402 Insufficient API credits**,
at premium AND draft tier. Marble has **two separate wallets** — the app
subscription the user bought does NOT fund the API. (Saved to memory:
`marble-credit-buckets`.)

**Everything is staged and one keystroke away:**
- Source photos downloaded to the user's **Downloads** folder:
  `mars-PIA25075.jpg`, `moon-as17-146-22294.jpg` (also in scratchpad).
- `scripts/marble.ts` now has an **`image`** command (single non-pano image →
  world), committed. Exact casts to fire:
  ```
  npx tsx scripts/marble.ts image --uri "https://images-assets.nasa.gov/image/PIA25075/PIA25075~large.jpg" --prompt "martian surface at Jezero crater, rocky terrain with scattered boulders and a low hill, explorable ground in all directions" --model marble-1.0-draft --name base-mars-santacruz
  npx tsx scripts/marble.ts image --uri "https://images-assets.nasa.gov/image/as17-146-22294/as17-146-22294~large.jpg" --prompt "lunar surface at the base of a massif, a large split boulder and rolling regolith terrain, explorable ground in all directions" --model marble-1.0-draft --name base-moon-station6
  ```

**Three ways to unblock (any one):**
1. Fund the API wallet at **platform.worldlabs.ai/billing** (or enable
   auto-refill) → retry the two casts above.
2. User generates the two worlds in the **Marble app** (spends the app
   credits they already own) → hand over the two world ids → ingest free via
   `npx tsx scripts/marble.ts download <worldId>` → certify → hero-check.
3. Install the **Claude in Chrome** extension + sign in → the agent can drive
   marble.worldlabs.ai directly. (Tried this session: extension not connected;
   `request_access` for desktop control timed out.)

**Weighing station (runs free once a world is on disk):**
```
node bin/surveyor.mjs certify assets/marble/<id> --write-bundle
npx tsx scripts/hero-check.ts <bundle> <cert.json>
```
"The certificates pick the hero" — a world is the hero only if a validated
twin-run failure route derives (press **R** in the viewer, or hero-check
headless).

---

## Cluster runbook (condensed — full version in HANDOFF §7c)

- **Host:** `ssh gilbreth.rcac.purdue.edu` (BoilerKey/SSH-key; `-o BatchMode=yes`).
  Working dir: `/scratch/gilbreth/gupta596/surveyor/`.
- **Container:** `isaac-lab-2.3.0.sif` (7.8 GB). Run pattern is baked into the
  `.sbatch` files — `apptainer exec --cleanenv --nv` + node-local kit-dir
  binds + EULA envs + `/workspace/isaaclab/isaaclab.sh -p <script>`.
- **Submit:** `--qos=standby` (bypasses AssocGrpGRES; runs in minutes),
  `-A bera89 -p a10 --gres=gpu:1 --mem=64G`. **Kit swallows stdout → scripts
  write results to a FILE** (`g3X-results.txt`).
- **Kit heap-crash lottery (~20% of runs):** `malloc/tcache abort` at
  `enable_extension`. Mitigations already in the sbatch: a **3-try retry loop**
  (break when the results file has a verdict) + **node blacklist**
  `-x gilbreth-h000,gilbreth-h014` (h000 also hangs 35 min before aborting).
- **Watcher pattern** (survives SSH resets — use keepalives):
  ```
  ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=10 gilbreth.rcac.purdue.edu \
    "while squeue -j <JOB> -h -o %T | grep -q .; do sleep 45; done; \
     sacct -j <JOB> --format=State,Elapsed,NodeList -X -n; \
     cat /scratch/gilbreth/gupta596/surveyor/g3X-results.txt"
  ```
  Run it with `run_in_background: true`; you get notified on completion.

**Hard-won Isaac gotchas (all already handled in g3b/g3c, keep them):**
- USD xform/bbox reads are STALE during sim (Fabric owns physics poses) — use
  RigidPrim/Articulation APIs for runtime truth, never `ComputeWorldBound` /
  `get_world_transform_matrix` on a moving prim.
- `FixedCuboid(scale=...)` collision extents ≠ naive size math — **drop a probe
  body and measure** the surface it rests on. (This is what made g3b pass;
  attempts 3–5 "failed" only because assertions trusted math, not physics.)
- **Never remove prims mid-play** (invalidates physics tensor views →
  "Failed to get DOF position targets"): `world.stop()` → remove → `reset()`.
- URDF importer mimics `panda_finger_joint2` off joint1 → `DriveAPI.Apply`
  in try/except, find finger DOFs by name prefix.
- Headless cameras need **`AppLauncher(headless=True, enable_cameras=True)`**
  AND `enable_extension("isaacsim.sensors.camera")` — without the launcher
  flag you get `Invalid object in Py_Graph in getWrappedGraphFromNode`.
- Offline assets confirmed in-container: Franka URDF at
  `/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf`;
  RMPflow config via `load_supported_motion_policy_config("Franka","RMPflow")`
  (EE frame `right_gripper` = fingertip midpoint — target the crate center,
  not a hand offset). Compute nodes have **no internet** — never rely on nucleus.

---

## Immediate next moves (suggested order)

1. **Fix G3c render** (Live Thread 1) — tiny debug script first, then port
   back, then encode the MP4. Commit `g3c.{py,sbatch}` into `isaac/cluster/`
   once it renders. This is the highest-value open item: it turns a proven-in-
   telemetry result into a *watchable* one.
2. **Hero fishing** the moment any unblock lands (Live Thread 2). Retry is
   automatic on the next message if the API wallet gets funded.
3. Then the cluster continues: **G4** (lift checkpoint), **G5** (Replicator
   SDG masked to verified free space — the render fix from #1 derisks this
   directly), and the **NuRec `.usdz`** conversion (the pack's one missing
   artifact — and the same missing payload that made G3c's world render empty).
4. One full **Beat 1→5 rehearsal** in the viewer — the only unrehearsed app
   surface (see HANDOFF §8).

## Positioning note (in case a judge asks) — HANDOFF §7d
"Isn't this NVIDIA Cosmos?" No — Cosmos generates **video** worlds (Predict/
Transfer/Reason); no collider, no interactive asset, physics is a learned
prior. SURVEYOR takes worlds a robot will *touch* (splats + collider),
measures visual-vs-physical disagreement, repairs it, and signs a
deterministic certificate. Receipt: PhysX corroborated our Rapier-certified
floor to 1 mm (G3a). "Cosmos dreams worlds. SURVEYOR decides whether a robot
may move in — and signs the certificate."

## Money / secrets
- `.env` holds `MARBLE_API_KEY` — gitignored; never print/commit.
- `assets/marble/**` gitignored (bundles + canonical certs live on disk only).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Ask before spending Marble credits or anything outward-facing.
