# G7a: a DRIVEN ROVER crossing the repaired, photoreal world â€” recorded from
# TWO cameras simultaneously: first-person (hood cam) + third-person (chase).
# Honest label: "driven rigid body on certified ground" (velocity-commanded
# box with visual wheels; no SLAM/vision claim â€” the traversal + photoreal
# NuRec visuals are the beat).
#
# Inherits every law from the g3c saga:
#  - single world.reset(), no stops; probes parked, never removed;
#  - all content authored PRE-reset;
#  - /World carries a +90X source-frame rotation â†’ raw-USD prims authored in
#    world coords go to ROOT LEVEL; isaacsim objects (position=) compensate;
#  - cameras live in the ROVER'S BODY FRAME (children of the physics body â€”
#    links render while moving, so children track via Fabric); a tracking
#    guard verifies that assumption before spending the full run.
import json
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g7a-results.txt"
FP_FRAMES = "/scratch/gilbreth/gupta596/surveyor/g7a-frames-fp"
TP_FRAMES = "/scratch/gilbreth/gupta596/surveyor/g7a-frames-tp"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g7a start (rover traversal, FP+TP)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import numpy as np
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.sensors.camera")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"stage open: {ok}")
    from pxr import Gf, Sdf, UsdGeom, UsdLux
    stage = ctx.get_stage()

    vis = stage.GetPrimAtPath("/World/Visuals")
    log(f"NuRec visuals active: {bool(vis and vis.IsValid() and vis.IsActive())}")
    # dbg7: the Volume's 'proxy' REL is the occlusion-compositing hook — link
    # the collider so meshes and the NuRec volume composite correctly
    vol = stage.GetPrimAtPath("/World/Visuals/gauss/gauss")
    if vol and vol.IsValid():
        vol.GetRelationship("proxy").SetTargets([Sdf.Path("/World/Geometry/Collider")])
        log("NuRec proxy REL -> /World/Geometry/Collider")

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    B = (s["x"], -s["z"], s["y"])
    log(f"rover spawn (stage): ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    # lights at ROOT (world-coord raw USD never goes under /World)
    UsdLux.DomeLight.Define(stage, Sdf.Path("/g7_dome")).CreateIntensityAttr(600)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/g7_sun"))
    sun.CreateIntensityAttr(2000)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))

    # ---- World + rover + probes, all pre-reset -----------------------------
    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid, VisualCuboid

    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)

    ROVER = "/World/g7_rover"
    BODY = (0.50, 0.34, 0.22)  # x length, y width, z height â€” browser-rover proportions
    rover = world.scene.add(DynamicCuboid(
        prim_path=ROVER, name="rover",
        position=(B[0], B[1], B[2] + BODY[2] / 2 + 0.06),
        scale=BODY, mass=8.0, color=np.array([0.85, 0.85, 0.9]),
    ))

    # visual dressing in the rover's BODY frame (children of the physics body;
    # cuboid scale does NOT inherit â€” DynamicCuboid scales via xform op on the
    # prim, so children DO inherit that scale; compensate by authoring in the
    # scaled space: divide local offsets by BODY scale)
    def child(path, cls):
        return cls.Define(stage, Sdf.Path(f"{ROVER}/{path}"))
    sx, sy, sz = BODY
    for i, (wx, wy) in enumerate([(0.18, 0.20), (0.18, -0.20), (-0.18, 0.20), (-0.18, -0.20)]):
        w = child(f"wheel{i}", UsdGeom.Cylinder)
        w.CreateAxisAttr("Y")
        w.CreateRadiusAttr(0.09 / sz)
        w.CreateHeightAttr(0.06 / sy)
        w.CreateDisplayColorAttr([Gf.Vec3f(0.12, 0.12, 0.14)])
        UsdGeom.XformCommonAPI(w.GetPrim()).SetTranslate((wx / sx, wy / sy, -0.09 / sz))
    mast = child("mast", UsdGeom.Cube)
    mast.CreateSizeAttr(1.0)
    mast.CreateDisplayColorAttr([Gf.Vec3f(0.2, 0.25, 0.3)])
    UsdGeom.XformCommonAPI(mast.GetPrim()).SetTranslate((0.16 / sx, 0.0, 0.20 / sz))
    UsdGeom.XformCommonAPI(mast.GetPrim()).SetScale((0.06 / sx, 0.06 / sy, 0.12 / sz))

    # cameras in the body frame (scale-compensated local coords), aimed with
    # the proven SetLookAt pattern â€” in LOCAL space
    def body_cam(name, eye, aim):
        path = f"{ROVER}/{name}"
        c = UsdGeom.Camera.Define(stage, Sdf.Path(path))
        c.CreateClippingRangeAttr(Gf.Vec2f(0.05, 10000.0))  # default near=1m eats the close ground
        e = Gf.Vec3d(eye[0] / sx, eye[1] / sy, eye[2] / sz)
        a = Gf.Vec3d(aim[0] / sx, aim[1] / sy, aim[2] / sz)
        view = Gf.Matrix4d().SetLookAt(e, a, Gf.Vec3d(0, 0, 1 / sz))
        UsdGeom.Xformable(stage.GetPrimAtPath(path)).MakeMatrixXform().Set(view.GetInverse())
        return path
    fp_path = body_cam("fp_cam", (0.20, 0.0, 0.30), (3.5, 0.0, 0.35))
    # WIDE cam: STATIC, root-level, at the g3c-PROVEN photoreal-clear eye --
    # the exact pose that filmed the box-lift with visible robot + splats.
    # (Chase cams ride inside splat fog; proven-clear air beats theory.)
    wide_path = "/g7_wide"
    wc = UsdGeom.Camera.Define(stage, Sdf.Path(wide_path))
    wc.CreateClippingRangeAttr(Gf.Vec2f(0.05, 10000.0))
    weye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    waim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)  # the EXACT g3c-proven aim (crisp there)
    wview = Gf.Matrix4d().SetLookAt(weye, waim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(wide_path)).MakeMatrixXform().Set(wview.GetInverse())
    tp_path = wide_path
    log("rover + wheels authored; FP body cam + WIDE static cam (g3c-proven eye)")

    # route probes: 3 distances x 4 compass directions, dropped pre-reset;
    # the direction with the most confirmed floor becomes the drive
    PROBE = 0.04
    DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    DISTS = [1.5, 3.0, 4.5]
    probes = []
    for di, (dx, dy) in enumerate(DIRS):
        for pj, dist in enumerate(DISTS):
            probes.append(world.scene.add(DynamicCuboid(
                prim_path=f"/World/g7_probe_{di}_{pj}", name=f"g7p{di}{pj}",
                position=(B[0] + dx * dist, B[1] + dy * dist, B[2] + 0.6),
                size=PROBE, mass=0.05,
            )))

    # marker for the render check (isaacsim visual object = world-compensated)
    marker = world.scene.add(VisualCuboid(
        prim_path="/World/g7_marker", name="g7marker",
        position=(B[0] + 1.2, B[1], B[2] + 0.45), size=0.3,
        color=np.array([1.0, 0.1, 0.1]),
    ))

    from isaacsim.sensors.camera import Camera
    fp = Camera(prim_path=fp_path, resolution=(1280, 720))
    tp = Camera(prim_path=tp_path, resolution=(1280, 720))

    world.get_physics_context().set_gravity(-1.62)
    world.reset()  # the one and only
    fp.initialize()
    tp.initialize()
    log("world reset (1.62 m/s^2); cameras initialized")

    for _ in range(360):
        world.step(render=False)

    # score directions by confirmed consecutive floor
    best_di, best_reach = 0, 0.0
    for di, (dx, dy) in enumerate(DIRS):
        reach = 0.0
        for pj, dist in enumerate(DISTS):
            p, _ = probes[di * 3 + pj].get_world_pose()
            support = float(p[2]) - PROBE / 2
            if abs(support - B[2]) <= 0.35:
                reach = dist
            else:
                break
        log(f"dir ({dx},{dy}): confirmed reach {reach} m")
        if reach > best_reach:
            best_reach, best_di = reach, di
    if best_reach < 1.5:
        log("G7A_FAIL no drivable direction from spawn")
        raise RuntimeError("no drivable direction")
    DX, DY = DIRS[best_di]
    GOAL = (B[0] + DX * best_reach, B[1] + DY * best_reach)
    log(f"drive: dir ({DX},{DY}), goal ({GOAL[0]:.2f}, {GOAL[1]:.2f}) â€” {best_reach} m")

    # rotate the ROVER so its +X (and the body-frame cameras) faces travel:
    # yaw about Z; isaacsim set_world_pose compensates the /World rotation
    import math
    yaw = math.atan2(DY, DX)
    q = np.array([math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)])  # wxyz about Z
    pos0, _ = rover.get_world_pose()
    rover.set_world_pose(pos0, q)
    for _ in range(30):
        world.step(render=False)

    # park probes out of shot
    try:
        for i, p in enumerate(probes):
            p.set_world_pose(np.array([B[0] - DX * 6 - i * 0.2, B[1] - DY * 6, B[2] + 0.2]), np.array([1.0, 0, 0, 0]))
            p.set_linear_velocity(np.zeros(3))
        log("probes parked")
    except Exception as pe:
        log(f"probe parking skipped: {pe!r}")

    # ---- capture rig checks ------------------------------------------------
    os.makedirs(FP_FRAMES, exist_ok=True)
    os.makedirs(TP_FRAMES, exist_ok=True)
    from PIL import Image
    counts = {"fp": 0, "tp": 0}
    def snap(cam, tag, folder):
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return
        Image.fromarray(np.asarray(rgba)[:, :, :3].astype(np.uint8)).save(
            f"{folder}/frame_{counts[tag]:05d}.png")
        counts[tag] += 1
    def spread(cam):
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return -1.0
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        return float(core.max()) - float(core.min())

    for _ in range(30):
        world.step(render=True)
    log(f"warmup spreads: fp {spread(fp):.0f}, tp {spread(tp):.0f} (marker on)")
    marker.prim.SetActive(False) if hasattr(marker, "prim") else None
    try:
        stage.GetPrimAtPath("/World/g7_marker").SetActive(False)
    except Exception:
        pass
    for _ in range(15):
        world.step(render=True)
    fp_s, tp_s = spread(fp), spread(tp)
    log(f"scene-only spreads: fp {fp_s:.0f}, tp {tp_s:.0f}")
    if fp_s <= 8 or tp_s <= 8:
        log("G7A_FAIL a camera sees nothing (scene-only)")
        raise RuntimeError("camera scene blank")

    # tracking guard: cameras must MOVE with the body (children-of-physics)
    ref = np.asarray(fp.get_rgba())[:, :, :3].astype(np.int16).copy()
    rover.set_linear_velocity(np.array([DX * 1.2, DY * 1.2, 0.0]))
    for _ in range(60):
        world.step(render=True)
    moved = np.abs(np.asarray(fp.get_rgba())[:, :, :3].astype(np.int16) - ref).mean()
    p_now, _ = rover.get_world_pose()
    log(f"tracking guard: rover moved {math.hypot(float(p_now[0]) - pos0[0], float(p_now[1]) - pos0[1]):.2f} m, FP frame delta {moved:.1f}")
    if moved < 1.0:
        log("G7A_FAIL CAMERA_NOT_TRACKING â€” body-frame cameras do not follow the physics body")
        raise RuntimeError("camera not tracking")

    # ---- the traversal, on camera ------------------------------------------
    SPEED = 0.9  # slower = longer, more watchable clip
    ARRIVE = 0.3
    MAXSTEP = 3600
    arrived = False
    step = 0
    while step < MAXSTEP:
        p, _ = rover.get_world_pose()
        gx, gy = GOAL[0] - float(p[0]), GOAL[1] - float(p[1])
        d = math.hypot(gx, gy)
        if d < ARRIVE:
            arrived = True
            break
        v = rover.get_linear_velocity()
        rover.set_linear_velocity(np.array([gx / d * SPEED, gy / d * SPEED, float(v[2])]))
        rover.set_angular_velocity(np.zeros(3))
        render = step % 2 == 0
        world.step(render=render)
        if render:
            snap(fp, "fp", FP_FRAMES)
            snap(tp, "tp", TP_FRAMES)
        step += 1
    rover.set_linear_velocity(np.zeros(3))
    for i in range(60):
        world.step(render=(i % 2 == 0))
        if i % 2 == 0:
            snap(fp, "fp", FP_FRAMES)
            snap(tp, "tp", TP_FRAMES)

    p, _ = rover.get_world_pose()
    log(f"end: arrived={arrived} at ({float(p[0]):.2f}, {float(p[1]):.2f}) after {step} steps; frames fp {counts['fp']}, tp {counts['tp']}")
    ok_all = arrived and counts["fp"] >= 100 and counts["tp"] >= 100
    log("G7A_" + ("PASS" if ok_all else "FAIL"))
except Exception as e:
    import traceback
    log("G7A_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
