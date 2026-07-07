# G3c-DBG2: is the PACK STAGE what poisons the render? Bisect:
# fresh-stage render already PASSES (dbg1). Now: open the pack stage, add the
# same known-good cube+light+camera -> snap (hypothesis: blank). Deactivate
# the unresolved NuRec payload prim -> snap again (hypothesis: renders).
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg2-results.txt"
OUTDIR = "/scratch/gilbreth/gupta596/surveyor"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c-dbg2 start")
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
    stage = ctx.get_stage()
    log(f"pack stage open: {ok}")

    from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux

    # inventory the root prims + spot unresolved composition arcs
    for prim in stage.GetPseudoRoot().GetChildren():
        for child in prim.GetChildren():
            kinds = []
            if child.HasAuthoredPayloads():
                kinds.append("payload")
            if child.HasAuthoredReferences():
                kinds.append("reference")
            log(f"prim {child.GetPath()} active={child.IsActive()} loaded={child.IsLoaded()} arcs={kinds}")

    # known-good render rig, floating far from world geometry
    cube = UsdGeom.Cube.Define(stage, Sdf.Path("/World/dbg2_cube"))
    cube.CreateSizeAttr(1.0)
    cube.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(cube.GetPrim()).SetTranslate((2.0, 0.0, 10.0))
    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/World/dbg2_dome"))
    dome.CreateIntensityAttr(1000)
    cam_path = "/World/dbg2_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(0, 0, 10.0), Gf.Vec3d(2, 0, 10.0), Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    log("rig defined on pack stage")

    from isaacsim.core.api import World
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(640, 480))
    world.reset()
    cam.initialize()
    log("world reset + camera initialized")

    def center_stats(tag):
        # judge by the CENTER region — dbg1's border line fools full-frame spread
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            log(f"{tag}: EMPTY")
            return False
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        spread = float(core.max()) - float(core.min())
        ch = [round(float(core[..., c].mean()), 1) for c in range(3)]
        log(f"{tag}: core spread {spread:.0f} ch {ch} SCENE_VISIBLE={spread > 8}")
        return spread > 8

    def warm(n):
        for _ in range(n):
            world.step(render=True)

    warm(30)
    pass1 = center_stats("PASS1 pack stage as-is")

    # deactivate the NuRec visuals prim (unresolved payload suspect) + retry
    suspects = []
    for path in ("/World/Visuals", "/World/visuals", "/Visuals"):
        p = stage.GetPrimAtPath(path)
        if p and p.IsValid():
            p.SetActive(False)
            suspects.append(path)
    log(f"deactivated: {suspects}")
    warm(30)
    pass2 = center_stats("PASS2 visuals deactivated")

    pass3 = None
    if not pass2:
        # nuclear: deactivate every root child except our rig
        killed = []
        for prim in stage.GetPrimAtPath("/World").GetChildren():
            nm = prim.GetName()
            if not nm.startswith("dbg2_"):
                prim.SetActive(False)
                killed.append(nm)
        log(f"deactivated all non-rig under /World: {killed}")
        warm(30)
        pass3 = center_stats("PASS3 only rig active")

    try:
        from PIL import Image
        rgba = cam.get_rgba()
        Image.fromarray(np.asarray(rgba)[:, :, :3].astype(np.uint8)).save(f"{OUTDIR}/g3c-dbg2-frame.png")
        log("png saved")
    except Exception as pe:
        log(f"png save failed: {pe!r}")

    log(f"VERDICT pass1={pass1} pass2={pass2} pass3={pass3}")
    log("G3CDBG2_" + ("PASS" if (pass1 or pass2 or pass3) else "FAIL"))
except Exception as e:
    import traceback
    log("G3CDBG2_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
