# SURVEYOR — session handoff

**Read this first.** Single entry point for continuing from a fresh Claude
session/account. Everything session-local is in the repo; nothing depends on
an old conversation.

Last updated: 2026-07-06 morning (post-ENDGAME build night). Event: "Worlds
in Action" hackathon before SIGGRAPH 2026 (~Jul 18). Repo: `D:\worlds-in-action`
(git, main). **The spec is `docs/ENDGAME.md` — locked. If it isn't in
ENDGAME, we don't build it. Pack wins.**

---

## 1. What this is

**SURVEYOR** — inspection + repair instrument for AI-generated 3D worlds.
Marble worlds ship photoreal splats and a collider that silently disagree.
SURVEYOR drops seeded Rapier probes + virtual LiDAR, measures divergence,
issues a graded **physics certificate** (uncertainty + methods line on every
number), repairs what it can (11 closed tools, op stack, revert, regional
recertify), ropes off the rest, and exports the **Certified World Pack**:
USD stage + Isaac Lab training contract + report. "The certificate is the
contract." Plan: `PLAN.md` · spec: `docs/ENDGAME.md` · pipeline: `docs/pipeline-v2.md`.

## 2. Vocabulary — non-negotiable

Never "lying" in user-facing copy: **confirmed / observed / divergent**,
**ghost geometry**, **phantom colliders**, **outside the surveyed area**.
Internal schema field names (`lying`, `lyingPct`, `TrustCellState`) are
intentionally frozen — saved certificates parse against them; rename is a
pre-public-repo migration. Do not "fix" casually.

## 3. ENDGAME build queue — status after this session

| # | Item | Status |
|---|---|---|
| C1 | Outdoor recalibration | **DONE** (commit b7f6b31) — capture envelope, sustained-contact verification, density-calibrated phantom radius, height-banded noise floor, enclosure test for holes. Moon: 1053→89 defects (979 phantom majors→51), divergent 65.2%→4.5%. Canyon: 128→51, sills 38→0. Bench UNCHANGED: recall 96.8% (CI ≥85.6%), precision 100% (CI ≥90.5%), same single disclosed miss. Regression suite `test/outdoor-calibration.test.ts`. |
| C2 | Grade dynamic range | **DONE** — station now grades **D** (its only critical is the TRUE vendor-scale error 2.528; 100% confirmed / 0% divergent); habitat/canyon/moon F. Real worlds rank. |
| C3 | Canonical re-certification | **PART DONE** — canonical post-C1 certificates + report.html installed in all four `assets/marble/<id>/` bundles (NOTE: `assets/marble` is **gitignored** — they live on disk only). CLI now passes `visualScales` (was a silent CLI≠browser divergence); engine threads scales through state/scale/revert/certify/export; browser worker fetches `visual-scales.f32`. Engine==CLI counts PROVEN on habitat (grade F, 21 defects, 64.4/20.2 exact) **and browser==CLI proven LIVE on two worlds** (habitat `f68e3de19081…`, moon `5d36c6d0eb1d…`; full JSON byte-identical modulo createdAt; export button downloads the full certificate via a worker-level `get_full_certificate` RPC). **Cassette RE-RECORDED live** (claude -p + MCP at canonical 2000 probes with visualScales): baseline F/21 == canonical EXACTLY; episode F(0/100)→A(100/100), **75 ledger outcomes, 0 dropped**, organic fitted_slab-seam → revert → mesh_fill adaptation, scale-first diagnosis (vendor 1.624× vs independent 1.60× agree). Repaired bundle re-exported to assets/exports/. **C3 COMPLETE.** |
| C4 | Hero + Beat-3 truth | **DONE mechanically** — `scripts/verify-beat-truth.ts` (see §5). Habitat CANNOT truthfully speak the rover/quadruped sill contrast (post-scale worst step 0.44 m fails both). ENDGAME's pre-committed fallback applies: Beat 3 = hole+ghost contrast + verdict-suspension line; sill contrast comes from the generated hero world (user lane, specced to carry it) or Q&A. |
| C5 | Copy-truth batch | **DONE** — humanize.ts: real check ids (`step_negotiation` etc.), honest suspension line ("N of M checks on hold until the size error is fixed"), accept-card derived from actual step verdicts, explicit surveyed-cells denominators, capture-boundary hole explainer. |
| C6 | Twin run choreography | **MECHANISM DONE** (commit ceabccc) — certificate-derived candidates validated by SILENT PHYSICS DRY-RUNS in the worker (ray heuristics provably cannot see torn-mesh slivers); three failure modes (fell / beached-in-defect / ghost drive-through), byte-deterministic replay, R key, camera framing that yields to the user, fall/ghost markers, honest refusal copy. **Honest finding: neither fallback world has a box-drivable raw failure lane** (habitat holes hug walls; moon rims are flap-armored — ~50 dry-runs, probes travel 0.6–5.3 m and beach on rims). The beat rides on hero-world curation exactly as ENDGAME §2 specs — **pressing R on a candidate world IS the curation check now**. Pre-recorded-clip fallback stands. Rover physics: pitch/roll free, yaw steering-locked, orientation streamed. Beat-5 delivery follow built; needs one full-repair rehearsal pass. |
| C7 | MISSION LOG panel | **DONE** (commit ceabccc) — recorded-episode replay narrates Beat 4 (agent's own words + tool chips with result-driven states, RECORDED REPLAY honesty chip, wifi-off from assets/traces/); starts with Run All on the same Space; recorded tool calls pulse the matching live plan cards. Determinism check: MATCH (two replays byte-identical). Standalone harness `/missionlog-dev.html`. Mounted at speed 2 (~38 s for the 305-event canonical cassette). |
| C8 | USD pack assembler | **DONE** — `src/export/usdPack.ts` + `usdValidate.ts` + `scripts/usd-pack.ts` + tests. Habitat repaired-bundle pack: **ALL RULES PASS** (Z-up/metersPerUnit explicit, PhysicsCollisionAPI, 10/10 spawns outside 72 quarantine cubes, NuRec payload ref, certificate sha in layer customData). Text-level validation only — drag-in test is cluster gate G2. |
| C9 | Isaac Lab task package | **DONE** — `isaac/` (surveyor-isaac): pure-python contract loader mirroring `isaacContract.ts` constant-for-constant; `Certified-Resupply-Rover-v0` env cfg wired entirely from the certificate (spawns→resets, quarantine→terminations, friction→DR, gravity→sim, open criticals→ContractRefused); 6/6 unittest green vs the real habitat certificate; README has exact Gilbreth commands + honest Isaac-version caveats (targets Isaac Lab 2.x, JETBOT_CONFIG — swap one import if the cluster differs). |
| C10 | Determinism hash chip | **DONE** — `certificateSha256` is now a CONTENT hash (createdAt normalized; stable across re-runs — required for the "re-hash live, match the Devpost print" claim). Worker streams it (WebCrypto, same bytes); panel chip with tooltip; report footer explains. |
| C11 | PREFLIGHT CLI | **DONE** — `bin/surveyor.mjs` (`surveyor certify <bundle> --min-grade B`…), exit codes 0/3/1/2, one-screen summary, self-contained `report.html` (dark, zero external requests, methods lines prominent). `scripts/certify.ts` delegates to the same main. tsx moved to dependencies. |

**Test suite: 35/35 green** (`npm test`) — includes usd-pack (5), report-html (5), outdoor-calibration (3). App `tsc --noEmit` clean.

## 4. The pack pipeline is proven end-to-end (this machine)

```
raw bundle → surveyor certify (canonical) → verify-beat-truth (repair plan F→A)
  → --export repaired bundle (spawns.json, quarantine.json, contract)
  → scripts/usd-pack.ts (ALL RULES PASS)
  → python -m surveyor_isaac.validate → CONTRACT OK (grade A gate, 10 spawns,
    72 termination masks, gravity + DR from the certificate)
```
Only cluster steps remain (NuRec visuals, SDG, training) — G-lane.

## 5. Beat truth — what the demo may speak (verified by script)

`npx tsx scripts/verify-beat-truth.ts [bundle] [--export <dir>]` proves, on
the loaded world, with the app's own humanize functions:
- Beat-2 line (habitat): "Physically tested: 64.4% · divergent: 20.2% · untested: 15.4% (of 630 surveyed cells)"
- Beat-3 raw-world verdict line: "2 of 5 checks on hold until the size error is fixed — measuring at the wrong scale would be meaningless."
- Repair plan converges **F→A** (waves of full-recertify audits; patches that
  fail the full audit twice get quarantined — "the certifier audits our own repairs").
- Beat-5 verdict line (habitat): "5 checks · all robots agree." — **no sill
  contrast on habitat**; do not speak it there (see C4).

## 6. What broke / was fixed this session (do not re-break)

- **Engine ledger flicker (fixed)**: recertify matching preferred a "fixed"
  twin over the quarantined one → immortal reopen loop. Reconciliation now
  prefers absorbing (non-fixed) matches. `src/repair/engine.ts`.
- **CLI≠browser counts (fixed)**: CLI never passed `visualScales`; engine
  dropped them; browser never fetched the sidecar. All three aligned now;
  `apply_vendor_scale` also scales Gaussian radii (they are lengths).
- **Hash was run-dependent (fixed)**: full-JSON sha included `createdAt`.
  Content hash normalizes it — anything comparing hashes must use
  `certificateSha256` from `src/report/reportHtml.ts` / the worker event.
- **Enclosure test almost killed the hero story**: raycast-only open-edge
  voids are boundary, not holes — but probe falls OVERRIDE (habitat's
  capture-boundary holes stay 0.95 critical). Both directions are load-bearing.

## 7. Blockers + user lane (calendar)

- **Claude subscription session limit** killed 3 background agents + 2 of 3
  diagnosis agents this session (resets ~4:50am America/New_York). Cassette
  re-record and any `claude -p` episode wait for reset. The one diagnosis
  agent that finished provided the load-bearing forensics (its numbers are in
  the C1 commit message).
- Marble credits ~1,000 — **ask before spending** (draft hero candidates ≈
  $0.12 each; Mars panorama ~150 credits). Hero-world generation (Artemis
  Supply Hab, specced with a real sill contrast) is user-gated.
- Gilbreth evenings (G1 driver check decides the Isaac layer), rules answer
  Jul 8 EOD, customer conversations, Gate-A fps on the demo laptop — user lane
  per ENDGAME §4.
- The old sci-fi panel-window ask (previous HANDOFF §6) is **superseded by
  ENDGAME's cut list** ("Full Mission Control chrome" cut; MISSION LOG panel
  only). Don't build it unless ENDGAME is edited first.

## 8. Suggested first moves (next session)

1. `npm test` (35 green) + one full Beat 1→5 rehearsal in the viewer:
   Space through the beats, Run All at Beat 4 (MISSION LOG narrates over the
   live engine — verify card pulsing + final grade), patrol/delivery at
   Beat 5 (`twinRun.followDelivery` camera). This is the only unrehearsed
   surface left in the app.
2. Hero-world candidates (user-gated, ~$0.12 draft each): for each candidate,
   load in the viewer and press **R** — a validated twin-run failure route
   either derives (twinRun.probeReport() in `__dbg` shows the dry-runs) or
   the world is not the hero. "The certificates pick the hero", mechanically.
3. `npx tsx scripts/verify-beat-truth.ts` on station (the D-grade,
   scale-repair story — a strong second beat if the hero world slips).
4. Assemble the publishable pack from the NEW canonical export:
   `npx tsx scripts/make-pack.ts assets/exports/7188e250-… --out <dir>`.

## 9. Environment, secrets, money

- `.env` holds `MARBLE_API_KEY` — gitignored; never print/commit.
- Agent episodes bill the user's Claude Max subscription via `claude -p`.
- Windows 11, PowerShell 5.1: no `&&`, no ternary; **embedded double quotes
  in args to native exes get mangled — write commit messages to a file and
  `git commit -F <file>`** (this cost a retry tonight).
- Node + `npx tsx`. `assets/marble/**` is **gitignored** (bundles + canonical
  certificates live on disk only — copy them when moving machines).
- Useful: `npm test` · `node bin/surveyor.mjs certify assets/marble/<id>` ·
  `npx tsx scripts/self-validate.ts` (~6 min) · `npx tsx scripts/verify-beat-truth.ts`
  · `npx tsx scripts/usd-pack.ts <bundle> --out <dir>` ·
  `python -m unittest discover isaac/tests -v` (PYTHONPATH=isaac for the CLI)
  · `npx tsx scripts/inspect-holes.ts <bundle> <cert.json>` ·
  `cd app; npx vite` (port 5173).
- Git commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 10. Gotchas that cost hours — do not rediscover

Everything from the previous handoff still holds (Rapier step-before-raycast,
`RayColliderHit.timeOfImpact`, Spark renderer must be added to the scene,
SPZ y-down + `rotateX(Math.PI)`, camera at splat-density peak, occluded-tab
rAF suspension → use `window.__dbg`, Marble `WLT-Api-Key` + download retries,
in-house SPZ parser at `src/ingest/spz.ts`, CRLF warnings are noise). New:

- The survey's claims are envelope-gated: **absence of splats beyond the
  capture is a capture limit, never a defect** — and `interiorVoids` carry an
  `openEdge` verdict that probe falls override. Keep both when touching
  survey.ts/metrology.ts/defects.ts; `test/outdoor-calibration.test.ts` guards it.
- Full recertify after mesh edits legitimately mints a few borderline
  clusters per wave (shifted regions, IoU miss). Replan loops must iterate;
  counts decay fast. See verify-beat-truth's wave loop.
- vitest suite must stay the single source of green: 35 tests as of tonight.
- **Vite on this machine lies without polling**: chokidar misses tool-driven
  writes, so the dev server serves modules ONE EDIT BEHIND (hours lost
  testing stale code) — `server.watch.usePolling` is now set in
  app/vite.config.ts; verify freshness with a cache-busted fetch of the
  module before trusting a browser test. Also: killing the preview leaves an
  **orphaned vite squatting port 5173** (npm→cmd→vite on Windows); check
  `Get-NetTCPConnection -LocalPort 5173` before restarting.
- Ray heuristics cannot vet a drive lane on torn Marble meshes (downward,
  horizontal, and floor-following rays all passed lanes that wedge a box).
  The twin run validates by silent physics dry-run (`rover_probe` in the
  worker) — keep that pattern for any future traversal claim.

## 11. File map (load-bearing additions this session)

```
src/certify/survey.ts        envelope, sustained contact, pnv radius, exit accounting
src/certify/metrology.ts     interiorVoids with openEdge (march-outward enclosure)
src/cli/certifyMain.ts       surveyor certify main (exit codes, report writing)
src/report/reportHtml.ts     self-contained report + certificateSha256 (CONTENT hash)
src/export/usdPack.ts        Certified World Pack .usda stage builder
src/export/usdValidate.ts    SimReady text-rule validator + md report
isaac/                       surveyor-isaac python package (contract, task, tests)
bin/surveyor.mjs             npx-able CLI entry
scripts/verify-beat-truth.ts demo-truth harness + repaired-bundle export
scripts/usd-pack.ts          pack assembly CLI
scripts/render-report.ts     report.html from an existing certificate
scripts/inspect-holes.ts     hole-region forensics (interior vs open-edge)
docs/handoff/                killed-workflow scripts (diagnosis one is re-runnable)
```
