# Repair-loop tool API — the complete action space

Ten tools (the nine from the plan plus an explicit `accept_defect`, so the
"no action is the correct action" outcome is a recorded tool call rather than
implicit prose). This menu is closed: the agent has no other way to touch the
world. All ACT tools are deterministic, parameterized, and reversible via the
operation stack. Schemas live in `src/core/types.ts` (`RepairToolInputs`);
declare every tool with `strict: true`.

Trigger conditions are written INTO the descriptions below — on Fable/Sonnet-class
models, tool descriptions are where "when to call this" guidance actually
lands. Copy these descriptions into the tool definitions verbatim.

## READ

### `get_certificate` `{}`
> Returns the current certificate: structured defect list with evidence,
> measurements with uncertainty, trust summary, per-robot verdicts. Call this
> first in every session and after any recertify to see the updated state.

### `inspect_region` `{ defectId }`
> Rendered views (640px) plus splat-density-vs-collider statistics for one
> defect's region. Call when the defect's evidence alone doesn't determine the
> root cause — e.g. to judge whether a doorway is visually open or a floor
> region visually intact.

### `query_measurement` `{ name, region? }`
> Run one named measurement (doorway_width, doorway_height, step_height,
> floor_plane_height, divergence...) optionally scoped to a region. Call to
> get the DISCRIMINATING measurement during diagnosis — e.g. door heights in
> other rooms to separate global mis-scale from a genuinely narrow door.

## ACT (deterministic, reversible)

### `apply_vendor_scale` `{}`
> Apply the vendor's shipped metric_scale_factor and ground-plane metadata,
> bake the transform, floor to zero. Call when door-height priors AND vendor
> metadata agree the world is mis-scaled. One call can resolve every
> scale-dependent defect at once — always evaluate this hypothesis before
> patching individual clearance defects.

### `patch_hole` `{ defectId, method: "fitted_slab" | "mesh_fill" }`
> Close a collider hole. fitted_slab inserts an invisible plane/box fitted to
> the splat surface (fast, can overshoot into adjacent passages); mesh_fill
> runs offline watertight repair (slower, conforms better). Call for
> collider_hole defects. If a regional recertify after fitted_slab reports a
> NEW clearance failure nearby, revert and retry with mesh_fill.

### `carve_opening` `{ defectId }`
> Remove collider ONLY where visuals show an opening AND probe evidence
> supports passage. The rarest tool: call only when inspect_region confirms
> the opening is visually real and query_measurement confirms the collider is
> the intruder. Never call it to widen a genuinely narrow doorway.

### `quarantine` `{ defectId, reason }`
> Exclude the region from the navmesh and mark the certificate. Call for
> visual lies that cannot be repaired (painted-on door) so no training
> episode touches the lie, or after repair attempts are exhausted.

### `rebuild_navmesh_and_spawns` `{}`
> Regenerate the navmesh with per-robot parameters and re-derive verified
> spawn points. Call after any geometry-changing repair passes recertify, and
> before final export.

### `revert` `{ actionId }`
> Undo one prior ACT operation (operations live on a stack). Call when a
> regional recertify shows the repair failed or caused a new defect.

## VERIFY

### `recertify` `{ scope: "regional" | "full", defectId? }`
> Re-run the inspection. regional (seconds) re-surveys one defect's
> neighborhood — call after every ACT to verify it before it counts. full
> re-runs the whole pipeline — call once at session end for the before/after
> grade. A repair does not exist until recertify passes it.

## Contract invariants (enforced by the harness, stated for the agent)

- Every ACT returns `{ actionId }` for the stack.
- Every defect ends in exactly one outcome: fixed / quarantined / escalated /
  accepted. `recertify(full)` fails the session if any defect lacks one.
- Max 2 repair attempts per defect before forced quarantine/escalate.
- Escalation = recommend regeneration with an adjusted prompt (~$1.20/world);
  the live demo never waits out a generation.
