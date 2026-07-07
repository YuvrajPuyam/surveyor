# G3c-DBG3: which g3c ingredient kills rendering? Single job, staged probes:
#   S1 minimal stage renders (baseline, known-good from dbg1)
#   S2 after 300 render=False steps            -> ?
#   S3 after world.stop() + world.reset()      -> ? (same camera)
#   S4 fresh Camera wrapper after the stop     -> ?
#   S5 after scene.add(DynamicCuboid) + reset  -> ?
#   S6 after URDF ext + import                 -> ?
# The first stage that goes blank names the poison.
RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg3-results.txt"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c-dbg3 start")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import numpy as np
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.sensors.camera")

    ctx = omni.usd.get_context()
    ctx.new_stage()
    stage = ctx.get_stage()
    from pxr import Gf, Sdf, UsdGeom, UsdLux
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    cube = UsdGeom.Cube.Define(stage, Sdf.Path("/World/dbg_cube"))
    cube.CreateSizeAttr(1.0)
    cube.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(cube.GetPrim()).SetTranslate((2.0, 0.0, 1.0))
    UsdLux.DomeLight.Define(stage, Sdf.Path("/World/dbg_dome")).CreateIntensityAttr(1000)
    cam_path = "/World/dbg_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(0, 0, 1.0), Gf.Vec3d(2, 0, 1.0), Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())

    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(640, 480))
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
    visible("S1 baseline", cam)

    warm(300, render=False)
    warm(20)
    visible("S2 after 300 render=False steps", cam)

    world.stop()
    world.reset()
    warm(20)
    visible("S3 after stop+reset (same camera)", cam)

    cam2 = Camera(prim_path=cam_path, resolution=(640, 480))
    cam2.initialize()
    warm(20)
    visible("S4 fresh wrapper after stop", cam2)

    world.scene.add(DynamicCuboid(
        prim_path="/World/dbg_dyn", name="dbg_dyn",
        position=(2.0, 0.6, 1.2), size=0.3, mass=0.1,
        color=np.array([0.1, 0.4, 1.0]),
    ))
    world.reset()
    warm(20)
    visible("S5 after scene.add + reset", cam2)

    log("enabling urdf ext + importing franka...")
    enable_extension("isaacsim.asset.importer.urdf")
    import omni.kit.commands
    status, import_config = omni.kit.commands.execute("URDFCreateImportConfig")
    import_config.merge_fixed_joints = False
    import_config.fix_base = True
    import_config.make_default_prim = False
    import_config.create_physics_scene = False
    URDF = "/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf"
    status, robot_path = omni.kit.commands.execute(
        "URDFParseAndImportFile", urdf_path=URDF, import_config=import_config
    )
    log(f"urdf at {robot_path}")
    warm(20)
    visible("S6 after urdf import", cam2)

    log("G3CDBG3_DONE")
except Exception as e:
    import traceback
    log("G3CDBG3_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
