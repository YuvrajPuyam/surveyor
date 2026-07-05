# UI Redesign Spec — the five-beat staged flow

Status: DESIGN SPEC, ready to implement. Companion to `docs/demo-five-beats.md`.
Scope: `app/` only. Root library untouched (one noted exception in §7.4 is
optional and stays out of scope unless the implementer opts in).

The problem (from a real screenshot on the moon world): everything renders at
once — dev HUD top-left, PHYSICS CERTIFICATE top-right, REPAIR PLAN
bottom-right — in machine language ("0.4% VERIFIED / 65.3% LYING", "d-hole-0",
"score 0/100"), with no narrative. A first-time viewer has no idea there IS a
five-beat story. This spec turns the app into that story.

Design principles, in priority order:

1. **The 3D world is the protagonist.** UI never covers more than the right
   380px column + a one-line narrator bar + a slim stepper rail.
2. **One thing on screen per beat.** Each beat shows exactly the UI that beat
   needs; everything else is hidden or collapsed.
3. **Human first, verbatim underneath.** Every number gets a plain-language
   sentence; the raw value/method/id is one click (expand) or one keypress
   (`D`) away — never deleted. The certificate's "methods VERBATIM" quality
   bar is preserved inside the expanded sections.
4. **Demo-safe.** Every transition has a keyboard trigger. Nothing requires a
   mouse. All existing shortcuts keep working.

---

## 1. The stepper (five beats)

### 1.1 Component

New file `app/src/ui/stepper.ts`. A bottom-center rail, max 44px tall,
pointer-events only on the dots/buttons, never blocking the world.

```
        ○──────●──────○──────○──────○
     1 Meet   2 Survey  3 Certificate  4 Repair  5 Certified
                    [ Space: start survey ]
```

- Five dots + short labels. Current beat: filled dot, label bright
  (`#eef2fa`); completed: green dot; future: dim (`#5b6478`).
- Below the rail, one **primary-action hint** line showing what `Space` does
  right now (e.g. `Space — reveal the physics`). This doubles as the
  presenter's cue card.
- A **narrator bar** top-center (reuses the position of today's
  `surveyOverlay`, replaces it): a single ellipsized line of plain-language
  status. Max width `44vw`. Never two lines.

### 1.2 API (exact contract)

```ts
export type Beat = 1 | 2 | 3 | 4 | 5;

export interface StepperOptions {
  /** Called when a beat becomes current. Host shows/hides UI here. */
  onEnter(beat: Beat, from: Beat): void;
  /** Space / primary button pressed while `beat` is current. */
  onPrimary(beat: Beat): void;
  /** Return false to refuse a forward jump (e.g. beat 3 before survey done). */
  canEnter(beat: Beat): boolean;
}

export interface StepperHandle {
  el: HTMLElement;                    // the rail
  current: Beat;
  go(beat: Beat): void;               // respects canEnter for forward moves
  advance(): void;                    // go(current+1)
  back(): void;
  /** Set the Space-hint line, e.g. "Space — run the repair plan". */
  setPrimaryHint(text: string): void;
  /** Narrator bar (top-center). Empty string hides it. */
  narrate(text: string): void;
  /** Pulse the next dot when the beat's exit condition is met. */
  armAdvance(on: boolean): void;
  destroy(): void;
}

export function mountStepper(parent: HTMLElement, opts: StepperOptions): StepperHandle;
```

- Forward `go()` refused by `canEnter` shows a 1.5s narrator flash of the
  reason (the host supplies it via `narrate`), does not move.
- `armAdvance(true)` makes the next dot pulse green — the visual "you may
  advance now" cue for stage use.

### 1.3 Keyboard map (complete — additions never collide with existing keys)

| Key | Action | Notes |
|---|---|---|
| `→` or `N` | next beat | refused politely if `canEnter` is false |
| `←` | previous beat | always allowed; UI re-hides accordingly |
| `1`–`5` | jump to beat | same `canEnter` gate for forward jumps |
| `Space` / `Enter` | primary action of the current beat | see per-beat table below |
| `D` | developer overlay toggle | see §3.3 |
| `W` | physics wireframe toggle | **unchanged** (also fired by Beat-1 primary) |
| `T` | trust map toggle | **unchanged** |
| `P` | patrol toggle | **unchanged** |
| `B` | defect boxes toggle | **unchanged** |
| `F` | flip splats | **unchanged** |
| `I` | inside/orbit camera | **unchanged** |

Guard: key handling ignores events when `document.activeElement` is an input
or button (so `Space` on a focused button doesn't double-fire — call
`(document.activeElement as HTMLElement)?.blur()` after mouse clicks on
panel buttons, or check `e.target`).

Primary action (`Space`) per beat:

| Beat | First press | Subsequent presses |
|---|---|---|
| 1 Meet the world | reveal physics wireframe (same as `W`) | advance to Beat 2 |
| 2 Survey | (survey auto-starts on enter) skip → advance to Beat 3 when armed | — |
| 3 Certificate | skip/finish the grade reveal animation | advance to Beat 4 |
| 4 Repair | Run All | when plan complete: advance to Beat 5 |
| 5 Certified | start/stop patrol (same as `P`) | — |

### 1.4 Beat-by-beat behavior

**Beat 1 — Meet the world** (`W` beat)
- Visible: splats, stepper rail, an **intro card** (bottom-left, max 340px,
  dismissed on advance): world name + one line:
  > **"This world was generated by AI. It looks real. Let's find out if it *is*."**
  > Button: **Reveal the physics**
- "Reveal the physics" toggles the collider wireframe (calls the same code as
  `W`) and swaps the card line to:
  > **"Teal mesh = what a robot actually feels. Everywhere it disagrees with what you see, that's ghost geometry."**
  > Button: **Start the survey →** (advances to Beat 2)
- Hidden: HUD, sidebar, trust map, defect boxes, survey overlay.
- **The live certification does NOT start at boot anymore** (see §5 main.ts
  changes) — Beat 2 owns it, so the trust-map paint is always witnessed.

**Beat 2 — Survey**
- On enter: call `startCertification(dir)`; force trust layer visible
  (`trustLayer` on); narrator bar cycles the humanized phase lines (§2 table,
  "Survey phases"). While `certifying`, narrator shows:
  > `Dropping 2,000 physics probes across the world — watching where reality and appearance disagree…`
- A slim **trust legend** appears bottom-left (three chips with live counts as
  the map paints): `● tested & solid` (green) / `● seen, not tested` (yellow) /
  `● divergent` (red).
- When the survey completes: `armAdvance(true)`, narrator:
  > `Survey complete. The world has been graded.` — primary hint: `Space — see the certificate`.
- If the user tries `→` early: narrator flashes `Still surveying — one moment.`
- Hidden: sidebar (certificate exists in memory but is NOT shown yet — the
  grade reveal is Beat 3's moment).

**Beat 3 — Certificate (the grade reveal)**
- On enter: full-screen-center **grade reveal** (new `app/src/ui/gradeReveal.ts`):
  a huge letter (min(28vw, 260px)), grade color from the existing
  `.sv-grade-*` palette, scale-in 400ms + settle, with one line under it —
  the `gradeStory` copy (§2). After 1.6s (or on `Space`) the letter shrinks
  and flies to the sidebar header, and the sidebar appears.
- Sidebar (right, 380px): certificate panel in **collapsed mode** — header
  (world name + grade badge + `gradeStory` line) and five **collapsed
  sections**, each a single human summary line (§2 gives every line):
  `Trust`, `Robot verdicts`, `Defects`, `Measurements`, `Fine print`.
  Click (or focus+Enter) expands one; expanding keeps the existing verbatim
  rendering inside (values, `[low..high]`, methods lines untouched).
- The `Robot verdicts` section carries a pulsing highlight if any check has
  the rover-FAIL/quadruped-PASS contrast — that's Beat 3's marquee ("same
  world, two verdicts") and should draw the eye without being expanded.
- Primary hint: `Space — propose repairs`. Repair panel stays hidden.

**Beat 4 — Repair**
- On enter: certificate panel collapses to a **slim sticky header** (grade
  badge + one line, ~48px); repair panel mounts below it as **cards** (§4).
- `Run All` (or `Space`) executes cards one by one, each card animating
  pending → running → done with its human status line.
- **Fail-and-adapt is the inline drama**: when the certifier catches a
  repair, the affected card expands in place, red border + the banner copy
  (§2 "Fail-and-adapt"), then plays the revert→retry beats as sub-rows
  appearing one at a time. The world view simultaneously flashes the new
  defect's box (force `defectBoxesVisible` on for that region for 3s).
- The raw live log is behind a collapsed **"Show the work"** expander at the
  panel bottom (auto-expands during fail-and-adapt, re-collapses after).
- When every step is done and finalize succeeds: `armAdvance(true)`,
  narrator: `All problems resolved. Re-certifying the whole world…` then
  `Re-certified.` Primary hint: `Space — see the verdict`.

**Beat 5 — Certified**
- On enter: **before/after card** replaces the repair panel (sidebar top):
  ```
   F  →  A
   before   after
   1,059 problems found · 1,059 resolved
   (56 patched or roped off, 991 re-measured correct at true scale, 12 accepted)
  ```
  Numbers computed from the final certificate (`defects` outcomes) — never
  hardcoded.
- Patrol auto-starts (existing `beginPatrol()`); narrator:
  > `Rover on patrol — driving over the patches we fixed, steering around the areas we roped off.`
- Buttons on the card: **Export certificate (JSON)** (downloads
  `certificate-<worldId>.json` via `Blob` of the final `CertificateSummary`)
  and **Watch the rover** (camera-follow toggle if cheap; otherwise omit —
  patrol is already visible).
- The full certificate panel remains reachable: the slim header expands back
  to the Beat-3 collapsed-sections view on click.

---

## 2. The human-language layer (translation table — this copy is final)

New file `app/src/ui/humanize.ts` — pure functions, no DOM. Panels import
from here; **no panel builds user-facing sentences inline anymore.**

### 2.1 Trust

| Machine (today) | Human (new) |
|---|---|
| `0.4% VERIFIED` chip | `We physically tested 0.4% of the walkable area.` |
| `65.3% LYING` chip | `In 65.3% of it, what you see is not what a robot would feel.` |
| (implicit remainder) | `The rest was seen but never physically tested.` |
| Collapsed-section summary line | `Physically tested: 0.4% · divergent: 65.3% · untested: 34.3%` |
| Trust legend (Beat 2) | `tested & solid` / `seen, not tested` / `divergent` |

`trustSummary(trust): { tested: string; divergent: string; untested: string; line: string }`
— untested = `100 − verifiedPct − lyingPct`, clamped to ≥ 0. (Wire field names
`verifiedPct`/`lyingPct` are the certificate schema — unchanged; display words
are confirmed / observed / divergent.)

### 2.2 Grade

`gradeStory(cert): string` — one sentence under the grade letter:

| Grade | Copy |
|---|---|
| `A` | `Certified — a robot can trust what it sees here.` |
| `B` | `Nearly certified — minor issues, none dangerous.` |
| `C` | `Usable with care — some areas would mislead a robot.` |
| `D` | `Not ready — a robot would get into trouble here.` |
| `F` | `Unsafe for any robot — the visuals and the physics tell different stories.` |

`gradeRationale` (e.g. `56 critical, 991 major, 12 minor unresolved defect(s);
score 0/100. Outcomes recorded: 0/1059`) is translated by
`rationaleStory(cert): string`:

> `56 places a robot would fall through or crash · 991 that would block or mislead it · 12 cosmetic. 0 of 1,059 resolved so far.`

(Counts from `cert.defects` by severity and outcome; thousands separators via
`toLocaleString()`. The raw rationale string moves to the expanded Trust
section and the grade badge's tooltip.)

### 2.3 Defects

`defectDisplayName(d, ordinal): string` — human name per type, numbered
**per type in display order** (Hole #1, Hole #2, … — ordinals are stable for
a given certificate render; raw id in tooltip/dev mode):

| `type` | Display name | One-line explainer (used as description fallback) |
|---|---|---|
| `collider_hole` | `Hole #n in the floor` | `The floor looks solid here, but physics says nothing is there — anything stepping on it falls through.` |
| `phantom_collider` | `Invisible wall #n` | `Physics says something solid is here, but you can't see it — a robot would collide with thin air.` |
| `visual_only_surface` | `Fake surface #n` | `Looks solid, isn't — pure image with no physics behind it.` |
| `scale_error` | `The whole world is the wrong size` | `Doors, steps and distances are all off by the same factor — every measurement is wrong until it's fixed.` |
| `raised_sill` | `Raised sill #n` | `A real step in a doorway — whether it's a problem depends on the robot.` |
| `clearance_violation` | `Tight squeeze #n` | `A passage too narrow or low for some robots.` |
| (unknown type) | `type.replace(/_/g," ")` + ` #n` | raw description |

Specific machine descriptions that must be replaced when matched (fallback:
raw description shown as-is inside the expanded row):

| Machine | Human |
|---|---|
| `Raycast void inside the floor footprint; no probe landed here` | `Our test rays passed straight through the floor here, and not one probe could land.` |
| `Raised step/sill of 0.15 m — negotiability is robot-relative (see per-robot verdicts).` | `A 0.15 m step. Whether that's passable depends on the robot — see the verdicts.` |
| `conf 87%` | `87% sure` (tooltip: `detector confidence`) |

Rather than string-matching descriptions, `humanize.ts` keys off `d.type` and
re-renders the sentence from the defect's own numbers where present
(sill height from description regex `([\d.]+)\s*m` or from evidence) — the
machine description goes into the expanded row under a small `raw:` label in
dev mode.

Outcome chips:

| Machine | Human chip | Chip tooltip |
|---|---|---|
| `OPEN` | `needs attention` | `no outcome recorded yet` |
| `fixed` | `fixed & re-tested` | `repaired, then verified by re-certification` |
| `quarantined` | `roped off` | `excluded from the navigable area — no robot training will touch it` |
| `accepted` | `OK as-is` | `a real feature, not an error — the verdict stands` |
| `escalated` | `needs a human` | `outside what automated repair can safely do` |

Collapsed-section summary line (`defectsSummary(cert)`):

> `1,059 problems — 56 would drop or crash a robot, 991 would mislead it, 12 cosmetic` — and once outcomes exist, append ` · 1,058 resolved`.

Severity words used everywhere: critical → `would drop or crash a robot`,
major → `would block or mislead it`, minor → `cosmetic`.

### 2.4 Robot verdicts

Collapsed summary line (`verdictsSummary(cert)`):
- If any contrast pair exists: `Same world, two answers: the 0.15 m sill stops the rover but not the quadruped.` (Values from the contrasting check's measured value; if several, use the first, append ` · +2 more checks`.)
- Else: `k checks · all robots agree.`

Inside the expanded section, per row:

| Machine | Human |
|---|---|
| `step_negotiability` (check name) | `Can it climb the step?` |
| `doorway_clearance` | `Does it fit through the doorway?` |
| `slope_traversal` | `Can it hold the slope?` |
| (unknown check) | `check.replace(/_/g," ")` (today's behavior) |
| `requires: <= 0.10 m` | `limit: 0.10 m` |
| `PASS` / `FAIL` / `NOT EVALUATED` | keep — they're already human |
| contrast tag `same world · two verdicts` | keep verbatim — it's the marquee |

Measured values keep the existing `fmtMeasurement` verbatim (this is the
"instrument" credibility), but the confidence range reads
`1.27 m (confident: 1.20–1.34)` instead of `1.27 m [1.20..1.34]` — implement
by changing `fmtMeasurement`'s bracket format only inside human mode;
dev mode keeps `[low..high]`.

### 2.5 Measurements

Collapsed summary: `12 measurements, each with its error bars and method.`

| Machine name | Human name |
|---|---|
| `floor_plane_height` | `Floor height` |
| `doorway_width` | `Doorway width` |
| `doorway_height` | `Doorway height` |
| `step_height` | `Tallest step` |
| `metric_scale_factor_estimate` | `Our size estimate (from door heights)` |
| `vendor_metric_scale_factor` | `Vendor's declared size factor` |
| (unknown) | `name.replace(/_/g, " ")` |

Method lines stay verbatim (purple italic, as today) — they are the product.
`uncertainty basis: …` renders as `how we know the error bars: …`.

### 2.6 Scale & the agreement copy — **THE BUG FIX**

**Root cause** (verified in code): `repairPanel.ts` `proposePlan()` (line ~95)
hardcodes the phrase regardless of the data:

```ts
detail: `vendor ${vf.toFixed(3)} vs independent estimate ${est.toFixed(2)} — they agree; one transform re-measures the whole world`
```

The `est` field itself is correct (`cert.scale.estimated.value` IS
`metric_scale_factor_estimate`, unit `x`, directly comparable to
`vendorFactor` — not a wrong field), but on the moon world the two values are
1.615 vs 0.85 and the string still says "they agree". The engine already
computes the truth: `src/certify/certificate.ts` lines 71–78 set
`cert.scale.agreement` to an "agrees (within 2 SD)" or "DISAGREE" sentence
using `estimated.uncertainty`. The panel must **derive, never assert**.

Required implementation — `humanize.ts`:

```ts
export interface ScaleAgreement {
  agrees: boolean | undefined;   // undefined when not comparable
  headline: string;              // card title detail
  body: string;                  // card body copy
}
export function scaleAgreement(scale: ScaleSummary | undefined): ScaleAgreement;
```

Logic: `agrees` is `undefined` if `vendorFactor` or `estimated` is missing.
Otherwise, if `estimated.uncertainty` exists:
`agrees = vendorFactor >= estimated.uncertainty.low && vendorFactor <= estimated.uncertainty.high`
(the same 2-SD window the certificate uses). Fallback without uncertainty:
`agrees = Math.abs(vendorFactor - estimated.value) / estimated.value <= 0.10`.
Do NOT parse `scale.agreement` text; recompute from numbers, and show the
certificate's own `agreement` sentence verbatim inside the expanded Scale
section (dev mode shows both).

Copy (all three branches, final):

| Case | Card copy |
|---|---|
| agrees | `The vendor says everything is ×1.615 too small — and our own independent estimate from door heights agrees (×1.60). One transform fixes every size-dependent problem at once.` |
| disagrees | `The vendor says ×1.615; our independent door-height estimate says ×0.85 — they disagree. We apply the vendor's factor anyway, then immediately re-measure the entire world: if the vendor is wrong, the re-survey will catch it.` |
| no estimate | `The vendor shipped a size correction (×1.615) that was never applied. We apply it, then re-measure the entire world to verify it.` |

(Numbers are interpolated from the live `ScaleSummary`, `toFixed(3)` /
`toFixed(2)` as today.)

Collapsed Scale info inside the certificate panel's Measurements section gets
the same treatment: today's `renderScale` line
`vendor factor: 1.615 · applied: NO` becomes
`Vendor's size factor: ×1.615 — not yet applied` /
`— applied` after the repair.

### 2.7 Repair plan cards

| Machine (today) | Human card title | Human card body |
|---|---|---|
| `1. Apply vendor scale ×1.615` | `Fix the world's size (×1.615)` | branch copy from §2.6 |
| `2. Patch hole d-hole-0 (fitted_slab)` | `Patch Hole #1` | `Fill the missing floor with a fitted slab, then re-test the area to prove the patch is honest.` |
| `3. Quarantine 14 ghost surfaces` | `Rope off 14 ghost surfaces` | `These can't be honestly repaired — so we exclude them. No robot will ever be trained on geometry that isn't really there.` |
| `4. Accept 2 raised sills` | `Leave 2 sills as they are` | `They're really there. The rover can't cross them; the quadruped can. That's a fact about the robots, not an error to fix.` |
| `defects: d-hole-0, d-lie-3, +4 more` footer | hidden in human mode; dev mode shows raw ids |

Status chips: `PENDING → waiting` · `RUNNING → working…` · `DONE → done ✓` ·
`CAUGHT → failed inspection` · `FAILED → error` · `REVERTED → undone`.
Buttons: `Execute → Run` · `Revert → Undo` · `Run All → Run the plan`.

### 2.8 Fail-and-adapt (Beat 4's drama — rendered inline on the card)

| Machine | Human |
|---|---|
| banner `CERTIFIER CAUGHT THE REPAIR` | `Our own repair just failed inspection` |
| `NEW major raised_sill: …` | `The patch created a new problem: a 0.48 m step where the slab meets the floor.` (from the new defect's type + numbers) |
| note `repaired is never invisible to this instrument` | `The inspector doesn't trust anyone — including us.` (keep as the banner footnote) |
| log `reverting action a-… ` | sub-row `Undoing the patch…` |
| log `retrying with mesh_fill (conforming watertight fill) …` | sub-row `Trying a different method: a fill that follows the terrain…` |
| resolved `→ adapted: revert + mesh_fill — repair holds` | `Second method holds — verified by re-inspection. ✓` |
| `mesh_fill did not pass recertify either — 2 failed repair attempts: quarantine per policy` | `Two repair methods failed inspection — roping the area off instead. Honest beats invisible.` |
| resolved `→ adapted: revert ×2 + quarantine — the region is excluded, honestly` | `Area roped off. No robot will ever be trained on it. ✓` |

### 2.9 Progress, phases, log lines, HUD

Survey phases (narrator bar, Beat 2) — `phaseLine(phase): string`:

| `CertifyPhase` | Narrator line |
|---|---|
| `fetching-collider` | `Loading the physics shell…` |
| `parsing-collider` | `Reading the physics shell…` |
| `fetching-visual-points` | `Loading the visuals…` |
| `physics-init` | `Warming up the physics engine…` |
| `certifying` | `Dropping 2,000 physics probes across the world…` (probe count from `PROBE_COUNT`) |
| `recertifying` | `Re-testing the repaired areas…` |
| `ready` | (hide narrator) |

Live-log translations (`Show the work` shows human lines; dev mode appends
the raw line in dim text underneath):

| Machine | Human |
|---|---|
| `survey starting: /marble/… (seed 1234, 2000 probes)` | `Survey starting — 2,000 probes, repeatable run.` |
| `survey complete — grade F, 1059 defect(s), 1059 open` | `Survey complete — grade F, 1,059 problems found.` |
| `vendor scale ×1.615 applied — re-measuring the whole world (full recertify)` | `Size corrected ×1.615 — re-measuring the entire world.` |
| `doorway_width re-measured: 1.27 m → 2.02 m` | `Doorway re-measured: 1.27 m → 2.02 m — now door-sized.` |
| `recertify (regional): grade F · resolved d-hole-0 · 12 open` | `Re-inspected the area — this problem is confirmed fixed.` |
| `recertify (full) at corrected scale: … 991 finding(s) re-measured …` | `Re-measured at the true scale: 991 problems were symptoms of the size error.` |
| `plan rebuilt from the re-measured certificate` | `Plan updated to match the re-measured world.` |
| `quarantined 14 region(s) — excluded from the navigable area; no training episode touches the divergent region` | `14 areas roped off — no robot will ever be trained on them.` |
| `accepted 2 defect(s) — robot-relative verdict stands, no repair` | `2 sills accepted as real features — the per-robot verdicts stand.` |
| `all defects have outcomes — final FULL recertify…` | `Every problem resolved — grading the repaired world from scratch.` |
| `final grade: A · 0 open defects` | `Final grade: A.` |
| `navmesh + spawns rebuilt: 14 verified spawn points` | `Found 14 spots we physically verified are safe to stand on.` |
| `rover patrol started — 22 waypoints, over patches, around 14 quarantined region(s) [P toggles]` | `Rover on patrol — over the patches, around the roped-off areas.` |
| `revert a-3 (stack discipline: later actions revert too)` | `Undoing — later changes are undone with it.` |

HUD content (render fps, physics steps/s, tris, probes, world id, keyboard
cheat-sheet) is **not translated — it's relocated** behind the dev toggle
(§3.3). The cheat-sheet line gains the new keys:
`[1-5] beats  [Space] action  [→/←] step  [D] dev  [W] wireframe  [T] trust  [P] patrol  [B] boxes  [F] flip  [I] camera`.

### 2.10 Disclosures

Section renamed `Fine print` (collapsed summary: `What this certificate does
and does not promise.`). Items stay verbatim — they're legal-grade text by
design. The Beat-5 card adds the one-liner from the demo doc verbatim:
`Grade predicts navmesh-level traversability under the disclosed model class — not policy transfer.`

---

## 3. Progressive disclosure rules

### 3.1 Visibility matrix

| Element | B1 | B2 | B3 | B4 | B5 | Dev toggle `D` |
|---|---|---|---|---|---|---|
| Splats / world | ● | ● | ● | ● | ● | — |
| Stepper rail + hint | ● | ● | ● | ● | ● | — |
| Intro card | ● | – | – | – | – | — |
| Narrator bar | – | ● | on change | on change | ● | — |
| Wireframe | after reveal | keep | keep | keep | keep | `W` anytime |
| Trust map | – | ● forced | ● | ● | dim (opacity 0.4) | `T` anytime |
| Trust legend chips | – | ● | – | – | – | — |
| Certificate panel (collapsed sections) | – | – | ● | slim header | via header click | — |
| Repair panel (cards) | – | – | – | ● | replaced by before/after card | — |
| Live log | – | – | – | collapsed "Show the work" | collapsed | dev: always expanded + raw lines |
| Defect boxes | – | – | – | auto-flash on caught repair | – | `B` anytime |
| Grade reveal overlay | – | – | on enter | – | before/after uses same component | — |
| fps/tris/probes HUD | – | – | – | – | – | ● only when dev on |
| Raw ids / seeds / actionIds / raw log | tooltips only | tooltips only | tooltips only | tooltips only | tooltips only | ● inline when dev on |

(`●` visible · `–` hidden · "keep" = whatever the user toggled persists.)

### 3.2 Expansion rules (Beat 3+ certificate panel)

- All five sections **collapsed by default**, every render. Expanding is
  per-section, multiple may be open, state survives `update()` re-renders
  (keep a `Set<string>` of open section keys in the panel closure).
- A collapsed section is one row: `▸ TITLE — human summary line` (summary
  from §2). Expanded: `▾ TITLE` + today's full verbatim body.
- Nothing auto-expands except: the Defects section auto-expands once on the
  first fail-and-adapt (to show the new defect appear), then obeys the user.

### 3.3 Developer toggle (`D`)

One boolean, default **off**, persisted to `localStorage("sv-dev")`.
When on: `#hud` visible (fps, steps/s, tris, probes, world id, cheat-sheet,
status line); panels render raw defect ids next to human names
(`Hole #1 · d-hole-0`), actionIds on cards, seed in the survey log, the raw
machine line under each human log line, and `[low..high]` bracket format.
When off: all of that is tooltip-only (`title=` attributes carry raw values).
`D` never changes layout — it only reveals annotations, so toggling it live
on stage is safe.

---

## 4. Layout

```
┌────────────────────────────────────────────────────────┬──────────┐
│                      narrator bar (top-center, 1 line) │ sidebar  │
│                                                        │ ≤380px   │
│                                                        │          │
│                 3D WORLD (always dominant)             │ (beats   │
│                                                        │  3–5     │
│  intro card /                                          │  only)   │
│  trust legend (bottom-left, ≤340px, beats 1–2 only)    │          │
│                                                        │          │
│              ○──●──○──○──○  stepper (bottom-center)    │          │
│              Space — start the survey                  │          │
└────────────────────────────────────────────────────────┴──────────┘
```

- Sidebar: the existing `#sv-sidebar` (fixed, right 10px, width 384px, panels
  380px) is reused; it gets `display:none` until Beat 3.
- Certificate slim header (Beat 4): 48px sticky row — grade badge (28px) +
  `gradeStory` one-liner; click restores the full collapsed-sections panel.
- Grade reveal overlay: fixed, centered, pointer-events none, `z-index 40`,
  background transparent (the world stays visible behind the letter).
- All new CSS in `panels.css` under new prefixes: `.sv-stepper*`,
  `.sv-narrator`, `.sv-intro*`, `.sv-legend*`, `.sv-reveal*`, `.sv-collapse*`,
  `.sv-card*`, `.sv-beforeafter*`, `.sv-dev` (a class on `<body>` that CSS
  keys off for dev-only annotations: `.sv-raw { display:none }`,
  `body.sv-dev .sv-raw { display:inline }`).

---

## 5. File-by-file implementation plan

### 5.1 NEW `app/src/ui/humanize.ts` (~250 lines, zero deps besides protocol types)

Exports (all pure; unit-testable):
- `trustSummary(trust)` (§2.1)
- `gradeStory(grade)` / `rationaleStory(cert)` (§2.2)
- `defectDisplayName(d, ordinal)`, `defectExplainer(d)`, `outcomeChip(outcome)`, `defectsSummary(cert)`, `severityPhrase(sev)` (§2.3)
- `checkName(check)`, `verdictsSummary(cert)` (§2.4)
- `measurementName(name)`, `fmtMeasurementHuman(m)` (§2.5)
- `scaleAgreement(scale)` — **the bug fix** (§2.6)
- `repairCardCopy(step, cert)` (§2.7), `statusChipLabel(status)`
- `phaseLine(phase, probeCount)` (§2.9), `humanizeLogLine(raw)` — a
  best-effort map for driver/main log lines; unknown lines pass through
- `caughtBanner(newDefects)` (§2.8)

### 5.2 NEW `app/src/ui/stepper.ts` (~200 lines)

Per §1.2. Owns: rail DOM, narrator DOM, primary-hint DOM, the beat keyboard
map (`→ ← N 1-5 Space Enter`), `armAdvance` pulse. Does NOT own `W/T/P/B/F/I/D`
— those stay in `main.ts` so existing behavior is untouched.

### 5.3 NEW `app/src/ui/gradeReveal.ts` (~90 lines)

`showGradeReveal(grade, story, opts?: { before?: string }): Promise<void>` —
resolves when the animation finishes or is skipped (Space/click). With
`before`, renders the Beat-5 `F → A` variant. CSS-transition based, no rAF
bookkeeping.

### 5.4 MODIFIED `app/src/ui/certificatePanel.ts`

- Replace `section(title, hint)` with `collapsible(key, title, summaryLine, hint)`
  returning `{root, body}`; collapsed by default; open-state `Set` in the
  mount closure keyed by `key`, preserved across `update()`.
- Header: keep `PHYSICS CERTIFICATE` title, add the `gradeStory` line under
  the world id; grade badge unchanged (tooltip = raw `gradeRationale`).
- Section bodies keep today's verbatim rendering, with these substitutions
  from `humanize.ts`: defect names/ordinals + explainers (raw id/type in
  `.sv-raw` span + tooltip), outcome chips, check names, measurement names,
  `fmtMeasurementHuman`, `renderScale` copy (§2.6), `DISCLOSURES → FINE PRINT`.
- New handle methods: `setCompact(on: boolean)` (Beat-4 slim header; click
  toggles back) and `expandSection(key)` (used by the fail-and-adapt
  auto-expand of Defects).
- Contrast highlight logic unchanged.

### 5.5 MODIFIED `app/src/ui/repairPanel.ts`

- **Bug fix (do this even if nothing else ships):** in `proposePlan()`,
  delete the hardcoded `— they agree` template; build `label`/`detail` from
  `humanize.scaleAgreement(cert.scale)` + `repairCardCopy` (§2.6/§2.7). All
  three branches (agree / disagree / no estimate) must render correctly.
- Step rows become cards (`.sv-card`): human title, body copy, status chip
  (§2.7 labels), buttons `Run`/`Undo`; raw `defects: …` footer moves into a
  `.sv-raw` span (dev only).
- Fail-and-adapt: keep the banner mechanism, source all strings from
  `humanize.caughtBanner`; render revert/retry/quarantine as timed sub-rows
  on the card itself (§2.8); call `opts.onCaught?.(defect)` (new optional
  callback) so `main.ts` can flash the defect box + auto-expand Defects.
- Log: every `log(line, kind)` call site passes the raw line; `log()` runs
  `humanizeLogLine` for display and stores raw in a `.sv-raw` sub-line. The
  whole `LIVE LOG` block wraps in a collapsed `Show the work` expander
  (`expandLog(on)` on the handle for the fail-and-adapt auto-expand).
- New handle method: `runAll(): void` (extract the click handler body) so
  `Space` in Beat 4 can trigger it without synthetic clicks.
- `proposePlan` remains exported and pure — keep it that way for tests.

### 5.6 MODIFIED `app/src/main.ts`

- Mount stepper; move `void startCertification(dir)` out of `main()` into
  Beat 2's `onEnter` (idempotent guard so `←`/`→` doesn't restart it).
- Beat gating per §3.1: `sidebar.style.display`, intro card, trust legend,
  `trustLayer` forced on at Beat 2, patrol + before/after card + export at
  Beat 5 (export = `Blob` download of `latestCert`).
- `canEnter(3)` = survey complete (`latestCert` from the live run set);
  `canEnter(4)` = always once 3 reached; `canEnter(5)` = `finalized`.
  Wire `armAdvance` in `startCertification` completion and `finalizeAndPatrol`.
- Replace `surveyOverlay`/`showSurveyOverlay` with `stepper.narrate` +
  `phaseLine` (delete the overlay element).
- `D` key: toggle `body.sv-dev` + `#hud` visibility + localStorage.
  `#hud` starts hidden (§5.8). `hud.status` writes also mirror to narrator
  only when they're user-relevant (patrol start/stop); dev retains all.
- Repair panel wiring: pass `onCaught` (flash defect box for 3s via a forced
  `defectBoxesVisible` window + `certificatePanel.expandSection("defects")`).
- Static `certificate.json` boot path: still load (grid, floorY, static
  boxes) but do NOT call `certificatePanel.update` before Beat 3 — keep the
  data, gate the display.
- Keep every existing key handler byte-for-byte; add the §1.3 guard.

### 5.7 MODIFIED `app/src/ui/panels.css`

Append the new component styles (§4 class list). Touch nothing existing
except: `.sv-section-title` gains a collapsed/expanded chevron variant, and
add `.sv-raw` / `body.sv-dev .sv-raw` rules.

### 5.8 MODIFIED `app/index.html`

`#hud { display: none; }` added to the inline style (JS shows it when dev
mode is on — also honoring the persisted flag at boot).

### 5.9 Out of scope for `app/` but load-bearing to know

`src/certify/certificate.ts:74` computes `within` with a first clause
(`impliedTrue >= est.uncertainty.low`) that is tautologically true; harmless
(the real gate is the vendor-in-band check) but worth a cleanup PR of its
own. The app-side fix in §2.6 does not depend on it. Root `npm test` must
stay green if anyone touches it.

---

## 6. Acceptance checklist

1. Boot on the moon world → only splats + intro card + stepper. No HUD, no
   panels, no trust map. `cd app && npx tsc --noEmit && npx vite build` pass.
2. `Space` reveals wireframe; `Space` again enters Beat 2; trust map paints
   live with the probe narrator line; nothing else appears.
3. Beat 3 opens with the animated grade letter; sidebar shows five collapsed
   one-line sections; expanding Measurements shows verbatim methods lines.
4. The scale card on the moon world reads the **disagree** branch
   (`×1.615 vs ×0.85 — they disagree…`); on a world where the values are in
   band it reads the agree branch. The words "they agree" can no longer
   appear alongside out-of-band numbers.
5. Run All executes cards top-to-bottom; a caught repair plays the inline
   revert→retry drama; the log stays collapsed except during that moment.
6. Beat 5 shows `F → A` with resolved counts from live data, patrol runs,
   export downloads valid JSON of the final certificate.
7. `W T P B F I` all still work at every beat; `D` toggles every raw
   annotation at once; the full demo is drivable with `Space` + `→` only.
8. No overlay other than the sidebar exceeds 380px wide; the world is never
   more than ~30% occluded.
