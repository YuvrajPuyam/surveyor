# GATE A — physics-worker throughput vs render fps

**Claim under test:** the 2000-ball probe rain runs in a Web Worker at a fixed
1/60 s timestep without dragging the render loop down, and the HUD reports the
two rates *independently*.

## How to run it on the demo laptop

1. ```sh
   cd app
   npm install     # once
   npm run dev
   ```
2. Open the printed URL in Chrome (or any WebGL2 browser):

   ```
   http://localhost:5173/?world=/marble/7188e250-e2ff-43e7-babb-73834c22e932
   ```
3. Wait for the HUD status line to read `physics running` (Rapier wasm init +
   collider transfer takes ~1–2 s). Cyan balls rain onto the world.

## What to read off the HUD (top-left)

The two big numbers are measured by different clocks and MUST be read
separately:

- `render N fps` — main-thread `requestAnimationFrame` rate, averaged over
  0.5 s windows. Green ≥ 50, yellow ≥ 25, red below.
- `physics N steps/s` — the worker's cumulative step counter, differenced on
  the main thread over ≥ 0.5 s windows. The worker steps a wall-clock
  accumulator in exact 1/60 s increments, so the honest target is **60**
  (green ≥ 55).

## Pass criteria

- `physics steps/s` holds ~60 with 2000 probes on the 35k-tri Marble collider.
- `render fps` holds near the display refresh rate (typically 60) while
  orbiting the camera (drag / scroll).
- The two numbers move independently: a heavy render view (zoom into the full
  splat cloud) must not lower `physics steps/s` — that is the whole point of
  the worker.

## Quick stress checks

- Press `W` / `B` to toggle wireframe and defect boxes and confirm render fps
  changes while physics stays at 60.
- Background-tab test: switch tabs for ~10 s and return. Render fps drops to
  ~0 while hidden (browser throttles rAF); physics keeps stepping in the
  worker (`setInterval` in workers is not rAF-throttled), and the step counter
  will have advanced accordingly.
- Fall-through check: with a grade-F world, some probes visibly drain through
  red defect boxes (collider holes). That is the bug being visualized, not a
  viewer bug.

## Failure modes seen so far

- `worker error: ...` in the HUD status line → Rapier wasm failed to init
  (check the browser console; the wasm is inlined, so this usually means an
  ancient browser).
- `visuals none` → bundle path wrong; check the `?world=` param against the
  directories under `assets/`.
