/**
 * Defect synthesis: fuse probe, raycast, and divergence evidence into typed,
 * evidence-backed defects. Confidence reflects how many independent
 * instruments agree — a probe fall-through alone never reaches certainty
 * without the raycast cross-check.
 */
import type { Aabb } from "../core/geom.js";
import { aabbAreaXZ, aabbOverlapXZ, iouXZ } from "../core/geom.js";
import type { Defect, Evidence } from "../core/types.js";
import type { MetrologyResult } from "./metrology.js";
import type { SurveyResult } from "./survey.js";

function toRegion(a: Aabb, yMin: number, yMax: number) {
  return {
    min: [a.min.x, Number.isFinite(a.min.y) ? a.min.y : yMin, a.min.z] as [number, number, number],
    max: [a.max.x, Number.isFinite(a.max.y) ? a.max.y : yMax, a.max.z] as [number, number, number],
  };
}

function regionToAabb(r: { min: [number, number, number]; max: [number, number, number] }): Aabb {
  return { min: { x: r.min[0], y: r.min[1], z: r.min[2] }, max: { x: r.max[0], y: r.max[1], z: r.max[2] } };
}

export function synthesizeDefects(survey: SurveyResult, metrology: MetrologyResult): Defect[] {
  const defects: Defect[] = [];
  let seq = 0;
  const nextId = (t: string) => `d-${t}-${seq++}`;
  const floorY = metrology.floorPlane.y;

  const grid = survey.trustGrid;
  const fall = grid.channel("fallConfirmed");
  const vnp = grid.channel("visualNoPhys");
  const pnv = grid.channel("physNoVisual");

  // same density-relative lie gate as the trust map: divergence claims are
  // measured against this world's verified-surface splat density
  const contact = grid.channel("probeContact");
  const visual = grid.channel("visualPts");
  const restedVisual: number[] = [];
  for (let i = 0; i < grid.size; i++) if (contact[i] > 0 && visual[i] > 0) restedVisual.push(visual[i]);
  restedVisual.sort((a, b) => a - b);
  const medianSurfaceDensity = restedVisual.length > 0 ? restedVisual[Math.floor(restedVisual.length / 2)] : 0;
  const lieThreshold = Math.max(3, 0.2 * medianSurfaceDensity);

  const countInRegion = (channel: Float64Array, region: Aabb): number => {
    let total = 0;
    for (let i = 0; i < grid.size; i++) {
      if (channel[i] <= 0) continue;
      const [x, z] = grid.center(i);
      if (x >= region.min.x && x <= region.max.x && z >= region.min.z && z <= region.max.z) total += channel[i];
    }
    return total;
  };

  // ------------------------------------------------------- collider holes
  for (const voidRegion of metrology.interiorVoids) {
    const probeFalls = countInRegion(fall, voidRegion);
    const visualCover = countInRegion(grid.channel("visualPts"), voidRegion);
    const evidence: Evidence[] = [
      {
        kind: "raycast_miss",
        detail: "downward virtual-LiDAR rays pass through this region unobstructed",
      },
    ];
    if (probeFalls > 0) {
      evidence.push({
        kind: "probe_fallthrough",
        detail: `${probeFalls} probes fell through; each confirmed by an independent raycast at its drop point (tunneling excluded)`,
        count: probeFalls,
      });
    }
    if (visualCover > 0) {
      evidence.push({
        kind: "divergence_visual_no_physics",
        detail: `${visualCover} visual samples cover this region — the floor LOOKS intact`,
        count: visualCover,
      });
    }
    defects.push({
      id: nextId("hole"),
      type: "collider_hole",
      region: toRegion(voidRegion, floorY - 0.3, floorY + 0.3),
      severity: "critical",
      confidence: probeFalls > 0 ? 0.95 : 0.7,
      evidence,
      description:
        probeFalls > 0
          ? "Physics hole under visually intact floor: probes fall through and rays pass unobstructed."
          : "Raycast void inside the floor footprint; no probe landed here — probe-directed follow-up recommended.",
    });
  }

  // -------------------------------------------------- phantom colliders
  // Minimum evidence mass per cluster: a lone hot cell is sampling noise,
  // not a barrier. Real phantom geometry yields dozens of unsupported samples.
  const MIN_CLUSTER_SAMPLES = 8;
  const pnvRegions = grid.regions((i) => pnv[i] >= 3);
  for (const r of pnvRegions) {
    const samples = countInRegion(pnv, r);
    if (samples < MIN_CLUSTER_SAMPLES) continue;
    defects.push({
      id: nextId("phantom"),
      type: "phantom_collider",
      region: toRegion(r, floorY, floorY + 2.5),
      severity: "major",
      confidence: Math.min(0.95, 0.5 + samples / 40),
      evidence: [
        {
          kind: "divergence_physics_no_visual",
          detail: `${samples} collider-surface samples have no visual support within 0.2 m — an invisible barrier`,
          count: samples,
        },
      ],
      description: "Collider surface with no visual counterpart: robots collide with something the camera cannot see.",
    });
  }

  // ------------------------------------------------ visual-only surfaces
  // Skip clusters that sit over a detected collider hole — same root defect.
  const holeRegions = defects.filter((d) => d.type === "collider_hole").map((d) => regionToAabb(d.region));
  const vnpRegions = grid.regions((i) => vnp[i] >= lieThreshold);
  for (const r of vnpRegions) {
    // same root defect if the cluster overlaps a hole — by IoU for comparable
    // sizes, or by containment when the cluster is a sliver of the hole's rim
    const overHole = holeRegions.some((h) => {
      const cover = aabbAreaXZ(r) > 0 ? aabbOverlapXZ(h, r) / aabbAreaXZ(r) : 0;
      return iouXZ(h, r) > 0.05 || cover > 0.4;
    });
    if (overHole) continue;
    const samples = countInRegion(vnp, r);
    if (samples < MIN_CLUSTER_SAMPLES) continue;
    defects.push({
      id: nextId("visual"),
      type: "visual_only_surface",
      region: toRegion(r, floorY, floorY + 2.5),
      severity: "major",
      confidence: Math.min(0.95, 0.5 + samples / 40),
      evidence: [
        {
          kind: "divergence_visual_no_physics",
          detail: `${samples} visual samples are >0.15 m from any collider surface — painted-on geometry`,
          count: samples,
        },
      ],
      description:
        "Visual surface with no physics behind it: looks solid, is not. Training episodes touching it learn a lie.",
    });
  }

  // ------------------------------------------------------- raised sills
  for (const s of metrology.steps) {
    defects.push({
      id: nextId("sill"),
      type: "raised_sill",
      region: toRegion(s.region, floorY, floorY + s.heightM.value + 0.05),
      severity: s.heightM.value >= 0.1 ? "major" : "minor",
      confidence: 0.85,
      evidence: [
        {
          kind: "floor_step_measurement",
          detail: `surface discontinuity of ${s.heightM.value.toFixed(3)} m between adjacent traversable cells`,
          measurement: s.heightM,
        },
      ],
      description: `Raised step/sill of ${s.heightM.value.toFixed(2)} m — negotiability is robot-relative (see per-robot verdicts).`,
    });
  }

  // -------------------------------------------------------- scale error
  // Two independent triggers: (a) the door-height prior disagrees with unit
  // scale; (b) the vendor's own metadata declares a non-metric export — even
  // when no doorway is measurable, the world says of itself that its meters
  // are not meters until the factor is applied.
  const vendorScale = metrology.measurements.find((m) => m.name === "vendor_metric_scale_factor");
  const est = metrology.scaleEstimate;
  const wholeWorld = {
    min: [survey.aabb.min.x, survey.aabb.min.y, survey.aabb.min.z] as [number, number, number],
    max: [survey.aabb.max.x, survey.aabb.max.y, survey.aabb.max.z] as [number, number, number],
  };
  if (est && Math.abs(est.value - 1) > 0.3) {
    defects.push({
      id: nextId("scale"),
      type: "scale_error",
      region: wholeWorld,
      severity: "critical",
      confidence: 0.8,
      evidence: [
        {
          kind: "scale_prior_comparison",
          detail: `door-height prior implies metric scale factor ${est.value.toFixed(2)}x`,
          measurement: est,
        },
      ],
      description:
        "World-level metric scale disagrees with door-height priors. All metric verdicts are invalid until scale is corrected (apply_vendor_scale, then cross-check).",
    });
  } else if (vendorScale && Math.abs(vendorScale.value - 1) > 0.15) {
    defects.push({
      id: nextId("scale"),
      type: "scale_error",
      region: wholeWorld,
      severity: "critical",
      confidence: 0.6,
      evidence: [
        {
          kind: "vendor_metadata",
          detail:
            `vendor ships metric_scale_factor ${vendorScale.value.toFixed(3)} — the world declares itself non-metric as exported; ` +
            (est ? `door-height estimate ${est.value.toFixed(2)} available for cross-check` : "no measurable doorway for independent verification"),
          measurement: vendorScale,
        },
      ],
      description:
        "Vendor metadata declares a non-metric export. Metric verdicts are suspended until apply_vendor_scale bakes the factor and re-certification confirms.",
    });
  }

  return defects;
}
