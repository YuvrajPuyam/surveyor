/**
 * Cassette replay for the MISSION LOG panel (ENDGAME C7).
 *
 * Loads a recorded repair-agent episode (JSONL of TraceEvent lines — the
 * exact file src/trace/cassette.ts TraceRecorder writes) and replays it as a
 * paced stream of typed callbacks. The cassette is the single source of
 * truth: the replayer renders whatever was recorded, verbatim, in recorded
 * order — it never invents, reorders, or edits an event.
 *
 * Wifi-off by construction: loadCassette() only accepts same-origin URLs
 * (the cassette ships as a static asset under the vite publicDir:
 * assets/traces/<name>.jsonl → served at /traces/<name>.jsonl). Nothing here
 * ever touches the network beyond that one static fetch.
 *
 * Pacing: recorded wall-clock gaps (API latency, tool runtime) are not
 * presentable — replay compresses them to a demo rhythm. Delays are computed
 * ONCE, deterministically, from the event sequence + pacing knobs
 * (buildSchedule): the same cassette + the same pacing always produces the
 * same schedule and the same callback order/content. Long runs of the same
 * tool (32× accept_defect, 41× quarantine in the recorded episode) compress
 * into a rapid cascade after `burstAfter` repeats so the ~180-event episode
 * lands near the ~35 s Beat-4 slot. `simTime`, when present on events, is
 * intentionally ignored — order comes from the recorded sequence, rhythm
 * from the knobs.
 */

// ------------------------------------------------------------------ events

/** Mirror of src/core/types.ts TraceEventSchema (no zod in the app bundle). */
export interface CassetteEvent {
  episodeId: string;
  callIndex: number;
  kind: "tool_call" | "tool_result" | "note";
  /** tool name for tool_call/tool_result; the note TEXT for kind "note"
   *  (TraceRecorder.note() stores the agent's words in `name`). */
  name?: string;
  args?: unknown;
  result?: unknown;
  contentAddr?: string;
  simTime?: number;
}

export interface Cassette {
  episodeId: string;
  events: CassetteEvent[];
  counts: { notes: number; toolCalls: number; toolResults: number };
  /** Original source (URL or label) for provenance display. */
  source?: string;
}

const EVENT_KINDS = new Set(["tool_call", "tool_result", "note"]);

/** Parse one JSONL cassette. Throws with a line number on malformed input. */
export function parseCassette(jsonl: string, source?: string): Cassette {
  const events: CassetteEvent[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`cassette line ${i + 1}: not valid JSON`);
    }
    const ev = raw as Record<string, unknown>;
    if (
      typeof ev !== "object" ||
      ev === null ||
      typeof ev["episodeId"] !== "string" ||
      typeof ev["callIndex"] !== "number" ||
      typeof ev["kind"] !== "string" ||
      !EVENT_KINDS.has(ev["kind"] as string)
    ) {
      throw new Error(`cassette line ${i + 1}: not a TraceEvent (need episodeId, callIndex, kind)`);
    }
    events.push(raw as CassetteEvent);
  }
  if (events.length === 0) throw new Error("cassette is empty");
  const counts = { notes: 0, toolCalls: 0, toolResults: 0 };
  for (const e of events) {
    if (e.kind === "note") counts.notes++;
    else if (e.kind === "tool_call") counts.toolCalls++;
    else counts.toolResults++;
  }
  return { episodeId: events[0]!.episodeId, events, counts, source };
}

/**
 * Fetch + parse a cassette from a STATIC same-origin URL (e.g.
 * "/traces/repair-episode.jsonl"). Rejects cross-origin URLs outright — the
 * replay must work with the venue wifi off.
 */
export async function loadCassette(url: string): Promise<Cassette> {
  const resolved = new URL(url, location.href);
  if (resolved.origin !== location.origin) {
    throw new Error(`cassette must be a same-origin static asset (got ${resolved.origin})`);
  }
  const res = await fetch(resolved.pathname + resolved.search);
  if (!res.ok) throw new Error(`cassette fetch failed: ${res.status} ${res.statusText} (${url})`);
  return parseCassette(await res.text(), url);
}

// ------------------------------------------------------------------ pacing

/** All knobs in milliseconds (except perChar caps). See buildSchedule(). */
export interface ReplayPacing {
  /** delay after a reasoning note: base + min(chars × perChar, extraCap). */
  noteBaseMs: number;
  notePerCharMs: number;
  noteExtraCapMs: number;
  /** delay after a tool_call row appears (chip shows "running"). */
  toolCallMs: number;
  /** delay after its tool_result lands (chip settles to done/failed). */
  toolResultMs: number;
  /** consecutive same-tool calls beyond this many compress into a burst. */
  burstAfter: number;
  burstToolCallMs: number;
  burstToolResultMs: number;
}

/**
 * Tuned against the recorded 183-event episode (91 calls / 91 results /
 * 1 note) to land ≈35 s at speed 1 — the Beat-4 slot. Re-tune here, or pass
 * overrides, when the episode is re-recorded.
 */
export const DEMO_PACING: ReplayPacing = {
  noteBaseMs: 900,
  notePerCharMs: 12,
  noteExtraCapMs: 2600,
  toolCallMs: 450,
  toolResultMs: 350,
  burstAfter: 2,
  burstToolCallMs: 110,
  burstToolResultMs: 70,
};

/** Per-event replay metadata, precomputed so playback is deterministic. */
export interface ScheduledEvent {
  event: CassetteEvent;
  /** delay AFTER this event fires, before the next one (ms, at speed 1). */
  delayAfterMs: number;
  /** true when this event sits inside a compressed same-tool cascade. */
  burst: boolean;
}

function noteText(ev: CassetteEvent): string {
  return typeof ev.name === "string" ? ev.name : "";
}

/**
 * Pure function of (events, pacing) → schedule. Burst membership: a
 * tool_call is "burst" when it is the (burstAfter+1)-th or later consecutive
 * call of the same tool; its result inherits the flag.
 */
export function buildSchedule(events: CassetteEvent[], pacing: ReplayPacing): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  let runTool: string | undefined;
  let runLength = 0;
  let callWasBurst = false;
  for (const event of events) {
    let delayAfterMs: number;
    let burst = false;
    if (event.kind === "note") {
      runTool = undefined;
      runLength = 0;
      delayAfterMs =
        pacing.noteBaseMs + Math.min(noteText(event).length * pacing.notePerCharMs, pacing.noteExtraCapMs);
    } else if (event.kind === "tool_call") {
      if (event.name === runTool) runLength += 1;
      else {
        runTool = event.name;
        runLength = 1;
      }
      burst = runLength > pacing.burstAfter;
      callWasBurst = burst;
      delayAfterMs = burst ? pacing.burstToolCallMs : pacing.toolCallMs;
    } else {
      // tool_result inherits its call's burst membership
      burst = callWasBurst;
      delayAfterMs = burst ? pacing.burstToolResultMs : pacing.toolResultMs;
    }
    out.push({ event, delayAfterMs, burst });
  }
  return out;
}

/** Total run time at a given speed — handy for tuning against the beat. */
export function estimateDurationMs(schedule: ScheduledEvent[], speed = 1): number {
  let t = 0;
  for (const s of schedule) t += s.delayAfterMs;
  return t / Math.max(speed, 0.01);
}

// ---------------------------------------------------------------- replayer

export interface ReplayCallbacks {
  /** Agent reasoning, VERBATIM from the cassette (kind "note"). */
  onReasoning?(text: string, ev: CassetteEvent, meta: ScheduledEvent): void;
  onToolCall?(name: string, args: unknown, ev: CassetteEvent, meta: ScheduledEvent): void;
  onToolResult?(name: string, result: unknown, ev: CassetteEvent, meta: ScheduledEvent): void;
  onDone?(): void;
  /** Fires on every event with (fired, total) — drives a progress readout. */
  onProgress?(fired: number, total: number): void;
}

export type ReplayState = "idle" | "playing" | "paused" | "done";

/** Poll granularity for the playback clock (ms). Delays are ≥70 ms, so a
 *  40 ms tick preserves the rhythm in a visible tab. */
const TICK_MS = 40;

/**
 * Plays a cassette's events through the callbacks with the precomputed
 * schedule. Event ORDER and CONTENT are byte-deterministic (they come from
 * the file); wall-clock spacing follows the schedule at the current speed.
 *
 * Playback is a wall-clock CATCH-UP loop, not a chained per-event timeout:
 * one interval advances a virtual playhead by real elapsed time × speed and
 * fires every event whose scheduled start it has passed. Browsers throttle
 * timers in hidden/occluded tabs (chained timeouts can coalesce to once a
 * minute) — with catch-up, an occluded window batches events on the next
 * tick instead of stalling the beat, and total duration stays honest.
 *
 * play()/pause() toggle; setSpeed() applies from the current playhead.
 */
export class CassetteReplayer {
  readonly cassette: Cassette;
  readonly schedule: ScheduledEvent[];
  /** Cumulative start time of each event at speed 1 (event 0 fires at 0). */
  private readonly startAtMs: number[];
  private readonly totalMs: number;
  private cb: ReplayCallbacks;
  private cursor = 0;
  private ticker: number | undefined;
  private stateInternal: ReplayState = "idle";
  private speedInternal: number;
  /** Schedule-time already consumed (speed-1 units) + the wall anchor. */
  private playheadMs = 0;
  private anchorWall = 0;

  constructor(cassette: Cassette, callbacks: ReplayCallbacks, pacing?: Partial<ReplayPacing>, speed = 1) {
    this.cassette = cassette;
    this.cb = callbacks;
    this.schedule = buildSchedule(cassette.events, { ...DEMO_PACING, ...pacing });
    this.speedInternal = Math.max(speed, 0.01);
    this.startAtMs = new Array<number>(this.schedule.length);
    let t = 0;
    for (let i = 0; i < this.schedule.length; i++) {
      this.startAtMs[i] = t;
      t += this.schedule[i]!.delayAfterMs;
    }
    this.totalMs = t;
  }

  get state(): ReplayState {
    return this.stateInternal;
  }

  get speed(): number {
    return this.speedInternal;
  }

  /** (fired, total) — how far the replay has advanced. */
  get progress(): { fired: number; total: number } {
    return { fired: this.cursor, total: this.schedule.length };
  }

  estimateDurationMs(): number {
    return estimateDurationMs(this.schedule, this.speedInternal);
  }

  /** Applies from the current playhead onward (mid-flight is fine). */
  setSpeed(speed: number): void {
    this.syncPlayhead();
    this.speedInternal = Math.max(speed, 0.01);
  }

  play(): void {
    if (this.stateInternal === "playing" || this.stateInternal === "done") return;
    this.stateInternal = "playing";
    this.anchorWall = performance.now();
    this.ticker = window.setInterval(() => this.tick(), TICK_MS);
    this.tick(); // fire event 0 immediately
  }

  pause(): void {
    if (this.stateInternal !== "playing") return;
    this.syncPlayhead();
    this.stateInternal = "paused";
    this.clearTicker();
  }

  /** Stop and rewind. A subsequent play() replays from the top. */
  stop(): void {
    this.clearTicker();
    this.cursor = 0;
    this.playheadMs = 0;
    this.stateInternal = "idle";
  }

  private clearTicker(): void {
    if (this.ticker !== undefined) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /** Fold elapsed wall time into the playhead and re-anchor. */
  private syncPlayhead(): void {
    if (this.stateInternal !== "playing") return;
    const now = performance.now();
    this.playheadMs += (now - this.anchorWall) * this.speedInternal;
    this.anchorWall = now;
  }

  private tick(): void {
    if (this.stateInternal !== "playing") return;
    this.syncPlayhead();
    let fired = false;
    while (this.cursor < this.schedule.length && this.startAtMs[this.cursor]! <= this.playheadMs) {
      const meta = this.schedule[this.cursor]!;
      this.cursor += 1;
      this.fire(meta);
      fired = true;
    }
    if (fired) this.cb.onProgress?.(this.cursor, this.schedule.length);
    if (this.cursor >= this.schedule.length && this.playheadMs >= this.totalMs) {
      // every event fired and the final settle delay has elapsed
      this.clearTicker();
      this.stateInternal = "done";
      this.cb.onDone?.();
    }
  }

  private fire(meta: ScheduledEvent): void {
    const ev = meta.event;
    if (ev.kind === "note") this.cb.onReasoning?.(noteText(ev), ev, meta);
    else if (ev.kind === "tool_call") this.cb.onToolCall?.(ev.name ?? "?", ev.args, ev, meta);
    else this.cb.onToolResult?.(ev.name ?? "?", ev.result, ev, meta);
  }
}
