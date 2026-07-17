# Surveyor Viewer

Browser app for Surveyor world bundles — and the live demo rig for the
five-beat script (`docs/demo-five-beats.md`). It renders the world (splats or
point cloud + collider wireframe + Rapier probe rain), then runs the REAL
headless certify/repair core (`src/certify/*`, `src/repair/engine.ts`) inside
a Web Worker against the same bundle: the survey paints a trust map live, the
certificate and repair-plan panels mount in the right sidebar, one click runs
the repair plan (fail-and-adapt rendered loud), and when every defect has an
outcome the rover patrols the re-certified navmesh.

## Run

```sh
cd app
npm install
npm run dev
```

Open the printed URL with the real Marble world:

```
http://localhost:5173/?world=marble/7188e250-e2ff-43e7-babb-73834c22e932
```

That world is also the default when `?world=` is omitted. The repo's `assets/`
directory is served as the web root (`publicDir: "../assets"`), so a bundle at
`assets/marble/<id>/` is `?world=marble/<id>`. A legacy `/assets/...` prefix
is accepted and stripped. `&splat=<filename>` points the viewer at a specific
splat file inside the bundle.

## What happens on load

1. **Bundle loads** — splats (Spark) or `visual-points.f32` point cloud,
   `collider.glb` wireframe, 2000-ball probe rain in its own worker (Gate A
   fps/steps-per-second HUD, top left).
2. **Certify worker spawns** (`certifyWorker.ts`) — fetches the same bundle,
   builds a `RepairEngine`, runs the first certification. Progress overlay top
   center; phases stream live.
3. **Trust map paints** — instanced quads at floor height, one per survey grid
   cell: green verified / yellow observed / red lying / dark unknown. Repaints
   after every recertify.
4. **Certificate panel** (sidebar, top) — grade badge, trust split, per-robot
   verdicts with the rover-FAIL/quadruped-PASS contrast highlighted, defect
   list with evidence, metric-scale agreement, methods lines verbatim.
5. **Repair panel** (sidebar, bottom) — proposed plan (scale → holes →
   quarantine → sills). `Run All` drives the worker engine step by step, each
   mutating step verified by a recertify:
   - `apply_vendor_scale` triggers a FULL recertify at the corrected scale;
     the world re-measures (doorway width logged before/after), the plan is
     rebuilt from the fresh certificate, and Run All continues automatically.
   - `patch_hole fitted_slab` + regional recertify: if the certifier catches
     the repair (new defects), the pulsing red banner fires and the panel
     reverts and retries with `mesh_fill` — the fail-and-adapt beat.
6. **Patrol** — once every defect has an outcome: final full recertify,
   navmesh + spawns rebuilt, and the box rover patrols the certified waypoint
   loop — over patches, around quarantined regions.

## Keys

Click the 3D view once first so the app has keyboard focus.

| Key | Action |
| --- | --- |
| `WASD` / arrows | fly the camera (hold `Shift` to sprint) |
| `V` | toggle collider wireframe |
| `T` | toggle trust map |
| `B` | toggle defect boxes (nearest 250, severity-colored; HUD acks the toggle) |
| `J` | jump to the next defect (teleports the camera box-to-box) |
| `R` | raw run: rover drives at a defect and physically fails (Beats 1–3) |
| `P` | toggle rover patrol (builds spawns on demand if repairs are done) |
| `F` | flip splats 180° about X (API `.spz` is y-down; app-exported splats auto-skip the flip via `metadata.json` `source`) |
| `I` | camera mode · `G` dev mode (HUD + sidebar) · `1–5` demo beats (`2` = live survey, with progress bar) |

Clicking a row in the certificate panel's defect list flies to that defect.

## Architecture notes

- `src/certify/*` and `src/repair/engine.ts` are fs-free and run in the worker
  as-is (Rapier compat WASM is isomorphic). `engine.exportBundle` is the only
  node-bound method and is never called in the browser — the `node:fs`
  externalization warnings during `vite build` come from its import and are
  harmless.
- The worker serves the exact closed 11-tool agent menu via
  `src/agent/tools.ts dispatchTool`; the repair panel is driving the same
  tools the autonomous agent uses.
- Protocol types live in `src/workerClient.ts` (worker + client) and
  `src/ui/protocol.d.ts` (panel-facing shapes, tolerant of both the compact
  summary and raw `certificate.json`).
- After `apply_vendor_scale` the engine world is rescaled; the viewer scales
  its world group (wireframe/splats/probes) to match, so the trust map,
  defect boxes and patrol (all in engine coordinates) stay aligned. Camera
  framing is preserved through the rescale.
- Everything works offline: no `.spz`/Spark → point-cloud fallback; no
  `metadata.json` → certifies without the vendor scale factor.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`

`npm run build` intentionally does **not** copy the multi-hundred-MB `assets/`
directory into `dist/` (`copyPublicDir: false`); the built app is meant to be
served next to an assets mount.
