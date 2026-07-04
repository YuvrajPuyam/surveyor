/**
 * certifyWorld — the orchestrator. Survey → metrology → defects → trust map →
 * per-robot verdicts → graded certificate. Deterministic for a fixed
 * (worldId, seed, gravity): the basis of replay mode.
 */
import type { TriMesh } from "../core/geom.js";
import type { Certificate, Gravity, Grade, RobotSpec, WorldMetadata } from "../core/types.js";
import { GRAVITY, ROBOT_PRESETS } from "../core/types.js";
import { synthesizeDefects } from "./defects.js";
import { runMetrology } from "./metrology.js";
import { DEFAULT_SURVEY, runSurvey, type SurveyOptions, type SurveyResult } from "./survey.js";
import { buildTrustMap, type TrustMap } from "./trustmap.js";
import { computeVerdicts } from "./verdicts.js";

export interface CertifyInput {
  worldId: string;
  collider: TriMesh;
  visualPoints: Float32Array;
  /** per-splat max Gaussian scale, aligned with visualPoints (SPZ worlds) */
  visualScales?: Float32Array;
  metadata?: WorldMetadata;
}

export interface CertifyOptions {
  seed?: number;
  gravity?: Gravity;
  robots?: RobotSpec[];
  /** injected clock — replay mode freezes this */
  createdAt?: string;
  survey?: Partial<SurveyOptions>;
}

export interface CertifyResult {
  certificate: Certificate;
  survey: SurveyResult;
  trustMap: TrustMap;
  metrology: import("./metrology.js").MetrologyResult;
}

function computeGrade(defects: Certificate["defects"]): { grade: Grade; rationale: string } {
  const open = defects.filter((d) => !d.outcome || d.outcome === "escalated");
  const critical = open.filter((d) => d.severity === "critical").length;
  const major = open.filter((d) => d.severity === "major").length;
  const minor = open.filter((d) => d.severity === "minor").length;
  const score = 100 - 40 * critical - 15 * major - 5 * minor;
  const grade: Grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return {
    grade,
    rationale:
      `${critical} critical, ${major} major, ${minor} minor unresolved defect(s); ` +
      `score ${Math.max(0, score)}/100 (critical -40, major -15, minor -5). ` +
      `Repaired/quarantined/accepted defects do not count against the grade but remain listed.`,
  };
}

export async function certifyWorld(input: CertifyInput, opts: CertifyOptions = {}): Promise<CertifyResult> {
  const seed = opts.seed ?? 1234;
  const gravity = opts.gravity ?? GRAVITY.earth;
  const robots = opts.robots ?? [ROBOT_PRESETS.rover, ROBOT_PRESETS.quadruped];

  const surveyOpts: SurveyOptions = { ...DEFAULT_SURVEY, ...opts.survey, seed, gravityMps2: gravity.g };
  const survey = await runSurvey(input.collider, input.visualPoints, surveyOpts, input.visualScales);
  const metrology = runMetrology(survey.rayGrid, seed, input.metadata);
  const defects = synthesizeDefects(survey, metrology);
  const trustMap = buildTrustMap(survey.trustGrid);
  const verdicts = computeVerdicts(robots, metrology, defects, gravity);
  const { grade, rationale } = computeGrade(defects);

  const vendorFactor = input.metadata?.metricScaleFactor;
  const est = metrology.scaleEstimate;
  let agreement: string | undefined;
  if (vendorFactor !== undefined && est) {
    const impliedTrue = est.value; // factor that would bring the world to metric scale
    const within = impliedTrue >= est.uncertainty.low && vendorFactor >= est.uncertainty.low && vendorFactor <= est.uncertainty.high;
    agreement = within
      ? `vendor factor ${vendorFactor} agrees with the door-height estimate ${est.value.toFixed(2)} (within 2 SD)`
      : `vendor factor ${vendorFactor} vs door-height estimate ${est.value.toFixed(2)} — DISAGREE; certificate flags scale as unverified`;
  }

  const certificate: Certificate = {
    schemaVersion: "0.1",
    worldId: input.worldId,
    seed,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    gravity,
    grade,
    gradeRationale: rationale,
    trust: trustMap.summary,
    measurements: metrology.measurements,
    defects,
    robotVerdicts: verdicts,
    scale: {
      vendorFactorApplied: false,
      vendorFactor,
      estimated: est ?? undefined,
      agreement,
    },
    disclosures: [
      ...robots.map((r) => `${r.label}: ${r.modelClassDisclosure}`),
      "Probe methodology: seeded probe rain with CCD; every fall-through cross-checked by an independent raycast at the probe's exit point before it counts as a hole.",
      "Trust states cover robot-REACHABLE space only; 'observed' means no physical experiment touched the cell.",
      (() => {
        // detection floor: what "verified" rules out at this coverage
        const domainCh = survey.rayGrid.channel("domain");
        let domainCells = 0;
        for (let i = 0; i < survey.rayGrid.size; i++) if (domainCh[i]) domainCells++;
        const domainArea = domainCells * surveyOpts.rayCellSize * surveyOpts.rayCellSize;
        const probeSpacing = survey.probeStats.probesDropped > 0 ? Math.sqrt(domainArea / survey.probeStats.probesDropped) : Infinity;
        const rayFloor = 2 * surveyOpts.rayCellSize;
        const floor = Math.max(rayFloor, Number.isFinite(probeSpacing) ? probeSpacing : rayFloor);
        return `Detection floor: at this coverage (ray grid ${surveyOpts.rayCellSize} m, ~${Number.isFinite(probeSpacing) ? probeSpacing.toFixed(2) : "n/a"} m probe spacing over ${domainArea.toFixed(0)} m²), 'verified' rules out collider holes with footprint ≥ ~${floor.toFixed(2)} m; smaller defects are below the instrument's floor.`;
      })(),
      survey.divergence.noiseFloorCalibrated
        ? `Divergence 'lying' threshold self-calibrated to this world's simplification noise floor: ${survey.divergence.noiseFloorM.toFixed(3)} m (1.5x the p99 splat-to-collider distance on probe-verified cells). 'Lying' means divergence beyond the vendor's own demonstrated simplification tolerance.`
        : `Divergence threshold: default ${survey.divergence.noiseFloorM.toFixed(2)} m (insufficient probe-verified visual samples for self-calibration).`,
      "Single-level survey: one walkable surface per column; multi-level worlds are unsupported in this version.",
      "Scope of the grade: it predicts navmesh-level traversability under the disclosed model class. It does not predict policy transfer or visual-domain fidelity.",
      "All measurements carry uncertainty ranges; the methods line under each number states how it was obtained.",
    ],
    probeStats: {
      probesDropped: survey.probeStats.probesDropped,
      probesRested: survey.probeStats.probesRested,
      probesFellThrough: survey.probeStats.probesFellThrough,
      tunnelingArtifactsExcluded: survey.probeStats.tunnelingArtifactsExcluded,
      simSteps: survey.probeStats.simSteps,
      fixedTimestep: survey.probeStats.fixedTimestep,
    },
  };

  return { certificate, survey, trustMap, metrology };
}
