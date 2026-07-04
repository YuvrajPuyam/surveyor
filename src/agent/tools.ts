/**
 * Agent-facing tool definitions and the dispatcher onto the RepairEngine.
 * Hand-written JSON schemas (strict: additionalProperties false everywhere),
 * with WHEN-TO-CALL trigger conditions in the descriptions — on
 * Fable/Sonnet-class models that is where triggering guidance lands.
 */
import type { RepairEngine } from "../repair/engine.js";
import type { Certificate, Defect, Measurement, Verdict } from "../core/types.js";

export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const REPAIR_TOOLS: AgentToolDef[] = [
  {
    name: "get_certificate",
    description:
      "Returns the current certificate: defect list with evidence and outcomes, measurements with uncertainty, trust summary, per-robot verdicts. Call this first in every session and after any recertify to see updated state.",
    input_schema: obj({}),
  },
  {
    name: "inspect_region",
    description:
      "Splat-density-vs-collider statistics for one defect's region. Call when the defect's evidence alone doesn't determine the root cause — e.g. to judge whether a region is visually covered or physically empty.",
    input_schema: obj({ defectId: { type: "string" } }, ["defectId"]),
  },
  {
    name: "query_measurement",
    description:
      "Fetch a named measurement from the last certification (doorway_width, doorway_height, step_height, floor_plane_height, metric_scale_factor_estimate, vendor_metric_scale_factor). Call to get the DISCRIMINATING measurement during diagnosis — e.g. door heights to separate global mis-scale from a genuinely narrow door.",
    input_schema: obj({ name: { type: "string" } }, ["name"]),
  },
  {
    name: "apply_vendor_scale",
    description:
      "Apply the vendor's shipped metric_scale_factor to the whole world and bake the transform. Call when the scale estimate AND vendor metadata agree the world is mis-scaled; one call can resolve every scale-dependent defect at once — always evaluate this hypothesis before patching individual defects.",
    input_schema: obj({}),
  },
  {
    name: "patch_hole",
    description:
      "Close a collider hole. fitted_slab: fast, fitted to the splat surface, sits slightly proud (splat centers float above true surfaces) and can create a new step at its boundary. mesh_fill: conforming watertight fill. Call for collider_hole defects; if a regional recertify after fitted_slab reports a NEW step/clearance defect nearby, revert and retry with mesh_fill.",
    input_schema: obj(
      { defectId: { type: "string" }, method: { type: "string", enum: ["fitted_slab", "mesh_fill"] } },
      ["defectId", "method"],
    ),
  },
  {
    name: "carve_opening",
    description:
      "Remove phantom collider geometry. The rarest tool: call only for phantom_collider defects where inspect_region confirms no visual support — never to widen a genuinely narrow doorway.",
    input_schema: obj({ defectId: { type: "string" } }, ["defectId"]),
  },
  {
    name: "quarantine",
    description:
      "Exclude defect regions from the navigable area and record outcome=quarantined. Call for visual lies that cannot be repaired (visual_only_surface) so no training episode touches the lie, or after 2 failed repair attempts. Accepts one defectId or a defectIds array for bulk resolution of a shared diagnosis.",
    input_schema: obj(
      {
        defectId: { type: "string" },
        defectIds: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      ["reason"],
    ),
  },
  {
    name: "accept_defect",
    description:
      "Record outcome=accepted: the finding is correct as-is and needs no repair (e.g. a genuinely raised sill whose negotiability is robot-relative — the verdict stands). Call when diagnosis concludes NO action is the right action. Accepts one defectId or a defectIds array for bulk resolution of a shared diagnosis.",
    input_schema: obj(
      {
        defectId: { type: "string" },
        defectIds: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      ["reason"],
    ),
  },
  {
    name: "rebuild_navmesh_and_spawns",
    description:
      "Regenerate navigable-area spawn points, excluding quarantined and unresolved-defect regions. Call after all defects have outcomes, before closing the session.",
    input_schema: obj({}),
  },
  {
    name: "revert",
    description:
      "Undo a prior action by actionId (and anything applied after it — stack discipline). Call when a regional recertify shows a repair failed or created a new defect.",
    input_schema: obj({ actionId: { type: "string" } }, ["actionId"]),
  },
  {
    name: "recertify",
    description:
      "Re-run the physical inspection. regional (seconds) re-probes one defect's neighborhood — call after every repair to verify it before it counts. full re-runs everything — call once at session end. A repair does not exist until recertify passes it.",
    input_schema: obj(
      { scope: { type: "string", enum: ["regional", "full"] }, defectId: { type: "string" } },
      ["scope"],
    ),
  },
];

// ------------------------------------------------------- compact summaries
// Numbers-not-pixels: the agent reads compact JSON, never megabyte dumps.

function summarizeMeasurement(m: Measurement) {
  return {
    name: m.name,
    value: Number(m.value.toFixed(4)),
    unit: m.unit,
    range: [Number(m.uncertainty.low.toFixed(4)), Number(m.uncertainty.high.toFixed(4))],
    basis: m.uncertainty.basis,
    method: m.method,
  };
}

function summarizeDefect(d: Defect) {
  return {
    id: d.id,
    type: d.type,
    severity: d.severity,
    confidence: d.confidence,
    region: { min: d.region.min.map((v) => Number(v.toFixed(2))), max: d.region.max.map((v) => Number(v.toFixed(2))) },
    description: d.description,
    evidence: d.evidence.map((e) => ({ kind: e.kind, detail: e.detail })),
    outcome: d.outcome ?? "OPEN",
    outcomeNote: d.outcomeNote,
  };
}

function summarizeVerdict(v: Verdict) {
  return {
    robot: v.robotId,
    check: v.check,
    pass: v.pass,
    measured: v.measured ? summarizeMeasurement(v.measured) : undefined,
    requirement: v.requirement,
    gravityNote: v.gravityNote,
  };
}

export function summarizeCertificate(c: Certificate) {
  return {
    worldId: c.worldId,
    gravity: c.gravity.name,
    grade: c.grade,
    gradeRationale: c.gradeRationale,
    trust: { verifiedPct: Number(c.trust.verifiedPct.toFixed(1)), lyingPct: Number(c.trust.lyingPct.toFixed(1)) },
    defects: c.defects.map(summarizeDefect),
    robotVerdicts: c.robotVerdicts.map(summarizeVerdict),
    scale: c.scale,
  };
}

/** Execute one agent tool call against the engine; returns a JSON-serializable result. */
export async function dispatchTool(engine: RepairEngine, name: string, input: unknown): Promise<unknown> {
  const args = (input ?? {}) as Record<string, string>;
  switch (name) {
    case "get_certificate":
      return summarizeCertificate(engine.getCertificate());
    case "inspect_region": {
      const r = engine.inspectRegion(args.defectId);
      return { defect: summarizeDefect(r.defect), stats: r.stats };
    }
    case "query_measurement":
      return engine.queryMeasurement(args.name);
    case "apply_vendor_scale":
      return engine.applyVendorScale();
    case "patch_hole":
      return engine.patchHole(args.defectId, args.method as "fitted_slab" | "mesh_fill");
    case "carve_opening":
      return engine.carveOpening(args.defectId);
    case "quarantine": {
      const a = args as unknown as { defectId?: string; defectIds?: string[]; reason: string };
      const ids = a.defectIds ?? (a.defectId ? [a.defectId] : []);
      if (ids.length === 0) return { error: "quarantine requires defectId or defectIds" };
      const actionIds = ids.map((id) => engine.quarantine(id, a.reason).actionId);
      return { defectIds: ids, actionIds, outcome: "quarantined" };
    }
    case "accept_defect": {
      const a = args as unknown as { defectId?: string; defectIds?: string[]; reason: string };
      const ids = a.defectIds ?? (a.defectId ? [a.defectId] : []);
      if (ids.length === 0) return { error: "accept_defect requires defectId or defectIds" };
      for (const id of ids) engine.markOutcome(id, "accepted", a.reason);
      return { defectIds: ids, outcome: "accepted" };
    }
    case "rebuild_navmesh_and_spawns":
      return engine.rebuildNavmeshAndSpawns();
    case "revert":
      return engine.revert(args.actionId);
    case "recertify": {
      const report = await engine.recertify(args.scope as "regional" | "full", args.defectId);
      return {
        scope: report.scope,
        grade: report.certificate.grade,
        resolvedDefectIds: report.resolvedDefectIds,
        newDefects: report.newDefects.map(summarizeDefect),
        verdictRegressions: report.verdictRegressions,
        openDefects: engine.openDefects().map((d) => d.id),
      };
    }
    default:
      return { error: `unknown tool '${name}' — the menu is closed` };
  }
}
