/**
 * twinRun.ts — C6 twin-run choreography (docs/ENDGAME.md §2 "Twin run", §3
 * the 0:25 beat).
 *
 * RAW RUN (Beats 1–3): the same rover as the Beat-5 delivery, driven on the
 * RAW world's physics. The route is derived FROM THE CERTIFICATE — the most
 * probe-confirmed collider_hole defect with a clear, raycast-verified
 * approach runway — never hardcoded. The physics executes inside the probe
 * worker (physicsWorker.ts), which holds the collider exactly as shipped:
 * a fresh Rapier world per run + fixed 1/60 s steps + pure-function steering
 * make the failure deterministic — same route, same fall, same step count,
 * every run.
 *
 * This module owns: route derivation (raycasts against the collider
 * wireframe), the rover visual + route line + fall marker, camera framing
 * with a user-yielding follow (grab the orbit controls and the camera is
 * yours), the run state machine, and the trigger button. Copy lives in
 * ui/humanize.ts; physics lives in physicsWorker.ts.
 *
 * DELIVERY FOLLOW (Beat 5): the same camera choreography, pointed at the
 * patrol/delivery rover — framing on start, soft target-follow, canceled the
 * moment the user touches the controls.
 */
import * as THREE from "three";
import type { MainToWorker, RoverDoneMsg, RoverFrameMsg, RoverOutcome, RoverProbeResultMsg } from "./protocol";
import { ROVER_HALF_EXTENTS } from "./protocol";
import { buildRoverMesh } from "./patrol";
import { BTN, NARRATE, rawRunVisionPlan } from "./ui/humanize";
import { visionConfirmed, type VisualGround } from "./visualGround";

// ------------------------------------------------------------------- types

/** Tolerant certificate shape: both the static bundle certificate.json and
 * the live worker summary satisfy it. */
export interface TwinDefectLike {
  id: string;
  type: string;
  severity: string;
  region?: { min: number[]; max: number[] };
  description?: string;
  evidence?: Array<{ kind?: string; detail?: string }>;
  outcome?: string;
}

export interface TwinCertLike {
  defects?: TwinDefectLike[];
}

export interface TwinRunDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: {
    target: THREE.Vector3;
    addEventListener(type: string, listener: () => void): void;
  };
  /** The collider wireframe mesh (raycast target). Undefined until loaded. */
  getCollider(): THREE.Object3D | undefined;
  /** C12: the visual-floor heightfield (splat centers). The raw-run planner
   *  justifies its crossing with THIS surface; physics holds the collider. */
  getVisualGround?(): VisualGround | undefined;
  /** Standing narrator line (persists until replaced). */
  narrate(text: string): void;
  /** 1.5 s narrator flash (refusals, hints). */
  flash(text: string): void;
  /** Optional status sink (the dev HUD). */
  setStatus?(text: string): void;
}

export interface TwinRunResult {
  outcome: RoverOutcome;
  /** Fixed 1/60 s steps from run start to the outcome. */
  step: number;
  /** Seconds of simulated time (step / 60). */
  seconds: number;
  /** Body-center position at the outcome, world space. */
  x: number;
  y: number;
  z: number;
  defectId: string;
}

export interface TwinRunHandle {
  /** Wire the probe physics worker (called from startPhysics in main.ts). */
  attachPhysics(post: (msg: MainToWorker) => void): void;
  /** Route rover_frame / rover_done / rover_probe_result worker messages here. */
  onRoverFrame(msg: RoverFrameMsg): void;
  onRoverDone(msg: RoverDoneMsg): void;
  onRoverProbeResult(msg: RoverProbeResultMsg): void;
  /** Feed the freshest certificate (static bundle at boot, live after survey). */
  setCertificate(cert: TwinCertLike | undefined): void;
  /** Beat gating; `reason` narrated when a trigger is refused. */
  setAvailability(available: boolean, reason?: string): void;
  /** R key / button: start (or restart) the raw run. */
  trigger(): void;
  /** Tear down any active raw run (visuals + worker world). */
  stopRaw(): void;
  isRunning(): boolean;
  /** Deterministic evidence for rehearsal: the last completed run. */
  lastResult(): TwinRunResult | undefined;
  /** The route the last trigger derived (rehearsal/debug telemetry). */
  lastRoute(): RawRoute | undefined;
  /** One line per dry-run probe of the last trigger (rehearsal telemetry). */
  probeReport(): string[];
  /** Beat-5 camera: frame + soft-follow the delivery rover. */
  followDelivery(rover: THREE.Object3D, waypoints: ReadonlyArray<THREE.Vector3>): void;
  stopFollow(): void;
}

// -------------------------------------------------------- route derivation

const RAW_SPEED_MPS = 2.0; // a committed dash: momentum carries the body clear of the rim into the void
const RAW_TURN_RPS = 2.5;
const RAW_ARRIVE_M = 0.15;
const RAW_MAX_STEPS = 3600; // 60 s of sim time
const APPROACH_DIRECTIONS = 16;
const SAMPLE_STEP_M = 0.35;
const EDGE_MARGIN_M = 0.55; // first runway sample this far beyond the hole edge
const RUNWAY_MAX_M = 3.5;
const RUNWAY_MIN_SAMPLES = 2; // >= ~0.7 m of confirmed solid approach (speed is set, not built)
// Soft band around the local floor estimate — the hard drivability rule is
// the 4.5 cm successive-step limit (see the runway walk); this band only
// stops the runway from wandering onto mezzanines/shelf tops.
const FLOOR_TOLERANCE_M = 0.35;
const FELL_BELOW_FLOOR_M = 0.9;

interface RawRoute {
  /** "fall": drive into a collider hole (expected outcome: fell).
   *  "ghost": drive THROUGH a visual-only surface (expected: arrived —
   *  it looks solid and nothing is there; ENDGAME's other raw failure). */
  kind: "fall" | "ghost";
  defectId: string;
  /** Defect region XZ bounds — the probe classifies "beached inside the defect". */
  regionMin: [number, number];
  regionMax: [number, number];
  /** Floor point the rover starts on. */
  start: THREE.Vector3;
  /** Aim point past the far edge of the hole (XZ target). */
  aim: THREE.Vector3;
  holeCenter: THREE.Vector3;
  floorY: number;
  /** Unit XZ direction start → hole. */
  dir: THREE.Vector3;
  /** C12 vision evidence for the crossing (samples INSIDE the defect region):
   *  how much of the flagged gap the VISUAL surface covers. seen/total >= 0.7
   *  means a planner driving on pixels would take this route. 0/0 when no
   *  visual ground is available (points not loaded). */
  visionSeen: number;
  visionTotal: number;
  visionMedianDeltaM: number;
}

/** Parse "N probes fell through" out of probe_fallthrough evidence. */
function probeFallCount(d: TwinDefectLike): number {
  for (const e of d.evidence ?? []) {
    if (!e.kind || !/probe/i.test(e.kind)) continue;
    const m = (e.detail ?? "").match(/(\d+)\s+probes?\b/);
    if (m) return Number(m[1]);
    return 1; // probe-confirmed but uncounted
  }
  return 0;
}

function regionAreaXZ(d: TwinDefectLike): number {
  const r = d.region;
  if (!r) return 0;
  return Math.max(0, (r.max[0]! - r.min[0]!) * (r.max[2]! - r.min[2]!));
}

/**
 * Rank the certificate's hole defects for the raw run: probe-confirmed
 * critical holes first, by probe-fall count, then by area. Deterministic.
 */
function rankedDefects(cert: TwinCertLike, type: string): TwinDefectLike[] {
  const list = (cert.defects ?? []).filter(
    (d) => d.type === type && d.region && (!d.outcome || d.outcome === "OPEN"),
  );
  const rank = (d: TwinDefectLike): [number, number, number] => [
    d.severity === "critical" ? 0 : 1,
    -probeFallCount(d),
    -regionAreaXZ(d),
  ];
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 3; i++) if (ra[i]! !== rb[i]!) return ra[i]! - rb[i]!;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function holeCandidates(cert: TwinCertLike): TwinDefectLike[] {
  return rankedDefects(cert, "collider_hole");
}

function ghostCandidates(cert: TwinCertLike): TwinDefectLike[] {
  return rankedDefects(cert, "visual_only_surface");
}

/** Distance from the AABB center to its edge along direction (dx, dz). */
function edgeDistance(halfX: number, halfZ: number, dx: number, dz: number): number {
  const tx = Math.abs(dx) > 1e-9 ? halfX / Math.abs(dx) : Infinity;
  const tz = Math.abs(dz) > 1e-9 ? halfZ / Math.abs(dz) : Infinity;
  return Math.min(tx, tz);
}

/**
 * Derive CANDIDATE raw-run routes for one hole: every compass direction with
 * a raycast-confirmed solid runway outside the hole edge and a spawn the
 * rover's box actually fits, starting there, aiming past the far edge.
 * Geometry here is a pre-filter — candidates are validated by a silent
 * physics dry-run before anything drives on camera.
 */
function deriveApproach(
  defect: TwinDefectLike,
  collider: THREE.Object3D,
  kind: "fall" | "ghost",
  ground: VisualGround | undefined,
): RawRoute[] {
  const r = defect.region!;
  const cx = (r.min[0]! + r.max[0]!) / 2;
  const cz = (r.min[2]! + r.max[2]!) / 2;
  const cy = (r.min[1]! + r.max[1]!) / 2;
  const halfX = Math.max(0.05, (r.max[0]! - r.min[0]!) / 2);
  const halfZ = Math.max(0.05, (r.max[2]! - r.min[2]!) / 2);

  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);

  /** Floor y at (x, z) near the hole, or undefined when there is nothing. */
  const floorAt = (x: number, z: number, refY: number): number | undefined => {
    raycaster.set(new THREE.Vector3(x, refY + 2.5, z), down);
    raycaster.far = 6;
    const hit = raycaster.intersectObject(collider, true)[0];
    return hit ? hit.point.y : undefined;
  };

  // Floor reference: median of downward hits on a ring just outside the hole.
  const ringHits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const rr = edgeDistance(halfX, halfZ, dx, dz) + 0.35;
    const y = floorAt(cx + dx * rr, cz + dz * rr, cy);
    if (y !== undefined && Math.abs(y - cy) < 1.5) ringHits.push(y);
  }
  ringHits.sort((a, b) => a - b);
  const floorY = ringHits.length > 0 ? ringHits[Math.floor(ringHits.length / 2)]! : cy;

  const UP = new THREE.Vector3(0, 1, 0);
  /**
   * The rover is a 0.34 × 0.50 m box — validate the VOLUME, not a point:
   * center + all four footprint corners must stand on ONE locally level
   * surface (spread ≤ the 4.5 cm the box can tolerate) with clear air above.
   * A single corner on storage-bay clutter wedges the locked-rotation box
   * and the contact solver pins it at spawn (observed: 2 mm in 3600 steps).
   */
  const boxFits = (x: number, z: number): boolean => {
    const yc = floorAt(x, z, floorY);
    if (yc === undefined) return false;
    const ox = ROVER_HALF_EXTENTS.x * 0.9;
    const oz = ROVER_HALF_EXTENTS.z * 0.9;
    for (const [px, pz] of [
      [0, 0],
      [ox, oz],
      [ox, -oz],
      [-ox, oz],
      [-ox, -oz],
    ] as const) {
      const y = floorAt(x + px, z + pz, floorY);
      if (y === undefined || Math.abs(y - yc) > 0.045) return false;
      raycaster.set(new THREE.Vector3(x + px, yc + 0.05, z + pz), UP);
      raycaster.far = ROVER_HALF_EXTENTS.y * 4;
      if (raycaster.intersectObject(collider, true).length > 0) return false;
    }
    return true;
  };

  const candidates: Array<{ dirIdx: number; startR: number; runway: number }> = [];
  for (let i = 0; i < APPROACH_DIRECTIONS; i++) {
    const a = (i / APPROACH_DIRECTIONS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const r0 = edgeDistance(halfX, halfZ, dx, dz) + EDGE_MARGIN_M;
    // Count consecutive DRIVABLE floor samples walking OUT from the hole
    // edge: successive samples may step at most 4.5 cm (what the box can
    // tolerate — tilt-immune, unlike a fixed band around floorY, because
    // this habitat's floor is stepped deck slabs on a ~3° tilt), inside a
    // soft band so the runway never wanders onto a mezzanine.
    let consec = 0;
    let prevY: number | undefined;
    const maxSamples = Math.floor(RUNWAY_MAX_M / SAMPLE_STEP_M);
    for (let k = 0; k < maxSamples; k++) {
      const rr = r0 + k * SAMPLE_STEP_M;
      const y = floorAt(cx + dx * rr, cz + dz * rr, floorY);
      if (y === undefined || Math.abs(y - floorY) > FLOOR_TOLERANCE_M) break;
      if (prevY !== undefined && Math.abs(y - prevY) > 0.045) break;
      prevY = y;
      consec++;
    }
    if (consec < RUNWAY_MIN_SAMPLES) continue;
    // EVERY start along the runway whose box fits is a candidate — geometry
    // is only a pre-filter (torn-mesh slivers defeat every ray heuristic:
    // downward, horizontal, and floor-following were all tried, and a box
    // still parked mid-lane). The silent dry-run probes are the real
    // validator: the same physics, before anything drives on camera.
    let pushed = 0;
    for (let k = RUNWAY_MIN_SAMPLES - 1; k < consec && pushed < 3; k++) {
      const startR = r0 + k * SAMPLE_STEP_M;
      const sx = cx + dx * startR;
      const sz = cz + dz * startR;
      if (!boxFits(sx, sz)) continue;
      candidates.push({ dirIdx: i, startR, runway: consec });
      pushed++;
    }
  }
  // Longest open side first — the best-reading shot goes to the probe first.
  candidates.sort((p, q) => q.runway - p.runway || p.dirIdx - q.dirIdx);
  return candidates.map((c) => {
    const a = (c.dirIdx / APPROACH_DIRECTIONS) * Math.PI * 2;
    const outX = Math.sin(a);
    const outZ = Math.cos(a);
    const sx = cx + outX * c.startR;
    const sz = cz + outZ * c.startR;
    const sy = floorAt(sx, sz, floorY) ?? floorY;
    // Aim PAST the far edge so the rover carries speed across the void.
    const farEdge = edgeDistance(halfX, halfZ, -outX, -outZ);
    const aim = new THREE.Vector3(cx - outX * (farEdge + 0.8), floorY, cz - outZ * (farEdge + 0.8));
    // C12: what do the PIXELS say about this crossing? Samples restricted to
    // the defect region — the runway is collider-verified (the rover really
    // drives there); the crossing is where vision and physics diverge.
    const insideRegion = (x: number, z: number): boolean =>
      x >= r.min[0]! && x <= r.max[0]! && z >= r.min[2]! && z <= r.max[2]!;
    const vision = ground
      ? ground.crossing(sx, sz, aim.x, aim.z, floorY, insideRegion)
      : { seen: 0, total: 0, medianAbsDeltaM: Number.NaN };
    return {
      kind,
      defectId: defect.id,
      regionMin: [r.min[0]!, r.min[2]!] as [number, number],
      regionMax: [r.max[0]!, r.max[2]!] as [number, number],
      start: new THREE.Vector3(sx, sy, sz),
      aim,
      holeCenter: new THREE.Vector3(cx, floorY, cz),
      floorY,
      dir: new THREE.Vector3(-outX, 0, -outZ),
      visionSeen: vision.seen,
      visionTotal: vision.total,
      visionMedianDeltaM: vision.medianAbsDeltaM,
    };
  });
}

/** Probe budget per trigger: each dry-run costs well under a second. */
const MAX_ROUTE_PROBES = 48;
/** Probes cap the sim shorter than the visible run — a route that has not
 *  fallen by 15 s of sim time never will; identical params up to the cap
 *  keep the replay byte-deterministic (a fall at step N replays at step N). */
const PROBE_MAX_STEPS = 900;

/**
 * All candidate routes, geometry-prefiltered: falls first (the stronger
 * beat), then ghost drive-throughs (guaranteed nothing to wedge on INSIDE
 * the region — a visual-only surface has no collider by definition).
 */
function deriveCandidateRoutes(
  cert: TwinCertLike,
  collider: THREE.Object3D,
  ground: VisualGround | undefined,
): RawRoute[] {
  const falls: RawRoute[] = [];
  for (const hole of holeCandidates(cert)) {
    falls.push(...deriveApproach(hole, collider, "fall", ground));
    if (falls.length >= MAX_ROUTE_PROBES) break;
  }
  const ghosts: RawRoute[] = [];
  for (const ghost of ghostCandidates(cert)) {
    if (falls.length + ghosts.length >= MAX_ROUTE_PROBES * 2) break;
    ghosts.push(...deriveApproach(ghost, collider, "ghost", ground));
  }
  // C12: within each kind, vision-confirmed crossings probe first — the run
  // that demonstrates the poisoning ("pixels say floor, collider says void")
  // beats one that merely falls. Stable: prior runway ordering is preserved
  // within each vision class.
  const visionFirst = (rs: RawRoute[]): RawRoute[] => [
    ...rs.filter((r) => visionConfirmed({ seen: r.visionSeen, total: r.visionTotal })),
    ...rs.filter((r) => !visionConfirmed({ seen: r.visionSeen, total: r.visionTotal })),
  ];
  return [...visionFirst(falls), ...visionFirst(ghosts)].slice(0, MAX_ROUTE_PROBES * 2);
}

// ------------------------------------------------------------- module body

export function createTwinRun(deps: TwinRunDeps): TwinRunHandle {
  let postToWorker: ((msg: MainToWorker) => void) | undefined;
  let certificate: TwinCertLike | undefined;
  let available = false;
  let unavailableReason: string | undefined;

  let runId = 0;
  let running = false;
  let activeRoute: RawRoute | undefined;
  let lastDerived: RawRoute | undefined;
  let last: TwinRunResult | undefined;
  // dry-run validation state: the route that PHYSICS confirmed fails
  interface ValidatedRun {
    route: RawRoute;
    /** what the dry-run proved: fell through / beached inside the defect / drove through the ghost */
    expected: "fell" | "stuck" | "arrived";
    /** the probe's terminal step — the visible run freezes shortly after it */
    steps: number;
  }
  let validatedRoute: ValidatedRun | undefined;
  let probing = false;
  let probeSeq = 0;
  const pendingProbes = new Map<number, (res: RoverProbeResultMsg) => void>();
  /** rehearsal telemetry: one line per dry-run probe of the last trigger */
  const probeLog: string[] = [];

  // ---- visuals
  let roverMesh: THREE.Group | undefined;
  let routeLine: THREE.Line | undefined;
  let fallMarker: THREE.Mesh | undefined;

  function clearVisuals(): void {
    roverMesh?.removeFromParent();
    roverMesh = undefined;
    routeLine?.removeFromParent();
    routeLine = undefined;
    fallMarker?.removeFromParent();
    fallMarker = undefined;
  }

  function buildRawRouteLine(route: RawRoute): THREE.Line {
    const pts = [
      route.start.clone().setY(route.floorY + 0.02),
      route.aim.clone().setY(route.floorY + 0.02),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xff9500, transparent: true, opacity: 0.6 }),
    );
    line.name = "twin-raw-route";
    return line;
  }

  function placeFallMarker(x: number, z: number, floorY: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xff453a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, floorY + 0.03, z);
    ring.name = "twin-fall-marker";
    deps.scene.add(ring);
    fallMarker = ring;
  }

  /** Ghost drive-through marker — quarantine purple, at the region center. */
  function placeGhostMarker(x: number, z: number, floorY: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xc792ea, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, floorY + 0.03, z);
    ring.name = "twin-ghost-marker";
    deps.scene.add(ring);
    fallMarker = ring;
  }

  // ---- camera follow (shared by raw run and delivery)
  let followActive = false;
  let userGrabbed = false;
  let followRafId = 0;
  let followGetPos: (() => THREE.Vector3) | undefined;

  deps.controls.addEventListener("start", () => {
    // The user grabbed the camera — it is theirs for the rest of this run.
    userGrabbed = true;
  });

  function followTick(): void {
    if (!followActive) return;
    if (!userGrabbed && followGetPos) {
      const p = followGetPos();
      deps.controls.target.lerp(new THREE.Vector3(p.x, p.y + 0.2, p.z), 0.08);
    }
    followRafId = requestAnimationFrame(followTick);
  }

  function startFollow(getPos: () => THREE.Vector3): void {
    stopFollow();
    followGetPos = getPos;
    followActive = true;
    userGrabbed = false;
    followRafId = requestAnimationFrame(followTick);
  }

  function stopFollow(): void {
    followActive = false;
    followGetPos = undefined;
    cancelAnimationFrame(followRafId);
  }

  /** One-time framing: behind the rover, three-quarter view onto the route. */
  function frameRoute(start: THREE.Vector3, toward: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(toward, start).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const perp = new THREE.Vector3(dir.z, 0, -dir.x);
    deps.camera.position
      .copy(start)
      .addScaledVector(dir, -2.6)
      .addScaledVector(perp, 1.7)
      .add(new THREE.Vector3(0, 2.1, 0));
    const mid = new THREE.Vector3().lerpVectors(start, toward, 0.55);
    deps.controls.target.set(mid.x, start.y + 0.2, mid.z);
  }

  // ---- trigger button (Beats 1–3 only; humanize owns the label)
  const btn = document.createElement("button");
  btn.className = "sv-btn sv-twinrun-btn";
  btn.textContent = BTN.rawRun;
  btn.style.display = "none";
  btn.addEventListener("click", () => {
    btn.blur();
    trigger();
  });
  document.body.appendChild(btn);

  // ------------------------------------------------------------- lifecycle

  function trigger(): void {
    if (!available) {
      deps.flash(unavailableReason ?? NARRATE.rawRunUnavailable);
      return;
    }
    const collider = deps.getCollider();
    if (!certificate || !collider || !postToWorker) {
      deps.flash(NARRATE.rawRunNoRoute);
      return;
    }
    // Re-trigger while running (or after a result) = fresh identical run.
    stopRaw(true);

    // A validated route from a previous trigger replays directly — the demo
    // re-run is instant and byte-identical. Otherwise probe candidates.
    if (validatedRoute) {
      runRoute(validatedRoute);
      return;
    }
    const routes = deriveCandidateRoutes(certificate, collider, deps.getVisualGround?.());
    if (routes.length === 0) {
      deps.flash(NARRATE.rawRunNoRoute);
      return;
    }
    void probeAndRun(routes);
  }

  /** Route params shared verbatim by the silent probe and the visible run. */
  function routeParams(route: RawRoute) {
    return {
      start: [route.start.x, route.start.y, route.start.z] as [number, number, number],
      waypoints: [[route.aim.x, route.aim.z]] as Array<[number, number]>,
      speedMps: RAW_SPEED_MPS,
      turnRateRps: RAW_TURN_RPS,
      arriveRadiusM: RAW_ARRIVE_M,
      // Fall line: below the HOLE'S local floor, not the start height — a
      // downhill approach legitimately descends; being under the rim the
      // pixels call "floor" is the failure, even where debris catches the
      // body deeper down.
      fellY: route.floorY - FELL_BELOW_FLOOR_M,
      maxSteps: RAW_MAX_STEPS,
    };
  }

  /**
   * Validate candidates by SILENT dry-run in the physics worker (the same
   * deterministic step loop, no camera) and drive the first one that falls.
   * Ray heuristics cannot see every torn-mesh sliver; the box itself can.
   */
  async function probeAndRun(routes: RawRoute[]): Promise<void> {
    if (probing) return;
    probing = true;
    probeLog.length = 0;
    deps.narrate(NARRATE.rawRunProbing);
    try {
      for (const route of routes) {
        const res = await new Promise<RoverProbeResultMsg>((resolve) => {
          const id = ++probeSeq;
          pendingProbes.set(id, resolve);
          postToWorker!({ kind: "rover_probe", probeId: id, ...routeParams(route), maxSteps: PROBE_MAX_STEPS });
        });
        deps.setStatus?.(
          `route probe: ${route.defectId} ${route.kind} from (${route.start.x.toFixed(2)}, ${route.start.z.toFixed(2)}) → ` +
            `${res.outcome} at step ${res.step}, end (${res.x.toFixed(2)}, ${res.y.toFixed(2)}, ${res.z.toFixed(2)}), ` +
            `travelled ${Math.hypot(res.x - route.start.x, res.z - route.start.z).toFixed(2)} m`,
        );
        probeLog.push(
          `${route.defectId}/${route.kind} ${res.outcome}@${res.step} d=${Math.hypot(res.x - route.start.x, res.z - route.start.z).toFixed(2)}` +
            ` vision=${route.visionSeen}/${route.visionTotal}${Number.isFinite(route.visionMedianDeltaM) ? ` Δ${route.visionMedianDeltaM.toFixed(3)}m` : ""}`,
        );
        // Three provable failure modes:
        //  fall-kind + fell            → dropped past the fall line
        //  fall-kind + beached inside  → nose-down IN the defect, > 0.2 m
        //    under the rim the pixels call floor (moon holes are mesh gaps
        //    over debris — a box cannot get 0.9 m down, and does not need
        //    to: a robot stuck in a pit is the failure)
        //  ghost-kind + arrived        → drove clean THROUGH the "solid" shelf
        const insideDefect =
          res.x >= route.regionMin[0] - 0.1 &&
          res.x <= route.regionMax[0] + 0.1 &&
          res.z >= route.regionMin[1] - 0.1 &&
          res.z <= route.regionMax[1] + 0.1;
        let expected: ValidatedRun["expected"] | undefined;
        if (route.kind === "fall" && res.outcome === "fell") expected = "fell";
        else if (route.kind === "fall" && insideDefect && res.y < route.floorY - 0.2) expected = "stuck";
        else if (route.kind === "ghost" && res.outcome === "arrived") expected = "arrived";
        if (expected) {
          validatedRoute = { route, expected, steps: res.step };
          runRoute(validatedRoute);
          return;
        }
      }
      deps.narrate("");
      deps.flash(NARRATE.rawRunNoRoute);
    } finally {
      probing = false;
    }
  }

  /** Drive a (validated) route on camera. */
  function runRoute(run: ValidatedRun): void {
    const route = run.route;
    activeRoute = route;
    lastDerived = route;
    runId += 1;
    running = true;

    roverMesh = buildRoverMesh();
    roverMesh.name = "twin-raw-rover";
    roverMesh.position.copy(route.start);
    roverMesh.rotation.y = Math.atan2(route.aim.x - route.start.x, route.aim.z - route.start.z);
    deps.scene.add(roverMesh);
    routeLine = buildRawRouteLine(route);
    deps.scene.add(routeLine);

    frameRoute(route.start, route.holeCenter);
    startFollow(() => roverMesh?.position ?? route.start);

    // C12: when the crossing is vision-confirmed, say the stronger true
    // sentence — the planner is driving on what the cameras see, and the
    // physics is about to disagree. Otherwise the classic line.
    if (route.kind === "fall" && visionConfirmed({ seen: route.visionSeen, total: route.visionTotal })) {
      deps.narrate(rawRunVisionPlan(route.visionSeen, route.visionTotal));
    } else {
      deps.narrate(NARRATE.rawRun);
    }
    deps.setStatus?.(
      `raw run #${runId}: defect ${route.defectId}, start (${route.start.x.toFixed(2)}, ${route.start.z.toFixed(2)}) → hole (${route.holeCenter.x.toFixed(2)}, ${route.holeCenter.z.toFixed(2)}), vision ${route.visionSeen}/${route.visionTotal}`,
    );

    // A "stuck" run freezes ~1.5 s after the dry-run's terminal step — the
    // beach-out is deterministic, so the camera holds a clean final shot
    // instead of grinding a 60 s timeout.
    const maxSteps = run.expected === "stuck" ? run.steps + 90 : RAW_MAX_STEPS;
    postToWorker!({ kind: "rover_run", runId, ...routeParams(route), maxSteps });
  }

  function stopRaw(keepNarration = false): void {
    postToWorker?.({ kind: "rover_stop" }); // also frees a finished run's frozen world
    running = false;
    activeRoute = undefined;
    clearVisuals();
    stopFollow();
    if (!keepNarration && last) deps.narrate("");
  }

  function onRoverFrame(msg: RoverFrameMsg): void {
    if (msg.runId !== runId || !roverMesh) return;
    roverMesh.position.set(msg.x, msg.y - ROVER_HALF_EXTENTS.y, msg.z);
    if (msg.qx !== undefined) {
      // full body orientation: the mesh pitches over relief and tumbles into the fall
      roverMesh.quaternion.set(msg.qx, msg.qy!, msg.qz!, msg.qw!);
    } else {
      roverMesh.rotation.y = msg.heading;
    }
  }

  function onRoverDone(msg: RoverDoneMsg): void {
    if (msg.runId !== runId || !activeRoute) return;
    running = false;
    stopFollow(); // hold the shot — the fall already happened in frame
    last = {
      outcome: msg.outcome,
      step: msg.step,
      seconds: msg.step / 60,
      x: msg.x,
      y: msg.y,
      z: msg.z,
      defectId: activeRoute.defectId,
    };
    if (msg.outcome === "fell") {
      placeFallMarker(msg.x, msg.z, activeRoute.floorY);
      deps.narrate(
        activeRoute && visionConfirmed({ seen: activeRoute.visionSeen, total: activeRoute.visionTotal })
          ? NARRATE.rawRunVisionFell
          : NARRATE.rawRunFell,
      );
    } else if (msg.outcome === "arrived") {
      if (activeRoute.kind === "ghost") {
        placeGhostMarker(activeRoute.holeCenter.x, activeRoute.holeCenter.z, activeRoute.floorY);
        deps.narrate(NARRATE.rawRunGhost);
      } else {
        deps.narrate(NARRATE.rawRunCrossed);
      }
    } else if (validatedRoute?.expected === "stuck" && msg.step >= validatedRoute.steps) {
      // the deterministic beach-out the dry-run proved — a failure, on camera
      placeFallMarker(msg.x, msg.z, activeRoute.floorY);
      deps.narrate(NARRATE.rawRunStuck);
    } else {
      deps.narrate(NARRATE.rawRunTimeout);
    }
    deps.setStatus?.(
      `raw run #${msg.runId}: ${msg.outcome} at step ${msg.step} (${(msg.step / 60).toFixed(2)} s) — (${msg.x.toFixed(3)}, ${msg.y.toFixed(3)}, ${msg.z.toFixed(3)})`,
    );
  }

  return {
    attachPhysics(post) {
      postToWorker = post;
    },
    onRoverFrame,
    onRoverDone,
    onRoverProbeResult(msg) {
      const resolve = pendingProbes.get(msg.probeId);
      if (resolve) {
        pendingProbes.delete(msg.probeId);
        resolve(msg);
      }
    },
    setCertificate(cert) {
      certificate = cert;
      validatedRoute = undefined; // new survey, new defect ids — revalidate
    },
    setAvailability(on, reason) {
      available = on;
      unavailableReason = reason;
      btn.style.display = on ? "" : "none";
    },
    trigger,
    stopRaw() {
      stopRaw();
    },
    isRunning() {
      return running;
    },
    lastResult() {
      return last;
    },
    lastRoute() {
      return lastDerived;
    },
    probeReport() {
      return [...probeLog];
    },
    followDelivery(rover, waypoints) {
      const goal = waypoints.length > 0 ? waypoints[waypoints.length - 1]! : rover.position;
      frameRoute(rover.position.clone(), goal.clone());
      startFollow(() => rover.position);
    },
    stopFollow,
  };
}
