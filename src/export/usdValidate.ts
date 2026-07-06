/**
 * SimReady text-level validator for the generated .usda stage (ENDGAME C8).
 *
 * HONESTY: Node has no USD runtime — these are STRUCTURAL rules over the
 * stage text (metadata, schemas, mesh integrity, spawn/quarantine geometry).
 * The authoritative test — drag into a fresh Isaac Sim, press Play, the
 * rover stands on the floor — is cluster gate G2 and cannot run here.
 */
import type { Aabb } from "../core/geom.js";

export interface UsdRule {
  id: string;
  pass: boolean;
  detail: string;
}

export interface UsdValidationReport {
  pass: boolean;
  honesty: string;
  rules: UsdRule[];
}

export interface UsdExpectations {
  colliderAabb: Aabb;
  pointCount: number;
  triCount: number;
  spawnCount: number;
  quarantineCount: number;
  gravityMps2: number;
}

function sliceArray(usda: string, marker: string): string | undefined {
  const at = usda.indexOf(marker);
  if (at === -1) return undefined;
  // search past the marker itself — type tokens like `point3f[]` contain brackets
  const start = usda.indexOf("[", at + marker.length);
  const end = usda.indexOf("]", start);
  if (start === -1 || end === -1) return undefined;
  return usda.slice(start + 1, end);
}

export function validateUsdaStage(usda: string, expect: UsdExpectations): UsdValidationReport {
  const rules: UsdRule[] = [];
  const rule = (id: string, pass: boolean, detail: string) => rules.push({ id, pass, detail });

  rule("header", usda.startsWith("#usda 1.0"), "stage begins with `#usda 1.0`");
  rule(
    "stage-metadata",
    /metersPerUnit = 1\b/.test(usda) && /upAxis = "Z"/.test(usda) && /defaultPrim = "World"/.test(usda),
    "metersPerUnit=1, upAxis=Z, defaultPrim=World all explicit",
  );
  rule(
    "zup-rotation",
    /xformOp:rotateXYZ = \(90, 0, 0\)/.test(usda),
    "Y-up source geometry sits under an explicit +90° X rotation",
  );

  const gMag = usda.match(/physics:gravityMagnitude = ([\d.]+)/);
  rule(
    "physics-scene",
    /def PhysicsScene/.test(usda) &&
      /physics:gravityDirection = \(0, 0, -1\)/.test(usda) &&
      gMag !== null &&
      Math.abs(parseFloat(gMag[1]) - expect.gravityMps2) < 1e-3,
    `PhysicsScene present, gravity (0,0,-1) × ${expect.gravityMps2} m/s² from the certificate`,
  );

  rule(
    "collision-api",
    /"PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"/.test(usda) &&
      /physics:collisionEnabled = 1/.test(usda) &&
      /physics:approximation = "none"/.test(usda),
    "collider carries PhysicsCollisionAPI + PhysicsMeshCollisionAPI, collision enabled, exact tri-mesh approximation",
  );

  // ---- mesh integrity (parsed, not pattern-matched)
  const ptsStr = sliceArray(usda, "point3f[] points");
  const countsStr = sliceArray(usda, "int[] faceVertexCounts");
  const idxStr = sliceArray(usda, "int[] faceVertexIndices");
  let meshOk = false;
  let meshDetail = "points/counts/indices arrays missing";
  if (ptsStr && countsStr && idxStr) {
    const nPts = ptsStr.split("(").length - 1;
    const counts = countsStr.split(",");
    const idx = idxStr.split(",");
    let maxIdx = -1;
    let idxParseOk = true;
    for (const s of idx) {
      const v = Number(s);
      if (!Number.isInteger(v) || v < 0) {
        idxParseOk = false;
        break;
      }
      if (v > maxIdx) maxIdx = v;
    }
    const countsAll3 = counts.every((c) => c.trim() === "3");
    meshOk =
      nPts === expect.pointCount &&
      counts.length === expect.triCount &&
      countsAll3 &&
      idx.length === expect.triCount * 3 &&
      idxParseOk &&
      maxIdx < expect.pointCount;
    meshDetail =
      `${nPts}/${expect.pointCount} points, ${counts.length}/${expect.triCount} tris (all 3-gons: ${countsAll3}), ` +
      `${idx.length} indices, max index ${maxIdx} < ${expect.pointCount}`;
  }
  rule("mesh-integrity", meshOk, meshDetail);

  const boundPath = usda.match(/rel material:binding:physics = <([^>]+)>/);
  const matName = boundPath ? boundPath[1].split("/").pop() : undefined;
  const sFr = usda.match(/physics:staticFriction = ([\d.]+)/);
  const frRange = usda.match(/surveyorStaticFrictionRange = \(([\d.]+), ([\d.]+)\)/);
  rule(
    "material-bound",
    !!boundPath &&
      !!matName &&
      new RegExp(`def Material "${matName}"`).test(usda) &&
      /"PhysicsMaterialAPI"/.test(usda) &&
      sFr !== null &&
      frRange !== null &&
      parseFloat(sFr[1]) >= parseFloat(frRange[1]) &&
      parseFloat(sFr[1]) <= parseFloat(frRange[2]),
    boundPath
      ? `collider bound to ${boundPath[1]}; static friction ${sFr?.[1]} inside its disclosed DR band [${frRange?.[1]}, ${frRange?.[2]}]`
      : "no physics material binding found",
  );

  // ---- spawns: inside the collider AABB, outside every quarantine box
  const quarantineBoxes: Array<{ c: [number, number, number]; h: [number, number, number] }> = [];
  const qRe = /def Cube "q_\d+"[\s\S]*?xformOp:translate = \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)[\s\S]*?xformOp:scale = \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g;
  for (let m = qRe.exec(usda); m; m = qRe.exec(usda)) {
    quarantineBoxes.push({
      c: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
      h: [parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])],
    });
  }
  rule(
    "quarantine-count",
    quarantineBoxes.length === expect.quarantineCount,
    `${quarantineBoxes.length}/${expect.quarantineCount} quarantine cubes`,
  );

  const spawnRe = /def Xform "spawn_\d+"[\s\S]*?xformOp:translate = \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g;
  const spawnsFound: Array<[number, number, number]> = [];
  for (let m = spawnRe.exec(usda); m; m = spawnRe.exec(usda)) {
    spawnsFound.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  const a = expect.colliderAabb;
  const inAabb = (p: [number, number, number]) =>
    p[0] >= a.min.x - 0.5 && p[0] <= a.max.x + 0.5 && p[1] >= a.min.y - 1.0 && p[1] <= a.max.y + 1.0 && p[2] >= a.min.z - 0.5 && p[2] <= a.max.z + 0.5;
  const inQuarantine = (p: [number, number, number]) =>
    quarantineBoxes.some(
      (q) =>
        Math.abs(p[0] - q.c[0]) <= q.h[0] && Math.abs(p[1] - q.c[1]) <= q.h[1] && Math.abs(p[2] - q.c[2]) <= q.h[2],
    );
  const badAabb = spawnsFound.filter((p) => !inAabb(p)).length;
  const badQuar = spawnsFound.filter(inQuarantine).length;
  rule(
    "spawns",
    spawnsFound.length === expect.spawnCount && badAabb === 0 && badQuar === 0,
    `${spawnsFound.length}/${expect.spawnCount} spawns; ${badAabb} outside the collider AABB; ${badQuar} inside a quarantine box`,
  );

  rule(
    "visuals-payload",
    /def Xform "Visuals" \(\s*\n\s*prepend payload = @\.\/nurec\//.test(usda),
    "NuRec visuals referenced as a payload (stage opens when the file is absent)",
  );

  return {
    pass: rules.every((r) => r.pass),
    honesty:
      "Text-level structural validation only — Node has no USD runtime. The authoritative check (drag into a fresh Isaac Sim, press Play, rover stands on the floor) is cluster gate G2.",
    rules,
  };
}

export function reportToMarkdown(report: UsdValidationReport, title: string): string {
  const lines = [
    `# SimReady validation — ${title}`,
    "",
    `**${report.pass ? "ALL RULES PASS" : "FAILURES PRESENT"}** (${report.rules.filter((r) => r.pass).length}/${report.rules.length})`,
    "",
    `> ${report.honesty}`,
    "",
    "| rule | verdict | detail |",
    "|---|---|---|",
    ...report.rules.map((r) => `| ${r.id} | ${r.pass ? "✓ pass" : "✗ FAIL"} | ${r.detail} |`),
    "",
  ];
  return lines.join("\n");
}
