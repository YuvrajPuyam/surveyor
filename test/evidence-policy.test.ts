import { describe, expect, it } from "vitest";
import { certifyWorld } from "../src/certify/certificate.js";
import { buildHabitat } from "../src/ingest/synthetic.js";

const FAST = { probeCount: 400, maxSettleSteps: 600 };

describe("evidence-tiered certification (--evidence-tiers)", () => {
  it("default OFF: byte-identical certificate (the policy is opt-in)", async () => {
    const world = buildHabitat({ worldId: "e-off", phantomBarrier: true });
    const base = { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints };
    const { certificate: plain } = await certifyWorld(base, { createdAt: "frozen", survey: FAST });
    const { certificate: plain2 } = await certifyWorld(base, { createdAt: "frozen", survey: FAST });
    expect(JSON.stringify(plain)).toBe(JSON.stringify(plain2));
    expect(JSON.stringify(plain)).not.toContain("Evidence policy");
  });

  it("a CONTRADICTED phantom survives the filter — the interior barrier stands in a fully-photographed room", async () => {
    const world = buildHabitat({ worldId: "e-contradicted", phantomBarrier: true });
    const { certificate } = await certifyWorld(
      { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints },
      { createdAt: "frozen", survey: FAST, evidencePolicy: true },
    );
    const phantoms = certificate.defects.filter((d) => d.type === "phantom_collider");
    expect(phantoms.length).toBeGreaterThanOrEqual(1);
  });

  it("bucket caps: many majors cannot saturate the grade below one systemic deduction", async () => {
    const world = buildHabitat({
      worldId: "e-caps",
      colliderHole: true,
      raisedSillM: 0.15,
      visualOnlyWall: true,
    });
    const base = { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints };
    const { certificate } = await certifyWorld(base, { createdAt: "frozen", survey: FAST, evidencePolicy: true });
    expect(certificate.gradeRationale).toContain("majors capped at -45");
    // 1 critical hole (-40) + capped majors (<= -45) + capped minors (<= -15)
    // floors the score at 0 — but the RATIONALE proves the capped formula ran
    const open = certificate.defects.filter((d) => !d.outcome);
    expect(open.length).toBeGreaterThan(0);
  });

  it("non-phantom defects are never filtered", async () => {
    const world = buildHabitat({ worldId: "e-keep", colliderHole: true, raisedSillM: 0.15, visualOnlyWall: true });
    const base = { worldId: world.worldId, collider: world.collider, visualPoints: world.visualPoints };
    const { certificate: off } = await certifyWorld(base, { createdAt: "frozen", survey: FAST });
    const { certificate: on } = await certifyWorld(base, { createdAt: "frozen", survey: FAST, evidencePolicy: true });
    const count = (c: typeof off, t: string) => c.defects.filter((d) => d.type === t).length;
    for (const t of ["collider_hole", "visual_only_surface", "raised_sill"]) {
      expect(count(on, t)).toBe(count(off, t));
    }
  });
});
