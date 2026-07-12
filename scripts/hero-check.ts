/**
 * HERO CHECK (ENDGAME §2): "the certificates pick the hero" — mechanically.
 *
 * For a certified bundle, verifies every property the hero world must carry:
 *   1. vendor metric scale factor shipped;
 *   2. ghost geometry (visual_only_surface) present;
 *   3. a real collider hole (probe-confirmed preferred);
 *   4. a sill whose POST-SCALE height lands in the rover-fail /
 *      quadruped-pass band (0.08, 0.25] — the Beat-3 contrast;
 *   5. a twin-run failure route VALIDATED BY PHYSICS DRY-RUN (the same
 *      candidate derivation + steering model as app/src/twinRun.ts +
 *      physicsWorker.ts — keep the constants in lockstep with those files).
 *
 * Usage: npx tsx scripts/hero-check.ts <bundle-dir>   (needs certificate.json —
 *        run `node bin/surveyor.mjs certify <dir> --write-bundle` first)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { initRapier, PhysicsWorld, FIXED_DT } from "../src/physics/rapierWorld.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { CertificateSchema, ROBOT_PRESETS, type Certificate, type Defect } from "../src/core/types.js";

// ---- constants mirrored from app/src/twinRun.ts + protocol.ts (lockstep!)
const ROVER_HALF = { x: 0.17, y: 0.14, z: 0.25 };
const APPROACH_DIRECTIONS = 16;
const SAMPLE_STEP_M = 0.35;
const EDGE_MARGIN_M = 0.55;
const RUNWAY_MAX_M = 3.5;
const RUNWAY_MIN_SAMPLES = 2;
const FLOOR_TOLERANCE_M = 0.35;
const RAW_SPEED_MPS = 2.0;
const RAW_TURN_RPS = 2.5;
const RAW_ARRIVE_M = 0.15;
const PROBE_MAX_STEPS = 900;
const FELL_BELOW_FLOOR_M = 0.9;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/hero-check.ts <bundle-dir>");
  process.exit(2);
}

import { existsSync } from "node:fs";
if (!existsSync(join(dir, "certificate.json"))) {
  console.error(`no certificate.json in ${dir} — run: node bin/surveyor.mjs certify ${dir} --write-bundle`);
  process.exit(2);
}
const world = await loadWorldBundle(dir);
const cert: Certificate = CertificateSchema.parse(JSON.parse(readFileSync(join(dir, "certificate.json"), "utf8")));
await initRapier();
const pw = new PhysicsWorld(9.81);
pw.addStaticTriMesh(world.collider);
pw.step();

const floorAt = (x: number, z: number, refY: number): number | undefined =>
  pw.castDown(x, refY + 2.5, z, 6)?.y;

interface Route {
  kind: "fall" | "ghost";
  defect: Defect;
  start: [number, number, number];
  aim: [number, number];
  floorY: number;
  regionMin: [number, number];
  regionMax: [number, number];
}

function edgeDistance(hx: number, hz: number, dx: number, dz: number): number {
  const tx = Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : Infinity;
  const tz = Math.abs(dz) > 1e-9 ? hz / Math.abs(dz) : Infinity;
  return Math.min(tx, tz);
}

function deriveRoutes(defect: Defect, kind: "fall" | "ghost"): Route[] {
  const r = defect.region;
  const cx = (r.min[0] + r.max[0]) / 2;
  const cz = (r.min[2] + r.max[2]) / 2;
  const cy = (r.min[1] + r.max[1]) / 2;
  const halfX = Math.max(0.05, (r.max[0] - r.min[0]) / 2);
  const halfZ = Math.max(0.05, (r.max[2] - r.min[2]) / 2);

  const ringHits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    const rr = edgeDistance(halfX, halfZ, dx, dz) + 0.35;
    const y = floorAt(cx + dx * rr, cz + dz * rr, cy);
    if (y !== undefined && Math.abs(y - cy) < 1.5) ringHits.push(y);
  }
  ringHits.sort((a, b) => a - b);
  const floorY = ringHits.length > 0 ? ringHits[Math.floor(ringHits.length / 2)] : cy;

  const boxFits = (x: number, z: number): boolean => {
    const yc = floorAt(x, z, floorY);
    if (yc === undefined) return false;
    const ox = ROVER_HALF.x * 0.9, oz = ROVER_HALF.z * 0.9;
    for (const [px, pz] of [[0, 0], [ox, oz], [ox, -oz], [-ox, oz], [-ox, -oz]] as const) {
      const y = floorAt(x + px, z + pz, floorY);
      if (y === undefined || Math.abs(y - yc) > 0.045) return false;
      if (pw.castUp(x + px, yc + 0.05, z + pz, ROVER_HALF.y * 4)) return false;
    }
    return true;
  };

  const routes: Route[] = [];
  for (let i = 0; i < APPROACH_DIRECTIONS; i++) {
    const a = (i / APPROACH_DIRECTIONS) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    const r0 = edgeDistance(halfX, halfZ, dx, dz) + EDGE_MARGIN_M;
    let consec = 0;
    let prevY: number | undefined;
    for (let k = 0; k < Math.floor(RUNWAY_MAX_M / SAMPLE_STEP_M); k++) {
      const rr = r0 + k * SAMPLE_STEP_M;
      const y = floorAt(cx + dx * rr, cz + dz * rr, floorY);
      if (y === undefined || Math.abs(y - floorY) > FLOOR_TOLERANCE_M) break;
      if (prevY !== undefined && Math.abs(y - prevY) > 0.045) break;
      prevY = y;
      consec++;
    }
    if (consec < RUNWAY_MIN_SAMPLES) continue;
    let pushed = 0;
    for (let k = RUNWAY_MIN_SAMPLES - 1; k < consec && pushed < 3; k++) {
      const startR = r0 + k * SAMPLE_STEP_M;
      const sx = cx + dx * startR;
      const sz = cz + dz * startR;
      if (!boxFits(sx, sz)) continue;
      const sy = floorAt(sx, sz, floorY) ?? floorY;
      const farEdge = edgeDistance(halfX, halfZ, -dx, -dz);
      routes.push({
        kind,
        defect,
        start: [sx, sy, sz],
        aim: [cx - dx * (farEdge + 0.8), cz - dz * (farEdge + 0.8)],
        floorY,
        regionMin: [r.min[0], r.min[2]],
        regionMax: [r.max[0], r.max[2]],
      });
      pushed++;
    }
  }
  return routes;
}

/** The worker's dry-run, verbatim math (stepRoverCore + buildRoverRun). */
function dryRun(route: Route): { outcome: "fell" | "stuck" | "arrived" | "timeout"; step: number; d: number } {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = FIXED_DT;
  const ground = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  w.createCollider(RAPIER.ColliderDesc.trimesh(world.collider.positions, world.collider.indices), ground);
  const [sx, sy, sz] = route.start;
  const body = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(sx, sy + ROVER_HALF.y + 0.05, sz)
      .setCcdEnabled(true)
      .enabledRotations(true, false, true)
      .setAngularDamping(1.5),
  );
  w.createCollider(
    RAPIER.ColliderDesc.cuboid(ROVER_HALF.x, ROVER_HALF.y, ROVER_HALF.z).setFriction(0.9).setRestitution(0),
    body,
  );
  let heading = Math.atan2(route.aim[0] - sx, route.aim[1] - sz);
  const fellY = route.floorY - FELL_BELOW_FLOOR_M;
  let outcome: "fell" | "stuck" | "arrived" | "timeout" = "timeout";
  let step = 0;
  for (; step < PROBE_MAX_STEPS; ) {
    const t = body.translation();
    const lv = body.linvel();
    if (lv.y > -0.75) {
      const dx = route.aim[0] - t.x;
      const dz = route.aim[1] - t.z;
      if (Math.hypot(dx, dz) < RAW_ARRIVE_M) {
        outcome = "arrived";
        break;
      }
      const desired = Math.atan2(dx, dz);
      let delta = desired - heading;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const maxTurn = RAW_TURN_RPS * FIXED_DT;
      heading += Math.min(maxTurn, Math.max(-maxTurn, delta));
      const v = RAW_SPEED_MPS * Math.max(0.25, Math.cos(delta));
      body.setLinvel({ x: Math.sin(heading) * v, y: lv.y, z: Math.cos(heading) * v }, true);
    }
    w.step();
    step++;
    if (body.translation().y < fellY) {
      outcome = "fell";
      break;
    }
  }
  const p = body.translation();
  const insideDefect =
    p.x >= route.regionMin[0] - 0.1 && p.x <= route.regionMax[0] + 0.1 &&
    p.z >= route.regionMin[1] - 0.1 && p.z <= route.regionMax[1] + 0.1;
  if (outcome === "timeout" && route.kind === "fall" && insideDefect && p.y < route.floorY - 0.2) outcome = "stuck";
  const d = Math.hypot(p.x - sx, p.z - sz);
  w.free();
  return { outcome, step, d };
}

// --------------------------------------------------------------- the checks
console.log(`\nHERO CHECK — ${cert.worldId} (grade ${cert.grade}, ${cert.defects.length} defects)\n`);
const results: Array<{ label: string; pass: boolean; detail: string }> = [];

const vendor = cert.scale.vendorFactor;
results.push({
  label: "vendor scale factor",
  pass: vendor !== undefined && Math.abs(vendor - 1) > 0.01,
  detail: vendor !== undefined ? `×${vendor}` : "absent",
});

const ghosts = cert.defects.filter((d) => d.type === "visual_only_surface");
results.push({ label: "ghost geometry", pass: ghosts.length > 0, detail: `${ghosts.length} visual_only_surface` });

const holes = cert.defects.filter((d) => d.type === "collider_hole");
const probedHoles = holes.filter((d) => d.evidence.some((e) => e.kind === "probe_fallthrough"));
results.push({
  label: "collider hole",
  pass: holes.length > 0,
  detail: `${holes.length} total, ${probedHoles.length} probe-confirmed`,
});

// sill contrast band post-scale: rover maxStep 0.08 < h <= quadruped 0.25
const factor = vendor ?? 1;
const roverMax = ROBOT_PRESETS.rover.maxStepM;
const quadMax = ROBOT_PRESETS.quadruped.maxStepM;
const sills = cert.defects.filter((d) => d.type === "raised_sill");
const sillHeights = sills
  .map((d) => d.evidence.find((e) => e.measurement)?.measurement?.value)
  .filter((v): v is number => typeof v === "number");
const scaled = sillHeights.map((h) => h * factor);
const inBand = scaled.filter((h) => h > roverMax && h <= quadMax);
const worstScaled = scaled.length > 0 ? Math.max(...scaled) : undefined;
const worstInBand = worstScaled !== undefined && worstScaled > roverMax && worstScaled <= quadMax;
results.push({
  label: "sill contrast band",
  pass: inBand.length > 0,
  detail:
    scaled.length === 0
      ? "no sills"
      : `${inBand.length}/${scaled.length} sills in (${roverMax}, ${quadMax}] m post-scale ` +
        `(scaled: ${scaled.map((h) => h.toFixed(2)).join(", ")}); ` +
        `worst ${worstScaled!.toFixed(2)} ${worstInBand ? "IN band — summary contrast renders" : "OUT of band — contrast is per-sill only"}`,
});

// twin-run failure route, physics-validated (falls first, then ghosts)
const rankHoles = [...probedHoles, ...holes.filter((h) => !probedHoles.includes(h))];
let validated: { route: Route; outcome: string; step: number } | undefined;
let probes = 0;
outer: for (const [kind, defects] of [["fall", rankHoles], ["ghost", ghosts]] as const) {
  for (const d of defects) {
    for (const route of deriveRoutes(d, kind)) {
      if (probes >= 60) break outer;
      probes++;
      const res = dryRun(route);
      const ok = (kind === "fall" && (res.outcome === "fell" || res.outcome === "stuck")) || (kind === "ghost" && res.outcome === "arrived");
      console.log(
        `  probe ${String(probes).padStart(2)}: ${d.id} ${kind} from (${route.start[0].toFixed(2)}, ${route.start[2].toFixed(2)}) → ${res.outcome}@${res.step} d=${res.d.toFixed(2)}${ok ? "   ← VALIDATED" : ""}`,
      );
      if (ok) {
        validated = { route, outcome: res.outcome, step: res.step };
        break outer;
      }
    }
  }
}
results.push({
  label: "twin-run failure route",
  pass: !!validated,
  detail: validated
    ? `${validated.route.defect.id} ${validated.route.kind} → ${validated.outcome} at step ${validated.step} (${(validated.step / 60).toFixed(1)} s)`
    : `none validated in ${probes} dry-runs`,
});

console.log("");
for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}: ${r.detail}`);
const hero = results.every((r) => r.pass);
console.log(`\n${hero ? "HERO CANDIDATE — carries everything ENDGAME §2 requires" : "NOT THE HERO — missing: " + results.filter((r) => !r.pass).map((r) => r.label).join(", ")}\n`);
pw.free();
process.exit(hero ? 0 : 1);
