/**
 * C16 — the paired receipt's core promise, proven on the bench:
 * the SAME route with the SAME controller reaches the goal on an intact
 * collider and falls through the planted hole on the raw one. Deterministic.
 */
import { describe, expect, it } from "vitest";
import { buildHabitat } from "../src/ingest/synthetic.js";
import { runRoute, type PairedGoal } from "../src/validation/pairedGoals.js";

// straight line along x=2.6 crossing the default planted hole (x 2.0–3.2,
// z 5.0–6.2) on the habitat's 10x8 floor
const CROSSING: PairedGoal = {
  id: 0,
  start: { x: 2.6, y: 0, z: 3.8 },
  goal: { x: 2.6, y: 0, z: 7.2 },
  distanceM: 3.4,
};

describe("paired goals (C16)", () => {
  it("same route, same controller: falls on the raw hole, arrives on the intact floor", async () => {
    const raw = buildHabitat({ worldId: "c16-raw", colliderHole: true });
    const intact = buildHabitat({ worldId: "c16-clean", colliderHole: false });

    const rawRun = await runRoute(raw.collider, CROSSING);
    const cleanRun = await runRoute(intact.collider, CROSSING);

    expect(rawRun.outcome).toBe("fell");
    expect(cleanRun.outcome).toBe("reached");
  }, 120_000);

  it("route outcomes are deterministic", async () => {
    const raw = buildHabitat({ worldId: "c16-raw", colliderHole: true });
    const a = await runRoute(raw.collider, CROSSING);
    const b = await runRoute(raw.collider, CROSSING);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 120_000);
});
