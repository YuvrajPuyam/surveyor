# G3c-DBG: isolate the blank-frame render bug on a MINIMAL stage.
# No pack, no robot: one bright cube + dome light + camera. Sweep warmup
# depth for Camera.get_rgba(), then try the Replicator annotator path.
# Everything logged to a results FILE (kit swallows stdout).
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg-results.txt"
OUTPNG = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg-frame.png"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c-dbg start")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted (cameras enabled)")

try:
    import numpy as np
    import carb.settings
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension

    enable_extension("isaacsim.sensors.camera")
    log("camera ext enabled")

    st = carb.settings.get_settings()
    for key in ("/renderer/active", "/renderer/enabled", "/rtx/rendermode",
                "/app/renderer/skipWhileMinimized", "/app/window/hideUi"):
        try:
            log(f"setting {key} = {st.get(key)!r}")
        except Exception as se:
            log(f"setting {key} unreadable: {se!r}")

    ctx = omni.usd.get_context()
    ctx.new_stage()
    stage = ctx.get_stage()
    log("fresh stage")

    from pxr import Gf, Sdf, UsdGeom, UsdLux
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)

    # big bright cube 2 m in front of camera
    cube = UsdGeom.Cube.Define(stage, Sdf.Path("/World/dbg_cube"))
    cube.CreateSizeAttr(1.0)
    cube.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(cube.GetPrim()).SetTranslate((2.0, 0.0, 1.0))

    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/World/dbg_dome"))
    dome.CreateIntensityAttr(1000)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/World/dbg_sun"))
    sun.CreateIntensityAttr(3000)
    log("cube + lights defined")

    cam_path = "/World/dbg_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(0, 0, 1.0), Gf.Vec3d(2, 0, 1.0), Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())

    from isaacsim.core.api import World
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)

    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(640, 480))
    log("camera wrapper created")

    world.reset()
    cam.initialize()
    log("world reset + camera initialized")

    def stats(tag, arr):
        if arr is None or getattr(arr, "size", 0) == 0:
            log(f"{tag}: EMPTY")
            return False
        a = np.asarray(arr)
        rgb = a[:, :, :3] if a.ndim == 3 and a.shape[2] >= 3 else a
        mean = rgb.mean()
        spread = float(rgb.max()) - float(rgb.min())
        ch = [round(float(rgb[..., c].mean()), 1) for c in range(rgb.shape[-1])] if rgb.ndim == 3 else []
        nonuniform = spread > 8
        log(f"{tag}: shape {a.shape} mean {mean:.1f} spread {spread:.0f} ch {ch} NONUNIFORM={nonuniform}")
        return nonuniform

    # ---- TEST A: Camera.get_rgba() at increasing warmup depth
    won = None
    total = 0
    for target in (8, 16, 30, 60, 120, 240):
        while total < target:
            world.step(render=True)
            total += 1
        ok = stats(f"A get_rgba after {target} render steps", cam.get_rgba())
        if ok and won is None:
            won = f"A@{target}"

    # ---- TEST A2: pure app.update() ticks (no physics) on top
    for _ in range(60):
        app.update()
    ok = stats("A2 get_rgba after +60 app.update", cam.get_rgba())
    if ok and won is None:
        won = "A2"

    # ---- TEST B: Replicator annotator path
    try:
        import omni.replicator.core as rep
        rp = rep.create.render_product(cam_path, (640, 480))
        annot = rep.AnnotatorRegistry.get_annotator("rgb")
        annot.attach([rp])
        log("replicator render_product + rgb annotator attached")
        for k in range(4):
            rep.orchestrator.step(rt_subframes=8)
            data = annot.get_data()
            ok = stats(f"B replicator step {k}", data)
            if ok:
                if won is None:
                    won = f"B@{k}"
                try:
                    from PIL import Image
                    a = np.asarray(data)
                    Image.fromarray(a[:, :, :3].astype(np.uint8)).save(OUTPNG)
                    log(f"png saved: {OUTPNG}")
                except Exception as pe:
                    log(f"png save failed: {pe!r}")
                break
    except Exception as be:
        import traceback
        log("TEST B error " + repr(be))
        log(traceback.format_exc())

    # if A won and no png yet, save from get_rgba
    if won and not os.path.exists(OUTPNG):
        try:
            from PIL import Image
            rgba = cam.get_rgba()
            Image.fromarray(np.asarray(rgba)[:, :, :3].astype(np.uint8)).save(OUTPNG)
            log(f"png saved from get_rgba: {OUTPNG}")
        except Exception as pe:
            log(f"png save failed: {pe!r}")

    log(f"WINNER: {won}")
    log("G3CDBG_" + ("PASS" if won else "FAIL"))
except Exception as e:
    import traceback
    log("G3CDBG_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
