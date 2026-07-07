# G3c: g3b's proven pick-and-place, CAPTURED ON CAMERA (headless RGB frames).
# Franka (URDF imported to its own file, referenced in) + RMPflow, crate
# shelf -> rover bed at lunar gravity inside the Certified World Pack.
#
# RENDER LAW (7 debug jobs of evidence, dbg1-4 + marker run): with Fabric
# Scene Delegate, only content present on the stage BEFORE the first
# world.reset() renders. Attribute edits after attach (purpose flips),
# late references, and scene.add between stop/reset cycles draw NOTHING
# while physics works perfectly. Therefore:
#   - visible-ize the collider BEFORE World creation,
#   - reference the robot BEFORE World creation,
#   - author ALL props/probes before the ONE and only reset,
#   - never world.stop(), never remove content — park probes out of frame.
import json
import math
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-results.txt"
FRAMES = "/scratch/gilbreth/gupta596/surveyor/g3c-frames"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
URDF = "/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf"
ROBOT_USD = "/scratch/gilbreth/gupta596/surveyor/franka-imported.usd"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c start (single-reset flow)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted (cameras enabled)")

try:
    import numpy as np
    import omni.kit.commands
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension

    enable_extension("isaacsim.asset.importer.urdf")
    enable_extension("isaacsim.robot_motion.motion_generation")
    enable_extension("isaacsim.sensors.camera")
    log("extensions enabled")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"stage open: {ok}")
    from pxr import Gf, PhysxSchema, Sdf, UsdGeom, UsdLux, UsdPhysics
    stage = ctx.get_stage()

    # NuRec payload is absent on the cluster by design — keep it out entirely
    vis = stage.GetPrimAtPath("/World/Visuals")
    if vis and vis.IsValid():
        vis.SetActive(False)
        log("NuRec visuals prim deactivated")

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    B = (s["x"], -s["z"], s["y"])
    log(f"franka base (stage): ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    # ---- PRE-WORLD: everything renderable gets authored NOW ---------------
    # collider visible + double-sided (splat-derived normals are arbitrary;
    # single-sided walls are backface-culled from inside the room)
    shown = 0
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Mesh):
            img = UsdGeom.Imageable(prim)
            img.CreatePurposeAttr().Set(UsdGeom.Tokens.default_)
            img.MakeVisible()
            UsdGeom.Mesh(prim).CreateDoubleSidedAttr(True)
            UsdGeom.Gprim(prim).CreateDisplayColorAttr([Gf.Vec3f(0.55, 0.57, 0.6)])
            shown += 1
    log(f"world meshes visible-ized pre-attach: {shown}")

    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/g3c_dome"))
    dome.CreateIntensityAttr(600)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/g3c_sun"))
    sun.CreateIntensityAttr(2500)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))

    # robot: import into its own USD (never into the open stage), reference in
    status, import_config = omni.kit.commands.execute("URDFCreateImportConfig")
    import_config.merge_fixed_joints = False
    import_config.fix_base = True
    import_config.make_default_prim = True
    import_config.create_physics_scene = False
    status, imported_path = omni.kit.commands.execute(
        "URDFParseAndImportFile", urdf_path=URDF, import_config=import_config,
        dest_path=ROBOT_USD,
    )
    existing = stage.GetPrimAtPath(imported_path) if imported_path else None
    if existing and existing.IsValid():
        robot_path = str(imported_path)
    else:
        stage.DefinePrim("/panda").GetReferences().AddReference(ROBOT_USD)
        robot_path = "/panda"
    log(f"robot referenced at {robot_path} (from {ROBOT_USD})")
    omni.kit.commands.execute(
        "TransformPrimSRT",
        path=robot_path,
        new_translation=Gf.Vec3d(B[0], B[1], B[2]),
        new_rotation_euler=Gf.Vec3d(0, 0, 0),
        new_scale=Gf.Vec3d(1, 1, 1),
    )
    art = PhysxSchema.PhysxArticulationAPI.Get(stage, robot_path)
    art.CreateSolverPositionIterationCountAttr(64)
    art.CreateSolverVelocityIterationCountAttr(64)
    for j in range(1, 8):
        drive = UsdPhysics.DriveAPI.Get(
            stage.GetPrimAtPath(f"{robot_path}/joints/panda_joint{j}"), "angular"
        )
        drive.GetStiffnessAttr().Set(math.radians(1e8))
        drive.GetDampingAttr().Set(math.radians(1e7))
    for fj in ("panda_finger_joint1", "panda_finger_joint2"):
        prim = stage.GetPrimAtPath(f"{robot_path}/joints/{fj}")
        try:
            drive = UsdPhysics.DriveAPI.Apply(prim, "linear")
            drive.CreateStiffnessAttr(1e7)
            drive.CreateDampingAttr(1e6)
            log(f"finger drive ok: {fj}")
        except Exception as fe:
            log(f"finger drive skipped ({fj}): {fe!r}")

    # camera prim + diagnostic marker (marker goes inactive before the movie)
    cam_path = "/g3c_cam"  # ROOT level: /World carries a +90X source-frame rotation that double-rotates raw-USD children authored in world coords (the 14-job lesson)
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    eye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    aim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    marker = UsdGeom.Cube.Define(stage, Sdf.Path("/g3c_marker"))
    marker.CreateSizeAttr(0.25)
    marker.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(marker.GetPrim()).SetTranslate((aim[0], aim[1], aim[2] + 0.3))
    log("camera + marker authored")

    # ---- World + ALL physics content, still before the one reset ----------
    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid, FixedCuboid
    from isaacsim.core.api.robots import Robot

    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    robot = world.scene.add(Robot(prim_path=robot_path, name="franka"))

    FLOOR_EST = B[2]  # spawn floor; probes measured it within 3 mm on this world
    pick_xy = (B[0] + 0.45, B[1])
    place_xy = (B[0], B[1] + 0.45)
    PROBE = 0.03
    SHELF_H = 0.35
    BED_H = 0.15
    CRATE = 0.06

    world.scene.add(FixedCuboid(
        prim_path="/World/g3b_shelf", name="shelf",
        position=(pick_xy[0], pick_xy[1], FLOOR_EST + SHELF_H / 2),
        scale=(0.30, 0.30, SHELF_H), color=np.array([0.4, 0.4, 0.45]),
    ))
    world.scene.add(FixedCuboid(
        prim_path="/World/g3b_bed", name="bed",
        position=(place_xy[0], place_xy[1], FLOOR_EST + BED_H / 2),
        scale=(0.35, 0.35, BED_H), color=np.array([0.35, 0.3, 0.25]),
    ))
    crate = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_crate", name="crate",
        position=(pick_xy[0], pick_xy[1], FLOOR_EST + SHELF_H + CRATE / 2 + 0.02),
        size=CRATE, mass=0.2, color=np.array([0.8, 0.5, 0.1]),
    ))
    # surface probes: dropped ONTO shelf/bed tops + open floor (offset XY,
    # clear of the prop footprints); parked out of frame after measuring
    probeC = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeC", name="probeC",
        position=(pick_xy[0] + 0.08, pick_xy[1] + 0.08, FLOOR_EST + SHELF_H + 0.6),
        size=PROBE, mass=0.05,
    ))
    probeD = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeD", name="probeD",
        position=(place_xy[0] + 0.06, place_xy[1] - 0.06, FLOOR_EST + BED_H + 0.6),
        size=PROBE, mass=0.05,
    ))
    probeF = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeF", name="probeF",
        position=(B[0] - 0.35, B[1] + 0.55, FLOOR_EST + 0.6), size=PROBE, mass=0.05,
    ))
    log("props + probes authored (pre-reset)")

    world.get_physics_context().set_gravity(-1.62)
    world.reset()  # THE one and only reset
    dof_names = list(robot.dof_names)
    log(f"world reset (Play); gravity 1.62; dofs: {len(dof_names)}")
    finger_idx = [i for i, n in enumerate(dof_names) if n.startswith("panda_finger_joint")]

    for _ in range(360):
        world.step(render=False)
    pc, _ = probeC.get_world_pose()
    pd, _ = probeD.get_world_pose()
    pf, _ = probeF.get_world_pose()
    cp0, _ = crate.get_world_pose()
    shelf_top = float(pc[2]) - PROBE / 2
    bed_top = float(pd[2]) - PROBE / 2
    floor_meas = float(pf[2]) - PROBE / 2
    crate_half = float(cp0[2]) - shelf_top
    log(f"measured: floor {floor_meas:.3f} (est {FLOOR_EST:.3f}), shelf top {shelf_top:.3f}, bed top {bed_top:.3f}, crate half {crate_half:.3f}")

    # park the probes out of frame (never remove content mid-play)
    try:
        for p, dx in ((probeC, 4.0), (probeD, 4.5), (probeF, 5.0)):
            p.set_world_pose(np.array([B[0] + dx, B[1] - 4.0, FLOOR_EST + 0.2]), np.array([1.0, 0, 0, 0]))
            p.set_linear_velocity(np.zeros(3))
        log("probes parked out of frame")
    except Exception as pe:
        log(f"probe parking skipped: {pe!r}")

    # ---- capture: renderer verified via marker, scene via marker-off ------
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(1280, 720))
    cam.initialize()
    os.makedirs(FRAMES, exist_ok=True)
    from PIL import Image
    frame_no = [0]
    def snap():
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return
        Image.fromarray(rgba[:, :, :3]).save(f"{FRAMES}/frame_{frame_no[0]:05d}.png")
        frame_no[0] += 1
    def frame_spread():
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return -1.0
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        return float(core.max()) - float(core.min())

    for _ in range(30):
        world.step(render=True)
    with_marker = frame_spread()
    log(f"warmup spread with marker: {with_marker:.0f}")
    marker.GetPrim().SetActive(False)
    for _ in range(15):
        world.step(render=True)
    scene_spread = frame_spread()
    log(f"scene-only spread (marker off): {scene_spread:.0f}")
    if with_marker <= 8:
        log("RENDER_DEAD — even the marker is invisible; aborting")
        raise RuntimeError("render product produced uniform frames")
    if scene_spread <= 8:
        log("SCENE_CONTENT_INVISIBLE — single-reset flow did NOT cure content ingestion; aborting to save walltime")
        raise RuntimeError("scene content invisible with healthy renderer")
    snap()
    log(f"SCENE RENDERS (spread {scene_spread:.0f}) — proceeding to choreography")

    # ---- RMPflow (verbatim from the proven g3b path) -----------------------
    from isaacsim.robot_motion.motion_generation import ArticulationMotionPolicy
    from isaacsim.robot_motion.motion_generation.interface_config_loader import (
        load_supported_motion_policy_config,
    )
    try:
        from isaacsim.robot_motion.motion_generation.lula import RmpFlow
    except ImportError:
        from isaacsim.robot_motion.motion_generation.lula.motion_policies import RmpFlow
    rmp_cfg = load_supported_motion_policy_config("Franka", "RMPflow")
    rmpflow = RmpFlow(**rmp_cfg)
    rmpflow.set_robot_base_pose(np.array(B), np.array([1.0, 0.0, 0.0, 0.0]))
    policy = ArticulationMotionPolicy(robot, rmpflow, 1.0 / 60.0)
    log("rmpflow ready")

    from isaacsim.core.utils.types import ArticulationAction
    DOWN = np.array([0.0, 1.0, 0.0, 0.0])
    ctrl = robot.get_articulation_controller()

    def fingers(width):
        if not finger_idx:
            return
        ctrl.apply_action(ArticulationAction(
            joint_positions=np.array([width] * len(finger_idx)), joint_indices=np.array(finger_idx)
        ))

    def run_phase(name, target, grip, steps):
        if target is not None:
            rmpflow.set_end_effector_target(
                target_position=np.array(target), target_orientation=DOWN
            )
        fingers(grip)
        for i in range(steps):
            render = (i % 2 == 0)  # 30 fps
            if target is not None:
                ctrl.apply_action(policy.get_next_articulation_action(1.0 / 60.0))
            world.step(render=render)
            if render:
                snap()
        cp, _ = crate.get_world_pose()
        log(f"phase {name}: crate [{cp[0]:.3f}, {cp[1]:.3f}, {cp[2]:.3f}] frames {frame_no[0]}")
        return np.array([float(v) for v in cp])

    HOVER = 0.14
    crate_pos = run_phase("settle", None, 0.04, 90)
    pick = crate_pos.copy()
    place = np.array([place_xy[0], place_xy[1], bed_top + crate_half])
    log(f"pick (measured): [{pick[0]:.3f}, {pick[1]:.3f}, {pick[2]:.3f}]; place (measured): [{place[0]:.3f}, {place[1]:.3f}, {place[2]:.3f}]")

    run_phase("pre-pick", pick + [0, 0, HOVER], 0.04, 260)
    run_phase("descend", pick + [0, 0, 0.005], 0.04, 200)
    run_phase("close", pick + [0, 0, 0.005], 0.0225, 110)
    run_phase("lift", pick + [0, 0, HOVER + 0.06], 0.0225, 170)
    run_phase("traverse", place + [0, 0, HOVER], 0.0225, 260)
    run_phase("lower", place + [0, 0, 0.012], 0.0225, 200)
    run_phase("release", place + [0, 0, 0.012], 0.04, 110)
    run_phase("retreat", place + [0, 0, HOVER + 0.08], 0.04, 140)

    tracks = []
    for i in range(90):
        world.step(render=(i % 2 == 0))
        if i % 2 == 0:
            snap()
        if i % 30 == 29:
            cp, _ = crate.get_world_pose()
            tracks.append([round(float(v), 4) for v in cp])
    log(f"post-release track: {tracks}")

    final = np.array(tracks[-1])
    dz = max(t[2] for t in tracks) - min(t[2] for t in tracks)
    on_bed_xy = abs(final[0] - place[0]) < 0.10 and abs(final[1] - place[1]) < 0.10
    on_bed_z = abs(final[2] - place[2]) < 0.05
    at_rest = dz < 0.005
    n_frames = frame_no[0]
    log(f"on_bed_xy: {on_bed_xy}; on_bed_z: {on_bed_z} (z {final[2]:.3f} vs {place[2]:.3f}); at_rest: {at_rest}; frames: {n_frames}")
    ok_all = on_bed_xy and on_bed_z and at_rest and n_frames >= 300
    log("G3C_" + ("PASS" if ok_all else "FAIL"))
except Exception as e:
    import traceback
    log("G3C_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
