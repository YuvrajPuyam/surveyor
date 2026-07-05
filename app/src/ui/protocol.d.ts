/**
 * Lane C+D local protocol — TYPES ONLY, no runtime.
 *
 * These mirror (a) the certificate summary produced by
 * src/agent/tools.ts summarizeCertificate() and (b) the expected worker
 * message shapes from lane A's certify-in-worker protocol. They are kept
 * deliberately tolerant (optional fields, both summary and full-certificate
 * spellings) so the panels can render either the compact summary or the raw
 * certificate.json from a bundle. Re-align with lane A's protocol.ts when
 * both lanes land — nothing here imports from other lane files.
 */

// ------------------------------------------------------------ measurement

export interface MeasurementLike {
  name: string;
  value: number;
  unit: string;
  /** summarizeMeasurement shape: [low, high] */
  range?: [number, number] | number[];
  /** full-certificate shape */
  uncertainty?: { low: number; high: number; basis?: string };
  basis?: string;
  /** The methods line — rendered VERBATIM under the number. */
  method?: string;
  n?: number;
}

// ----------------------------------------------------------------- defect

export interface EvidenceSummary {
  kind: string;
  detail?: string;
  count?: number;
}

export type DefectOutcome = "OPEN" | "fixed" | "quarantined" | "escalated" | "accepted";

export interface DefectSummary {
  id: string;
  type: string; // collider_hole | phantom_collider | visual_only_surface | scale_error | raised_sill | clearance_violation
  severity: "critical" | "major" | "minor";
  confidence: number;
  region?: { min: number[]; max: number[] };
  description?: string;
  evidence?: EvidenceSummary[];
  /** summarizeDefect emits "OPEN" when unset; full certificate omits it. */
  outcome?: DefectOutcome | string;
  outcomeNote?: string;
}

// ---------------------------------------------------------------- verdict

export interface VerdictSummary {
  /** summarizeVerdict spelling */
  robot?: string;
  /** full-certificate spelling */
  robotId?: string;
  check: string;
  pass: boolean | "not_evaluated";
  measured?: MeasurementLike;
  requirement: string;
  gravityNote?: string;
}

// ------------------------------------------------------------ certificate

export interface ScaleSummary {
  vendorFactorApplied: boolean;
  vendorFactor?: number;
  estimated?: MeasurementLike;
  agreement?: string;
}

export interface CertificateSummary {
  worldId: string;
  gravity?: string | { name: string };
  grade: string;
  gradeRationale?: string;
  trust: { verifiedPct: number; lyingPct: number };
  defects: DefectSummary[];
  robotVerdicts: VerdictSummary[];
  scale?: ScaleSummary;
  /** Present on the full certificate.json; absent from the compact summary. */
  measurements?: MeasurementLike[];
  disclosures?: string[];
}

// -------------------------------------------------------------- recertify

/** Shape of the recertify tool result (dispatchTool "recertify"). */
export interface RecertifyResult {
  scope: "regional" | "full";
  grade: string;
  resolvedDefectIds: string[];
  /** Non-empty = the certifier caught the repair — the fail-and-adapt moment. */
  newDefects: DefectSummary[];
  verdictRegressions?: unknown[];
  openDefects?: string[];
}

// ------------------------------------------------------------ repair plan

export type RepairStepKind = "apply_vendor_scale" | "patch_hole" | "quarantine" | "accept_defect";

export interface RepairStep {
  id: string;
  kind: RepairStepKind;
  label: string;
  detail: string;
  defectIds: string[];
  method?: "fitted_slab" | "mesh_fill";
  reason?: string;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  /** Engine actionId of the (last) mutating action — needed for revert. */
  actionId?: string;
  actionIds?: string[];
  /** Free-form lines appended to the live log. */
  log?: string[];
  /** Regional recertify report the driver ran after the action. */
  recertify?: RecertifyResult;
  /** Updated certificate summary, if the driver refreshed it. */
  certificate?: CertificateSummary;
  /**
   * The step re-measured the WHOLE world (apply_vendor_scale + full
   * recertify): re-discovered findings at the corrected scale are not a
   * caught repair — the panel should rebuild the plan from `certificate`
   * and continue, instead of raising the fail-and-adapt banner.
   */
  replan?: boolean;
}

/**
 * What the repair panel drives. In the integrated app this is backed by the
 * lane-A worker; runStep is expected to execute the engine action(s) for the
 * step AND run a regional recertify, returning it in StepResult.recertify so
 * the panel can detect fail-and-adapt (recertify.newDefects.length > 0).
 */
export interface RepairDriver {
  runStep(step: RepairStep): Promise<StepResult>;
  revert(actionId: string): Promise<StepResult>;
}

// -------------------------------------------- expected worker wire shapes
// (lane A owns the real protocol; this is the minimal contract we expect)

export type RepairWorkerRequest =
  | { kind: "certify"; requestId: number }
  | { kind: "getCert"; requestId: number }
  | { kind: "applyVendorScale"; requestId: number }
  | { kind: "patchHole"; requestId: number; defectId: string; method: "fitted_slab" | "mesh_fill" }
  | { kind: "quarantine"; requestId: number; defectIds: string[]; reason: string }
  | { kind: "accept"; requestId: number; defectIds: string[]; reason: string }
  | { kind: "revert"; requestId: number; actionId: string }
  | { kind: "recertify"; requestId: number; scope: "regional" | "full"; defectId?: string };

export type RepairWorkerResponse =
  | { kind: "cert"; requestId: number; certificate: CertificateSummary }
  | { kind: "result"; requestId: number; ok: boolean; actionId?: string; detail?: unknown }
  | { kind: "recertified"; requestId: number; report: RecertifyResult }
  | { kind: "error"; requestId: number; message: string };
