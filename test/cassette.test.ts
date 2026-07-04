import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TraceRecorder, TraceReplayer } from "../src/trace/cassette.js";

describe("replay cassette", () => {
  it("records and replays tool calls in order, keyed on callIndex", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cassette-"));
    const path = join(dir, "episode.jsonl");

    const rec = new TraceRecorder("ep-1", path);
    await rec.record("get_certificate", {}, () => ({ grade: "C" }));
    await rec.record("inspect_region", { defectId: "d-hole-0" }, () => ({ views: 2 }));

    const rep = new TraceReplayer(path);
    expect(rep.replay("get_certificate", {})).toEqual({ grade: "C" });
    expect(rep.replay("inspect_region", { defectId: "d-hole-0" })).toEqual({ views: 2 });
  });

  it("throws on divergence (different tool than recorded)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cassette-"));
    const path = join(dir, "episode.jsonl");
    const rec = new TraceRecorder("ep-2", path);
    await rec.record("get_certificate", {}, () => ({ grade: "B" }));

    const rep = new TraceReplayer(path);
    expect(() => rep.replay("patch_hole", { defectId: "x" })).toThrow(/divergence/);
  });

  it("tolerates args drift but records the mismatch (record-decisions mode)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cassette-"));
    const path = join(dir, "episode.jsonl");
    const rec = new TraceRecorder("ep-3", path);
    await rec.record("query_measurement", { name: "doorway_width" }, () => ({ value: 0.9 }));

    const rep = new TraceReplayer(path);
    expect(rep.replay("query_measurement", { name: "doorway_height" })).toEqual({ value: 0.9 });
    expect(rep.mismatches).toHaveLength(1);
  });
});
