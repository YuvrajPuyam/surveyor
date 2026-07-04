import { describe, expect, it } from "vitest";
import { certifyWorld } from "../src/certify/certificate.js";
import { GRAVITY } from "../src/core/types.js";
import { buildHabitat } from "../src/ingest/synthetic.js";

const FAST = { probeCount: 400, maxSettleSteps: 600 };

describe("certify core", () => {
  it("detects a collider hole with probe + raycast agreement, never from tunneling alone", async () => {
    const world = buildHabitat({ worldId: "t-hole", colliderHole: true });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { survey: FAST },
    );
    const holes = certificate.defects.filter((d) => d.type === "collider_hole");
    expect(holes.length).toBe(1);
    expect(holes[0].evidence.some((e) => e.kind === "raycast_miss")).toBe(true);
  });

  it("grades a clean world A with no defects", async () => {
    const world = buildHabitat({ worldId: "t-clean" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { survey: FAST },
    );
    expect(certificate.defects).toHaveLength(0);
    expect(certificate.grade).toBe("A");
  });

  it("sill fails the rover and passes the quadruped — verdicts are robot-relative", async () => {
    const world = buildHabitat({ worldId: "t-sill", raisedSillM: 0.15 });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { survey: FAST },
    );
    const step = (robot: string) =>
      certificate.robotVerdicts.find((v) => v.robotId === robot && v.check === "step_negotiation")!;
    expect(step("rover").pass).toBe(false);
    expect(step("quadruped").pass).toBe(true);
  });

  it("slope verdict is gravity-invariant; stopping distance is not", async () => {
    const world = buildHabitat({ worldId: "t-grav" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { gravity: GRAVITY.mars, survey: FAST },
    );
    const slope = certificate.robotVerdicts.find((v) => v.robotId === "rover" && v.check === "slope_capability")!;
    expect(slope.gravitySensitivity).toBe("unchanged_by_gravity");
    const brake = certificate.robotVerdicts.find(
      (v) => v.robotId === "rover" && v.check === "braking_stopping_distance",
    )!;
    expect(brake.gravitySensitivity).toBe("changes_with_gravity");
    // v²/(2µg) on Mars vs Earth = 9.81/3.71 ≈ 2.64x
    expect(brake.measured!.value).toBeCloseTo((1.5 * 1.5) / (2 * 0.8 * 3.71), 3);
  });

  it("is deterministic: same seed, byte-identical certificate", async () => {
    const world = buildHabitat({ worldId: "t-det", colliderHole: true });
    const run = async () => {
      const { certificate } = await certifyWorld(
        { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
        { seed: 42, createdAt: "frozen", survey: FAST },
      );
      return JSON.stringify(certificate);
    };
    expect(await run()).toBe(await run());
  });
});
