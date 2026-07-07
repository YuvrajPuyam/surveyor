# G3c-DBG6: does the NuRec payload RENDER in this container? Pack stage with
# /World/Visuals ACTIVE (payload now present), root-level camera at the g3c
# pose, no robot, no props. Spread + PNG = verdict on the photoreal layer.
RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3c-dbg6-results.txt"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3c-dbg6 start (NuRec payload render test)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import json
    import numpy as np
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.sensors.camera")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    stage = ctx.get_stage()
    log(f"pack stage open: {ok}")

    from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux
    vis = stage.GetPrimAtPath("/World/Visuals")
    log(f"/World/Visuals valid={bool(vis and vis.IsValid())} active={vis.IsActive() if vis else None} loaded={vis.IsLoaded() if vis else None}")
    # inventory what the payload brought in
    n_prims = 0
    kinds = {}
    if vis and vis.IsValid():
        for p in Usd.PrimRange(vis):
            n_prims += 1
            kinds[p.GetTypeName()] = kinds.get(p.GetTypeName(), 0) + 1
    log(f"visuals subtree prims: {n_prims} · types: {kinds}")

    with open("/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json") as f:
        s = json.load(f)[0]
    B = (s["x"], -s["z"], s["y"])

    # root-level camera (the 14-job lesson) at the g3c pose
    cam_path = "/dbg6_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    eye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    aim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    UsdLux.DomeLight.Define(stage, Sdf.Path("/dbg6_dome")).CreateIntensityAttr(800)

    from isaacsim.core.api import World
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(1280, 720))
    world.reset()
    cam.initialize()
    for _ in range(60):
        world.step(render=True)
    rgba = cam.get_rgba()
    if rgba is None or getattr(rgba, "size", 0) == 0:
        log("frame EMPTY")
        spread = -1.0
    else:
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        spread = float(core.max()) - float(core.min())
        ch = [round(float(core[..., c].mean()), 1) for c in range(3)]
        log(f"core spread {spread:.0f} ch {ch}")
        from PIL import Image
        Image.fromarray(rgb.astype(np.uint8)).save("/scratch/gilbreth/gupta596/surveyor/g3c-dbg6-frame.png")
        log("png saved")
    log("G3CDBG6_" + ("PASS" if spread > 8 else "FAIL"))
except Exception as e:
    import traceback
    log("G3CDBG6_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
