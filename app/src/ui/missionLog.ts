/**
 * MISSION LOG panel (ENDGAME C7) — Beat 4's cassette replay UI.
 *
 * Streams a RECORDED repair-agent episode into a monospace log: the agent's
 * own reasoning types in verbatim (kind "note" events, plus the recorded
 * per-call justifications in quarantine/accept args), and every recorded
 * tool call renders as a chip row whose state (running → done/failed/
 * flagged) is driven by the recorded tool_result that follows it on tape.
 *
 * Honesty is structural: the header carries a permanent RECORDED REPLAY chip
 * — this panel replays a real session byte-for-byte from a static cassette
 * file; nothing in it is generated live, and nothing here touches the
 * network (see cassetteReplay.loadCassette's same-origin guard).
 *
 * Copy lives in humanize.ts (MISSION_LOG section); styles in panels.css
 * (sv-ml- block). Mount idiom matches the other panels: mountMissionLog()
 * returns { el, start(cassette), stop(), onToolCall, … }.
 */
import "./panels.css";
import {
  CassetteReplayer,
  type Cassette,
  type CassetteEvent,
  type ReplayPacing,
  type ScheduledEvent,
} from "../cassetteReplay";
import {
  MISSION_LOG,
  missionReasonQuote,
  missionResultFailed,
  missionResultFlagged,
  missionResultNote,
  missionToolLine,
} from "./humanize";

export interface MissionLogOptions {
  /** Pacing overrides forwarded to the replayer (see DEMO_PACING). */
  pacing?: Partial<ReplayPacing>;
  /** Playback speed multiplier (1 = the tuned ~35 s rhythm). */
  speed?: number;
  /** Typing speed for reasoning lines, characters per second. */
  typeCharsPerSec?: number;
  /** Notified for every recorded tool call — drive the matching repair card. */
  onToolCall?: (name: string, args: unknown, ev: CassetteEvent) => void;
  /** Notified when the recorded result lands (settle the card you drove). */
  onToolResult?: (name: string, result: unknown, ev: CassetteEvent) => void;
  onDone?: () => void;
}

export interface MissionLogHandle {
  el: HTMLElement;
  /** Clear the log and play this cassette from the top. */
  start(cassette: Cassette): void;
  /** Halt playback (content stays on screen; start() clears it). */
  stop(): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: number): void;
  /** Reassignable after mount — same contract as options.onToolCall. */
  onToolCall?: (name: string, args: unknown, ev: CassetteEvent) => void;
  onToolResult?: (name: string, result: unknown, ev: CassetteEvent) => void;
  onDone?: () => void;
  destroy(): void;
}

// ------------------------------------------------------------ DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function rawJson(v: unknown, cap = 400): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? "";
  } catch {
    s = String(v);
  }
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

type ChipState = "running" | "done" | "failed" | "flagged";

interface ToolRow {
  row: HTMLElement;
  chip: HTMLElement;
  burst: boolean;
}

/**
 * Mount the MISSION LOG panel into `parent`. When `parent` is document.body
 * the panel floats bottom-right (same convention as the repair panel).
 */
export function mountMissionLog(parent: HTMLElement, opts: MissionLogOptions = {}): MissionLogHandle {
  const panel = el("div", "sv-panel sv-panel-mission");
  if (parent === document.body) panel.classList.add("sv-float-br");
  parent.appendChild(panel);

  // ---- header: title + the honesty chip
  const head = el("div", "sv-cert-head");
  const titleWrap = el("div");
  titleWrap.appendChild(el("div", "sv-cert-title", MISSION_LOG.title));
  titleWrap.appendChild(el("div", "sv-cert-world", MISSION_LOG.subtitle));
  head.appendChild(titleWrap);
  const replayChip = el("span", "sv-ml-replaychip", MISSION_LOG.replayChip);
  replayChip.title = MISSION_LOG.replayTooltip;
  head.appendChild(replayChip);
  panel.appendChild(head);

  // ---- sub row: episode id (left) + progress (right)
  const sub = el("div", "sv-ml-sub");
  const episodeEl = el("span", "sv-ml-episode", "");
  const progressEl = el("span", "sv-ml-progress", "");
  sub.appendChild(episodeEl);
  sub.appendChild(progressEl);
  panel.appendChild(sub);

  // ---- the log
  const logArea = el("div", "sv-ml-log");
  logArea.appendChild(el("div", "sv-empty", MISSION_LOG.empty));
  panel.appendChild(logArea);

  // ---- footer: status + pause/replay
  const foot = el("div", "sv-ml-foot");
  const statusEl = el("span", "sv-ml-status", "");
  foot.appendChild(statusEl);
  const pauseBtn = el("button", "sv-btn", MISSION_LOG.btnPause) as HTMLButtonElement;
  pauseBtn.style.display = "none";
  foot.appendChild(pauseBtn);
  panel.appendChild(foot);

  // ------------------------------------------------- auto-scroll override
  // Stick to the bottom unless the user scrolled up to read; re-stick when
  // they return to the bottom themselves.
  let stickBottom = true;
  logArea.addEventListener("scroll", () => {
    stickBottom = logArea.scrollTop + logArea.clientHeight >= logArea.scrollHeight - 24;
  });
  function scrollLog(): void {
    if (stickBottom) logArea.scrollTop = logArea.scrollHeight;
  }

  // ---------------------------------------------------------- typing effect
  const typeCps = Math.max(opts.typeCharsPerSec ?? 110, 10);
  let typeTimer: number | undefined;
  let typeTarget: { span: HTMLElement; caret: HTMLElement; full: string } | undefined;

  /** Finish any in-progress typing instantly — the final DOM never depends
   *  on how typing raced the event schedule (deterministic end state). */
  function settleTyping(): void {
    if (typeTimer !== undefined) clearInterval(typeTimer);
    typeTimer = undefined;
    if (typeTarget) {
      typeTarget.span.textContent = typeTarget.full;
      typeTarget.caret.remove();
      typeTarget = undefined;
    }
    scrollLog();
  }

  function typeIn(span: HTMLElement, caret: HTMLElement, full: string): void {
    settleTyping();
    typeTarget = { span, caret, full };
    let shown = 0;
    const stepMs = 16;
    const perTick = Math.max(1, Math.round((typeCps * stepMs) / 1000));
    typeTimer = window.setInterval(() => {
      shown = Math.min(full.length, shown + perTick);
      span.textContent = full.slice(0, shown);
      scrollLog();
      if (shown >= full.length) settleTyping();
    }, stepMs);
  }

  // ------------------------------------------------------------- rendering

  /** Unresolved tool rows per tool name — the recorded result that follows
   *  settles the most recent one (the cassette is strictly call→result). */
  const openRows = new Map<string, ToolRow[]>();

  function clearLog(): void {
    settleTyping();
    openRows.clear();
    logArea.replaceChildren();
    stickBottom = true;
  }

  function setChip(chipEl: HTMLElement, state: ChipState): void {
    chipEl.className = `sv-ml-state sv-ml-state-${state}`;
    chipEl.textContent = MISSION_LOG.state[state];
  }

  function renderReasoning(text: string): void {
    settleTyping();
    const note = el("div", "sv-ml-note");
    note.appendChild(el("span", "sv-ml-note-tag", MISSION_LOG.agentTag));
    const span = el("span", "sv-ml-note-text", "");
    note.appendChild(span);
    const caret = el("span", "sv-ml-caret");
    note.appendChild(caret);
    logArea.appendChild(note);
    scrollLog();
    typeIn(span, caret, text);
  }

  function renderToolCall(name: string, args: unknown, meta: ScheduledEvent): void {
    settleTyping();
    const row = el("div", `sv-ml-tool${meta.burst ? " sv-ml-tool-burst" : ""}`);
    row.appendChild(el("span", "sv-ml-glyph", MISSION_LOG.toolGlyph));
    const line = el("span", "sv-ml-tool-line", missionToolLine(name, args));
    line.title = `${name} ${rawJson(args)}`;
    row.appendChild(line);
    const chip = el("span", "sv-ml-state");
    setChip(chip, "running");
    row.appendChild(chip);

    // the agent's own recorded justification, verbatim
    const reason = missionReasonQuote(args);
    if (reason) {
      const quote = el("div", `sv-ml-quote${meta.burst ? " sv-ml-quote-clip" : ""}`, `“${reason}”`);
      quote.title = reason;
      row.appendChild(quote);
    }

    // dev-mode raw args (hidden until body.sv-dev — same idiom as the other panels)
    row.appendChild(el("span", "sv-raw sv-raw-block", `${name} ${rawJson(args)}`));

    logArea.appendChild(row);
    const list = openRows.get(name);
    if (list) list.push({ row, chip, burst: meta.burst });
    else openRows.set(name, [{ row, chip, burst: meta.burst }]);
    scrollLog();
  }

  function renderToolResult(name: string, result: unknown): void {
    settleTyping();
    const open = openRows.get(name);
    const target = open?.pop();
    const failed = missionResultFailed(result);
    const flagged = missionResultFlagged(name, result);
    const state: ChipState = failed ? "failed" : flagged ? "flagged" : "done";
    const note = missionResultNote(name, result);
    if (target) {
      setChip(target.chip, state);
      if (note && (!target.burst || state !== "done")) {
        const cls =
          state === "failed"
            ? "sv-ml-resnote sv-ml-resnote-failed"
            : state === "flagged"
              ? "sv-ml-resnote sv-ml-resnote-flagged"
              : "sv-ml-resnote";
        const noteEl = el("div", cls, note);
        noteEl.title = rawJson(result);
        target.row.appendChild(noteEl);
      }
      target.row.appendChild(el("span", "sv-raw sv-raw-block", `= ${rawJson(result)}`));
    } else if (note) {
      // truncated / hand-edited cassette: a result with no open call still renders
      logArea.appendChild(el("div", "sv-ml-resnote", `${name}: ${note}`));
    }
    scrollLog();
  }

  // -------------------------------------------------------------- playback

  let replayer: CassetteReplayer | undefined;

  function setStatus(text: string, done = false): void {
    statusEl.textContent = text;
    statusEl.className = done ? "sv-ml-status sv-ml-status-done" : "sv-ml-status";
  }

  function refreshPauseBtn(): void {
    if (!replayer) {
      pauseBtn.style.display = "none";
      return;
    }
    pauseBtn.style.display = "";
    pauseBtn.textContent =
      replayer.state === "done"
        ? MISSION_LOG.btnReplay
        : replayer.state === "paused"
          ? MISSION_LOG.btnResume
          : MISSION_LOG.btnPause;
  }

  const handle: MissionLogHandle = {
    el: panel,
    onToolCall: opts.onToolCall,
    onToolResult: opts.onToolResult,
    onDone: opts.onDone,

    start(cassette: Cassette): void {
      replayer?.stop();
      clearLog();
      episodeEl.textContent = cassette.episodeId;
      episodeEl.title = cassette.source ?? cassette.episodeId;
      setStatus("");
      replayer = new CassetteReplayer(
        cassette,
        {
          onReasoning: (text) => renderReasoning(text),
          onToolCall: (name, args, ev, meta) => {
            renderToolCall(name, args, meta);
            handle.onToolCall?.(name, args, ev);
          },
          onToolResult: (name, result, ev) => {
            renderToolResult(name, result);
            handle.onToolResult?.(name, result, ev);
          },
          onProgress: (fired, total) => {
            progressEl.textContent = `${fired}/${total}`;
          },
          onDone: () => {
            settleTyping();
            setStatus(MISSION_LOG.done, true);
            refreshPauseBtn();
            handle.onDone?.();
          },
        },
        opts.pacing,
        opts.speed ?? 1,
      );
      progressEl.textContent = `0/${replayer.progress.total}`;
      replayer.play();
      refreshPauseBtn();
    },

    stop(): void {
      settleTyping();
      replayer?.stop();
      refreshPauseBtn();
    },

    pause(): void {
      replayer?.pause();
      refreshPauseBtn();
    },

    resume(): void {
      replayer?.play();
      refreshPauseBtn();
    },

    setSpeed(speed: number): void {
      replayer?.setSpeed(speed);
    },

    destroy(): void {
      settleTyping();
      replayer?.stop();
      panel.remove();
    },
  };

  pauseBtn.addEventListener("click", () => {
    pauseBtn.blur();
    if (!replayer) return;
    if (replayer.state === "done") {
      // full deterministic re-run of the same cassette
      handle.start(replayer.cassette);
    } else if (replayer.state === "paused") {
      handle.resume();
    } else {
      handle.pause();
    }
  });

  return handle;
}
