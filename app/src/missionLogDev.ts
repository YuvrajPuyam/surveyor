/**
 * MISSION LOG standalone dev harness (C7 verification page).
 *
 *   cd app && npx vite   →   http://localhost:5173/missionlog-dev.html
 *   optional: ?cassette=/traces/<other>.jsonl
 *
 * Proves, without touching main.ts: the cassette loads from the static
 * /traces/ path (wifi-off), reasoning lines type in, tool chips settle from
 * the recorded results, onToolCall fires per recorded call (the hook the
 * coordinator wires to the repair cards), and the replay end-state is
 * deterministic (two hidden high-speed runs render identical logs).
 */
import { estimateDurationMs, loadCassette, type Cassette } from "./cassetteReplay";
import { buildSchedule, DEMO_PACING } from "./cassetteReplay";
import { mountMissionLog, type MissionLogHandle } from "./ui/missionLog";

const params = new URLSearchParams(location.search);
const CASSETTE_URL = params.get("cassette") ?? "/traces/repair-episode.jsonl";

const host = document.getElementById("panel-host")!;
const controls = document.getElementById("controls")!;

function box(id: string): HTMLElement {
  const d = document.createElement("div");
  d.id = id;
  controls.appendChild(d);
  return d;
}

function row(): HTMLElement {
  const r = document.createElement("div");
  r.className = "row";
  controls.appendChild(r);
  return r;
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

const meta = box("meta");
meta.textContent = `loading ${CASSETTE_URL} …`;

const buttons = row();
const driven = box("driven");
driven.textContent = "onToolCall: (none yet)";
const determinism = box("determinism");
determinism.textContent = "determinism check: not run";

// ---------------------------------------------------------------- the panel

let toolCallCount = 0;
const log: MissionLogHandle = mountMissionLog(host, {
  onToolCall: (name, args) => {
    toolCallCount += 1;
    driven.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = `onToolCall #${toolCallCount}`;
    driven.appendChild(b);
    driven.appendChild(
      document.createTextNode(` → ${name} ${JSON.stringify(args ?? {}).slice(0, 140)}`),
    );
  },
  onDone: () => {
    meta.textContent = `${metaText} — DONE (${toolCallCount} tool calls fired)`;
  },
});
log.el.style.width = "420px";

let cassette: Cassette | undefined;
let metaText = "";

async function main(): Promise<void> {
  cassette = await loadCassette(CASSETTE_URL);
  const sched = buildSchedule(cassette.events, DEMO_PACING);
  metaText =
    `cassette ${CASSETTE_URL}\n` +
    `episode ${cassette.episodeId}\n` +
    `events ${cassette.events.length} — ${cassette.counts.toolCalls} tool_call / ` +
    `${cassette.counts.toolResults} tool_result / ${cassette.counts.notes} note\n` +
    `estimated duration at speed 1: ${(estimateDurationMs(sched) / 1000).toFixed(1)} s`;
  meta.textContent = metaText;

  buttons.appendChild(
    btn("restart", () => {
      toolCallCount = 0;
      if (cassette) log.start(cassette);
    }),
  );
  buttons.appendChild(btn("pause", () => log.pause()));
  buttons.appendChild(btn("resume", () => log.resume()));
  for (const s of [0.5, 1, 2, 8, 25]) {
    buttons.appendChild(btn(`×${s}`, () => log.setSpeed(s)));
  }
  buttons.appendChild(btn("determinism check", () => void determinismCheck()));

  log.start(cassette);
}

// ------------------------------------------------- determinism double-run
// Two hidden panels replay the same cassette at high speed; identical final
// text = identical event order, content, chip states and settle-lines.

function hiddenRun(c: Cassette): Promise<string> {
  return new Promise((resolve) => {
    const mount = document.createElement("div");
    mount.style.position = "fixed";
    mount.style.left = "-10000px";
    document.body.appendChild(mount);
    const h = mountMissionLog(mount, {
      speed: 200,
      typeCharsPerSec: 100000,
      onDone: () => {
        const text = h.el.textContent ?? "";
        h.destroy();
        mount.remove();
        resolve(text);
      },
    });
    h.start(c);
  });
}

async function determinismCheck(): Promise<void> {
  if (!cassette) return;
  determinism.textContent = "determinism check: running two hidden replays…";
  determinism.className = "";
  const [a, b] = await Promise.all([hiddenRun(cassette), hiddenRun(cassette)]);
  const ok = a === b;
  determinism.textContent = ok
    ? `determinism check: MATCH — two replays rendered identical logs (${a.length} chars)`
    : `determinism check: DIFF — run A ${a.length} chars vs run B ${b.length} chars`;
  determinism.className = ok ? "ok" : "bad";
}

main().catch((err: unknown) => {
  meta.textContent = `harness failed: ${err instanceof Error ? err.message : String(err)}`;
});
