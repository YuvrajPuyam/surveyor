# G3c-DBG4: replicate g3c's EXACT preamble, checkpointing the render after
# each layer. dbg3 cleared every ingredient in isolation; this catches the
# combination. A red cube sits at the camera's exact AIM point, so "camera
# aimed at nothing" cannot masquerade as "renderer broken".
#   T1 g3c ext order (urdf, motion_gen, camera) + pack stage + rig
#   T2 + URDF import + TransformPrimSRT + articulation APIs + drives
#   T3 + visible-ized world meshes + g3c lights
#   T4 + Robot() scene.add + props via scene.add
#   T5 + the exact three-cycle calibration (stop/reset x3), fresh 720p wrapper
import json

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg4-results.txt"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
URDF = "/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c-dbg4 start")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import math
    import numpy as np
    import omni.kit.commands
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension

    # g3c's exact extension order
    enable_extension("isaacsim.asset.importer.urdf")
    enable_extension("isaacsim.robot_motion.motion_generation")
    enable_extension("isaacsim.sensors.camera")
    log("extensions enabled (g3c order)")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"pack stage open: {ok}")
    stage = ctx.get_stage()

    from pxr import Gf, PhysxSchema, Sdf, UsdGeom, UsdLux, UsdPhysics

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    B = (s["x"], -s["z"], s["y"])
    log(f"base B: ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    # camera rig at g3c's exact pose; RED CUBE AT THE AIM POINT
    cam_path = "/World/g3c_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    eye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    aim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    marker = UsdGeom.Cube.Define(stage, Sdf.Path("/World/dbg4_marker"))
    marker.CreateSizeAttr(0.3)
    marker.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(marker.GetPrim()).SetTranslate((aim[0], aim[1], aim[2]))
    UsdLux.DomeLight.Define(stage, Sdf.Path("/World/dbg4_dome")).CreateIntensityAttr(1000)
    log("rig + aim marker defined")

    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid, FixedCuboid
    from isaacsim.core.api.robots import Robot
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(1280, 720))
    world.reset()
    cam.initialize()

    def visible(tag, c):
        rgba = c.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            log(f"{tag}: EMPTY")
            return False
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        spread = float(core.max()) - float(core.min())
        log(f"{tag}: core spread {spread:.0f} VISIBLE={spread > 8}")
        return spread > 8

    def warm(n, render=True):
        for _ in range(n):
            world.step(render=render)

    warm(20)
    visible("T1 ext-order + pack + rig", cam)

    # ---- T2: URDF import + articulation config (verbatim g3c)
    status, import_config = omni.kit.commands.execute("URDFCreateImportConfig")
    import_config.merge_fixed_joints = False
    import_config.fix_base = True
    import_config.make_default_prim = False
    import_config.create_physics_scene = False
    status, robot_path = omni.kit.commands.execute(
        "URDFParseAndImportFile", urdf_path=URDF, import_config=import_config
    )
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
        except Exception:
            pass
    warm(20)
    visible("T2 + urdf/articulation", cam)

    # ---- T3: visible-ized meshes + g3c lights
    shown = 0
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Mesh) and not str(prim.GetPath()).startswith("/panda"):
            UsdGeom.Imageable(prim).CreatePurposeAttr().Set(UsdGeom.Tokens.default_)
            UsdGeom.Gprim(prim).CreateDisplayColorAttr([Gf.Vec3f(0.55, 0.57, 0.6)])
            shown += 1
    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/World/g3c_dome"))
    dome.CreateIntensityAttr(600)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/World/g3c_sun"))
    sun.CreateIntensityAttr(2500)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))
    warm(20)
    visible(f"T3 + visible meshes ({shown}) + lights", cam)

    # ---- T4: Robot + props via scene.add, then reset (as g3c)
    robot = world.scene.add(Robot(prim_path=robot_path, name="franka"))
    pick_xy = (B[0] + 0.45, B[1])
    world.scene.add(FixedCuboid(
        prim_path="/World/g3b_shelf", name="shelf",
        position=(pick_xy[0], pick_xy[1], B[2] + 0.2),
        scale=(0.30, 0.30, 0.35), color=np.array([0.4, 0.4, 0.45]),
    ))
    world.get_physics_context().set_gravity(-1.62)
    world.reset()
    warm(20)
    visible("T4 + Robot/scene.add + reset", cam)

    # ---- T5: g3c's exact three stop/reset calibration cycles + fresh wrapper
    p1 = world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeA", name="probeA",
        position=(pick_xy[0] + 0.15, pick_xy[1] + 0.15, B[2] + 0.6), size=0.03, mass=0.05,
    ))
    world.reset()
    warm(60, render=False)
    world.stop()
    world.scene.remove_object("probeA")
    world.scene.add(DynamicCuboid(
        prim_path="/World/g3b_probeC", name="probeC",
        position=(pick_xy[0] + 0.08, pick_xy[1] + 0.08, B[2] + 1.2), size=0.03, mass=0.05,
    ))
    world.reset()
    warm(60, render=False)
    world.stop()
    world.scene.remove_object("probeC")
    world.reset()
    warm(60, render=False)
    cam5 = Camera(prim_path=cam_path, resolution=(1280, 720))
    cam5.initialize()
    warm(30)
    visible("T5 post-calibration fresh wrapper", cam5)
    visible("T5b same check on original wrapper", cam)

    log("G3CDBG4_DONE")
except Exception as e:
    import traceback
    log("G3CDBG4_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
