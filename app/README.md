# Surveyor Viewer

Browser viewer for Surveyor world bundles: gaussian-splat (or point-cloud)
visuals, the physics collider as a wireframe, live Rapier probe rain in a Web
Worker, and the certificate's defect regions as translucent boxes — so you can
*see* where the world's visuals and physics disagree.

## Run

```sh
cd app
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). The repo's `assets/`
directory is served as the web root (`publicDir: "../assets"`), so the real
Marble bundle is at:

```
http://localhost:5173/?world=/marble/7188e250-e2ff-43e7-babb-73834c22e932
```

That world is also the default when `?world=` is omitted. A legacy
`?world=/assets/marble/<id>` prefix is accepted and stripped. To point the
viewer at a specific splat file inside the bundle, add `&splat=<filename>`.

## What you see

| Layer | Source | Toggle |
| --- | --- | --- |
| Splats | first `splat-*.spz` found, rendered by Spark | — |
| Point cloud (offline fallback) | `visual-points.f32`, height-colored `THREE.Points` | — |
| Collider wireframe | `collider.glb`, teal | `W` |
| Defect regions | `certificate.json` `defects[].region` AABBs, colored by severity (red critical / orange major / yellow minor) | `B` |
| Probe rain | 2000 Rapier balls dropped 2 m above raycast-verified surfaces, stepped at a fixed 1/60 s in a Web Worker | — |
| Flip visuals | `.spz` files are y-down; flips the splat/point object 180° about X if it renders upside-down relative to the collider | `F` |

The HUD (top-left) shows **render fps** and **worker physics steps/s**
separately — see `GATE-A.md` for the acceptance test.

## Notes

- The physics collider, probe simulation, and defect boxes all live in the
  `collider.glb` frame (node transforms baked), which is the same frame the
  certify pipeline measures in. Splats are rendered in their native `.spz`
  frame; if the vendor exported mismatched frames, that mismatch is visible —
  which is rather the point of this tool.
- Everything works offline: if Spark or the `.spz` fails to load, the viewer
  falls back to `visual-points.f32` automatically.
- `npm run build` intentionally does **not** copy the multi-hundred-MB
  `assets/` directory into `dist/` (`copyPublicDir: false`); the built app is
  meant to be served next to an assets mount.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build (type-safe, `vite build`)
- `npm run typecheck` — `tsc --noEmit`
