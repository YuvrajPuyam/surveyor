/**
 * humanize.ts — the human-language layer (docs/ui-redesign-spec.md §2).
 *
 * EVERY user-facing sentence in the app lives here so the copy is reviewable
 * in one place. Pure functions + string constants only — no DOM, no deps
 * besides the protocol types. Panels import from here; no panel builds
 * user-facing sentences inline anymore.
 *
 * Includes THE BUG FIX (§2.6): scaleAgreement() derives agree/disagree from
 * the actual numeric comparison (vendorFactor vs the independent estimate's
 * 2-SD band) instead of hardcoding "they agree".
 */
import type {
  CertificateSummary,
  DefectSummary,
  MeasurementLike,
  RepairStep,
  ScaleSummary,
  VerdictSummary,
} from "./protocol";

// -------------------------------------------------------------- formatting

/** Shared numeric formatter (same rounding ladder the panels always used). */
export function num(v: number): string {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toFixed(d);
}

function loc(n: number): string {
  return n.toLocaleString();
}

export function rangeOf(m: MeasurementLike): [number, number] | undefined {
  if (m.uncertainty) return [m.uncertainty.low, m.uncertainty.high];
  if (m.range && m.range.length >= 2) {
    const lo = m.range[0];
    const hi = m.range[1];
    if (lo !== undefined && hi !== undefined) return [lo, hi];
  }
  return undefined;
}

/** Human bracket format: "1.27 m (confident: 1.20–1.34)". */
export function fmtMeasurementHuman(m: MeasurementLike): string {
  const r = rangeOf(m);
  const base = `${num(m.value)} ${m.unit}`;
  return r ? `${base} (confident: ${num(r[0])}–${num(r[1])})` : base;
}

/** Dev/raw bracket format: "1.27 m  [1.20..1.34]" (today's format, verbatim). */
export function fmtMeasurementRaw(m: MeasurementLike): string {
  const r = rangeOf(m);
  const base = `${num(m.value)} ${m.unit}`;
  return r ? `${base}  [${num(r[0])}..${num(r[1])}]` : base;
}

// ------------------------------------------------------------------- trust

export interface TrustLike {
  verifiedPct: number;
  lyingPct: number;
  /** full-certificate trust summaries carry cell counts — render the denominator when we have it */
  counts?: { unknown: number; verified: number; observed: number; lying: number };
}

export interface TrustStory {
  tested: string;
  lying: string;
  untested: string;
  line: string;
  untestedPct: number;
}

export function trustSummary(trust: TrustLike): TrustStory {
  const tested = trust.verifiedPct;
  const lying = trust.lyingPct;
  const untested = Math.max(0, 100 - tested - lying);
  // explicit denominator: percentages are over SURVEYED cells — space outside
  // the capture envelope is counted in none of these
  const known = trust.counts ? trust.counts.verified + trust.counts.observed + trust.counts.lying : undefined;
  const denom = known !== undefined ? ` (of ${loc(known)} surveyed cells)` : "";
  return {
    tested: `We physically tested ${tested.toFixed(1)}% of the surveyed area${denom}.`,
    lying: `In ${lying.toFixed(1)}% of it, what you see is not what a robot would feel.`,
    untested: "The rest was seen but never physically tested. Anything outside the surveyed area makes no claim at all.",
    line: `Physically tested: ${tested.toFixed(1)}% · divergent: ${lying.toFixed(1)}% · untested: ${untested.toFixed(1)}%${denom}`,
    untestedPct: untested,
  };
}

/** Trust legend chip labels (Beat 2, bottom-left). */
export const TRUST_LEGEND = {
  verified: "tested & solid",
  observed: "seen, not tested",
  lying: "divergent",
} as const;

// ------------------------------------------------------------------- grade

const GRADE_STORY: Record<string, string> = {
  A: "Certified — a robot can trust what it sees here.",
  B: "Nearly certified — minor issues, none dangerous.",
  C: "Usable with care — some areas would mislead a robot.",
  D: "Not ready — a robot would get into trouble here.",
  F: "Unsafe for any robot — the visuals and the physics tell different stories.",
};

export function gradeStory(grade: string): string {
  return GRADE_STORY[grade] ?? "";
}

function isResolved(d: DefectSummary): boolean {
  return !!d.outcome && d.outcome !== "OPEN";
}

function severityCounts(defects: DefectSummary[]): { critical: number; major: number; minor: number } {
  const c = { critical: 0, major: 0, minor: 0 };
  for (const d of defects) {
    if (d.severity === "critical") c.critical += 1;
    else if (d.severity === "major") c.major += 1;
    else c.minor += 1;
  }
  return c;
}

/** Human translation of gradeRationale, computed from the defects themselves. */
export function rationaleStory(cert: CertificateSummary): string {
  const { critical, major, minor } = severityCounts(cert.defects);
  const total = cert.defects.length;
  const resolved = cert.defects.filter(isResolved).length;
  return (
    `${loc(critical)} places a robot would fall through or crash · ` +
    `${loc(major)} that would block or mislead it · ${loc(minor)} cosmetic. ` +
    `${loc(resolved)} of ${loc(total)} resolved so far.`
  );
}

export function severityPhrase(sev: string): string {
  if (sev === "critical") return "would drop or crash a robot";
  if (sev === "major") return "would block or mislead it";
  return "cosmetic";
}

// ----------------------------------------------------------------- defects

/** Human name per defect type, numbered per type in display order. */
export function defectDisplayName(d: DefectSummary, ordinal: number): string {
  switch (d.type) {
    case "collider_hole":
      return `Hole #${ordinal} in the floor`;
    case "phantom_collider":
      return `Invisible wall #${ordinal}`;
    case "visual_only_surface":
      return `Fake surface #${ordinal}`;
    case "scale_error":
      return "The whole world is the wrong size";
    case "raised_sill":
      return `Raised sill #${ordinal}`;
    case "clearance_violation":
      return `Tight squeeze #${ordinal}`;
    default:
      return `${d.type.replace(/_/g, " ")} #${ordinal}`;
  }
}

const METERS_RE = /([\d.]+)\s*m\b/;

/** One-line explainer keyed off d.type, re-rendered from the defect's own numbers. */
export function defectExplainer(d: DefectSummary): string {
  switch (d.type) {
    case "collider_hole":
      if (d.description && /capture boundary/i.test(d.description)) {
        return "The pixels keep going but the physics stops — this floor sits at the very edge of what the capture saw, and probes fell straight out of the world here.";
      }
      if (d.description && /raycast void/i.test(d.description)) {
        return "Our test rays passed straight through the floor here, and not one probe could land.";
      }
      return "The floor looks solid here, but physics says nothing is there — anything stepping on it falls through.";
    case "phantom_collider":
      return "Physics says something solid is here, but you can't see it — a robot would collide with thin air.";
    case "visual_only_surface":
      return "Looks solid, isn't — pure image with no physics behind it.";
    case "scale_error":
      return "Doors, steps and distances are all off by the same factor — every measurement is wrong until it's fixed.";
    case "raised_sill": {
      const h = d.description?.match(METERS_RE)?.[1];
      if (h) return `A ${h} m step. Whether that's passable depends on the robot — see the verdicts.`;
      return "A real step in a doorway — whether it's a problem depends on the robot.";
    }
    case "clearance_violation":
      return "A passage too narrow or low for some robots.";
    default:
      return d.description ?? "";
  }
}

export function confidencePhrase(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}% sure`;
}

export const CONFIDENCE_TOOLTIP = "detector confidence";

const OUTCOME_CHIPS: Record<string, { label: string; tooltip: string }> = {
  OPEN: { label: "needs attention", tooltip: "no outcome recorded yet" },
  fixed: { label: "fixed & re-tested", tooltip: "repaired, then verified by re-certification" },
  quarantined: {
    label: "roped off",
    tooltip: "excluded from the navigable area — no robot training will touch it",
  },
  accepted: { label: "OK as-is", tooltip: "a real feature, not an error — the verdict stands" },
  escalated: { label: "needs a human", tooltip: "outside what automated repair can safely do" },
};

export function outcomeChip(outcome: string | undefined): { label: string; tooltip: string } {
  const key = outcome && outcome !== "OPEN" ? outcome : "OPEN";
  return OUTCOME_CHIPS[key] ?? { label: key, tooltip: "" };
}

/** Collapsed-section summary line for the Defects section. */
export function defectsSummary(cert: CertificateSummary): string {
  const { critical, major, minor } = severityCounts(cert.defects);
  const total = cert.defects.length;
  const resolved = cert.defects.filter(isResolved).length;
  let s = `${loc(total)} problems — ${loc(critical)} would drop or crash a robot, ${loc(major)} would mislead it, ${loc(minor)} cosmetic`;
  if (resolved > 0) s += ` · ${loc(resolved)} resolved`;
  return s;
}

/** Ordinal of a defect among its own type, in certificate display order (1-based). */
export function defectOrdinal(cert: CertificateSummary, defectId: string): number | undefined {
  const target = cert.defects.find((x) => x.id === defectId);
  if (!target) return undefined;
  let n = 0;
  for (const d of cert.defects) {
    if (d.type !== target.type) continue;
    n += 1;
    if (d.id === defectId) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------- verdicts

// Keys are the REAL check ids the certificate emits (src/certify/verdicts.ts);
// the older spellings stay as aliases so stale summaries still humanize.
const CHECK_NAMES: Record<string, string> = {
  step_negotiation: "Can it climb the step?",
  passage_clearance_width: "Does it fit through the passage?",
  slope_capability: "Can it hold the slope?",
  floor_integrity: "Can it trust the floor?",
  braking_stopping_distance: "Can it stop in time?",
  step_negotiability: "Can it climb the step?",
  doorway_clearance: "Does it fit through the doorway?",
  slope_traversal: "Can it hold the slope?",
};

export function checkName(check: string): string {
  return CHECK_NAMES[check] ?? check.replace(/_/g, " ");
}

const CHECK_NOUN: Record<string, string> = {
  step_negotiation: "sill",
  passage_clearance_width: "passage",
  slope_capability: "slope",
  floor_integrity: "floor",
  braking_stopping_distance: "stopping distance",
  step_negotiability: "sill",
  doorway_clearance: "doorway",
  slope_traversal: "slope",
};

function robotOf(v: VerdictSummary): string {
  return v.robot ?? v.robotId ?? "one robot";
}

/** Collapsed-section summary line for the Robot verdicts section. */
export function verdictsSummary(cert: CertificateSummary): string {
  const groups = new Map<string, VerdictSummary[]>();
  for (const v of cert.robotVerdicts) {
    const list = groups.get(v.check);
    if (list) list.push(v);
    else groups.set(v.check, [v]);
  }
  const contrasts: Array<{ check: string; fail: VerdictSummary; pass: VerdictSummary }> = [];
  for (const [check, vs] of groups) {
    const fail = vs.find((v) => v.pass === false);
    const pass = vs.find((v) => v.pass === true);
    if (fail && pass) contrasts.push({ check, fail, pass });
  }
  if (contrasts.length > 0) {
    const c = contrasts[0];
    const noun = CHECK_NOUN[c.check] ?? c.check.replace(/_/g, " ");
    const m = c.fail.measured ?? c.pass.measured;
    const val = m ? `${num(m.value)} ${m.unit} ` : "";
    let s = `Same world, two answers: the ${val}${noun} stops the ${robotOf(c.fail)} but not the ${robotOf(c.pass)}.`;
    if (contrasts.length > 1) {
      const extra = contrasts.length - 1;
      s += ` · +${extra} more check${extra === 1 ? "" : "s"}`;
    }
    return s;
  }
  if (groups.size === 0) return "No robot checks were run.";
  // "All robots agree" would be misleading while metric verdicts are on hold:
  // an open size error suspends every meter-based check by design.
  let suspendedGroups = 0;
  for (const [, vs] of groups) {
    if (vs.some((v) => v.pass === "not_evaluated")) suspendedGroups += 1;
  }
  if (suspendedGroups > 0) {
    const openScale = cert.defects.some((d) => d.type === "scale_error" && !isResolved(d));
    return openScale
      ? `${suspendedGroups} of ${groups.size} checks on hold until the size error is fixed — measuring at the wrong scale would be meaningless.`
      : `${suspendedGroups} of ${groups.size} checks could not be evaluated on this world.`;
  }
  return `${groups.size} check${groups.size === 1 ? "" : "s"} · all robots agree.`;
}

/** "requires: <= 0.10 m" → "limit: 0.10 m". */
export function requirementLine(requirement: string): string {
  return `limit: ${requirement.replace(/^<=\s*/, "")}`;
}

/** Contrast tag — kept verbatim, it's the marquee. */
export const CONTRAST_TAG = "same world · two verdicts";

// ------------------------------------------------------------ measurements

const MEASUREMENT_NAMES: Record<string, string> = {
  floor_plane_height: "Floor height",
  doorway_width: "Doorway width",
  doorway_height: "Doorway height",
  step_height: "Tallest step",
  metric_scale_factor_estimate: "Our size estimate (from door heights)",
  vendor_metric_scale_factor: "Vendor's declared size factor",
};

export function measurementName(name: string): string {
  return MEASUREMENT_NAMES[name] ?? name.replace(/_/g, " ");
}

export function measurementsSummary(count: number): string {
  return `${loc(count)} measurements, each with its error bars and method.`;
}

export const MEASUREMENTS_SCALE_ONLY_SUMMARY = "The world's size factor and how we checked it.";

/** "uncertainty basis: …" → "how we know the error bars: …". */
export function basisLine(basis: string): string {
  return `how we know the error bars: ${basis}`;
}

// ------------------------------------------- scale agreement (THE BUG FIX)

export interface ScaleAgreement {
  /** undefined when the two values are not comparable (one is missing). */
  agrees: boolean | undefined;
  /** short card-title detail */
  headline: string;
  /** card body copy */
  body: string;
}

/**
 * Derive, never assert: agreement is recomputed from the numbers using the
 * same 2-SD window the certificate itself uses (estimated.uncertainty
 * [low..high]); fallback without a band is a ±10% relative check. We do NOT
 * parse the certificate's `agreement` sentence.
 */
export function scaleAgreement(scale: ScaleSummary | undefined): ScaleAgreement {
  const vf = scale?.vendorFactor;
  const est = scale?.estimated;
  if (vf === undefined) {
    return {
      agrees: undefined,
      headline: "no vendor size factor",
      body: "No vendor size correction was shipped with this world.",
    };
  }
  const vfs = `×${vf.toFixed(3)}`;
  if (!est) {
    return {
      agrees: undefined,
      headline: `vendor ${vfs} — never applied`,
      body: `The vendor shipped a size correction (${vfs}) that was never applied. We apply it, then re-measure the entire world to verify it.`,
    };
  }
  const band = rangeOf(est);
  const agrees = band
    ? vf >= band[0] && vf <= band[1]
    : est.value !== 0 && Math.abs(vf - est.value) / Math.abs(est.value) <= 0.1;
  const ests = `×${est.value.toFixed(2)}`;
  if (agrees) {
    return {
      agrees: true,
      headline: `vendor ${vfs} and our estimate ${ests} agree`,
      body: `The vendor says everything is ${vfs} too ${vf >= 1 ? "small" : "big"} — and our own independent estimate from door heights agrees (${ests}). One transform fixes every size-dependent problem at once.`,
    };
  }
  return {
    agrees: false,
    headline: `vendor ${vfs} vs our estimate ${ests} — they disagree`,
    body: `The vendor says ${vfs}; our independent door-height estimate says ${ests} — they disagree. We apply the vendor's factor anyway, then immediately re-measure the entire world: if the vendor is wrong, the re-survey will catch it.`,
  };
}

/** "vendor factor: 1.615 · applied: NO" → "Vendor's size factor: ×1.615 — not yet applied". */
export function scaleVendorLine(scale: ScaleSummary | undefined): string {
  if (!scale || scale.vendorFactor === undefined) return "Vendor's size factor: n/a";
  return `Vendor's size factor: ×${num(scale.vendorFactor)} — ${scale.vendorFactorApplied ? "applied" : "not yet applied"}`;
}

// -------------------------------------------------------- repair plan cards

/** Human title + body for a repair step card (§2.7). */
export function repairCardCopy(
  step: RepairStep,
  cert?: CertificateSummary,
): { title: string; body: string } {
  switch (step.kind) {
    case "apply_vendor_scale": {
      const vf = cert?.scale?.vendorFactor;
      return {
        title: `Fix the world's size${vf !== undefined ? ` (×${vf.toFixed(3)})` : ""}`,
        body: scaleAgreement(cert?.scale).body,
      };
    }
    case "patch_hole": {
      const id = step.defectIds[0];
      const ord = cert && id ? defectOrdinal(cert, id) : undefined;
      return {
        title: `Patch Hole${ord !== undefined ? ` #${ord}` : ""}`,
        body: "Fill the missing floor with a fitted slab, then re-test the area to prove the patch is honest.",
      };
    }
    case "quarantine": {
      const n = step.defectIds.length;
      return {
        title: `Rope off ${loc(n)} ghost surface${n === 1 ? "" : "s"}`,
        body: "These can't be honestly repaired — so we exclude them. No robot will ever be trained on geometry that isn't really there.",
      };
    }
    case "accept_defect": {
      const n = step.defectIds.length;
      const title = `Leave ${loc(n)} sill${n === 1 ? " as it is" : "s as they are"}`;
      // Derive the who-can-cross sentence from the certificate's own step
      // verdicts — never assert a split the verdicts don't show.
      const stepVerdicts = (cert?.robotVerdicts ?? []).filter(
        (v) => v.check === "step_negotiation" || v.check === "step_negotiability",
      );
      const fails = stepVerdicts.filter((v) => v.pass === false).map(robotOf);
      const passes = stepVerdicts.filter((v) => v.pass === true).map(robotOf);
      let body: string;
      if (fails.length > 0 && passes.length > 0) {
        body = `They're really there. The ${fails.join(" and ")} can't cross them; the ${passes.join(" and ")} can. That's a fact about the robots, not an error to fix.`;
      } else if (fails.length > 0) {
        body = "They're really there, and the verdicts say none of this fleet can cross them. Real terrain, honestly recorded — route around, don't erase.";
      } else if (passes.length > 0) {
        body = "They're really there, and every robot in this fleet clears them — recorded as terrain, not as defects.";
      } else {
        body = "They're really there. Whether a robot can cross them is answered by the per-robot verdicts, not by hiding the step.";
      }
      return { title, body };
    }
    default:
      return { title: step.label, body: step.detail };
  }
}

const STATUS_LABELS: Record<string, string> = {
  pending: "waiting",
  running: "working…",
  done: "done ✓",
  caught: "failed inspection",
  failed: "error",
  reverted: "undone",
};

export function statusChipLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Button labels (§2.7). */
export const BTN = {
  run: "Run",
  undo: "Undo",
  runAll: "Run the plan",
  export: "Export certificate (JSON)",
  rawRun: "Raw run (R)",
} as const;

// ----------------------------------------------------------- fail-and-adapt

export interface CaughtBannerCopy {
  title: string;
  lines: string[];
  footnote: string;
}

function defectNoun(d: DefectSummary): string {
  switch (d.type) {
    case "collider_hole":
      return "a hole in the floor";
    case "phantom_collider":
      return "an invisible wall";
    case "visual_only_surface":
      return "a ghost surface";
    case "scale_error":
      return "a size error";
    case "clearance_violation":
      return "a tight squeeze";
    default:
      return d.type.replace(/_/g, " ");
  }
}

function defectNounPlural(d: DefectSummary, n: number): string {
  switch (d.type) {
    case "collider_hole":
      return `${n} holes in the floor`;
    case "phantom_collider":
      return `${n} invisible walls`;
    case "visual_only_surface":
      return `${n} ghost surfaces`;
    case "scale_error":
      return `${n} size errors`;
    case "clearance_violation":
      return `${n} tight squeezes`;
    default:
      return `${n} ${d.type.replace(/_/g, " ")}s`;
  }
}

export function caughtBanner(newDefects: DefectSummary[]): CaughtBannerCopy {
  // one line per defect *kind*, counted — three identical holes must read as
  // "3 holes", never as the same sentence stacked three times
  const groups = new Map<string, DefectSummary[]>();
  for (const d of newDefects) {
    const key =
      d.type === "raised_sill"
        ? `raised_sill:${d.description?.match(METERS_RE)?.[1] ?? ""}`
        : d.type;
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }
  const lines = [...groups.values()].map((g) => {
    const d = g[0];
    if (d.type === "raised_sill") {
      const h = d.description?.match(METERS_RE)?.[1];
      const step = h ? `a ${h} m step` : "a raised step";
      return g.length > 1
        ? `The patch created ${g.length} new problems: ${step} where each slab meets the floor.`
        : `The patch created a new problem: ${step} where the slab meets the floor.`;
    }
    return g.length > 1
      ? `The repair created new problems: ${defectNounPlural(d, g.length)}.`
      : `The repair created a new problem: ${defectNoun(d)}.`;
  });
  return {
    title: "Our own repair just failed inspection",
    lines,
    footnote: "The inspector doesn't trust anyone — including us.",
  };
}

/** Timed sub-row copy for the fail-and-adapt card drama (§2.8). */
export const SUBROW = {
  reverting: "Undoing the patch…",
  retrying: "Trying a different method: a fill that follows the terrain…",
  retryHolds: "Second method holds — verified by re-inspection. ✓",
  bothFailed: "Two repair methods failed inspection — roping the area off instead. Honest beats invisible.",
  quarantined: "Area roped off. No robot will ever be trained on it. ✓",
} as const;

// ---------------------------------------------------------- phases and logs

/** Narrator line per survey phase (Beat 2). Empty string = hide the narrator. */
export function phaseLine(phase: string, probeCount = 2000): string {
  switch (phase) {
    case "fetching-collider":
      return "Loading the physics shell…";
    case "parsing-collider":
      return "Reading the physics shell…";
    case "fetching-visual-points":
      return "Loading the visuals…";
    case "physics-init":
      return "Warming up the physics engine…";
    case "certifying":
      return `Dropping ${loc(probeCount)} physics probes across the world — watching where reality and appearance disagree…`;
    case "recertifying":
      return "Re-testing the repaired areas…";
    default:
      return "";
  }
}

interface LogRule {
  re: RegExp;
  human: (m: RegExpMatchArray) => string;
}

const LOG_RULES: LogRule[] = [
  {
    re: /^survey starting: .*\(seed \d+, (\d+) probes\)/,
    human: (m) => `Survey starting — ${loc(Number(m[1]))} probes, repeatable run.`,
  },
  {
    re: /^survey complete — grade (\S+), (\d+) defect\(s\)/,
    human: (m) => `Survey complete — grade ${m[1]}, ${loc(Number(m[2]))} problems found.`,
  },
  {
    re: /^vendor scale ×([\d.]+) applied/,
    human: (m) => `Size corrected ×${m[1]} — re-measuring the entire world.`,
  },
  {
    re: /^doorway_width re-measured: ([\d.]+) m → ([\d.]+) m/,
    human: (m) => `Doorway re-measured: ${m[1]} m → ${m[2]} m — now door-sized.`,
  },
  {
    re: /^recertify \(regional\):.*resolved /,
    human: () => "Re-inspected the area — this problem is confirmed fixed.",
  },
  {
    re: /^recertify \(full\) at corrected scale:.*?(\d+) finding\(s\) re-measured/,
    human: (m) => `Re-measured at the true scale: ${loc(Number(m[1]))} problems were symptoms of the size error.`,
  },
  {
    re: /^plan rebuilt from the re-measured certificate/,
    human: () => "Plan updated to match the re-measured world.",
  },
  {
    re: /^quarantined (\d+) region\(s\)/,
    human: (m) => `${loc(Number(m[1]))} area${Number(m[1]) === 1 ? "" : "s"} roped off — no robot will ever be trained on them.`,
  },
  {
    re: /^accepted (\d+) (?:defect|robot-relative finding)\(s\)/,
    human: (m) => `${loc(Number(m[1]))} sill${Number(m[1]) === 1 ? "" : "s"} accepted as real features — the per-robot verdicts stand.`,
  },
  {
    re: /^all defects have outcomes/,
    human: () => "Every problem resolved — grading the repaired world from scratch.",
  },
  {
    re: /^final grade: (\S+)/,
    human: (m) => `Final grade: ${m[1]}.`,
  },
  {
    re: /^navmesh \+ spawns rebuilt: (\d+) verified spawn points/,
    human: (m) => `Found ${loc(Number(m[1]))} spots we physically verified are safe to stand on.`,
  },
  {
    re: /^rover patrol started/,
    human: () => "Rover on patrol — over the patches, around the roped-off areas.",
  },
  {
    re: /^rover delivery started/,
    human: () => "Delivery run started — verified spawn to the depot, around the roped-off areas.",
  },
  {
    re: /^delivery complete/,
    human: () => "Delivery complete — the certified route held, end to end.",
  },
  {
    re: /^revert \S+ \(stack discipline/,
    human: () => "Undoing — later changes are undone with it.",
  },
  {
    re: /^reverting action /,
    human: () => SUBROW.reverting,
  },
  {
    re: /^reverting failed retry /,
    human: () => SUBROW.reverting,
  },
  {
    re: /^retrying with mesh_fill/,
    human: () => SUBROW.retrying,
  },
  {
    re: /^mesh_fill holds/,
    human: () => SUBROW.retryHolds,
  },
  {
    re: /^mesh_fill did not pass recertify either/,
    human: () => SUBROW.bothFailed,
  },
  {
    re: /^region quarantined — no training episode/,
    human: () => SUBROW.quarantined,
  },
  {
    re: /^CERTIFIER CAUGHT THE REPAIR/,
    human: () => "Our own repair just failed inspection.",
  },
];

/**
 * Best-effort translation of a driver/main log line. Returns undefined when
 * the line has no mapping — the caller shows the raw line as-is.
 */
export function humanizeLogLine(raw: string): string | undefined {
  for (const rule of LOG_RULES) {
    const m = raw.match(rule.re);
    if (m) return rule.human(m);
  }
  return undefined;
}

// -------------------------------------------------- stepper / beat copy

export const BEAT_LABELS = ["Meet", "Survey", "Certificate", "Repair", "Certified"] as const;

/** Space-hint lines (the presenter's cue card). */
export const HINT = {
  revealPhysics: "Space — reveal the physics",
  startSurvey: "Space — start the survey",
  seeCertificate: "Space — see the certificate",
  proposeRepairs: "Space — propose repairs",
  runPlan: "Space — run the repair plan",
  seeVerdict: "Space — see the verdict",
  patrol: "Space — start / stop the rover",
  /** Twin run (C6). */
  rawRun: "R — raw twin run",
  delivery: "Space — run the delivery",
} as const;

/** Narrator lines. */
export const NARRATE = {
  surveyDone: "Survey complete. The world has been graded.",
  stillSurveying: "Still surveying — one moment.",
  finishRepairsFirst: "Run the repair plan to the end first.",
  resolving: "All problems resolved. Re-certifying the whole world…",
  recertified: "Re-certified.",
  patrol:
    "Rover on patrol — driving over the patches we fixed, steering around the areas we roped off.",
  patrolStopped: "Rover parked.",
  surveyFailed: "The survey hit an error — press D for details.",
  // ---- twin run (C6): raw-world failure + certified delivery ----
  rawRun: "Raw world, before repairs — same rover, the physics a robot would train on. Watch the floor.",
  rawRunFell:
    "It fell through a floor that looks solid — ghost geometry. A training run would never tell you why.",
  rawRunCrossed:
    "The rover crossed — its track straddled the confirmed gap this time. The survey's probe falls stand.",
  rawRunTimeout: "The rover never reached the flagged floor — run it again, or move the camera and watch.",
  rawRunUnavailable:
    "The raw world is gone — repairs are baked into the physics now. Reload to run the raw twin again.",
  rawRunProbing:
    "Choosing the failure route — dry-running candidates in the raw physics until one fails…",
  rawRunGhost:
    "Straight through a shelf that looks solid — there is no physics behind it. Ghost geometry: a robot would learn an affordance that does not exist.",
  rawRunStuck:
    "Nose-down in a pit the pixels call floor — beached. Every training episode through here would end exactly like this, and nothing would say why.",
  rawRunNoRoute:
    "No confirmed floor hole with a clear approach in this certificate — nothing to drive into.",
  rawRunVisionFell:
    "The cameras said floor. The collider said nothing. A vision policy trained here learns this exact crossing — and finds out on hardware.",
  delivery:
    "Certified delivery — verified spawn to depot, over the patched floor, around the roped-off areas.",
  deliveryArrived:
    "Delivery complete — every meter of that route was physically verified before a wheel turned.",
} as const;

/** Beat-1 intro card copy (html allowed for the <em> emphasis). */
export const INTRO = {
  line1Html: "This world was generated by AI. It looks real. Let's find out if it <em>is</em>.",
  btn1: "Reveal the physics",
  line2Html:
    "Teal mesh = what a robot actually feels. Everywhere it disagrees with what you see, that's ghost geometry.",
  btn2: "Start the survey →",
} as const;

/** Certificate panel section titles + fine-print copy. */
export const SECTION = {
  trust: "TRUST",
  verdicts: "ROBOT VERDICTS",
  defects: "DEFECTS",
  measurements: "MEASUREMENTS",
  finePrint: "FINE PRINT",
  finePrintSummary: "What this certificate does and does not promise.",
} as const;

/** Beat-5 disclosure one-liner (verbatim from the demo doc). */
export const MODEL_CLASS_DISCLOSURE =
  "Grade predicts navmesh-level traversability under the disclosed model class — not policy transfer.";

/** Beat-5 before/after card numbers, computed live — never hardcoded. */
export function beforeAfterSummary(
  cert: CertificateSummary,
  firstSurveyCount?: number,
): { found: string; breakdown: string } {
  const total = cert.defects.length;
  let fixed = 0;
  let quarantined = 0;
  let accepted = 0;
  let escalated = 0;
  for (const d of cert.defects) {
    if (d.outcome === "fixed") fixed += 1;
    else if (d.outcome === "quarantined") quarantined += 1;
    else if (d.outcome === "accepted") accepted += 1;
    else if (d.outcome === "escalated") escalated += 1;
  }
  const resolved = fixed + quarantined + accepted + escalated;
  const parts: string[] = [];
  if (fixed > 0) parts.push(`${loc(fixed)} fixed & re-tested`);
  if (quarantined > 0) parts.push(`${loc(quarantined)} roped off`);
  if (accepted > 0) parts.push(`${loc(accepted)} accepted as real`);
  if (escalated > 0) parts.push(`${loc(escalated)} escalated to a human`);
  // the total can exceed the first survey's count: fixing the size error
  // re-measures the world at the true scale, which surfaces more findings —
  // say so, or the jump reads as an inconsistency
  const grew = firstSurveyCount !== undefined && total > firstSurveyCount;
  const found = grew
    ? `${loc(firstSurveyCount)} problems at first survey — ${loc(total)} once re-measured at the true size · ${loc(resolved)} resolved`
    : `${loc(total)} problems found · ${loc(resolved)} resolved`;
  return {
    found,
    breakdown: parts.length > 0 ? `(${parts.join(", ")})` : "",
  };
}

/**
 * C12 vision-driven twin run: the planner's own crossing evidence, spoken at
 * run start. `seen`/`total` are sight-line samples across the flagged gap
 * that landed on visual (splat) surface.
 */
export function rawRunVisionPlan(seen: number, total: number): string {
  return (
    `This run is planned on what the cameras see: ${seen} of ${total} sight-lines across the flagged gap land on visual floor. ` +
    `The physics runs the shipped collider — which has nothing there. Same rover, two realities. Watch.`
  );
}

/** "Show the work" expander label (raw live log). */
export const SHOW_THE_WORK = "Show the work";

// ===================================================== MISSION LOG (C7)
// Beat-4 cassette replay panel. Every user-facing string of missionLog.ts
// lives here. The reasoning lines themselves are NOT here — they are the
// agent's own recorded words, rendered verbatim from the cassette.

export const MISSION_LOG = {
  title: "MISSION LOG",
  subtitle: "recorded episode replay",
  /** Honesty chip — always visible in the header. */
  replayChip: "RECORDED REPLAY",
  replayTooltip:
    "A real repair session, recorded to a cassette file and replayed here byte-for-byte — same words, same tool calls, same results, every run. Nothing in this panel is generated live.",
  loading: "loading cassette…",
  empty: "no cassette loaded",
  done: "episode complete — every defect ended in a recorded outcome",
  agentTag: "agent",
  toolGlyph: "▸",
  btnPause: "Pause",
  btnResume: "Resume",
  btnReplay: "Replay",
  /** Chip states for a tool row (running until its recorded result lands). */
  state: {
    running: "running…",
    done: "done ✓",
    failed: "failed ✗",
    /** recertify came back with new findings — the certifier caught the repair */
    flagged: "recheck: new findings",
  },
} as const;

// ---- tiny safe accessors (cassette args/results are unknown-typed) --------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function numOf(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Compact human line for a recorded tool call, e.g.
 *   "patch_hole fitted_slab d-hole-3" · "recertify regional d-hole-3" ·
 *   "quarantine d-phantom-15" · "revert a-2" · "apply_vendor_scale".
 * Falls back to the tool name — the replay renders tools it has never met.
 */
export function missionToolLine(name: string, args: unknown): string {
  const a = asRecord(args) ?? {};
  const defect = str(a["defectId"]);
  switch (name) {
    case "patch_hole":
      return ["patch_hole", str(a["method"]), defect].filter(Boolean).join(" ");
    case "recertify":
      return ["recertify", str(a["scope"]), defect].filter(Boolean).join(" ");
    case "quarantine":
      return ["quarantine", defect].filter(Boolean).join(" ");
    case "accept_defect":
      return ["accept_defect", defect].filter(Boolean).join(" ");
    case "inspect_region":
      return ["inspect_region", defect].filter(Boolean).join(" ");
    case "revert":
      return ["revert", str(a["actionId"])].filter(Boolean).join(" ");
    case "query_measurement":
      return ["query_measurement", str(a["name"])].filter(Boolean).join(" ");
    case "carve_opening":
      return ["carve_opening", defect].filter(Boolean).join(" ");
    default:
      return name;
  }
}

/**
 * One dim settle-line under a tool row once its recorded result lands.
 * undefined = nothing worth saying beyond the state chip.
 */
export function missionResultNote(name: string, result: unknown): string | undefined {
  const r = asRecord(result);
  if (!r) return undefined;
  const err = str(r["error"]);
  if (err) return err;
  switch (name) {
    case "get_certificate": {
      const grade = str(r["grade"]);
      const defects = Array.isArray(r["defects"]) ? r["defects"].length : undefined;
      if (grade === undefined) return undefined;
      return `grade ${grade}${defects !== undefined ? ` · ${defects} defect${defects === 1 ? "" : "s"}` : ""}`;
    }
    case "apply_vendor_scale": {
      const f = numOf(r["factorApplied"]);
      return f !== undefined ? `×${f.toFixed(3)} applied — the whole world re-measured` : undefined;
    }
    case "recertify": {
      const grade = str(r["grade"]);
      const resolved = Array.isArray(r["resolvedDefectIds"]) ? r["resolvedDefectIds"].length : 0;
      const fresh = Array.isArray(r["newDefects"]) ? r["newDefects"].length : 0;
      const open = Array.isArray(r["openDefects"]) ? r["openDefects"].length : undefined;
      const bits = [`grade ${grade ?? "?"}`];
      if (resolved > 0) bits.push(`${resolved} resolved`);
      if (fresh > 0) bits.push(`${fresh} new finding${fresh === 1 ? "" : "s"}`);
      if (open !== undefined) bits.push(`${open} open`);
      return bits.join(" · ");
    }
    case "patch_hole": {
      const y = numOf(r["slabTopY"]);
      return y !== undefined ? `patched — slab top at y ${y.toFixed(3)} m` : undefined;
    }
    case "revert": {
      const id = str(r["reverted"]);
      return id ? `undone (${id}) — later actions undone with it` : undefined;
    }
    case "rebuild_navmesh_and_spawns": {
      const spawns = Array.isArray(r["spawns"]) ? r["spawns"].length : undefined;
      return spawns !== undefined ? `${spawns} verified spawn point${spawns === 1 ? "" : "s"}` : undefined;
    }
    case "quarantine":
      return "roped off — no training episode touches the divergent region";
    case "accept_defect":
      return "accepted as a real feature — the per-robot verdict stands";
    default:
      return undefined;
  }
}

/** Did this recertify result flag new findings? (the certifier-audits moment) */
export function missionResultFlagged(name: string, result: unknown): boolean {
  if (name !== "recertify") return false;
  const r = asRecord(result);
  return !!r && Array.isArray(r["newDefects"]) && r["newDefects"].length > 0;
}

/** Recorded result carries an error → the tool call failed on tape. */
export function missionResultFailed(result: unknown): boolean {
  const r = asRecord(result);
  return !!r && typeof r["error"] === "string";
}

/**
 * The agent's own recorded justification (quarantine/accept_defect `reason`
 * args) — rendered verbatim as a quote line under the tool row. This is
 * agent prose from the episode, not app copy.
 */
export function missionReasonQuote(args: unknown): string | undefined {
  const a = asRecord(args);
  return a ? str(a["reason"]) : undefined;
}
