# SURVEYOR — session handoff

**Read this first.** It is the single entry point for continuing work from a fresh
Claude session/account. Everything session-local has been copied into the repo;
nothing below depends on the old conversation existing.

Last updated: 2026-07-05 evening. Event: "Worlds in Action" hackathon before
SIGGRAPH 2026 (~Jul 18). Repo: `D:\worlds-in-action` (git, master).

---

## 1. What this is

**SURVEYOR** — an inspection + repair instrument for AI-generated 3D worlds.
Marble (World Labs) worlds ship photoreal gaussian splats and a separate collider
mesh that silently disagree. SURVEYOR drops seeded physics probes (Rapier),
casts virtual-LiDAR rays, measures splat/collider divergence, and issues a
**physics certificate** (grade A–F, per-robot verdicts, every value with
uncertainty + methods line). A repair engine (11 closed tools, operation stack,
revert, regional recertify) plus a Claude agent loop fixes what it can, roping
off the rest. Exports an Isaac Lab training contract ("the certificate is the
contract"). Long-term frame: certified worlds feed NVIDIA Isaac (docs/pipeline-v2.md).

Execution plan: `PLAN.md`. Demo script: `docs/demo-five-beats.md`.
Pipeline extension: `docs/pipeline-v2.md`. Customer notes: `docs/customer-discovery.md`.

## 2. Vocabulary — non-negotiable

The user rejected the word **"lying"** (2026-07-05): use robotics/graphics-first terms.

- Trust triad (display): **confirmed / observed / divergent**
- Visuals without collision: **ghost geometry**
- Collision without visuals: **phantom colliders**
- Internal schema field names (`lying`, `lyingPct`, `TrustCellState`) are
  **intentionally unchanged** — saved certificates/bundles parse against them.
  Rename is deferred to a pre-public-repo migration with a bundle migrator.
  Do not "fix" them casually.

## 3. State of the build (all committed, master)

- **Headless certifier** validated: 27 synthetic worlds / 31 planted defects
  (incl. out-of-taxonomy plants), recall 96.8% (95% CI ≥ 85.6%), precision 100%
  (CI ≥ 90.5%), one honest disclosed miss. `npm test` = 18/18 green.
- **4 real Marble worlds** in `assets/marble/` (each: collider.glb,
  visual-points.f32, visual-scales.f32, splat*.spz, certificate.json):
  - `7188e250…` habitat — scale 1.624, graded F, **repaired F→A by a live agent
    episode** (81/81 defect outcomes, replayable cassette in `traces/`)
  - `ac573c1f…` station — scale 2.528, F
  - `90c2b55d…` canyon — F, outdoor, instrument misfires (see §5)
  - `f1f4e6b3…` moon-base — scale 1.449, F, outdoor, instrument misfires (see §5)
- **Browser app** (`app/`, Vite + three + @sparkjsdev/spark + Rapier worker):
  full five-beat staged UX (stepper rail, narrator bar, humanize layer, grade
  reveal, collapsible certificate, repair cards with inline fail-and-adapt,
  patrol + F→A close). Survey runs in a worker at Beat 2. 57–119 fps.
  Dev mode `D` shows raw machine strings. Vendor-agreement copy bug fixed
  (agreement is derived from the estimate's uncertainty band, never asserted).
- **Agent repair**: `mcp/repair-server.ts` (stateful MCP) + subscription-billed
  episodes: `claude -p "$(cat prompt)" --mcp-config mcp/repair-mcp-config.json
  --allowedTools "mcp__repair" --max-turns N`. SDK loop in `src/agent/runner.ts`.
- **Isaac Stage B**: `exportBundle` → collider.glb + certificate.json +
  spawns.json + quarantine.json + surveyor_contract.py (`src/export/isaacContract.ts`).
- **Marble CLI**: `scripts/marble.ts` (generate/pano/wait/get/download/list/gate-d1).

## 4. Environment, secrets, money

- `.env` at repo root holds `MARBLE_API_KEY` — **gitignored; never print or commit**.
- Marble credits remaining: **~1,000** (started 7K). Mars/Perseverance panorama
  drafts would cost ~150 — **ask the user before spending credits**.
- Agent episodes bill the user's **Claude Max subscription** via `claude -p`,
  not an API key.
- Windows 11, PowerShell 5.1 (no `&&`, no ternary), repo also drives fine from
  Git Bash. Node + npx tsx for scripts: `npx tsx scripts/certify.ts <bundle-dir>`.
- Useful commands: `npm test` · `npm run certify -- assets/marble/<id>` ·
  `npx tsx scripts/self-validate.ts` · `cd app && npx vite` (or the
  `.claude/launch.json` "viewer" config, port 5173) ·
  app URL pattern `http://localhost:5173/?world=/marble/<world-id>`.
- Git commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 5. ACTIVE WORK #1 — outdoor terrain calibration (top instrument priority)

The certifier's indoor assumptions misfire on outdoor rolling terrain:

| world | probes dropped | rested | "fell through" | verified cells | spurious majors |
|---|---|---|---|---|---|
| moon `f1f4e6b3` | 731 | 141 | **590 (81%)** | 60 / ~93k (0.24%) | 979 phantom_collider |
| canyon `90c2b55d` | 409 | 6 | **403 (98.5%)** | 0.02% | 66 phantom + 20 visual |

Working hypotheses (numbers above are from `assets/marble/<id>/certificate.json`):
1. Probes are dropped outside the terrain footprint (interior-tuned
   "floor-claiming void" branch of `dropHeightAt` in `src/certify/survey.ts`)
   and/or roll off open edges (see finding 6 below).
2. The 979 "phantom colliders" are collider terrain **outside the splat capture
   envelope** (no visuals out there ≠ invisible wall) — needs a local-visual-density
   gate before pnv evidence counts.
3. Verified-cell starvation (rest-based criterion; balls never sleep on slopes) →
   divergence noise floor can't self-calibrate → 65% "divergent". Candidate:
   sustained-contact (≥30 steps) counts as surface confirmation.

**A 3-agent diagnostic workflow was launched but KILLED before any agent finished**
(no salvageable results). Re-launch it from the persisted script:
`docs/handoff/outdoor-calibration-diagnosis.workflow.js` — pass it to the
Workflow tool via `{scriptPath: "docs/handoff/outdoor-calibration-diagnosis.workflow.js"}`
(absolute path). It contains the full forensic briefs; agents write scratch
scripts and instrument real runs. **Note:** the script's scratchpad path points
at the OLD session — swap in the new session's scratchpad dir before launching.

**Fix together with the diagnosis** (one bench run): adversarial-review findings
3–6, all CONFIRMED with mechanisms + fix sketches in `docs/review-triage-todo.md`
(NaN RANSAC floor plane on slopes; tunneling cross-check ray too short; no
grid-size guard → OOM on cm-scale worlds; rim-clamping defeats the
off-world-edge exclusion). Three of the four are outdoor mechanisms.
Acceptance: 27-world bench recall/precision CIs must hold; re-certify all four
Marble worlds; moon majors should collapse from ~985 to a defensible number.

## 6. ACTIVE WORK #2 — sci-fi panel window system (user's latest ask)

The user wants the viewer panels to behave like a **sci-fi game UI**: panels
that can be **enlarged / minimized / maximized**, choreographed by the five-beat
flow (think dock chips ↔ cards ↔ focus ↔ fullscreen takeover).

A 4-concept + 3-judge design workflow was launched and **KILLED before any
agent finished**. Re-launch from `docs/handoff/scifi-panel-system-design.workflow.js`
(same scriptPath mechanism). The four directions: diegetic ship console
(Alien: Isolation), tactical glass HUD (Destiny/Titanfall), cinema FUI with
world-anchored callouts (The Expanse), RTS command deck (Homeworld).
Judges score: stage legibility, vanilla-TS/CSS buildability without WebGL frame
cost, five-beat coherence.

Agreed deliverable: **interactive HTML artifact mockup for user review first**
(panels actually minimize/expand; real habitat data: grade F, 12.1% confirmed /
42.3% divergent, 39 defects — or the browser-run numbers 18.1/25.4/28),
implement in `app/` only after approval. The previous UX mockup artifact source
is preserved at `docs/handoff/surveyor-ui-proposal.html` (already updated to
ghost/divergent terminology). Existing keybinds that must not collide:
W wireframe, B boxes, F flip, I inside/orbit, D dev, Space/Enter/arrows/N/1–5 stepper.

## 7. Backlog (post the two active items)

- Live agent beat in the browser (agent reasoning log streamed into the UI).
- Gravity suite UI + falsification panel (slope UNCHANGED under gravity swap —
  "a tool that faked physics would have moved it").
- Mars/Perseverance panorama pipeline (~150 credits — ask first).
- Fleet gallery + self-validation gallery pages.
- Quadruped traversal experiment (judge suggestion).
- Schema rename lying→divergent with bundle migration (pre-public-repo).
- Review the `docs/ui-redesign-spec.md` §5 main.ts changes if panels get reworked.
- User-only: customer conversations (3–5), cluster gates P1–P6 (P4 box-lift is
  the guaranteed demo ending), Marble credit top-up, demo-day API key tier,
  Gate A fps reading on the actual demo laptop.

## 8. Gotchas that cost hours — do not rediscover

- **Rapier**: world must `step()` once after adding a trimesh before raycasts
  hit; trimesh normals face the ray (never use two-sided parity tests — use
  `projectPoint` free-checks); `RayColliderHit.timeOfImpact` (not `.toi`).
- **Spark**: `SparkRenderer` must be **explicitly added to the scene** or splats
  render zero draw calls. SPZ is y-down; Spark converts; the collider frame then
  needs `splat.rotateX(Math.PI)` (default-on, key F re-flips).
- **Camera**: spawn at the 2D splat-density peak within the densest y-band —
  centroid/origin/AABB heuristics all fail on shell-heavy worlds.
- **Preview/screenshot**: occluded tabs suspend rAF — screenshots time out and
  `canvas.toDataURL` returns blanks. Use `window.__dbg` (scene, worldGroup,
  camera, renderer, splat): force `renderer.render(scene, camera)` then
  `toDataURL`. DOM/a11y checks via `preview_eval` are more reliable than pixels.
- **Marble API**: base `https://api.worldlabs.ai`, header `WLT-Api-Key`; world
  object key is `world_id`; metric scale at
  `assets.splats.semantics_metadata.metric_scale_factor`; downloads flake
  (ECONNRESET) — retry, and validate gunzip of .spz (NGSP magic).
- **@spz-loader/core breaks in Node** — in-house parser at `src/ingest/spz.ts`.
- Certificates are byte-identical for the same seed — determinism is a demo
  claim; keep it true.
- Windows CRLF warnings on commit are noise; PowerShell 5.1 lacks `&&`.

## 9. Working agreements with the user

- "Get the project running by tomorrow — let's gun for it" + "we shouldn't
  limit ourselves either, let's make the best project": no day-pacing, no
  artificial ceiling, but working > planned.
- **Ultracode is ON**: use the Workflow tool for every substantive task
  (diagnosis fan-outs, design panels, adversarial verification).
- Information must be **human-friendly** (the humanize layer exists for this);
  machine strings only in dev mode.
- Honesty is the brand: measurements carry uncertainty + methods lines; CIs on
  self-validation; disclose failure modes proudly (fail-and-adapt is THE beat).
- Ask before spending Marble credits or anything outward-facing.

## 10. File map (the load-bearing ones)

```
src/certify/survey.ts      probe rain, claim zone, divergence, noise floor  ← outdoor fix lands here
src/certify/metrology.ts   RANSAC floor, doorways, steps                    ← finding 3
src/certify/defects.ts     evidence fusion → typed defects                  ← phantom gate
src/certify/trustmap.ts    confirmed/observed/divergent grid
src/certify/certificate.ts certifyWorld() end-to-end
src/repair/engine.ts       11 tools, op stack, revert, recertify, exportBundle
src/agent/{tools,runner}.ts agent tool schemas + SDK loop
src/export/isaacContract.ts certificate → Isaac Lab contract
src/ingest/{bundleIO,spz,marbleClient}.ts
app/src/main.ts            viewer wiring, beats, __dbg
app/src/ui/{stepper,humanize,gradeReveal,certificatePanel,repairPanel}.ts
scripts/{certify,self-validate,marble,repair-agent}.ts
test/                      18 tests incl. the fail-and-adapt hero loop
docs/handoff/              killed-workflow scripts + UI mockup (this handoff's annexes)
```

**Suggested first moves for the new session:** (1) `npm test` to confirm green;
(2) re-launch the sci-fi panel design workflow (user is waiting on the mockup);
(3) re-launch the outdoor diagnosis workflow; (4) read `docs/review-triage-todo.md`.
