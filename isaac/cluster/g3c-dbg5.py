# G3c-DBG5: the physics-prims-are-invisible hypothesis. Every prim with
# physics (collider/robot/props/probes) draws nothing; every plain-USD prim
# (marker, debug cubes) draws. Suspect: PhysX Fabric owns physics prims and
# the classic hydra path stops drawing them. Two candidate cures, selected
# by env var so the same script serves two parallel jobs:
#   G3C_FIX=usd     -> /physics/fabricEnabled=False (+updateToUsd)
#   G3C_FIX=fsd     -> /app/useFabricSceneDelegate=True
import os

MODE = os.environ.get("G3C_FIX", "classic")
RESULTS = f"/scratch/gilbreth/gupta596/surveyor/g3c-dbg5-{MODE}-results.txt"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log(f"g3c-dbg5 start (mode={MODE})")
from isaaclab.app import AppLauncher
if MODE in ("classic", "readback"):
    import sys
    KA = ("--/physics/suppressReadback=false --/physics/fabricEnabled=false --/physics/updateToUsd=true"
          if MODE == "readback" else
          "--/app/useFabricSceneDelegate=false --/physics/fabricEnabled=false --/physics/updateToUsd=true")
    sys.argv += ["--kit_args", KA]
    import argparse
    parser = argparse.ArgumentParser()
    AppLauncher.add_app_launcher_args(parser)
    args = parser.parse_args(sys.argv[1:])
    args.headless = True
    args.enable_cameras = True
    app = AppLauncher(args).app
else:
    app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import numpy as np
    import carb.settings
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.sensors.camera")

    st = carb.settings.get_settings()
    for key in ("/physics/fabricEnabled", "/physics/updateToUsd", "/physics/suppressReadback",
                "/app/useFabricSceneDelegate", "/app/usdrt/population/utils/mergeInstances"):
        try:
            log(f"BEFORE {key} = {st.get(key)!r}")
        except Exception:
            log(f"BEFORE {key} unreadable")

    if MODE == "classic":
        # boot-time kit_args did the real work; log the post-boot values above
        log("classic mode: FSD + physics fabric disabled via boot kit_args")
    elif MODE == "usd":
        st.set("/physics/fabricEnabled", False)
        st.set("/physics/updateToUsd", True)
        log("SET /physics/fabricEnabled=False, /physics/updateToUsd=True")
    else:
        st.set("/app/useFabricSceneDelegate", True)
        log("SET /app/useFabricSceneDelegate=True")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    stage = ctx.get_stage()
    log(f"pack stage open: {ok}")

    from pxr import Gf, Sdf, UsdGeom, UsdLux
    vis = stage.GetPrimAtPath("/World/Visuals")
    if vis and vis.IsValid():
        vis.SetActive(False)

    # visible-ize the collider (purpose guide -> default, doubleSided)
    for prim in stage.Traverse():
        if prim.IsA(UsdGeom.Mesh):
            img = UsdGeom.Imageable(prim)
            img.CreatePurposeAttr().Set(UsdGeom.Tokens.default_)
            img.MakeVisible()
            UsdGeom.Mesh(prim).CreateDoubleSidedAttr(True)
            UsdGeom.Gprim(prim).CreateDisplayColorAttr([Gf.Vec3f(0.55, 0.57, 0.6)])
    UsdLux.DomeLight.Define(stage, Sdf.Path("/World/dbg5_dome")).CreateIntensityAttr(1000)

    import json
    with open("/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json") as f:
        s = json.load(f)[0]
    B = (s["x"], -s["z"], s["y"])
    cam_path = "/World/dbg5_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    eye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    aim = Gf.Vec3d(B[0] + 0.25, B[1] + 0.22, B[2] + 0.25)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    marker = UsdGeom.Cube.Define(stage, Sdf.Path("/World/dbg5_marker"))
    marker.CreateSizeAttr(0.25)
    marker.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(marker.GetPrim()).SetTranslate((aim[0], aim[1], aim[2] + 0.3))

    from isaacsim.core.api import World
    from isaacsim.core.api.objects import FixedCuboid
    world = World(stage_units_in_meters=1.0, physics_dt=1.0 / 60.0, rendering_dt=1.0 / 60.0)
    world.scene.add(FixedCuboid(
        prim_path="/World/dbg5_shelf", name="shelf",
        position=(B[0] + 0.45, B[1], B[2] + 0.2),
        scale=(0.30, 0.30, 0.35), color=np.array([0.2, 0.5, 0.9]),
    ))
    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(640, 480))
    # decisive mechanism datum: are physics prims visible BEFORE Play?
    import omni.kit.app as _ka
    for _ in range(20):
        _ka.get_app().update()
    pre = cam.get_rgba()
    if pre is not None and getattr(pre, "size", 0) > 0:
        rgbp = np.asarray(pre)[:, :, :3]
        hh, ww = rgbp.shape[0], rgbp.shape[1]
        corep = rgbp[hh // 4 : 3 * hh // 4, ww // 4 : 3 * ww // 4]
        log(f"PRE-PLAY spread: {float(corep.max()) - float(corep.min()):.0f}")
    else:
        log("PRE-PLAY: camera empty before initialize (expected on some builds)")
    world.reset()
    cam.initialize()
    log("world reset + camera initialized")

    def spread(tag):
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            log(f"{tag}: EMPTY")
            return -1.0
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        sp = float(core.max()) - float(core.min())
        log(f"{tag}: core spread {sp:.0f}")
        return sp

    if MODE == "viewport":
        from omni.kit.viewport.utility import get_active_viewport, capture_viewport_to_file
        vp = get_active_viewport()
        log(f"viewport: {vp!r}")
        vp.camera_path = cam_path
        marker.GetPrim().SetActive(False)  # scene-only from the start
        for _ in range(45):
            world.step(render=True)
        outf = f"/scratch/gilbreth/gupta596/surveyor/g3c-dbg5-{MODE}-frame.png"
        cap = capture_viewport_to_file(vp, outf)
        for _ in range(30):
            world.step(render=True)
        import os as _os
        ok_png = _os.path.exists(outf) and _os.path.getsize(outf) > 0
        log(f"viewport capture written: {ok_png}")
        # measure the png itself
        scene = -1.0
        if ok_png:
            from PIL import Image as _I
            a = np.asarray(_I.open(outf).convert("RGB"))
            h, w = a.shape[0], a.shape[1]
            core = a[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
            scene = float(core.max()) - float(core.min())
            log(f"viewport png core spread: {scene:.0f}")
        with_marker = scene  # not separately measured in this mode
    else:
        for _ in range(30):
            world.step(render=True)
        with_marker = spread("with marker")
        marker.GetPrim().SetActive(False)
        for _ in range(15):
            world.step(render=True)
        scene = spread("scene only (collider + physics shelf)")

    try:
        from PIL import Image
        rgba = cam.get_rgba()
        Image.fromarray(np.asarray(rgba)[:, :, :3].astype(np.uint8)).save(
            f"/scratch/gilbreth/gupta596/surveyor/g3c-dbg5-{MODE}-frame.png")
        log("png saved")
    except Exception as pe:
        log(f"png save failed: {pe!r}")

    log(f"VERDICT mode={MODE} marker={with_marker:.0f} scene={scene:.0f}")
    log("G3CDBG5_" + ("PASS" if scene > 8 else "FAIL"))
except Exception as e:
    import traceback
    log("G3CDBG5_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
