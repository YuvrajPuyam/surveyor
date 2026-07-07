# SURVEYOR — session pickup (2026-07-07)

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

## LIVE THREAD 1 — G3c blank frames (render path)

> **UPDATE 2026-07-07 (this session): ROOT-CAUSED via g3c-dbg bisect on a
> minimal stage.** `Camera.get_rgba()` works from 8 warmups after a SINGLE
> `world.reset()` (red cube renders, RTX active). g3c's blank frames come
> from its THREE stop/reset cycles orphaning the render product bound at the
> early `cam.initialize()`. Fix landed in `isaac/cluster/g3c.py`: re-bind
> `cam.initialize()` AFTER the final reset + spread-verified warmup (abort
> before choreography if still uniform). Full run resubmitted (job 11221410).
> **Second finding: `rep.orchestrator.step()` HANGS headless in this
> container** (g3c-dbg died at walltime right after annotator attach) — G5's
> SDG must use the Camera sensor path or Replicator's writer WITHOUT
> orchestrator.step. The original hypotheses below are kept for history.

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
