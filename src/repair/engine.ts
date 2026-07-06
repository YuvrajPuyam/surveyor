/**
 * Repair engine — the deterministic tool backend behind the agent's closed
 * 9-tool menu. The agent never edits geometry: it calls these operations,
 * every one of which is parameterized, reversible (operation stack with full
 * snapshots), and verified by re-certification before it counts.
 *
 * Honest modeling notes:
 *  - fitted_slab sits PROUD of the true floor by ~0.10 m: it is fitted to the
 *    splat surface, and splat centers float above the real surface (splat
 *    fuzz). Fast, but can create a new step defect at its boundary —
 *    deliberately preserved because recovering from it IS the demo beat.
 *  - mesh_fill models the offline watertight repair: conforming (bias 0.01,
 *    tight margin), slower in reality.
 *  - rebuild_navmesh_and_spawns is occupancy-grid based here; the browser app
 *    swaps in recast-navigation with per-robot params (same interface).
 */
import type { Aabb, TriMesh } from "../core/geom.js";
import { boxTriMesh, mergeTriMeshes } from "../core/geom.js";
import type { Certificate, Defect, DefectOutcome, Gravity, Region, RobotSpec, WorldMetadata } from "../core/types.js";
import { GRAVITY, ROBOT_PRESETS } from "../core/types.js";
import { certifyWorld, type CertifyResult } from "../certify/certificate.js";
import { iouXZ } from "../core/geom.js";

export interface RepairWorldState {
  worldId: string;
  collider: TriMesh;
  visualPoints: Float32Array;
  /** per-splat max Gaussian scale, aligned with visualPoints — certify counts shift without it */
  visualScales?: Float32Array;
  metadata: WorldMetadata;
}

export interface AppliedAction {
  actionId: string;
  tool: string;
  args: unknown;
  /** collider snapshot BEFORE the action, for revert */
  before: TriMesh;
  beforeMetadata: WorldMetadata;
  beforeVisualPoints: Float32Array;
  beforeVisualScales?: Float32Array;
  /** ledger defect regions BEFORE the action — whole-world transforms move them */
  beforeRegions: Map<string, Region>;
  reverted: boolean;
}

export interface RecertifyReport {
  certificate: Certificate;
  resolvedDefectIds: string[];
  newDefects: Defect[];
  verdictRegressions: { robotId: string; check: string; requirement: string }[];
  scope: "regional" | "full";
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  robotId: string;
  clearanceM: number;
}

function cloneMesh(m: TriMesh): TriMesh {
  return { positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices) };
}

function regionToAabb(r: Region): Aabb {
  return { min: { x: r.min[0], y: r.min[1], z: r.min[2] }, max: { x: r.max[0], y: r.max[1], z: r.max[2] } };
}

export class RepairEngine {
  private state: RepairWorldState;
  private stack: AppliedAction[] = [];
  private seq = 0;
  /** defect ledger: every defect ever seen, with its (eventual) outcome */
  private ledger = new Map<string, Defect>();
  private quarantined: { defectId: string; region: Region; reason: string }[] = [];
  private lastResult: CertifyResult | null = null;
  private spawns: SpawnPoint[] = [];

  constructor(
    world: RepairWorldState,
    private opts: { seed?: number; gravity?: Gravity; robots?: RobotSpec[]; probeCount?: number } = {},
  ) {
    this.state = {
      worldId: world.worldId,
      collider: cloneMesh(world.collider),
      visualPoints: new Float32Array(world.visualPoints),
      visualScales: world.visualScales ? new Float32Array(world.visualScales) : undefined,
      metadata: { ...world.metadata },
    };
  }

  private robots(): RobotSpec[] {
    return this.opts.robots ?? [ROBOT_PRESETS.rover, ROBOT_PRESETS.quadruped];
  }

  // ------------------------------------------------------------- READ

  async init(): Promise<Certificate> {
    const result = await this.certify();
    this.lastResult = result;
    for (const d of result.certificate.defects) this.ledger.set(d.id, { ...d });
    return this.currentCertificate();
  }

  getCertificate(): Certificate {
    return this.currentCertificate();
  }

  getDefect(defectId: string): Defect {
    const d = this.ledger.get(defectId);
    if (!d) throw new Error(`unknown defect '${defectId}'`);
    return d;
  }

  inspectRegion(defectId: string): {
    defect: Defect;
    stats: { visualPointsInRegion: number; colliderTrianglesInRegion: number; floorPlaneY: number };
  } {
    const defect = this.getDefect(defectId);
    const r = regionToAabb(defect.region);
    let pts = 0;
    const vp = this.state.visualPoints;
    for (let i = 0; i < vp.length; i += 3) {
      if (vp[i] >= r.min.x && vp[i] <= r.max.x && vp[i + 2] >= r.min.z && vp[i + 2] <= r.max.z) pts++;
    }
    let tris = 0;
    const { positions, indices } = this.state.collider;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t] * 3;
      const cx = positions[i0], cz = positions[i0 + 2];
      if (cx >= r.min.x && cx <= r.max.x && cz >= r.min.z && cz <= r.max.z) tris++;
    }
    return {
      defect,
      stats: {
        visualPointsInRegion: pts,
        colliderTrianglesInRegion: tris,
        floorPlaneY: this.lastResult?.metrology.floorPlane.y ?? 0,
      },
    };
  }

  queryMeasurement(name: string): unknown {
    const m = this.lastResult?.metrology.measurements.filter((mm) => mm.name === name) ?? [];
    if (m.length === 0) return { error: `no measurement named '${name}' in the last certification` };
    return m;
  }

  // -------------------------------------------------------------- ACT

  private push(tool: string, args: unknown): AppliedAction {
    const beforeRegions = new Map<string, Region>();
    for (const [id, d] of this.ledger) {
      beforeRegions.set(id, { min: [...d.region.min], max: [...d.region.max] });
    }
    const action: AppliedAction = {
      actionId: `a-${this.seq++}`,
      tool,
      args,
      before: cloneMesh(this.state.collider),
      beforeMetadata: { ...this.state.metadata },
      beforeVisualPoints: this.state.visualPoints, // visual points only change on scale ops; shared ref is fine otherwise
      beforeVisualScales: this.state.visualScales,
      beforeRegions,
      reverted: false,
    };
    this.stack.push(action);
    return action;
  }

  applyVendorScale(): { actionId: string; factorApplied: number } {
    const factor = this.state.metadata.metricScaleFactor;
    if (factor === undefined || factor === 1) {
      throw new Error("no vendor metric_scale_factor to apply (absent or already 1)");
    }
    const action = this.push("apply_vendor_scale", { factor });
    const scaled = new Float32Array(this.state.collider.positions.length);
    for (let i = 0; i < scaled.length; i++) scaled[i] = this.state.collider.positions[i] * factor;
    this.state.collider = { positions: scaled, indices: this.state.collider.indices };
    const vp = new Float32Array(this.state.visualPoints.length);
    for (let i = 0; i < vp.length; i++) vp[i] = this.state.visualPoints[i] * factor;
    this.state.visualPoints = vp;
    if (this.state.visualScales) {
      // Gaussian scales are lengths — a whole-world transform scales them too
      const vs = new Float32Array(this.state.visualScales.length);
      for (let i = 0; i < vs.length; i++) vs[i] = this.state.visualScales[i] * factor;
      this.state.visualScales = vs;
    }
    this.state.metadata = { ...this.state.metadata, metricScaleFactor: 1 };
    // a whole-world transform moves every recorded region with it — the
    // ledger stays in world coordinates or identity matching falls apart
    // and every defect double-counts at its new location
    const scaleRegion = (r: Region): Region => ({
      min: [r.min[0] * factor, r.min[1] * factor, r.min[2] * factor],
      max: [r.max[0] * factor, r.max[1] * factor, r.max[2] * factor],
    });
    for (const d of this.ledger.values()) d.region = scaleRegion(d.region);
    for (const q of this.quarantined) q.region = scaleRegion(q.region);
    this.spawns = this.spawns.map((s) => ({ ...s, x: s.x * factor, y: s.y * factor, z: s.z * factor }));
    return { actionId: action.actionId, factorApplied: factor };
  }

  patchHole(defectId: string, method: "fitted_slab" | "mesh_fill"): { actionId: string; slabTopY: number } {
    const defect = this.getDefect(defectId);
    if (defect.type !== "collider_hole") throw new Error(`patch_hole targets collider_hole defects; '${defectId}' is ${defect.type}`);
    const r = regionToAabb(defect.region);
    const floorY = this.lastResult?.metrology.floorPlane.y ?? 0;
    // fitted_slab: generous margin, sits proud of the true floor (splat fuzz bias).
    // mesh_fill: conforming margin and bias.
    const margin = method === "fitted_slab" ? 0.2 : 0.03;
    const bias = method === "fitted_slab" ? 0.1 : 0.01;
    const thickness = 0.12;
    const cx = (r.min.x + r.max.x) / 2;
    const cz = (r.min.z + r.max.z) / 2;
    const ex = r.max.x - r.min.x + 2 * margin;
    const ez = r.max.z - r.min.z + 2 * margin;
    const topY = floorY + bias;
    const slab = boxTriMesh({ x: cx, y: topY - thickness / 2, z: cz }, { x: ex, y: thickness, z: ez });
    const action = this.push("patch_hole", { defectId, method });
    this.state.collider = mergeTriMeshes([this.state.collider, slab]);
    return { actionId: action.actionId, slabTopY: topY };
  }

  carveOpening(defectId: string): { actionId: string; trianglesRemoved: number } {
    const defect = this.getDefect(defectId);
    if (defect.type !== "phantom_collider") {
      throw new Error(`carve_opening targets phantom_collider defects; '${defectId}' is ${defect.type}`);
    }
    const r = regionToAabb(defect.region);
    const pad = 0.05;
    const { positions, indices } = this.state.collider;
    const keep: number[] = [];
    let removed = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
      const cx = (positions[i0] + positions[i1] + positions[i2]) / 3;
      const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
      const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
      const inside =
        cx >= r.min.x - pad && cx <= r.max.x + pad &&
        cy >= r.min.y - pad && cy <= r.max.y + pad &&
        cz >= r.min.z - pad && cz <= r.max.z + pad;
      if (inside) removed++;
      else keep.push(indices[t], indices[t + 1], indices[t + 2]);
    }
    if (removed === 0) throw new Error("carve_opening removed nothing — region does not intersect the collider");
    const action = this.push("carve_opening", { defectId });
    this.state.collider = { positions, indices: new Uint32Array(keep) };
    return { actionId: action.actionId, trianglesRemoved: removed };
  }

  quarantine(defectId: string, reason: string): { actionId: string } {
    const defect = this.getDefect(defectId);
    const action = this.push("quarantine", { defectId, reason });
    this.quarantined.push({ defectId, region: defect.region, reason });
    defect.outcome = "quarantined";
    defect.outcomeNote = reason;
    return { actionId: action.actionId };
  }

  rebuildNavmeshAndSpawns(): { actionId: string; spawns: SpawnPoint[] } {
    if (!this.lastResult) throw new Error("certify before rebuilding spawns");
    const action = this.push("rebuild_navmesh_and_spawns", {});
    const rayGrid = this.lastResult.survey.rayGrid;
    const classes = rayGrid.channel("class");
    const surfaceY = rayGrid.channel("surfaceY");
    const headroom = rayGrid.channel("headroom");
    const cell = rayGrid.cellSize;

    // chamfer distance to nearest non-floor cell = clearance radius
    const INF = 1e9;
    const dist = new Float64Array(rayGrid.size).fill(INF);
    for (let i = 0; i < rayGrid.size; i++) if (classes[i] !== 1) dist[i] = 0;
    // chamfer with diagonal neighbors approximates Euclidean clearance to
    // within ~8% (pure 4-neighbor passes compute city-block distance, which
    // overestimates diagonal clearance by up to sqrt(2) and can spawn a
    // wide robot overlapping a corner)
    const DIAG = cell * Math.SQRT2;
    for (let r = 0; r < rayGrid.rows; r++)
      for (let c = 0; c < rayGrid.cols; c++) {
        const i = r * rayGrid.cols + c;
        if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + cell);
        if (r > 0) dist[i] = Math.min(dist[i], dist[i - rayGrid.cols] + cell);
        if (c > 0 && r > 0) dist[i] = Math.min(dist[i], dist[i - rayGrid.cols - 1] + DIAG);
        if (c < rayGrid.cols - 1 && r > 0) dist[i] = Math.min(dist[i], dist[i - rayGrid.cols + 1] + DIAG);
      }
    for (let r = rayGrid.rows - 1; r >= 0; r--)
      for (let c = rayGrid.cols - 1; c >= 0; c--) {
        const i = r * rayGrid.cols + c;
        if (c < rayGrid.cols - 1) dist[i] = Math.min(dist[i], dist[i + 1] + cell);
        if (r < rayGrid.rows - 1) dist[i] = Math.min(dist[i], dist[i + rayGrid.cols] + cell);
        if (c < rayGrid.cols - 1 && r < rayGrid.rows - 1) dist[i] = Math.min(dist[i], dist[i + rayGrid.cols + 1] + DIAG);
        if (c > 0 && r < rayGrid.rows - 1) dist[i] = Math.min(dist[i], dist[i + rayGrid.cols - 1] + DIAG);
      }

    const inExcluded = (x: number, z: number): boolean => {
      const zones = [
        ...this.quarantined.map((q) => q.region),
        ...[...this.ledger.values()].filter((d) => !d.outcome || d.outcome === "escalated").map((d) => d.region),
      ];
      return zones.some((r) => x >= r.min[0] - 0.3 && x <= r.max[0] + 0.3 && z >= r.min[2] - 0.3 && z <= r.max[2] + 0.3);
    };

    this.spawns = [];
    for (const robot of this.robots()) {
      const candidates: SpawnPoint[] = [];
      for (let i = 0; i < rayGrid.size; i++) {
        if (classes[i] !== 1) continue;
        if (dist[i] < robot.footprintRadiusM + 0.15) continue;
        if (headroom[i] < robot.heightM + 0.1) continue;
        const [x, z] = rayGrid.center(i);
        if (inExcluded(x, z)) continue;
        candidates.push({ x, y: surfaceY[i], z, robotId: robot.id, clearanceM: dist[i] });
      }
      // greedy max-min dispersion, up to 5 spawns per robot
      candidates.sort((a, b) => b.clearanceM - a.clearanceM);
      const picked: SpawnPoint[] = [];
      for (const c of candidates) {
        if (picked.length >= 5) break;
        if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 1.5)) picked.push(c);
      }
      this.spawns.push(...picked);
    }
    return { actionId: action.actionId, spawns: this.spawns };
  }

  revert(actionId: string): { reverted: string } {
    const idx = this.stack.findIndex((a) => a.actionId === actionId && !a.reverted);
    if (idx === -1) throw new Error(`no revertible action '${actionId}'`);
    // revert this action and everything after it (stack discipline)
    for (let i = this.stack.length - 1; i >= idx; i--) {
      const a = this.stack[i];
      if (a.reverted) continue;
      this.state.collider = cloneMesh(a.before);
      this.state.metadata = { ...a.beforeMetadata };
      this.state.visualPoints = a.beforeVisualPoints;
      this.state.visualScales = a.beforeVisualScales;
      // restore ledger regions (whole-world transforms move them on apply)
      for (const [id, region] of a.beforeRegions) {
        const d = this.ledger.get(id);
        if (d) d.region = { min: [...region.min], max: [...region.max] };
      }
      if (a.tool === "quarantine") {
        const args = a.args as { defectId: string };
        this.quarantined = this.quarantined.filter((q) => q.defectId !== args.defectId);
        const d = this.ledger.get(args.defectId);
        if (d) {
          d.outcome = undefined;
          d.outcomeNote = undefined;
        }
      }
      a.reverted = true;
    }
    return { reverted: actionId };
  }

  // ------------------------------------------------------------ VERIFY

  async recertify(scope: "regional" | "full", defectId?: string): Promise<RecertifyReport> {
    const prevCert = this.lastResult?.certificate;
    let focusRegion: { min: { x: number; z: number }; max: { x: number; z: number } } | undefined;
    let probeCount = this.opts.probeCount ?? 2000;
    if (scope === "regional") {
      if (!defectId) throw new Error("regional recertify requires a defectId");
      const r = regionToAabb(this.getDefect(defectId).region);
      const pad = 1.5;
      focusRegion = {
        min: { x: r.min.x - pad, z: r.min.z - pad },
        max: { x: r.max.x + pad, z: r.max.z + pad },
      };
      probeCount = Math.min(probeCount, 600);
    }

    const result = await this.certify(focusRegion, probeCount);
    this.lastResult = result;

    // ledger reconciliation: which open defects vanished, which are new
    const open = [...this.ledger.values()].filter((d) => !d.outcome);
    const matches = (a: Defect, b: Defect) =>
      a.type === b.type && (a.type === "scale_error" || iouXZ(regionToAabb(a.region), regionToAabb(b.region)) > 0.05);

    const resolvedDefectIds: string[] = [];
    for (const old of open) {
      const inspected =
        scope === "full" ||
        !focusRegion ||
        iouXZ(regionToAabb(old.region), {
          min: { x: focusRegion.min.x, y: -Infinity, z: focusRegion.min.z },
          max: { x: focusRegion.max.x, y: Infinity, z: focusRegion.max.z },
        } as Aabb) > 0 ||
        old.type === "scale_error";
      if (!inspected) continue; // regional pass can only vouch for what it re-probed
      const still = result.certificate.defects.find((d) => matches(old, d));
      if (!still) {
        old.outcome = "fixed";
        old.outcomeNote = `resolved; ${scope} re-certification no longer detects it`;
        resolvedDefectIds.push(old.id);
      }
    }

    const newDefects: Defect[] = [];
    const ledgerEntries = [...this.ledger.values()];
    for (const d of result.certificate.defects) {
      // Prefer a match that ABSORBS the detection (open/quarantined/accepted)
      // over a "fixed" one: overlapping ledger entries otherwise let a
      // quarantined cluster keep reopening its old "fixed" twin forever —
      // an immortal flicker in every replan loop.
      const known =
        ledgerEntries.find((old) => old.outcome !== "fixed" && matches(old, d)) ??
        ledgerEntries.find((old) => matches(old, d));
      if (!known) {
        this.ledger.set(d.id, { ...d });
        newDefects.push(d);
      } else if (known.outcome === "fixed") {
        // a "fixed" defect that reappeared — reopen it
        known.outcome = undefined;
        known.outcomeNote = undefined;
      }
    }

    // verdict regressions vs previous certificate
    const verdictRegressions: RecertifyReport["verdictRegressions"] = [];
    if (prevCert) {
      for (const v of result.certificate.robotVerdicts) {
        const before = prevCert.robotVerdicts.find((p) => p.robotId === v.robotId && p.check === v.check);
        if (before && before.pass === true && v.pass === false) {
          verdictRegressions.push({ robotId: v.robotId, check: v.check, requirement: v.requirement });
        }
      }
    }

    return { certificate: this.currentCertificate(), resolvedDefectIds, newDefects, verdictRegressions, scope };
  }

  /** All ledger defects must carry an outcome for a session to close clean. */
  openDefects(): Defect[] {
    return [...this.ledger.values()].filter((d) => !d.outcome);
  }

  markOutcome(defectId: string, outcome: DefectOutcome, note: string): void {
    const d = this.getDefect(defectId);
    d.outcome = outcome;
    d.outcomeNote = note;
  }

  // ------------------------------------------------------------- export

  /**
   * Export the corrected bundle: repaired collider, certificate with
   * outcomes, verified spawns, quarantine zones, and the Isaac training
   * contract (pipeline v2 Stage B). Refuses nothing but WARNS in the
   * certificate itself if defects remain open.
   */
  async exportBundle(outDir: string): Promise<{ files: string[]; openDefects: number }> {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { saveTriMeshGlb } = await import("../ingest/glb.js");
    const { certificateToIsaac } = await import("../export/isaacContract.js");

    mkdirSync(outDir, { recursive: true });
    const cert = this.currentCertificate();
    const quarantine = this.quarantined.map((q) => ({ region: q.region, reason: q.reason }));
    const contract = certificateToIsaac(cert, this.spawns, quarantine);

    await saveTriMeshGlb(join(outDir, "collider.glb"), this.state.collider, "collider-repaired");
    writeFileSync(join(outDir, "visual-points.f32"), Buffer.from(this.state.visualPoints.buffer, this.state.visualPoints.byteOffset, this.state.visualPoints.byteLength));
    if (this.state.visualScales) {
      writeFileSync(join(outDir, "visual-scales.f32"), Buffer.from(this.state.visualScales.buffer, this.state.visualScales.byteOffset, this.state.visualScales.byteLength));
    }
    writeFileSync(join(outDir, "metadata.json"), JSON.stringify(this.state.metadata, null, 2));
    writeFileSync(join(outDir, "certificate.json"), JSON.stringify(cert, null, 2));
    writeFileSync(join(outDir, "spawns.json"), JSON.stringify(this.spawns, null, 2));
    writeFileSync(join(outDir, "quarantine.json"), JSON.stringify(quarantine, null, 2));
    writeFileSync(join(outDir, "surveyor_contract.py"), contract.python);
    writeFileSync(join(outDir, "contract.json"), JSON.stringify(contract.sidecar, null, 2));
    return {
      files: ["collider.glb", "visual-points.f32", "metadata.json", "certificate.json", "spawns.json", "quarantine.json", "surveyor_contract.py", "contract.json"],
      openDefects: this.openDefects().length,
    };
  }

  // ------------------------------------------------------------ internals

  private async certify(
    focusRegion?: { min: { x: number; z: number }; max: { x: number; z: number } },
    probeCount?: number,
  ): Promise<CertifyResult> {
    return certifyWorld(
      {
        worldId: this.state.worldId,
        collider: this.state.collider,
        visualPoints: this.state.visualPoints,
        visualScales: this.state.visualScales,
        metadata: this.state.metadata,
      },
      {
        seed: this.opts.seed ?? 1234,
        gravity: this.opts.gravity ?? GRAVITY.earth,
        robots: this.robots(),
        survey: { probeCount: probeCount ?? this.opts.probeCount ?? 2000, ...(focusRegion ? { focusRegion } : {}) },
      },
    );
  }

  /** The last certificate with ledger outcomes merged in (grade reflects outcomes). */
  private currentCertificate(): Certificate {
    if (!this.lastResult) throw new Error("call init() first");
    const cert = this.lastResult.certificate;
    const defects = [...this.ledger.values()];
    const open = defects.filter((d) => !d.outcome || d.outcome === "escalated");
    const critical = open.filter((d) => d.severity === "critical").length;
    const major = open.filter((d) => d.severity === "major").length;
    const minor = open.filter((d) => d.severity === "minor").length;
    const score = 100 - 40 * critical - 15 * major - 5 * minor;
    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
    // Same wording as certifyWorld's computeGrade — a FRESH engine
    // certificate must be byte-identical to the CLI's (the content hash is
    // the demo's determinism claim). Only once outcomes exist does the
    // rationale gain the outcomes line: a repaired certificate is a
    // different artifact and may say so.
    const outcomes = defects.filter((d) => d.outcome).length;
    const baseRationale =
      `${critical} critical, ${major} major, ${minor} minor unresolved defect(s); ` +
      `score ${Math.max(0, score)}/100 (critical -40, major -15, minor -5). ` +
      `Repaired/quarantined/accepted defects do not count against the grade but remain listed.`;
    return {
      ...cert,
      defects,
      grade,
      gradeRationale: outcomes > 0 ? `${baseRationale} Outcomes recorded: ${outcomes}/${defects.length}.` : baseRationale,
    };
  }
}
