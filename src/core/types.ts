/**
 * Surveyor core schemas.
 *
 * Design rules (from the execution plan, non-negotiable):
 *  - Every numeric claim is a Measurement with an uncertainty range and a
 *    methods line. Raw centimeter claims are forbidden by the schema itself.
 *  - Every defect ends in exactly one recorded outcome.
 *  - Gravity sensitivity is explicit per verdict: the instrument states what
 *    gravity does NOT change ("unchanged under Mars gravity") as loudly as
 *    what it does.
 * Zod schemas double as runtime validation for the MCP server and as strict
 * tool-input schemas for the agent layer.
 */
import { z } from "zod";

// ---------------------------------------------------------------- gravity

export const GravitySchema = z.object({
  name: z.enum(["earth", "moon", "mars", "custom"]),
  g: z.number().positive().describe("m/s², positive magnitude"),
});
export type Gravity = z.infer<typeof GravitySchema>;

export const GRAVITY = {
  earth: { name: "earth", g: 9.81 },
  moon: { name: "moon", g: 1.62 },
  mars: { name: "mars", g: 3.71 },
} as const satisfies Record<string, Gravity>;

// ------------------------------------------------------------ measurement

export const MeasurementSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  uncertainty: z.object({
    low: z.number(),
    high: z.number(),
    basis: z
      .string()
      .describe("Where the uncertainty comes from (grid resolution, RANSAC inlier RMS, sample count...)"),
  }),
  method: z.string().describe("The methods line printed under the number in the certificate UI"),
  n: z.number().int().positive().optional().describe("Sample count backing the estimate"),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

// ----------------------------------------------------------------- region

export const RegionSchema = z.object({
  min: z.tuple([z.number(), z.number(), z.number()]),
  max: z.tuple([z.number(), z.number(), z.number()]),
});
export type Region = z.infer<typeof RegionSchema>;

// ---------------------------------------------------------------- defects

export const DefectTypeSchema = z.enum([
  "collider_hole", // visuals show floor/surface, physics has nothing — probe falls through AND ray misses
  "phantom_collider", // physics surface with no visual support — invisible barrier / painted-over opening blocked
  "visual_only_surface", // visual surface (wall, rock, door) with no collider behind it
  "scale_error", // world-level metric scale disagrees with priors/vendor metadata
  "raised_sill", // step/threshold at a passage exceeding expected floor continuity
  "clearance_violation", // passage narrower/lower than robot spec requires
  // ---- bench-only classes: planted in validation manifests to test the
  // certifier OUTSIDE its own taxonomy; the certifier never emits these.
  // Detection counts if the certifier flags the damage in its own terms.
  "frame_mismatch", // collider rotated/offset relative to visuals (the -90 deg X quirk)
  "local_scale_error", // one sub-region mis-scaled relative to the rest
]);
export type DefectType = z.infer<typeof DefectTypeSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum([
    "probe_fallthrough",
    "raycast_miss",
    "raycast_hit_crosscheck",
    "divergence_visual_no_physics",
    "divergence_physics_no_visual",
    "doorway_measurement",
    "floor_step_measurement",
    "scale_prior_comparison",
    "vendor_metadata",
  ]),
  detail: z.string(),
  measurement: MeasurementSchema.optional(),
  count: z.number().int().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const DefectOutcomeSchema = z.enum(["fixed", "quarantined", "escalated", "accepted"]);
export type DefectOutcome = z.infer<typeof DefectOutcomeSchema>;

export const DefectSchema = z.object({
  id: z.string(),
  type: DefectTypeSchema,
  region: RegionSchema,
  severity: z.enum(["critical", "major", "minor"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
  description: z.string(),
  outcome: DefectOutcomeSchema.optional().describe("Set by the repair loop; absent on a fresh certificate"),
  outcomeNote: z.string().optional(),
});
export type Defect = z.infer<typeof DefectSchema>;

// ------------------------------------------------------------- robot spec

export const RobotSpecSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["dynamic_vehicle", "kinematic_envelope"]),
  modelClassDisclosure: z
    .string()
    .describe("Printed on the certificate: what physics class the verdict is valid under"),
  footprintRadiusM: z.number().positive(),
  heightM: z.number().positive(),
  maxStepM: z.number().nonnegative(),
  maxSlopeDeg: z.number().positive(),
  frictionMu: z.number().positive().default(0.8),
  referenceSpeedMps: z.number().positive().default(1.5),
});
export type RobotSpec = z.infer<typeof RobotSpecSchema>;

export const ROBOT_PRESETS: Record<string, RobotSpec> = {
  rover: {
    id: "rover",
    label: "Wheeled rover (raycast-vehicle class)",
    kind: "dynamic_vehicle",
    modelClassDisclosure:
      "Rigid-body raycast vehicle, Coulomb friction, no soil mechanics. Verdicts valid for this model class only.",
    footprintRadiusM: 0.35,
    heightM: 0.5,
    maxStepM: 0.08,
    maxSlopeDeg: 20,
    frictionMu: 0.8,
    referenceSpeedMps: 1.5,
  },
  quadruped: {
    id: "quadruped",
    label: "Quadruped (kinematic capability envelope)",
    kind: "kinematic_envelope",
    modelClassDisclosure:
      "Kinematic capability envelope anchored to ANYmal published spec (footprint, max step, max slope). No gait simulation performed or implied.",
    footprintRadiusM: 0.3,
    heightM: 0.7,
    maxStepM: 0.25,
    maxSlopeDeg: 30,
    frictionMu: 0.8,
    referenceSpeedMps: 1.0,
  },
};

// ---------------------------------------------------------------- verdict

export const GravitySensitivitySchema = z.enum([
  "changes_with_gravity", // e.g. stopping distance ~ 1/g
  "unchanged_by_gravity", // e.g. Coulomb slope limit atan(mu) — gravity cancels
  "model_excluded", // e.g. soil mechanics — outside the disclosed model class
]);

export const VerdictSchema = z.object({
  robotId: z.string(),
  check: z.string(),
  pass: z.union([z.boolean(), z.literal("not_evaluated")]),
  measured: MeasurementSchema.optional(),
  requirement: z.string(),
  gravitySensitivity: GravitySensitivitySchema,
  gravityNote: z.string().describe('e.g. "unchanged under Mars gravity: slope limit is atan(µ); gravity cancels"'),
  defectIds: z.array(z.string()).default([]),
});
export type Verdict = z.infer<typeof VerdictSchema>;

// -------------------------------------------------------------- trust map

export const TrustCellStateSchema = z.enum(["unknown", "verified", "observed", "lying"]);
export type TrustCellState = z.infer<typeof TrustCellStateSchema>;

export const TrustSummarySchema = z.object({
  cellSizeM: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  counts: z.object({
    unknown: z.number().int(),
    verified: z.number().int(),
    observed: z.number().int(),
    lying: z.number().int(),
  }),
  verifiedPct: z.number(),
  lyingPct: z.number(),
});
export type TrustSummary = z.infer<typeof TrustSummarySchema>;

// ------------------------------------------------------------ certificate

export const GradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export type Grade = z.infer<typeof GradeSchema>;

export const SelfValidationSchema = z.object({
  worldsTested: z.number().int(),
  plantedDefects: z.number().int(),
  truePositives: z.number().int(),
  falsePositives: z.number().int(),
  falseNegatives: z.number().int(),
  precision: z.number(),
  recall: z.number(),
  /** one-sided 95% Clopper-Pearson lower bounds — a 100% at n=8 is a ">=69%", and the certificate says so */
  recallCI95Low: z.number(),
  precisionCI95Low: z.number(),
  notes: z.array(z.string()),
});
export type SelfValidation = z.infer<typeof SelfValidationSchema>;

// ------------------------------------------------------ extended checks
// The --extended profile: additional instruments (visual self-consistency,
// plausibility priors, solver health). INFORMATIONAL in v1 — they never
// enter the grade, so a world's grade is identical under both profiles and
// the default certificate stays byte-identical (extendedChecks is absent).

export const ExtendedChecksSchema = z.object({
  profile: z.literal("extended-v1"),
  note: z.string().describe("Scope statement: informational, not graded, in this version"),
  /** plausibility prior: floors should be level and planar */
  levelAudit: z.object({
    tilt: MeasurementSchema,
    planarityRms: MeasurementSchema,
  }),
  /** visual self-consistency: splat clusters disconnected from the main structure */
  floaters: z.object({
    count: z.number().int(),
    pointSharePct: z.number(),
    examples: z.array(RegionSchema).describe("Up to 10 largest floater AABBs"),
    measurement: MeasurementSchema,
  }),
  /** independent metric-scale witnesses beyond the door-height estimate */
  scaleConsensus: z.object({
    witnesses: z.array(MeasurementSchema),
    agreement: z.string(),
  }),
  /** resting-contact solver health: boxes placed on confirmed floor must sit still */
  settling: z.object({
    boxes: z.number().int(),
    stable: z.number().int(),
    jitter: z.number().int(),
    ejected: z.number().int(),
    maxDriftM: MeasurementSchema,
    verdict: z.string(),
  }),
  /** fraction of visually-claimed floor physically reachable from the main floor component */
  reachability: z.object({
    visualFloorCells: z.number().int(),
    reachableCells: z.number().int(),
    fractionPct: MeasurementSchema,
  }),
  /** monocular-depth cross-check summary, merged from the bundle's depth-audit.json when present */
  depthConsensus: z
    .object({
      source: z.string(),
      conclusive: z.boolean(),
      yawOffsetDeg: z.number(),
      cropsCalibrated: z.number().int(),
      consensusSpearman: z.number(),
    })
    .optional(),
});
export type ExtendedChecks = z.infer<typeof ExtendedChecksSchema>;

export const CertificateSchema = z.object({
  schemaVersion: z.literal("0.1"),
  worldId: z.string(),
  seed: z.number().int(),
  createdAt: z.string().describe("Injected by the harness; frozen in replay mode"),
  gravity: GravitySchema,
  grade: GradeSchema,
  gradeRationale: z.string(),
  trust: TrustSummarySchema,
  measurements: z.array(MeasurementSchema),
  defects: z.array(DefectSchema),
  robotVerdicts: z.array(VerdictSchema),
  scale: z.object({
    vendorFactorApplied: z.boolean(),
    vendorFactor: z.number().optional(),
    estimated: MeasurementSchema.optional(),
    agreement: z.string().optional(),
  }),
  selfValidation: SelfValidationSchema.optional(),
  disclosures: z.array(z.string()).describe("Model-class and scope disclosures printed on the certificate"),
  probeStats: z.object({
    probesDropped: z.number().int(),
    probesRested: z.number().int(),
    probesFellThrough: z.number().int(),
    tunnelingArtifactsExcluded: z
      .number()
      .int()
      .describe("Fall-throughs reclassified as engine artifacts by the raycast cross-check"),
    simSteps: z.number().int(),
    fixedTimestep: z.number(),
  }),
  /** present only under `certify --extended`; the default profile omits it (byte-identity law) */
  extendedChecks: ExtendedChecksSchema.optional(),
});
export type Certificate = z.infer<typeof CertificateSchema>;

// ------------------------------------------------------ trace / cassette

export const TraceEventSchema = z.object({
  episodeId: z.string(),
  callIndex: z.number().int(),
  kind: z.enum(["tool_call", "tool_result", "note"]),
  name: z.string().optional(),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  contentAddr: z.string().optional().describe("sha256 of any binary payload (images) stored beside the trace"),
  simTime: z.number().optional(),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

// --------------------------------------------- repair tool menu (9 tools)

/** The complete, closed action space of the repair agent. */
export const RepairToolInputs = {
  get_certificate: z.object({}),
  inspect_region: z.object({ defectId: z.string() }),
  query_measurement: z.object({ name: z.string(), region: RegionSchema.optional() }),
  apply_vendor_scale: z.object({}),
  patch_hole: z.object({
    defectId: z.string(),
    method: z.enum(["fitted_slab", "mesh_fill"]),
  }),
  carve_opening: z.object({ defectId: z.string() }),
  quarantine: z.object({ defectId: z.string(), reason: z.string() }),
  rebuild_navmesh_and_spawns: z.object({}),
  revert: z.object({ actionId: z.string() }),
  recertify: z.object({ scope: z.enum(["regional", "full"]), defectId: z.string().optional() }),
} as const;

export interface RepairAction {
  actionId: string;
  tool: keyof typeof RepairToolInputs;
  args: unknown;
  reverted: boolean;
}

// ------------------------------------------------------ world source data

export interface WorldMetadata {
  worldId: string;
  metricScaleFactor?: number; // vendor-shipped; Marble worlds carry this, almost nobody applies it
  groundPlaneY?: number;
  source: "marble" | "synthetic" | "sample";
}
