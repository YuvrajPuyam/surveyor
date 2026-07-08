# Surveyor

**An inspection and repair shop for AI-generated 3D worlds.**

Generated worlds ship as two files that nobody checks against each other: a
photoreal splat file and an invisible simplified physics shell. A floor can
have a physics hole under perfect pixels; a door can be painted on (ghost
geometry), and solid collision can exist where nothing is visible (phantom
colliders). Robots train in these worlds anyway. Surveyor runs physical
experiments inside a world — seeded probe rain, virtual LiDAR, divergence
analysis — and produces a **certificate** (every region graded
confirmed / observed / divergent, every number with an uncertainty range and
a methods line) and a **repaired copy** (scale applied, holes patched,
divergent regions quarantined, verified spawn points), graded per robot: the
same 0.15 m sill fails a small rover and passes a quadruped.

Named for NASA's 1966–68 Surveyor program, which landed on the Moon to
certify the ground before Apollo risked humans on it.

Built for the **Worlds in Action** hackathon (SIGGRAPH 2026).

## Quickstart

Requires Node 20+ and git. The core library is headless-first: everything
except the viewer runs in Node with no browser and no network.

```bash
git clone git@github.com:YuvrajPuyam/surveyor.git
cd surveyor
npm install
cd app && npm install && cd ..   # the browser viewer has its own deps

cp .env.example .env             # then fill in MARBLE_API_KEY (ask in the team channel)

npm test                         # 43 regression tests incl. byte-identical determinism — should be green
```

Then generate the synthetic validation worlds and run your first
certification:

```bash
npm run make:synthetic           # writes planted-defect worlds to assets/generated/
npm run certify -- assets/generated/syn-kitchen-sink --gravity mars
npm run self-validate            # certifier vs its own test bench: precision/recall
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Full regression suite (keep it green — determinism is a demo claim) |
| `npm run certify -- <bundle-dir>` | Certify a world bundle, write `certificate.json` |
| `npm run make:synthetic` | Regenerate the planted-defect validation worlds |
| `npm run self-validate` | Precision/recall of the certifier against the 27-world bench |
| `npm run marble -- <subcommand>` | Marble API CLI: generate / wait / get / download / list |
| `npm run repair-agent` | Claude agent repair episode against a certified world |
| `npm run mcp` | MCP server over stdio (Claude Desktop front door) |
| `npm run wt -- add <branch>` | New git worktree, ready to run (see below) |
| `cd app && npm run dev` | Browser viewer on port 5173 |

## The browser viewer

```bash
cd app && npm run dev
# then open http://localhost:5173/?world=/marble/<world-id>
```

Five-beat staged demo flow (stepper: Space/Enter/arrows/N/1–5). Keybinds:
`W` wireframe, `B` defect boxes, `F` flip splats, `I` inside/orbit camera,
`D` dev mode (raw machine strings; the default UI is the humanized layer).

## Getting worlds

Real Marble world bundles (`assets/marble/`) and generated synthetic worlds
(`assets/generated/`) are **gitignored** — they're hundreds of MB. To get
them:

- **Synthetic bench**: `npm run make:synthetic` regenerates it exactly
  (seeded, deterministic).
- **Real Marble worlds**: ask a teammate for the bundle folders, or download
  with `npm run marble -- download <world-id>` (needs `MARBLE_API_KEY`).
  **Generating new worlds spends shared credits (~1,000 left) — always ask
  before generating.**

One repaired real-world sample (the habitat world: collider, visual points,
certificate) is committed under `assets/exports/` for reference.

## Working in parallel: git worktrees

Multiple people (and multiple Claude sessions) can work on this repo at once
without stepping on each other's checkouts. Instead of `git checkout`-ing
branches in place, give each branch its own directory:

```bash
npm run wt -- add feat/my-feature      # new branch off main, in .worktrees/feat-my-feature
npm run wt -- add fix/thing origin/xyz # base it on something else
npm run wt -- list                     # what's checked out where
npm run wt -- remove feat/my-feature   # done (branch is kept)
```

The helper (`scripts/worktree.mjs`) puts every worktree under `.worktrees/`
(gitignored), copies your `.env` in, and runs `npm install` in both the root
and `app/` so the checkout is immediately runnable. Plain `git worktree`
commands work too — the helper is just the batteries-included path.

Rules of the road:

- One branch = one worktree = one task. PRs into `main`.
- Never commit from two worktrees to the same branch simultaneously.
- `main` stays green: `npm test` before you push.

## Architecture

```
src/core       schemas (zod), PRNG, geometry, grids     — every number is a Measurement
src/ingest     GLB collider IO, SPZ parser, Marble client, bundle format
src/physics    Rapier wrapper (deterministic fixed timestep, WASM)
src/certify    survey (probes + rays + divergence) → metrology → defects → trust map → verdicts → certificate
src/repair     11 closed repair tools, operation stack, revert, regional recertify
src/agent      agent tool schemas + SDK episode loop
src/export     certificate → Isaac Lab training contract
src/validation self-validation: planted defects vs detections, precision/recall
src/trace      replay cassette (JSONL, content-addressed blobs, frozen clocks)
app/           browser viewer (Vite + three + Spark splats + Rapier worker)
agents/        Surveyor + Repair agent prompts
mcp/           MCP stdio servers: certify + stateful repair
scripts/       CLI entry points (certify, self-validate, marble, repair-agent…)
docs/          demo script, pipeline v2, review triage, contingency scope
test/          43 tests incl. the fail-and-adapt hero loop and the paired receipt
```

Current self-validation on the 27-world bench (31 planted defects, including
adversarial classes outside the certifier's taxonomy and defects at the
detection floor): **recall 96.8% (95% CI ≥ 85.6%), precision 100% (95% CI ≥
90.5%)**, zero false positives on clean controls, one honest disclosed miss.
Field-validated: the first real Marble world's vendor scale factor (1.624)
was independently recovered by door-height metrology at 1.60 [1.44..1.76],
and a live agent episode repaired that world F → A with all 81 defect
outcomes recorded (cassette in `traces/`).

## The receipts (everything below exists on disk)

The certified world was taken all the way to a working robot on NVIDIA's
stack (Isaac Sim 5.1, Purdue Gilbreth A10 cluster):

- **Cross-engine (G3a):** PhysX corroborates the Rapier-certified repaired
  floor to **1 mm** at a certificate-verified spawn point.
- **Scripted manipulation (G3b/c):** a Franka arm picks a crate and sets it
  down **0.3 mm** from the probe-measured surface at lunar gravity — on
  video inside the photoreal splats (`assets/isaac/g3c-box-lift.mp4`).
- **Learned policy (G4):** NVIDIA's pretrained lift policy — zero training,
  never saw this world — grasps and delivers the crate to **2.6 cm** of the
  commanded goal at lunar gravity, recovering from its own fumble on the
  way (`assets/isaac/g4-policy-lift.mp4`). Rollouts byte-deterministic
  across three runs.
- **Labeled data (G5):** 500 frames (RGB/depth/bbox/semseg), labeled crates
  at verified spawns, cameras in certified free space, every rejection
  itemized in the manifest.
- **The paired receipt (C16):** fifteen identical navmesh routes, one
  controller — **raw world 0/15, repaired world 13/15**. The certified
  spawn points literally sit above holes in the raw collider.
- **The Certified World Pack:** one folder — Isaac-ready USD world (splats +
  repaired collider + spawn/quarantine prims), the dataset, the policy and
  videos, the executable training contract, and the certificate —
  `HASHES.txt` stamped last, headed by the certificate content-hash.

Claim discipline: the grade predicts **navmesh-level traversability under a
disclosed model class — not policy transfer**. The paired receipt is a floor
for the claim, not a transfer study; that study is the next receipt.

## Honesty invariants (enforced in code, not prose)

- A probe fall-through only counts as a hole if an independent raycast at the
  same point also passes through — engine tunneling can never masquerade as a
  collider hole.
- The `Measurement` schema makes raw centimeter claims unrepresentable: value
  + uncertainty range + basis + methods line, always.
- Slope verdicts print **"unchanged under Mars gravity"** — the Coulomb slope
  limit is atan(µ); gravity cancels. Stopping distance changes (~2.6x on
  Mars) and the certificate says which is which.
- Every certificate ships with the self-validation appendix: the certifier's
  own precision/recall on worlds with planted defects.
- Certificates are byte-identical for the same seed. Determinism is a demo
  claim; keep it true.
- The repair agent never edits geometry — it chooses from a closed menu of
  deterministic, reversible tools, and the instrument re-inspects every
  action before it counts. (Say this out loud before anyone assumes an LLM
  is moving vertices; an external reviewer already made that mistake.)

## Where to read next

- **[HANDOFF.md](HANDOFF.md)** — the deep state-of-the-project brief: active
  work, gotchas that cost hours (Rapier, Spark, Marble API), working
  agreements. **Read §2 (vocabulary) and §8 (gotchas) before touching code.**
- [docs/ENDGAME.md](docs/ENDGAME.md) — **the locked plan-of-record** (build
  queue, sequencing law, wording law; if it isn't in ENDGAME, don't build it).
- [PLAN.md](PLAN.md) — original execution plan (historical).
- [docs/demo-five-beats.md](docs/demo-five-beats.md) — the demo script + Q&A arsenal.
- [docs/pipeline-v2.md](docs/pipeline-v2.md) — the Isaac Lab pipeline frame.

Vocabulary note: display language is **confirmed / observed / divergent**,
**ghost geometry**, **phantom colliders** — never "lying". Some internal
schema field names still use the old terms; that rename is deferred
deliberately (saved certificates parse against them) — don't "fix" them
casually.

## Secrets & spending

- `.env` holds `MARBLE_API_KEY`. It is gitignored — never print it, never
  commit it. Copy `.env.example` to get started.
- Marble generation spends the team's shared credits. Agent repair episodes
  bill a Claude subscription. **Ask before spending either.**

## Attribution

Sample worlds generated using World Labs Marble carry "Generated using World
Labs". Mars panoramas: NASA/JPL-Caltech/ASU/MSSS, converted; generated worlds
are AI-derived, not NASA imagery.
