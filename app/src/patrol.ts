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
}

export interface PatrolHandle {
  stop(): void;
  /** The full validated waypoint loop (spawns + inserted detours), world space. */
  waypoints: ReadonlyArray<THREE.Vector3>;
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

// ------------------------------------------------------------- rover visual

function buildRoverMesh(): THREE.Group {
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

function buildRouteLine(waypoints: THREE.Vector3[]): THREE.Line {
  const pts = [...waypoints, waypoints[0]!].map((w) => w.clone().setY(w.y + 0.02));
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: 0x7bd88f, transparent: true, opacity: 0.55 }),
  );
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
  const waypoints = buildPatrolRoute(opts.spawns, opts.quarantine ?? []);
  const speed = opts.speedMps ?? 0.6;
  const turnRate = opts.turnRateRps ?? 2.5;

  const rover = buildRoverMesh();
  let routeLine: THREE.Line | undefined;
  let label: HTMLDivElement | undefined;
  let rafId = 0;
  let stopped = false;

  if (waypoints.length < 2) {
    // Nothing to patrol; return an inert handle.
    return { stop: () => undefined, waypoints };
  }

  const start = waypoints[0]!;
  rover.position.copy(start);
  scene.add(rover);
  routeLine = buildRouteLine(waypoints);
  routeLine.name = "patrol-route";
  scene.add(routeLine);

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
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      scene.remove(rover);
      if (routeLine) scene.remove(routeLine);
      label?.remove();
    },
  };
}
