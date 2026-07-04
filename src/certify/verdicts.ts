/**
 * Per-robot verdicts. Sim-readiness is relative to the robot: the same 0.15 m
 * sill fails a small rover and passes a quadruped envelope.
 *
 * Gravity honesty (never regress on this):
 *  - Coulomb slope limit is atan(µ): traction µ·m·g·cosθ vs pull m·g·sinθ —
 *    gravity CANCELS. The certificate prints "unchanged under X gravity".
 *  - Stopping distance v²/(2µg) DOES change: ~2.6x longer on Mars.
 *  - Soil mechanics are outside the disclosed model class, stated explicitly.
 */
import type { Defect, Gravity, Measurement, RobotSpec, Verdict } from "../core/types.js";
import { GRAVITY } from "../core/types.js";
import type { MetrologyResult } from "./metrology.js";

export function computeVerdicts(
  robots: RobotSpec[],
  metrology: MetrologyResult,
  defects: Defect[],
  gravity: Gravity,
): Verdict[] {
  const verdicts: Verdict[] = [];
  const holes = defects.filter((d) => d.type === "collider_hole");
  const sills = defects.filter((d) => d.type === "raised_sill");
  const gName = gravity.name;

  for (const robot of robots) {
    // ------------------------------------------------- floor integrity
    verdicts.push({
      robotId: robot.id,
      check: "floor_integrity",
      pass: holes.length === 0,
      requirement: "no unresolved collider holes in the navigable area",
      gravitySensitivity: "unchanged_by_gravity",
      gravityNote: `unchanged under ${gName} gravity: a missing collider is missing at any g`,
      defectIds: holes.map((d) => d.id),
    });

    // ------------------------------------------------- passage clearance
    if (metrology.doorways.length > 0) {
      const narrowest = metrology.doorways.reduce((a, b) => (a.widthM.value < b.widthM.value ? a : b));
      const required = 2 * robot.footprintRadiusM + 0.1;
      verdicts.push({
        robotId: robot.id,
        check: "passage_clearance_width",
        pass: narrowest.widthM.uncertainty.low >= required,
        measured: narrowest.widthM,
        requirement: `narrowest passage ≥ ${required.toFixed(2)} m (2x footprint radius + 0.10 m margin)`,
        gravitySensitivity: "unchanged_by_gravity",
        gravityNote: `unchanged under ${gName} gravity: geometry does not scale with g`,
        defectIds: [],
      });
    }

    // ------------------------------------------------- step negotiation
    const maxStep: Measurement | undefined =
      metrology.steps.length > 0
        ? metrology.steps.reduce((a, b) => (a.heightM.value > b.heightM.value ? a : b)).heightM
        : undefined;
    verdicts.push({
      robotId: robot.id,
      check: "step_negotiation",
      pass: maxStep ? maxStep.uncertainty.high <= robot.maxStepM : true,
      measured: maxStep,
      requirement: `max step/sill ≤ ${robot.maxStepM.toFixed(2)} m (${robot.kind === "kinematic_envelope" ? "published capability envelope" : "wheel-climb limit for the vehicle model class"})`,
      gravitySensitivity: "unchanged_by_gravity",
      gravityNote: `unchanged under ${gName} gravity: step negotiability in this model class is kinematic`,
      defectIds: sills.map((d) => d.id),
    });

    // ------------------------------------------------- slope capability
    const tilt = metrology.floorPlane.tiltDeg;
    const coulombLimitDeg = (Math.atan(robot.frictionMu) * 180) / Math.PI;
    verdicts.push({
      robotId: robot.id,
      check: "slope_capability",
      pass: tilt <= robot.maxSlopeDeg,
      measured: {
        name: "max_traversal_slope",
        value: tilt,
        unit: "deg",
        uncertainty: { low: Math.max(0, tilt - 0.5), high: tilt + 0.5, basis: "RANSAC plane-fit angular resolution" },
        method: "floor-plane tilt from RANSAC fit; per-region slope mapping is a survey extension",
      },
      requirement: `traversal slopes ≤ ${robot.maxSlopeDeg} deg (robot spec); Coulomb traction limit atan(µ=${robot.frictionMu}) = ${coulombLimitDeg.toFixed(1)} deg`,
      gravitySensitivity: "unchanged_by_gravity",
      gravityNote:
        `UNCHANGED under ${gName} gravity: slope limit is atan(µ) — traction µ·m·g·cosθ and gravity pull m·g·sinθ both scale with g, which cancels. ` +
        `Loose-soil slip is excluded by the disclosed model class (rigid contact, Coulomb friction).`,
      defectIds: [],
    });

    // ------------------------------------------------- stopping distance
    const v = robot.referenceSpeedMps;
    const d = (v * v) / (2 * robot.frictionMu * gravity.g);
    const dEarth = (v * v) / (2 * robot.frictionMu * GRAVITY.earth.g);
    const ratio = gravity.g === GRAVITY.earth.g ? 1 : GRAVITY.earth.g / gravity.g;
    verdicts.push({
      robotId: robot.id,
      check: "braking_stopping_distance",
      pass: true, // informational: no threshold, but it moves with gravity and the certificate says so
      measured: {
        name: "stopping_distance",
        value: d,
        unit: "m",
        uncertainty: {
          low: d * 0.9,
          high: d * 1.15,
          basis: "±10-15% for µ variation across surfaces in the model class",
        },
        method: `v²/(2µg) at reference speed ${v} m/s, µ=${robot.frictionMu}, g=${gravity.g} m/s²`,
      },
      requirement: "informational — plan braking margins accordingly",
      gravitySensitivity: "changes_with_gravity",
      gravityNote:
        gravity.g === GRAVITY.earth.g
          ? "changes with gravity: deceleration is µ·g — on Mars this distance grows ~2.6x, on the Moon ~6.1x"
          : `CHANGES with gravity: ${ratio.toFixed(2)}x the Earth value of ${dEarth.toFixed(2)} m — deceleration is µ·g`,
      defectIds: [],
    });
  }

  return verdicts;
}
