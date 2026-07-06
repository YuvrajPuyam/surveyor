# MISSION LOG (C7) — integration contract for main.ts

Written by the C7 lane, which may NOT edit `app/src/main.ts`. The coordinator
pastes the blocks below. Every referenced name is real as of this writing:
`sidebar`, `repairPanel` (RepairPanelHandle: `el/log/runAll/…`), `stepper`,
`finalized`, `applyBeat`, the `onPrimary` beat switch. The snippet block was
compile-checked verbatim against the real module types (`tsc --noEmit`) via a
temporary mirror file before this doc was written.

**Cassette asset (wifi-off):** `assets/traces/repair-episode.jsonl` — a
byte-identical copy (sha256 `038422d7…a67f01`) of
`traces/7188e250-e2ff-43e7-babb-73834c22e932-mcp-2026-07-04T22-32-42-848Z.jsonl`
(the recorded F→A / 81-outcomes episode). Vite `publicDir: "../assets"` serves
it at `/traces/repair-episode.jsonl`; nothing is fetched remotely. When the
episode is re-recorded against the canonical certificate (C3 remainder),
overwrite that one file — no code change needed.

**Choreography (Beat 4, one Space):** the MISSION LOG starts replaying the
recorded episode (the agent's own words + tool calls, honesty chip always
visible) at the same moment `repairPanel.runAll()` starts the live engine.
Each recorded tool call pulses the matching live plan card (cosmetic blue
outline, class `sv-ml-drive`) — the recorded agent visibly "drives" the same
repairs the live engine is executing. Card status chips stay owned by the
live run; the replay never mutates engine state.

---

## Edit 1 — imports (top of main.ts, beside the other `./ui/` imports)

```ts
import { mountMissionLog } from "./ui/missionLog";
import { loadCassette } from "./cassetteReplay";
```

## Edit 2 — Block A: mount + loader + card-driver

Paste immediately AFTER the repair panel mount, i.e. after this existing line:

```ts
repairPanel.log("waiting for survey…");
```

```ts
// ---- MISSION LOG (C7): recorded-episode replay narrating Beat 4 --------
// Cassette is a static asset: assets/traces/repair-episode.jsonl (vite
// publicDir "../assets") → served at /traces/repair-episode.jsonl. Wifi-off.
const MISSION_LOG_CASSETTE_URL = "/traces/repair-episode.jsonl";

const missionLog = mountMissionLog(sidebar, {
  onToolCall: (name, args) => driveRepairCard(name, args),
});
Object.assign(missionLog.el.style, {
  flex: "1 1 50%",
  minHeight: "0",
  width: "100%",
} satisfies Partial<CSSStyleDeclaration>);
missionLog.el.style.display = "none"; // Beat 4 only — applyBeat owns visibility

let missionLogStarted = false;
function startMissionLogReplay(): void {
  if (missionLogStarted) return;
  missionLogStarted = true;
  loadCassette(MISSION_LOG_CASSETTE_URL)
    .then((cassette) => missionLog.start(cassette))
    .catch((err: unknown) => {
      missionLogStarted = false; // allow a retry on the next Space
      repairPanel.log(
        `mission log: cassette failed to load — ${err instanceof Error ? err.message : String(err)}`,
        "warn",
      );
    });
}

/**
 * A recorded tool call visually drives the matching repair-plan card: pulse
 * the card whose raw footer (".sv-step-defects": rawLabel + defect ids)
 * mentions the call's defectId, else the card of the same step kind.
 * Cosmetic only (sv-ml-drive outline) — the card's real status chip stays
 * owned by the live Run All engine.
 */
function driveRepairCard(name: string, args: unknown): void {
  const a = (args ?? {}) as Record<string, unknown>;
  const defectId = typeof a["defectId"] === "string" ? (a["defectId"] as string) : undefined;
  const KIND_LABEL: Record<string, string> = {
    apply_vendor_scale: "Apply vendor scale",
    patch_hole: "Patch hole",
    quarantine: "Quarantine",
    accept_defect: "Accept",
  };
  const label = KIND_LABEL[name];
  let target: HTMLElement | undefined;
  for (const card of Array.from(repairPanel.el.querySelectorAll<HTMLElement>(".sv-card"))) {
    const footer = card.querySelector(".sv-step-defects")?.textContent ?? "";
    if (defectId && footer.includes(defectId)) {
      target = card;
      break;
    }
    if (!target && label && footer.includes(label)) target = card;
  }
  if (!target) return;
  target.classList.remove("sv-ml-drive");
  void target.offsetWidth; // restart the pulse animation
  target.classList.add("sv-ml-drive");
  window.setTimeout(() => target.classList.remove("sv-ml-drive"), 900);
}
```

## Edit 3 — Line B: visibility matrix in `applyBeat`

Inside `applyBeat(beat, from)`, right after this existing line:

```ts
repairPanel.el.style.display = beat === 4 ? "" : "none";
```

add:

```ts
missionLog.el.style.display = beat === 4 ? "" : "none";
if (beat === 4) missionLog.resume();
else missionLog.pause(); // never narrate over other beats (no-op before start)
```

## Edit 4 — Lines C: Beat-4 primary action in the stepper's `onPrimary`

Replace the existing `case 4:` body

```ts
case 4:
  if (finalized) stepper.advance();
  else repairPanel.runAll();
  break;
```

with

```ts
case 4:
  if (finalized) stepper.advance();
  else {
    startMissionLogReplay(); // the recorded agent narrates…
    repairPanel.runAll(); // …while the live engine executes the plan
  }
  break;
```

---

## Notes for the coordinator

- **Sidebar layout:** in Beat 4 the certificate panel is compact
  (`setCompact(beat >= 4)`, flex none), so the column is compact-cert +
  repair (45%) + mission log (50%). In every other beat the mission log is
  `display: none` — nothing else moves.
- **Pacing:** tuned to ≈35 s at speed 1 for the current 183-event cassette
  (`DEMO_PACING` in `app/src/cassetteReplay.ts`; measured 34.9 s estimate,
  knobs documented there). `missionLog.setSpeed(n)` adjusts live if rehearsal
  wants it tighter; pass `pacing`/`speed` in `mountMissionLog` options to
  retune after the re-record.
- **Replay honesty:** the panel header carries a permanent
  `RECORDED REPLAY` chip with the byte-for-byte tooltip (humanize
  `MISSION_LOG.replayTooltip`). Keep it — it is the disclosure ENDGAME's
  fallback table relies on ("Cassette replay, disclosed").
- **Current cassette caveat:** the shipped episode predates the C1
  recalibration (baseline "grade F, 40 defects, probes 800" vs canonical
  F/21/2000), so its defect ids will NOT match the live plan's ids on the
  canonical habitat — `driveRepairCard` then falls back to kind-label
  matching (scale/patch/quarantine/accept cards still pulse). After the C3
  re-record the ids line up and per-defect pulsing becomes exact.
- **Standalone QA:** `http://localhost:5173/missionlog-dev.html` (harness:
  restart/pause/speed buttons, onToolCall counter, determinism double-run).
