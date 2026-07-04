/**
 * Replay cassette: every agent episode is recorded as JSONL keyed on
 * (episodeId, callIndex). The same file is simultaneously:
 *   - the dead-wifi fallback (venue demo runs against the cassette),
 *   - the deterministic demo mode (byte-identical reruns),
 *   - the eval artifact (traces are diffable across prompt versions).
 *
 * Rules baked in from the plan:
 *   - binary payloads (rendered views) are content-addressed by sha256 and
 *     stored beside the trace — NEVER keyed on screenshot bytes (WebGL output
 *     differs across GPUs; byte-keyed caches fail silently at the venue),
 *   - clocks are frozen: ordering comes from callIndex, not wall time.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TraceEventSchema, type TraceEvent } from "../core/types.js";

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class TraceRecorder {
  private callIndex = 0;
  constructor(
    readonly episodeId: string,
    readonly path: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) writeFileSync(path, ""); // a recorder always starts a fresh episode
  }

  private write(event: TraceEvent): void {
    appendFileSync(this.path, JSON.stringify(TraceEventSchema.parse(event)) + "\n");
  }

  note(text: string): void {
    this.write({ episodeId: this.episodeId, callIndex: this.callIndex++, kind: "note", name: text });
  }

  /** Store a binary payload content-addressed; returns the address to embed in results. */
  storeBlob(data: Buffer, ext = "bin"): string {
    const addr = `${sha256(data)}.${ext}`;
    const blobDir = join(dirname(this.path), "blobs");
    mkdirSync(blobDir, { recursive: true });
    const p = join(blobDir, addr);
    if (!existsSync(p)) writeFileSync(p, data);
    return addr;
  }

  /** Record one tool call + result pair. Returns the result unchanged. */
  async record<T>(name: string, args: unknown, run: () => Promise<T> | T): Promise<T> {
    const idx = this.callIndex++;
    this.write({ episodeId: this.episodeId, callIndex: idx, kind: "tool_call", name, args });
    const result = await run();
    this.write({
      episodeId: this.episodeId,
      callIndex: this.callIndex++,
      kind: "tool_result",
      name,
      result,
    });
    return result;
  }
}

export class TraceReplayer {
  private events: TraceEvent[];
  private cursor = 0;
  /** args mismatches are surfaced, not fatal — supports the record-decisions / execute-tools-live split */
  readonly mismatches: string[] = [];

  constructor(readonly path: string) {
    this.events = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => TraceEventSchema.parse(JSON.parse(l)));
  }

  /** Return the recorded result for the next call of `name`. Throws if the cassette diverges. */
  replay<T>(name: string, args?: unknown): T {
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor++];
      if (ev.kind !== "tool_call") continue;
      if (ev.name !== name) {
        throw new Error(
          `Cassette divergence at callIndex ${ev.callIndex}: recorded '${ev.name}', requested '${name}'`,
        );
      }
      if (args !== undefined && stableStringify(args) !== stableStringify(ev.args)) {
        this.mismatches.push(`callIndex ${ev.callIndex} (${name}): args differ from recording`);
      }
      // the matching result is the next tool_result event
      for (let j = this.cursor; j < this.events.length; j++) {
        if (this.events[j].kind === "tool_result" && this.events[j].name === name) {
          this.cursor = j + 1;
          return this.events[j].result as T;
        }
      }
      throw new Error(`Cassette truncated: no result recorded for '${name}' at callIndex ${ev.callIndex}`);
    }
    throw new Error(`Cassette exhausted: no more recorded calls (requested '${name}')`);
  }
}
