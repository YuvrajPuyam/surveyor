/**
 * Rover patrol — deterministic waypoint follower (Lane E).
 *
 * Honesty line: this is NOT a physics-driven policy and NOT A*. It is plain
 * navmesh waypoint-following: straight segments between certified rover
 * spawn points, with each segment validated against the quarantine AABBs
 * (inflated 0.3 m). A segment that crosses a quarantined region gets a
 * detour waypoint inserted around the box corner. The rover's y follows the
 * collider floor via a downward raycast.
 *
 * Two modes (C6):
 *   "loop"     — the original patrol: a closed circuit over the spawns.
 *   "delivery" — start→goal: from the first verified spawn to the FARTHEST
 *                verified spawn (the depot), via any patched-floor regions
 *                that lie near the straight route (the rover demonstrably
 *                drives OVER repaired floor), around quarantine as always.
 *                Arrival parks the rover at the depot marker and fires
 *                onArrive once.
 *
 * Usage:
 *   const patrol = startPatrol(scene, { spawns, quarantine, collider });
 *   ...
 *   patrol.stop();
 */
import * as THREE from "three";

// ------------------------------------------------------------------- types

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  robotId?: string;
  clearanceM?: number;
}

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PatrolOptions {
  /** Candidate spawn points; rover spawns (robotId contains "rover") are preferred. */
  spawns: SpawnPoint[];
  /** Quarantined regions the rover must route AROUND (inflated 0.3 m). */
  quarantine?: Aabb[];
  /** Collider mesh (e.g. the wireframe mesh) used to raycast the floor height. */
  collider?: THREE.Object3D;
  /** Cruise speed in m/s (default 0.6). */
  speedMps?: number;
  /** Max turn rate in rad/s (default 2.5). */
  turnRateRps?: number;
  /** Show the honesty-label overlay (default true). */
  showLabel?: boolean;
  /** "loop" (default) circles the spawns forever; "delivery" is start→depot. */
  mode?: "loop" | "delivery";
  /** Patched-floor regions (fixed defects) the delivery route prefers to cross. */
  patched?: Aabb[];
  /** Fired once when a delivery run reaches the depot. */
  onArrive?: (info: { position: THREE.Vector3 }) => void;
}

export interface PatrolHandle {
  stop(): void;
  /** The full validated waypoint route (spawns + inserted detours), world space. */
  waypoints: ReadonlyArray<THREE.Vector3>;
  /** The rover object (for camera framing). */
  rover: THREE.Object3D;
  mode: "loop" | "delivery";
}

// -------------------------------------------------------- segment validation

const QUARANTINE_INFLATE_M = 0.3;
const DETOUR_EXTRA_M = 0.15; // corners sit slightly outside the inflated box
const MAX_DETOUR_DEPTH = 4;

interface Box2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function inflateXZ(box: Aabb, by: number): Box2 {
  return {
    minX: box.min[0] - by,
    minZ: box.min[2] - by,
    maxX: box.max[0] + by,
    maxZ: box.max[2] + by,
  };
}

/** 2D (XZ) segment vs AABB slab test. */
function segmentCrossesBox(ax: number, az: number, bx: number, bz: number, box: Box2): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let tMin = 0;
  let tMax = 1;
  for (const [d, a, lo, hi] of [
    [dx, ax, box.minX, box.maxX],
    [dz, az, box.minZ, box.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (a < lo || a > hi) return false;
    } else {
      let t1 = (lo - a) / d;
      let t2 = (hi - a) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

function pointInBox(x: number, z: number, box: Box2): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

function segmentClearOfAll(a: THREE.Vector3, b: THREE.Vector3, boxes: Box2[]): boolean {
  for (const box of boxes) {
    if (segmentCrossesBox(a.x, a.z, b.x, b.z, box)) return false;
  }
  return true;
}

/**
 * Validate segment a->b against quarantine boxes. If it crosses one, insert a
 * detour waypoint just outside the box corner that keeps both sub-segments
 * clear (recursing a bounded number of times). Returns the intermediate
 * waypoints (excluding a and b). Deterministic: boxes and corners are tried
 * in a fixed order, ties broken by shorter total detour length.
 */
function detourSegment(a: THREE.Vector3, b: THREE.Vector3, boxes: Box2[], depth: number): THREE.Vector3[] {
  if (depth <= 0) return [];
  let hit: Box2 | undefined;
  for (const box of boxes) {
    if (segmentCrossesBox(a.x, a.z, b.x, b.z, box)) {
      hit = box;
      break;
    }
  }
  if (!hit) return [];

  const e = DETOUR_EXTRA_M;
  const corners: Array<[number, number]> = [
    [hit.minX - e, hit.minZ - e],
    [hit.maxX + e, hit.minZ - e],
    [hit.maxX + e, hit.maxZ + e],
    [hit.minX - e, hit.maxZ + e],
  ];

  const y = (a.y + b.y) / 2;
  let best: THREE.Vector3 | undefined;
  let bestLen = Infinity;
  for (const [cx, cz] of corners) {
    if (boxes.some((box) => pointInBox(cx, cz, box))) continue;
    if (segmentCrossesBox(a.x, a.z, cx, cz, hit) || segmentCrossesBox(cx, cz, b.x, b.z, hit)) continue;
    const len = Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz);
    if (len < bestLen) {
      bestLen = len;
      best = new THREE.Vector3(cx, y, cz);
    }
  }
  if (!best) {
    // No single corner clears this box (segment spans it diagonally through
    // both visible corners) — go via the two corners on the near side.
    const c0 = corners[0]!;
    best = new THREE.Vector3(c0[0], y, c0[1]);
  }

  // Recursively clear the two sub-segments against the remaining boxes.
  const pre = detourSegment(a, best, boxes, depth - 1);
  const post = detourSegment(best, b, boxes, depth - 1);
  return [...pre, best, ...post];
}

/** Build the closed waypoint loop from spawns, inserting quarantine detours. */
export function buildPatrolRoute(spawns: SpawnPoint[], quarantine: Aabb[]): THREE.Vector3[] {
  const rovers = spawns.filter((s) => (s.robotId ?? "").toLowerCase().includes("rover"));
  const picked = (rovers.length >= 2 ? rovers : spawns).slice(0, 8);
  const base = picked.map((s) => new THREE.Vector3(s.x, s.y, s.z));
  if (base.length < 2) return base;

  const boxes = quarantine.map((q) => inflateXZ(q, QUARANTINE_INFLATE_M));
  const route: THREE.Vector3[] = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[i]!;
    const b = base[(i + 1) % base.length]!;
    route.push(a);
    route.push(...detourSegment(a, b, boxes, MAX_DETOUR_DEPTH));
  }
  return route;
}

/**
 * Delivery route (C6): first verified spawn → farthest verified spawn (the
 * depot). Patched-floor regions near the straight route are inserted as via
 * points so the run demonstrably crosses repaired floor; quarantine detours
 * apply to every leg. Deterministic: fixed pick order, ties by index.
 */
export function buildDeliveryRoute(
  spawns: SpawnPoint[],
  quarantine: Aabb[],
  patched: Aabb[] = [],
): THREE.Vector3[] {
  const rovers = spawns.filter((s) => (s.robotId ?? "").toLowerCase().includes("rover"));
  const pool = rovers.length >= 2 ? rovers : spawns;
  if (pool.length < 2) return pool.map((s) => new THREE.Vector3(s.x, s.y, s.z));

  const start = pool[0]!;
  let depot = pool[1]!;
  let bestD = -1;
  for (let i = 1; i < pool.length; i++) {
    const s = pool[i]!;
    const d = Math.hypot(s.x - start.x, s.z - start.z);
    if (d > bestD) {
      bestD = d;
      depot = s;
    }
  }
  const a = new THREE.Vector3(start.x, start.y, start.z);
  const b = new THREE.Vector3(depot.x, depot.y, depot.z);
  const boxes = quarantine.map((q) => inflateXZ(q, QUARANTINE_INFLATE_M));

  // Via points: patched regions whose center sits near the straight route.
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const abLen2 = abx * abx + abz * abz;
  const vias: Array<{ t: number; p: THREE.Vector3 }> = [];
  if (abLen2 > 1e-6) {
    for (const r of patched) {
      const cx = (r.min[0]! + r.max[0]!) / 2;
      const cz = (r.min[2]! + r.max[2]!) / 2;
      const t = ((cx - a.x) * abx + (cz - a.z) * abz) / abLen2;
      if (t < 0.12 || t > 0.88) continue; // keep departure/arrival legs clean
      const px = a.x + t * abx;
      const pz = a.z + t * abz;
      if (Math.hypot(cx - px, cz - pz) > 2.5) continue; // too far off-route
      if (boxes.some((box) => pointInBox(cx, cz, box))) continue;
      vias.push({ t, p: new THREE.Vector3(cx, a.y + t * (b.y - a.y), cz) });
    }
    vias.sort((u, v) => u.t - v.t);
  }

  const anchors = [a, ...vias.map((v) => v.p), b];
  const route: THREE.Vector3[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const p = anchors[i]!;
    route.push(p);
    if (i < anchors.length - 1) {
      route.push(...detourSegment(p, anchors[i + 1]!, boxes, MAX_DETOUR_DEPTH));
    }
  }
  return route;
}

// ------------------------------------------------------------- rover visual

export function buildRoverMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "patrol-rover";

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.14, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }),
  );
  body.position.y = 0.14;
  group.add(body);

  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.22, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a }),
  );
  mast.position.set(0, 0.32, 0.14);
  group.add(mast);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x4dd2ff, emissive: 0x1a5a70 }),
  );
  head.position.set(0, 0.44, 0.14);
  group.add(head);

  const wheelGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12);
  wheelGeom.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.9 });
  for (const [wx, wz] of [
    [-0.2, 0.18],
    [0.2, 0.18],
    [-0.2, -0.18],
    [0.2, -0.18],
  ] as const) {
    const wheel = new THREE.Mesh(wheelGeom, wheelMat);
    wheel.position.set(wx, 0.07, wz);
    group.add(wheel);
  }
  return group;
}

function buildRouteLine(waypoints: THREE.Vector3[], closed: boolean): THREE.Line {
  const pts = (closed ? [...waypoints, waypoints[0]!] : waypoints).map((w) => w.clone().setY(w.y + 0.02));
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: 0x7bd88f, transparent: true, opacity: 0.55 }),
  );
}

/** Depot marker for delivery mode: pole + flag + ground ring at the goal. */
function buildDepotMarker(at: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = "delivery-depot";
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0xb8bfcc }),
  );
  pole.position.y = 0.45;
  group.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x34d975, side: THREE.DoubleSide }),
  );
  flag.position.set(0.18, 0.78, 0);
  group.add(flag);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 32),
    new THREE.MeshBasicMaterial({ color: 0x34d975, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  group.position.copy(at);
  return group;
}

// ----------------------------------------------------------------- overlay

function buildLabel(): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = "rover patrol: navmesh waypoint-following (not a learned policy)";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    padding: "4px 10px",
    font: "12px/1.4 ui-monospace, monospace",
    color: "#7bd88f",
    background: "rgba(11,14,20,0.75)",
    border: "1px solid rgba(123,216,143,0.4)",
    borderRadius: "4px",
    pointerEvents: "none",
    zIndex: "10",
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

// ------------------------------------------------------------------- patrol

const ARRIVE_RADIUS_M = 0.12;
const RAY_START_ABOVE_M = 3;
const MAX_DT_S = 0.1;

export function startPatrol(scene: THREE.Scene, opts: PatrolOptions): PatrolHandle {
  const mode = opts.mode ?? "loop";
  const waypoints =
    mode === "delivery"
      ? buildDeliveryRoute(opts.spawns, opts.quarantine ?? [], opts.patched ?? [])
      : buildPatrolRoute(opts.spawns, opts.quarantine ?? []);
  const speed = opts.speedMps ?? 0.6;
  const turnRate = opts.turnRateRps ?? 2.5;

  const rover = buildRoverMesh();
  let routeLine: THREE.Line | undefined;
  let depotMarker: THREE.Group | undefined;
  let label: HTMLDivElement | undefined;
  let rafId = 0;
  let stopped = false;
  let arrivedFired = false;

  if (waypoints.length < 2) {
    // Nothing to patrol; return an inert handle.
    return { stop: () => undefined, waypoints, rover, mode };
  }

  const start = waypoints[0]!;
  rover.position.copy(start);
  scene.add(rover);
  routeLine = buildRouteLine(waypoints, mode === "loop");
  routeLine.name = "patrol-route";
  scene.add(routeLine);
  if (mode === "delivery") {
    depotMarker = buildDepotMarker(waypoints[waypoints.length - 1]!);
    scene.add(depotMarker);
  }

  if (opts.showLabel !== false) {
    label = buildLabel();
    document.body.appendChild(label);
  }

  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const rayOrigin = new THREE.Vector3();

  /** Floor height at (x, z): raycast the collider, else fall back to hint y. */
  function floorY(x: number, z: number, hintY: number): number {
    if (!opts.collider) return hintY;
    rayOrigin.set(x, hintY + RAY_START_ABOVE_M, z);
    raycaster.set(rayOrigin, down);
    raycaster.far = RAY_START_ABOVE_M * 2 + 2;
    const hits = raycaster.intersectObject(opts.collider, true);
    const hit = hits[0];
    return hit ? hit.point.y : hintY;
  }

  let target = 1; // waypoint index the rover is driving toward
  let heading = Math.atan2(waypoints[1]!.x - start.x, waypoints[1]!.z - start.z);
  rover.rotation.y = heading;
  let lastT = performance.now();

  function tick(now: number): void {
    if (stopped) return;
    const dt = Math.min((now - lastT) / 1000, MAX_DT_S);
    lastT = now;

    const wp = waypoints[target]!;
    const dx = wp.x - rover.position.x;
    const dz = wp.z - rover.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < ARRIVE_RADIUS_M) {
      if (mode === "delivery" && target >= waypoints.length - 1) {
        // Depot reached: park the rover (mesh stays), fire onArrive once.
        if (!arrivedFired) {
          arrivedFired = true;
          opts.onArrive?.({ position: rover.position.clone() });
        }
        return; // stop ticking — the rover is parked at the depot
      }
      target = (target + 1) % waypoints.length;
    } else {
      // Smooth turn toward the waypoint, then advance along the heading.
      const desired = Math.atan2(dx, dz);
      let delta = desired - heading;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const maxTurn = turnRate * dt;
      heading += THREE.MathUtils.clamp(delta, -maxTurn, maxTurn);
      rover.rotation.y = heading;

      // Slow down while turning hard so corners look driven, not slid.
      const align = Math.max(0.25, Math.cos(delta));
      const step = Math.min(speed * align * dt, dist);
      rover.position.x += Math.sin(heading) * step;
      rover.position.z += Math.cos(heading) * step;
      rover.position.y = floorY(rover.position.x, rover.position.z, wp.y);
    }

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return {
    waypoints,
    rover,
    mode,
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      scene.remove(rover);
      if (routeLine) scene.remove(routeLine);
      if (depotMarker) scene.remove(depotMarker);
      label?.remove();
    },
  };
}
