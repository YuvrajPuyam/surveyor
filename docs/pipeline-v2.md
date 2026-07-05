# SURVEYOR pipeline v2 — the certified world factory feeding Isaac

**Status (2026-07-05):** feasibility verified by four independent research
passes (asset conversion, NuRec rendering, manipulation path, Gilbreth
cluster) — **all four FEASIBLE**, every load-bearing claim source-checked,
the pretrained lift checkpoint confirmed downloadable (HTTP 200) the same
day. This document extends `PLAN.md` — the five-beat demo
(`docs/demo-five-beats.md`) keeps its shape and gains one closing beat.
Kill criteria here follow the same rule as PLAN §10: fallback fires the
same day the gate fails.

> **The pipeline in one paragraph.** Marble generates the world; Surveyor
> certifies and repairs it; the certificate *executes* — its spawn points,
> quarantine mask, and uncertainty ranges become the Isaac Lab training
> configuration; a robot trains (or a pretrained policy deploys) in the
> certified world at lunar gravity and does a real task — lifts a box and
> places it at a target. The certificate is the contract between the world
> model and the robot.

---

## 1. Strategic position (read this before building)

NVIDIA has published this integration as an official blog — *"Simulate
Robotic Environments Faster with NVIDIA Isaac Sim and World Labs Marble"*
(splat PLY + collider GLB → 3dgrut → NuRec in Isaac Sim → physics on the
collider → robot inserted). World Labs' own robotics case study runs
ANYmal/Spot/Franka in Marble worlds.

Two consequences, both load-bearing:

1. **Integration risk ≈ zero.** Every stage below follows a vendor-blessed
   path with named public tools. We are not pioneering; we are assembling.
2. **Integration novelty ≈ zero.** The NVIDIA blog aligns the collider
   with the splats *by hand* and never verifies the two files agree. The
   certification layer is the only part of this pipeline NVIDIA's blog
   does not have — Surveyor is the differentiation, not the plumbing.
   Every demo sentence must keep the certificate visible as the thing
   doing work (DR ranges appearing in the Isaac config, episodes routing
   around the quarantine), or we've demoed NVIDIA's blog post.

**Pitch line:** "World models generate the pixels; Surveyor certifies the
physics; Isaac trains the robot — and the certificate is the contract
between them."

---

## 2. Verified reference facts (2026-07-05, all source-checked)

- **SPZ → PLY:** PlayCanvas `splat-transform` (npm, v2.7.1) reads SPZ v2–4,
  writes PLY; `-s/-r/-t` flags can bake Marble's `metric_scale_factor` and
  axis rotation directly into the splat. Niantic `spz` lib + browser
  converter as alternates. Marble paid tier exports full-res PLY directly —
  may skip this hop entirely.
- **PLY → NuRec:** `nv-tlabs/3dgrut`:
  `python -m threedgrut.export.scripts.ply_to_usd model.ply --output_file out.usdz`
  (the exact command from NVIDIA's Marble blog). Needs CUDA GPU. Isaac Sim
  5.x consumes NuRec USDZ; **6.0 prefers the standard-USD `ParticleField`
  schema** (custom USDZ headed for deprecation) — pin Isaac version, pick
  matching schema. Known artifact reports on this conversion → visual QA
  mandatory (Gate P2).
- **Splats as camera input:** NuRec renders inside the RTX renderer itself;
  **pinhole robot cameras get splat RGB in their render products** —
  vision observations and Replicator/SDG both work
  (`isaacsim.replicator.nurec_utils` shipped in 6.0.1). Splats have
  baked-in lighting (robot's lights won't relight the world) and **zero
  collision** — physics comes entirely from our certified collider, which
  is the thesis as an architecture requirement. No published precedent for
  tiled multi-env vision RL over NuRec — vision claims stay at SDG /
  few-env scale.
- **GLB → USD:** Isaac's asset converter, with a **confirmed cm-units bug**
  (stage lands at `metersPerUnit = 0.01`; `use_meter_as_world_unit` does
  not fix it) plus the known **−90° X rotation** (glTF Y-up → Isaac Z-up).
  Mitigation: author scale/orientation explicitly in Python, never trust
  the converter's defaults.
- **Static collider physics:** triangle-mesh collision (approximation
  "none") is supported for static bodies —
  `UsdPhysics.CollisionAPI` + `MeshCollisionAPI("none")`, no RigidBodyAPI.
  **Per-GeomSubset friction is supported for exactly this case** (static
  tri-mesh, "Triangle Mesh Multimaterial" demo snippet) via
  `UsdShade` physics-purpose bindings — Marble's GLB carries no subsets, so
  the material pass must author face subsets first.
- **SimReady:** open spec + pip-installable validator
  (`simready-validate`, NVIDIA/simready-foundation) — but **all shipped
  profiles are prop/robot-scoped; no environment profile exists.** We may
  run individual physics rules and say so; we never say
  "SimReady-certified environment."
- **Manipulation:** `Isaac-Lift-Cube-Franka-v0` ships in Isaac Lab with a
  **published pretrained rsl_rl checkpoint** (verified HTTP 200 on the
  Nucleus S3 bucket for Isaac 4.5/5.0/5.1/6.0):
  `play.py --task Isaac-Lift-Cube-Franka-v0 --use_pretrained_checkpoint`.
  The policy's observations are robot-relative (never sees the
  environment mesh) → dropping the robot+table+cube island into our moon
  base changes nothing it observes. Official tutorial exists for policy
  inference inside a custom USD scene. **Scripted fallback:** Isaac Sim's
  Franka pick-and-place example (RMPflow, non-RL) is a documented ~1-day
  path that works in any scene.
- **Lunar gravity:** one config field — `env_cfg.sim.gravity = (0, 0, -1.62)`
  (`isaaclab.sim.SimulationCfg.gravity`); scripted path:
  `PhysicsContext.set_gravity(-1.62)`. Isaac Lab even ships a
  gravity-randomization event term.
- **ONNX export:** every `play.py` run drops `exported/policy.onnx`
  automatically. In-browser inference (onnxruntime-web + Rapier) has
  precedent for *other* stacks but none for Isaac policies — stretch only.
- **Gilbreth:** Gilbreth-H = 16 nodes × 3× A10 24 GB (SLURM partition
  `a10`; normal QOS up to 2 weeks walltime, **standby QOS max 4 h**).
  **The A10s are the only RT-core GPUs on the cluster — A100/H100 are
  explicitly unsupported by Isaac Sim.** Apptainer + NGC containers are
  RCAC-documented; Isaac Lab has an official Apptainer-on-SLURM cluster
  guide. Driver requirement: Isaac Sim 5.0 ≥ 535.129, 5.1 ≥ 580.65 —
  **node driver version is unverifiable remotely and we cannot change it**
  (Gate P1). Headless mp4: `--headless --enable_cameras --video` (needs
  ffmpeg) or Replicator Synthetic Data Recorder + ffmpeg.
- **Livestream from the cluster: ruled out.** WebRTC media is UDP on an
  effectively hardcoded port; SSH tunnels carry TCP only; compute nodes
  sit behind the cluster firewall. Recorded-but-real is the plan, not the
  fallback.
- **Demo laptop:** RTX 5060 Laptop (8 GB VRAM — meets Isaac's GPU minimum),
  16 GB RAM (below the 32 GB recommendation), driver 591.84 / CUDA 13.1.
  Live local playback of a small scene is a *possible upgrade*, never a
  dependency (Gate P7).

---

## 3. Stage specs

### Stage A — Asset conversion (certified bundle → Isaac USD) — 2–4 days

1. Splat: `splat-transform world.spz world.ply` with `-s/-r` baking the
   *certificate's* verified scale + upright rotation (not the raw vendor
   metadata — the certificate already cross-checked it). Prefer Marble's
   direct PLY export where available. Use the 500k-splat tier for
   A10-friendly VRAM.
2. `3dgrut ply_to_usd` → NuRec USDZ (or ParticleField per pinned Isaac
   version). Reference from a `.usda` root stage — never open the USDZ as
   root.
3. Collider GLB → USD; then a deterministic Python post-pass: set
   `metersPerUnit`, author xform explicitly (−90° X), apply
   `CollisionAPI` + `MeshCollisionAPI("none")`, link as NuRec proxy mesh
   (shadows/occlusion).
4. Material pass: author face GeomSubsets on the collider from Surveyor's
   zone map; bind one physics material per subset
   (`physics:staticFriction/dynamicFriction` from the certificate's
   material ranges — midpoint on the prim, range in the sidecar).
5. **Alignment check before anything else touches it:** known 2 m doorway
   measured in-stage; splat and collider visually coincident from three
   camera angles. Three transform sources must agree (certificate scale,
   converter units, axis rotation) across two assets through two
   toolchains — a silent factor error is the pipeline's most likely
   failure, so this check is a gate (P3), not a habit.

### Stage B — Certificate → training contract — ~1 day

A `certificate_to_isaac.py` converter emitting an Isaac Lab env-config
fragment from the certificate JSON:

- `sim.gravity` from the certificate's gravity context;
- friction DR ranges from material `Measurement` uncertainty (wide
  uncertainty → wide randomization; a measured value → narrow band) via
  Isaac Lab's randomization event terms;
- spawn set → episode reset poses (verified spawn points only);
- quarantine mask → episode termination / reward masking so no training
  step touches a quarantined region;
- SDG camera placement masked to verified regions.

This file is the demo's "certificate doing work" screen: the certificate
JSON on the left, the generated Isaac config on the right.

### Stage C — Moon-base box task — two tracks

- **Track A (guaranteed, ~1–2 days):** Isaac Sim scripted Franka
  pick-and-place inside the certified moon base, gravity 1.62, box start
  and drop target both on certified surfaces. Record mp4. This alone
  satisfies "robot lifts a box and places it at a target in our verified
  world at lunar gravity."
- **Track B (wow-layer, ~2–3 days):** pretrained lift checkpoint,
  `num_envs=1`, moon base as static asset per the official
  custom-USD-inference tutorial, trained robot/table/cube island kept at
  its trained relative geometry. Earth-g vs lunar-g comparison on camera
  ("same brain, moon physics" — expect floaty, occasional fumbles: that's
  the beat, not a bug). If too degraded: fine-tune a few hundred
  iterations at 1.62 from the checkpoint (~an hour on an A10). If still
  bad: Track A only, Track B becomes a slide.

### Stage D — Recording factory (Gilbreth) — cluster evenings

Headless container on `a10` partition; every demo asset rendered to mp4 +
Replicator frames on scratch, pulled home the same evening. Pre-pull the
SIF and Nucleus assets to scratch as insurance against compute-node
network surprises. The existing Nav2 receipt (PLAN §5) and the box task
share cluster sessions — book both evenings as before.

### Stage E — Demo assembly

Live beats stay in the browser (survey, repair, rover patrol — wifi-immune,
as in `demo-five-beats.md`). Isaac beats are recorded-but-real, cassette
disciplined, **disclosed with the same pride line as the library**
("rendered on Purdue's cluster last week — here's the run log"). New
closing beat, replacing/absorbing the old patrol close:

> **Beat 5′ — The contract executes (~35s).** Certificate JSON → generated
> Isaac config on screen (5s). Cut to recorded Isaac footage: Franka lifts
> the box in the certified moon base, box settles lunar-slow, placed on
> target; one caption line: "trained at Earth g, deployed at 1.62 m/s² —
> spawns, quarantine, and friction ranges all came from the certificate."

Stretch (never load-bearing): ONNX rover policy in-browser via
onnxruntime-web — one timeboxed evening; manipulation sim2sim is
explicitly out.

---

## 4. Gates & kill criteria (pre-committed; fallback fires same day)

| # | Date (target) | Gate | Pass condition | On failure |
|---|---|---|---|---|
| P1 | **first cluster session (Jul 6–7)** | Cluster reality | `sinteractive -p a10` works at normal QOS; `nvidia-smi` driver ≥ 535.129; outbound net from compute node (else pre-pulled SIF works) | Driver &lt; 535 → **Isaac-on-Gilbreth dead; Track A/B move to any RTX ≥ 12 GB machine we can borrow, else pipeline-v2 demoted to slides + browser demo stands alone.** Standby-only QOS → schedule all runs in 4 h windows, book more evenings |
| P2 | Jul 8 | NuRec visual QA | One Marble world through ply→USDZ renders artifact-free from a robot camera | Artifacts → try ParticleField schema / 6.0 path; still bad → **Isaac beats render collider-world (untextured) and splat visuals stay browser-side**; vision-input claim → slide |
| P3 | Jul 8–9 | Alignment | 2 m doorway measures 2 m ± 2% in-stage; splat/collider coincident | Fix transforms in the Python post-pass, re-gate; never proceed misaligned — every downstream artifact would be poisoned |
| P4 | **Jul 10** | Guaranteed ending | Scripted pick-and-place mp4 in the certified moon base at 1.62 recorded | This gate cannot fail on science (documented example); if it slips on logistics, Track B is CUT and P4 gets the freed days — **the demo ends with a box lift or the pipeline story isn't told** |
| P5 | Jul 12 | Wow-layer | Pretrained checkpoint runs in custom USD at lunar g, acceptable on camera (fine-tune allowed) | Track A footage only; "pretrained policy, zero training needed" becomes the caption of the scripted run instead |
| P6 | Jul 13 | Vision beat | Replicator SDG frames from a splat-rendering robot camera over the certified world | Vision beat → one slide ("the camera sees Marble pixels; physics sees our certificate") with the NVIDIA-blog citation |
| P7 | Jul 15 | Laptop playback | Small certified scene plays live in Isaac on the RTX 5060 at presentable fps | Stay recorded-but-real (already the default; this gate only ever upgrades) |
| P8 | Jul 15–16 | ONNX stretch | Browser rover inference from exported policy.onnx in one evening | Drop silently; show the .onnx file + config in Q&amp;A only |

Conflicts with PLAN.md gates: P1 supersedes Gate C's "container ≥5.0"
wording (pin to what the driver supports); the two Isaac receipt evenings
(PLAN §5 / Gate H) now also carry P4–P6 — if cluster time collides,
priority order is **P4 &gt; Nav2 receipt &gt; P5 &gt; P6** (the guaranteed ending
outranks everything; a receipt without an ending is a footnote).

---

## 5. Honesty lines (certificate-grade claims for the new stages)

- Recorded Isaac beats are disclosed on stage as recorded, with pride,
  run logs available — same discipline as the pre-event library.
- "The robot's camera sees the Marble world" is claimed only if P6 passes;
  we never imply massively-parallel vision RL (no precedent, not
  attempted).
- Never "SimReady-certified" (no environment profile exists); permitted:
  "passes N individual SimReady physics rules, validator output attached."
- Splat lighting is baked; we say so if lighting comes up.
- Friction values in Isaac are **assigned priors with disclosed ranges**,
  not measurements — the certificate's basis lines carry through to the
  USD sidecar; DR over the range is the honest consumption of that
  uncertainty.
- Lunar-g behavior of the Earth-g policy is shown as-is (floaty,
  imperfect); a fumble at 1.62 m/s² is evidence the physics is real, and
  we narrate it that way.

---

## 6. Effort & schedule fit

Stage A 2–4 d · Stage B 1 d · Stage C-A 1–2 d · Stage C-B 2–3 d ·
Stage D inside existing cluster evenings · Stage E inside existing
rehearsal blocks ≈ **7–12 part-time days**, overlapping PLAN.md's Day 5–10
lanes. Nothing here requires training from scratch, nothing new runs live
at the venue, and the certifier itself is already built, tested, and
self-validated — pipeline v2 is assembly and choreography on top of a
finished instrument.
