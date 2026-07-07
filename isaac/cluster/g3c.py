# G3c: g3b's proven pick-and-place, CAPTURED ON CAMERA (headless RGB frames).
# Franka (bundled URDF) + RMPflow (bundled config), crate shelf -> bed at
# lunar gravity inside the Certified World Pack; every surface probe-measured.
# Frames -> /scratch/.../g3c-frames/ at 30 fps via Camera sensor + PIL.
import json
import math
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-results.txt"
FRAMES = "/scratch/gilbreth/gupta596/surveyor/g3c-frames"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
URDF = "/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c start")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted (cameras enabled)")

try:
    import numpy as np
    import omni.kit.commands
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension

    log("enabling urdf importer ext...")
    enable_extension("isaacsim.asset.importer.urdf")
    log("enabling motion_generation ext...")
    enable_extension("isaacsim.robot_motion.motion_generation")
    log("enabling camera sensor ext...")
    enable_extension("isaacsim.sensors.camera")
    log("extensions enabled")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"stage open: {ok}")

    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid, FixedCuboid
    from isaacsim.core.api.robots import Robot

    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    B = (s["x"], -s["z"], s["y"])
    log(f"franka base (stage): ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    status, import_config = omni.kit.commands.execute("URDFCreateImportConfig")
    import_config.merge_fixed_joints = False
    import_config.fix_base = True
    import_config.make_default_prim = False
    import_config.create_physics_scene = False
    status, robot_path = omni.kit.commands.execute(
        "URDFParseAndImportFile", urdf_path=URDF, import_config=import_config
    )
    log(f"urdf imported at: {robot_path}")

    from pxr import Gf, PhysxSchema, Sdf, UsdGeom, UsdLux, UsdPhysics
    stage = ctx.get_stage()
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
    log("drives configured")

    # ---- make the collider world visible + lit (splats = absent NuRec payload)
    shown = 0
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Mesh) and not str(prim.GetPath()).startswith("/panda"):
            img = UsdGeom.Imageable(prim)
            img.CreatePurposeAttr().Set(UsdGeom.Tokens.default_)
            UsdGeom.Gprim(prim).CreateDisplayColorAttr([Gf.Vec3f(0.55, 0.57, 0.6)])
            shown += 1
    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/World/g3c_dome"))
    dome.CreateIntensityAttr(600)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/World/g3c_sun"))
    sun.CreateIntensityAttr(2500)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))
    log(f"world meshes made visible: {shown}; lights added")

    robot = world.scene.add(Robot(prim_path=robot_path, name="franka"))

    # ---- camera EARLY: render products must exist before sim start/reset
    cam_path = "/World/g3c_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    eye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    aim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(1280, 720))
    log("camera prim + wrapper created (pre-reset)")

    # ---- CALIBRATION PASS 1: floor support
    pick_xy = (B[0] + 0.45, B[1])
    place_xy = (B[0], B[1] + 0.45)
    PROBE = 0.03
    probeA = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeA", name="probeA",
        position=(pick_xy[0], pick_xy[1], B[2] + 0.6), size=PROBE, mass=0.05,
    ))
    probeB = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeB", name="probeB",
        position=(place_xy[0], place_xy[1], B[2] + 0.6), size=PROBE, mass=0.05,
    ))
    world.get_physics_context().set_gravity(-1.62)
    world.reset()
    cam.initialize()
    log("camera initialized")
    for _ in range(300):
        world.step(render=False)
    pa, _ = probeA.get_world_pose()
    pb, _ = probeB.get_world_pose()
    supportA = float(pa[2]) - PROBE / 2
    supportB = float(pb[2]) - PROBE / 2
    log(f"measured floor support: pick {supportA:.3f} (spawn floor {B[2]:.3f}), place {supportB:.3f}")
    world.stop()
    world.scene.remove_object("probeA")
    world.scene.remove_object("probeB")

    # ---- props + surface probes
    SHELF_H = 0.35
    BED_H = 0.15
    CRATE = 0.06
    world.scene.add(FixedCuboid(
        prim_path="/World/g3b_shelf", name="shelf",
        position=(pick_xy[0], pick_xy[1], supportA + SHELF_H / 2),
        scale=(0.30, 0.30, SHELF_H), color=np.array([0.4, 0.4, 0.45]),
    ))
    world.scene.add(FixedCuboid(
        prim_path="/World/g3b_bed", name="bed",
        position=(place_xy[0], place_xy[1], supportB + BED_H / 2),
        scale=(0.35, 0.35, BED_H), color=np.array([0.35, 0.3, 0.25]),
    ))
    crate = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_crate", name="crate",
        position=(pick_xy[0], pick_xy[1], supportA + SHELF_H + CRATE / 2 + 0.01),
        size=CRATE, mass=0.2, color=np.array([0.8, 0.5, 0.1]),
    ))
    probeC = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeC", name="probeC",
        position=(pick_xy[0] + 0.08, pick_xy[1] + 0.08, supportA + 1.2), size=PROBE, mass=0.05,
    ))
    probeD = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeD", name="probeD",
        position=(place_xy[0] + 0.06, place_xy[1] - 0.06, supportB + 1.2), size=PROBE, mass=0.05,
    ))
    log("props + surface probes placed")

    world.reset()
    dof_names = list(robot.dof_names)
    log(f"world reset (Play); gravity 1.62; dofs: {len(dof_names)}")
    finger_idx = [i for i, n in enumerate(dof_names) if n.startswith("panda_finger_joint")]

    for _ in range(300):
        world.step(render=False)
    pc, _ = probeC.get_world_pose()
    pd, _ = probeD.get_world_pose()
    cp0, _ = crate.get_world_pose()
    shelf_top = float(pc[2]) - PROBE / 2
    bed_top = float(pd[2]) - PROBE / 2
    crate_half = float(cp0[2]) - shelf_top
    log(f"measured surfaces: shelf top {shelf_top:.3f}, bed top {bed_top:.3f}, crate half {crate_half:.3f}")
    world.stop()
    world.scene.remove_object("probeC")
    world.scene.remove_object("probeD")
    world.reset()
    for _ in range(300):
        world.step(render=False)
    cp0, _ = crate.get_world_pose()
    log(f"crate re-settled at [{cp0[0]:.3f}, {cp0[1]:.3f}, {cp0[2]:.3f}]")

    # ---- capture plumbing. The g3c-dbg bisect proved get_rgba() works from
    # 8 warmups on a single-reset stage; the blank frames came from the THREE
    # stop/reset cycles above orphaning the render product bound at the early
    # initialize(). Re-bind AFTER the final reset and verify the first frame
    # is non-uniform before spending the full choreography.
    cam.initialize()  # re-bind render product post stop/reset cycles
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
        return float(rgb.max()) - float(rgb.min())
    spread = -1.0
    for attempt in range(3):
        for _ in range(30):
            world.step(render=True)
        spread = frame_spread()
        log(f"warmup attempt {attempt}: frame spread {spread:.0f}")
        if spread > 8:
            break
        cam.initialize()  # still clear-color: re-bind and retry
    if spread <= 8:
        log("RENDER_STILL_BLANK after 3 re-binds — aborting before choreography")
        raise RuntimeError("camera render product produced uniform frames")
    snap()
    log(f"camera live (spread {spread:.0f}); warmup frame written: {frame_no[0] > 0}")

    # ---- RMPflow
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
