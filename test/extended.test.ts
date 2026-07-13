import { describe, expect, it } from "vitest";
import { certifyWorld } from "../src/certify/certificate.js";
import { buildHabitat } from "../src/ingest/synthetic.js";

const FAST = { probeCount: 400, maxSettleSteps: 600 };

/** clean habitat + a small splat cluster floating mid-room, disconnected from all structure */
function withFloater(points: Float32Array): Float32Array {
  const cluster: number[] = [];
  for (let i = 0; i < 30; i++) {
    // deterministic 0.4 m blob centered 1.8 m above the room-A floor
    cluster.push(2 + 0.2 * Math.sin(i * 1.7), 1.8 + 0.2 * Math.cos(i * 2.3), 2 + 0.2 * Math.sin(i * 0.9));
  }
  const out = new Float32Array(points.length + cluster.length);
  out.set(points);
  out.set(cluster, points.length);
  return out;
}

describe("extended check profile", () => {
  it("default profile omits extendedChecks entirely — the byte-identity law", async () => {
    const world = buildHabitat({ worldId: "x-default" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { createdAt: "frozen", survey: FAST },
    );
    expect(certificate.extendedChecks).toBeUndefined();
    expect(JSON.stringify(certificate)).not.toContain("extendedChecks");
  });

  it("clean world: level floor, stable settling, zero floaters, high reachability, grade unchanged", async () => {
    const world = buildHabitat({ worldId: "x-clean" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { createdAt: "frozen", survey: FAST, extended: true },
    );
    const ext = certificate.extendedChecks!;
    expect(ext.profile).toBe("extended-v1");
    expect(ext.levelAudit.tilt.value).toBeLessThan(1.0);
    expect(ext.settling.ejected).toBe(0);
    expect(ext.settling.stable).toBe(ext.settling.boxes);
    expect(ext.floaters.count).toBe(0);
    expect(ext.reachability.fractionPct.value).toBeGreaterThan(80);
    // informational: the extended profile never moves the grade
    expect(certificate.grade).toBe("A");
  });

  it("floater census catches an injected disconnected splat cluster", async () => {
    const world = buildHabitat({ worldId: "x-floater" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: withFloater(world.visualPoints) },
      { createdAt: "frozen", survey: FAST, extended: true },
    );
    const ext = certificate.extendedChecks!;
    expect(ext.floaters.count).toBeGreaterThanOrEqual(1);
    expect(ext.floaters.pointSharePct).toBeGreaterThan(0);
    expect(ext.floaters.examples.length).toBeGreaterThanOrEqual(1);
    // the injected blob sits near (2, 1.8, 2)
    const hit = ext.floaters.examples.some(
      (r) => r.min[0] < 2 && r.max[0] > 2 && r.min[1] > 1.0 && r.max[1] < 2.6 && r.min[2] < 2 && r.max[2] > 2,
    );
    expect(hit).toBe(true);
  });

  it("scale consensus produces independent witnesses that corroborate a true-scale world", async () => {
    const world = buildHabitat({ worldId: "x-scale" });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { createdAt: "frozen", survey: FAST, extended: true },
    );
    const ext = certificate.extendedChecks!;
    // the bench habitat is ceilingless, so the ceiling witness cannot exist here;
    // door height + door width are the two independent witnesses
    expect(ext.scaleConsensus.witnesses.length).toBeGreaterThanOrEqual(2);
    const names = ext.scaleConsensus.witnesses.map((w) => w.name);
    expect(names).toContain("scale_witness_door_width");
    // each witness's 2 SD interval should contain metric scale 1.0 on a
    // true-scale bench world (inclusive: the width witness inherits
    // metrology's conservative header-footprint measurement and can land
    // exactly on the boundary)
    for (const w of ext.scaleConsensus.witnesses) {
      expect(w.uncertainty.low).toBeLessThanOrEqual(1.0);
      expect(w.uncertainty.high).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("a hole swallowing the doorway disconnects room B and lowers reachability", async () => {
    const mk = async (worldId: string, holeRect?: { x0: number; x1: number; z0: number; z1: number }) => {
      const world = buildHabitat({ worldId, ...(holeRect ? { colliderHole: true, holeRect } : {}) });
      const { certificate } = await certifyWorld(
        { worldId, collider: world.collider, visualPoints: world.visualPoints },
        { createdAt: "frozen", survey: FAST, extended: true },
      );
      return certificate.extendedChecks!.reachability.fractionPct.value;
    };
    const clean = await mk("x-reach-clean");
    // the interior doorway sits at the room divider (x ≈ 5.1, z 3.5–4.4);
    // a hole spanning it severs the only path between the rooms AND the
    // hole cells themselves claim floor visually — both effects subtract
    const cut = await mk("x-reach-cut", { x0: 4.5, x1: 5.7, z0: 3.2, z1: 4.7 });
    expect(cut).toBeLessThan(clean - 10);
  });

  it("is deterministic: same seed, byte-identical extended certificate", async () => {
    const world = buildHabitat({ worldId: "x-det", colliderHole: true });
    const run = async () => {
      const { certificate } = await certifyWorld(
        { worldId: world.worldId, collider: world.collider, visualPoints: withFloater(world.visualPoints) },
        { seed: 42, createdAt: "frozen", survey: FAST, extended: true },
      );
      return JSON.stringify(certificate);
    };
    expect(await run()).toBe(await run());
  });

  it("grade is identical under both profiles on a defect world", async () => {
    const world = buildHabitat({ worldId: "x-grade", colliderHole: true, raisedSillM: 0.15 });
    const base = { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints };
    const { certificate: plain } = await certifyWorld(base, { createdAt: "frozen", survey: FAST });
    const { certificate: extended } = await certifyWorld(base, { createdAt: "frozen", survey: FAST, extended: true });
    expect(extended.grade).toBe(plain.grade);
    expect(extended.gradeRationale).toBe(plain.gradeRationale);
  });
});
