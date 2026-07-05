export const meta = {
  name: 'outdoor-calibration-diagnosis',
  description: 'Diagnose why outdoor Marble worlds get ~0% verified cells and hundreds of spurious majors',
  phases: [
    { title: 'Diagnose', detail: 'three parallel forensic agents with instrumented runs' },
  ],
}

const REPORT_SCHEMA = {
  type: 'object',
  required: ['findings', 'topHypothesis', 'keyNumbers', 'recommendations'],
  properties: {
    findings: { type: 'string', description: 'What the instrumented run actually showed, with concrete numbers' },
    topHypothesis: { type: 'string', description: 'Single best-supported root cause, stated falsifiably' },
    keyNumbers: { type: 'array', items: { type: 'string' }, description: 'The load-bearing statistics, one per entry' },
    recommendations: { type: 'array', items: { type: 'string' }, description: 'Specific code changes in src/certify, ranked' },
  },
  additionalProperties: false,
}

const COMMON = `
CONTEXT — repo D:\\worlds-in-action, a physics certifier for AI-generated 3D worlds
(Marble gaussian-splat visuals + a separate collider mesh). The instrument was built
and validated on INDOOR worlds (rooms, corridors) and works there: 27-world bench,
recall 96.8% / precision 100% on planted defects. On OUTDOOR rolling-terrain worlds
it misfires badly. Your job is forensic diagnosis with an instrumented run — produce
NUMBERS, not speculation. Do not modify any file in src/, scripts/, app/, or test/.
Write your scratch scripts to C:\\Users\\yuvra\\AppData\\Local\\Temp\\claude\\D--worlds-in-action\\9a1e9e8a-465a-4627-9948-6577fec014c6\\scratchpad\\
and run them with:  npx tsx <script.ts>   (cwd D:\\worlds-in-action; imports work as
"./src/certify/survey.js" style relative-to-repo paths, or copy how scripts/certify.ts does it).

THE TWO SICK WORLDS (real Marble outdoor worlds, bundles on disk):
- moon-base  D:\\worlds-in-action\\assets\\marble\\f1f4e6b3-855d-4a73-b36c-2e082a508b50
  certificate.json in the same dir says: probesDropped 731, probesRested 141,
  probesFellThrough 590 (81%!), tunnelingArtifactsExcluded 91, trust 0.24% verified /
  65.2% lying, 1053 defects of which 979 are phantom_collider majors, 55 collider_hole.
- canyon     D:\\worlds-in-action\\assets\\marble\\90c2b55d-5012-4ff2-82e0-a216c5ffb5c0
  certificate.json: probesDropped 409, probesRested 6, probesFellThrough 403 (98.5%!),
  trust 0.02% verified / 29.4% lying, 128 defects (66 phantom, 20 visual_only, 38 sills).
For contrast, a HEALTHY indoor world: assets\\marble\\7188e250-e2ff-43e7-babb-73834c22e932
(habitat — 18% verified after repair story, sane defect counts).

KEY CODE (read these first):
- src/certify/survey.ts — probe spawning (dropHeightAt: standable columns get
  surface+headroom-capped rise; "floor-claiming voids" get floorEst+1.2), reachability
  + claimZone flood fill, visualBand/visualTotal smoothing (±0.25 m), two-pass
  divergence with self-calibrated noise floor (p99 × 1.5 of splat-to-collider distance
  on probe-VERIFIED cells; falls back to a default when too few verified samples),
  fall-through exit cross-check (castDown at the probe exit point).
- src/certify/trustmap.ts — cell is "verified" only via probe contact; "lying" gate
  fall[i]>0 || vnp[i]>=lieThreshold || pnv[i]>=3.
- src/certify/defects.ts — phantom_collider: pnv>=3 cells clustered, >=8 samples;
  lieThreshold = max(3, 0.2 × median splat density on probe-contacted cells).
- src/ingest/bundleIO.ts — loadWorldBundle(dir) → { worldId, collider, visualPoints, metadata }.
- src/certify/certificate.ts — certifyWorld(world, opts) end-to-end.
- scripts/probe-experiment.ts — example of a diagnostic script layout.
Rapier notes: headless via src/core physics wrapper (see how survey.ts builds it);
castDown exists on the physics world wrapper; world must step() once after adding
the trimesh before raycasts return hits; RayColliderHit uses .timeOfImpact.

Return your report via the structured output schema. Be exhaustive in the run but
selective in the report — lead with the numbers that discriminate between hypotheses.`

phase('Diagnose')
const [probes, phantoms, verify] = await parallel([
  () => agent(`${COMMON}

YOUR DIMENSION — PROBE FALL-THROUGH FORENSICS (the 81% / 98.5% fall-through rates).
A "fall-through" is a probe that exits the world downward AND whose exit-point
downward raycast also finds nothing (else it is excluded as tunneling). On a world
that is mostly solid terrain, 590/731 fall-throughs means probes are being DROPPED
WRONG, not that the terrain is missing.

Instrument the survey on BOTH sick worlds (load bundle, run the real survey code or
replicate its spawn logic exactly by importing it) and classify every fall-through
drop point (x, dropY, z) into:
  (a) NO COLLIDER ANYWHERE in the column: castDown from collider-AABB max.y + 5 at
      that XZ hits nothing — probe was dropped outside the terrain footprint.
      For these, also record the local splat density (visual points within the cell)
      to test "dropped over background sky-shell splats".
  (b) COLLIDER EXISTS BELOW THE AABB-TOP RAY but the probe still escaped — dropY was
      UNDER the terrain surface (dropHeightAt picked a start below ground) or the
      probe rolled off an edge before settling. Distinguish: dropY < terrain surface
      height at that XZ → under-terrain spawn; dropY > surface → rolled/escaped.
  (c) genuine hole (castDown from above also passes through near the exit).
Report the (a)/(b)/(c) split per world, the dropY-minus-surfaceY distribution for (b),
and where category-(a) drop points sit relative to the splat-density envelope
(distance from the 2D density peak, local density vs world median).
Also answer: which branch of dropHeightAt produced each category — standable column
vs "floor-claiming void" (instrument or re-derive the branch per drop point).`,
    { label: 'diag:fall-through', phase: 'Diagnose', schema: REPORT_SCHEMA, effort: 'high' }),

  () => agent(`${COMMON}

YOUR DIMENSION — PHANTOM COLLIDER FORENSICS (979 spurious majors on the moon world).
phantom_collider means collider-surface samples with no visual support within 0.2 m
(pnv channel >= 3, clustered, >= 8 samples). Hypothesis to test: these regions are
OUTSIDE THE SPLAT CAPTURE ENVELOPE — the collider terrain extends farther than the
usable splat coverage, so "no visual support" means "no visuals out here", not
"invisible wall".

Load the moon certificate.json + bundle. For EVERY phantom_collider defect region
(or a systematic sample >= 200 if runtime forces it), compute:
  - local splat density inside the region (visual points per m² and per grid cell)
    vs the world median density on probe-contacted cells;
  - distance from region centroid to the 2D splat-density peak (the capture origin
    proxy — compute the peak the same way app/src/main.ts does: 1 m XZ cells, densest
    y-band) and to the splat-mass centroid;
  - the actual splat-to-collider distance distribution in the region: are the nearest
    splats at 0.25-0.5 m (near-miss fuzz, threshold problem) or is there genuinely
    NOTHING within meters (envelope problem)?
  - whether the region is inside the reachability/claim zone the survey computed.
Then split the 979 into: envelope-outside vs near-miss-fuzz vs plausibly-real, with
counts. Do the same for the canyon's 66 phantoms as a cross-check. Answer crisply:
what single gate would have killed what fraction of the 979 without touching the
indoor bench's true positives (e.g. "require local visual density >= 20% of median
before a pnv cell may count toward phantom evidence" — test YOUR proposed gate's
kill-rate on the moon data and state it).`,
    { label: 'diag:phantoms', phase: 'Diagnose', schema: REPORT_SCHEMA, effort: 'high' }),

  () => agent(`${COMMON}

YOUR DIMENSION — VERIFIED-CELL STARVATION + NOISE-FLOOR CASCADE.
On the moon world 141 probes rested yet only 60 cells (of ~93k, 0.24%) are verified,
and lyingPct is 65%. The noise floor for the divergence gate self-calibrates on
probe-verified cells — starve those and the gate misbehaves. Instrument the moon
survey (and canyon as cross-check):
  - Where did the 141 rested probes come to rest? Clustered in one flat spot or
    spread? How many DISTINCT grid cells got probeContact > 0, and why does that
    number collapse to 60 verified (what exactly is the verified criterion in
    trustmap.ts / survey.ts — rest vs contact vs something stricter)?
  - What noiseFloorM did the run actually use — self-calibrated or the default
    (check survey.divergence.noiseFloorCalibrated + noiseFloorM; the moon
    certificate methods lines record it)? Recompute what the noise floor WOULD be
    if calibrated on (i) all probe-CONTACT cells rather than rested-only, and
    (ii) a slope-tolerant rest criterion (see below). How does lyingPct change under
    each recomputed threshold (re-run the divergence pass with the new floor)?
  - Slope-tolerant verification: on rolling terrain a ball probe never sleeps — it
    keeps rolling. Count probes that maintained CONTACT with the collider for >= 30
    consecutive steps (0.5 s) while moving: under a "sustained-contact = surface
    confirmed along its path" rule, how many additional cells become verified?
    (If per-step contact history isn't recorded, instrument the probe loop in a
    scratch copy of the relevant survey internals, or re-run with a probe-tracking
    hook — do what it takes to get the number.)
Answer crisply: the causal chain from rest-criterion to 985 spurious majors, with
the counterfactual numbers at each link.`,
    { label: 'diag:verification', phase: 'Diagnose', schema: REPORT_SCHEMA, effort: 'high' }),
])

return {
  fallThrough: probes,
  phantoms: phantoms,
  verification: verify,
}