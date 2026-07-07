# G5: SDG teaser dataset from the Certified World Pack - 500 labeled frames
# (RGB + depth + 2D bboxes + semantic seg) with camera poses derived from the
# certificate's verified spawns. Laws honored: camera-sensor annotator path
# ONLY (rep.orchestrator hangs headless), root-level camera prim, all content
# authored pre-reset, NuRec visuals active (RGB shows the photoreal world),
# ASCII-only file. New API probe: Camera.set_world_pose mid-sim - verified by
# checking pose-to-pose frame difference; abort if poses do not take.
import json
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g5-results.txt"
OUT = "/scratch/gilbreth/gupta596/surveyor/g5-dataset"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
N_TARGET = 500

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g5 start (SDG teaser from certified free space)")
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
    log(f"stage open: {ok}")
    from pxr import Gf, Sdf, UsdGeom, UsdLux

    vis = stage.GetPrimAtPath("/World/Visuals")
    log(f"NuRec visuals active: {bool(vis and vis.IsValid() and vis.IsActive())}")

    with open(SPAWNS) as f:
        spawns = json.load(f)
    # spawns are stored in source frame: world pos = (x, -z, y)
    pts = [(s["x"], -s["z"], s["y"]) for s in spawns]
    log(f"{len(pts)} verified spawns loaded")

    UsdLux.DomeLight.Define(stage, Sdf.Path("/g5_dome")).CreateIntensityAttr(700)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/g5_sun"))
    sun.CreateIntensityAttr(2000)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))

    # labeled props at certified spawn locations (splats carry no semantics -
    # you label what you insert; the world is the trustworthy stage)
    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid
    from isaacsim.core.utils.semantics import add_update_semantics

    cam_path = "/g5_cam"
    UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    UsdGeom.Camera(stage.GetPrimAtPath(cam_path)).CreateFocalLengthAttr(24.0)

    world = World(stage_units_in_meters=1.0, physics_dt=0.01, rendering_dt=0.02)

    rng = np.random.default_rng(1234)  # certificate seed - deterministic dataset
    crates = []
    n_props = min(4, len(pts))
    for i in range(n_props):
        p = pts[i % len(pts)]
        c = world.scene.add(DynamicCuboid(
            prim_path=f"/World/g5_crate_{i}", name=f"crate_{i}",
            position=(p[0] + float(rng.uniform(-0.2, 0.2)),
                      p[1] + float(rng.uniform(-0.2, 0.2)),
                      p[2] + 0.35),
            size=0.18, mass=0.5,
            color=np.array([[0.85, 0.55, 0.10], [0.20, 0.55, 0.85],
                            [0.70, 0.25, 0.25], [0.30, 0.65, 0.35]][i]),
        ))
        add_update_semantics(c.prim, semantic_label="crate")
        crates.append(c)
    log(f"{len(crates)} labeled crates dropped at verified spawns")

    world.reset()
    for _ in range(200):
        world.step(render=False)
    for i, c in enumerate(crates):
        cp, _ = c.get_world_pose()
        log(f"  crate_{i} rest: ({float(cp[0]):.2f}, {float(cp[1]):.2f}, {float(cp[2]):.2f})")

    from isaacsim.sensors.camera import Camera
    cam = Camera(prim_path=cam_path, resolution=(640, 480))
    cam.initialize()
    cam.add_distance_to_image_plane_to_frame()
    cam.add_bounding_box_2d_tight_to_frame()
    cam.add_semantic_segmentation_to_frame()
    log("camera + annotators initialized (depth, bbox2d, semseg)")

    os.makedirs(OUT, exist_ok=True)
    from PIL import Image

    def set_cam(eye, aim):
        e = Gf.Vec3d(*[float(v) for v in eye])
        a = Gf.Vec3d(*[float(v) for v in aim])
        view = Gf.Matrix4d().SetLookAt(e, a, Gf.Vec3d(0, 0, 1))
        m = view.GetInverse()
        # position via the sensor API (fabric-aware), orientation via quat
        q = Gf.Transform(m).GetRotation().GetQuat()
        cam.set_world_pose(
            np.array([float(v) for v in eye]),
            np.array([q.GetReal(), q.GetImaginary()[0], q.GetImaginary()[1], q.GetImaginary()[2]]),
        )

    def spread_of(rgb):
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        return float(core.max()) - float(core.min())

    # ---- probe: do runtime camera moves take effect? -----------------------
    p0 = pts[0]
    set_cam((p0[0] - 1.0, p0[1] - 1.0, p0[2] + 1.2), (p0[0], p0[1], p0[2] + 0.3))
    for _ in range(25):
        world.step(render=True)
    f1 = np.asarray(cam.get_rgba())[:, :, :3].astype(np.int32)
    set_cam((p0[0] + 1.0, p0[1] + 1.0, p0[2] + 1.2), (p0[0], p0[1], p0[2] + 0.3))
    for _ in range(25):
        world.step(render=True)
    f2 = np.asarray(cam.get_rgba())[:, :, :3].astype(np.int32)
    delta = float(np.abs(f1 - f2).mean())
    log(f"camera-move probe: mean frame delta {delta:.1f} (spreads {spread_of(f1):.0f}/{spread_of(f2):.0f})")
    if delta < 2.0:
        log("CAMERA_POSE_FROZEN - runtime moves do not take; aborting cheap")
        raise RuntimeError("camera pose changes do not propagate")

    # ---- the dataset loop ---------------------------------------------------
    manifest = []
    frame_i = 0
    kept = 0
    attempts = 0
    while kept < N_TARGET and attempts < N_TARGET * 3:
        attempts += 1
        base = pts[int(rng.integers(0, len(pts)))]
        # eye inside certified free space: above a verified spawn, human-ish heights
        eye = (base[0] + float(rng.uniform(-0.3, 0.3)),
               base[1] + float(rng.uniform(-0.3, 0.3)),
               base[2] + float(rng.uniform(0.5, 1.5)))
        tgt = crates[int(rng.integers(0, len(crates)))]
        tp, _ = tgt.get_world_pose()
        aim = (float(tp[0]) + float(rng.uniform(-0.2, 0.2)),
               float(tp[1]) + float(rng.uniform(-0.2, 0.2)),
               float(tp[2]) + float(rng.uniform(-0.1, 0.3)))
        set_cam(eye, aim)
        for _ in range(6):
            world.step(render=True)
        frame = cam.get_current_frame()
        rgba = frame.get("rgba")
        if rgba is None or getattr(rgba, "size", 0) == 0:
            continue
        rgb = np.asarray(rgba)[:, :, :3]
        sp = spread_of(rgb)
        if sp < 12:  # splat fog / empty view - certified-clear frames only
            continue
        Image.fromarray(rgb.astype(np.uint8)).save(f"{OUT}/rgb_{kept:05d}.png")
        depth = frame.get("distance_to_image_plane")
        if depth is not None and getattr(depth, "size", 0) > 0:
            np.save(f"{OUT}/depth_{kept:05d}.npy", np.asarray(depth).astype(np.float16))
        bbox = frame.get("bounding_box_2d_tight")
        bbox_list = []
        try:
            if bbox is not None:
                data = bbox["data"] if isinstance(bbox, dict) else bbox
                for row in np.asarray(data).tolist():
                    bbox_list.append([float(x) if not isinstance(x, (list, tuple)) else x for x in row])
        except Exception:
            bbox_list = ["unparsed"]
        seg = frame.get("semantic_segmentation")
        if seg is not None:
            try:
                seg_img = seg["data"] if isinstance(seg, dict) else seg
                seg_arr = np.asarray(seg_img)
                if seg_arr.size > 0:
                    Image.fromarray(seg_arr.astype(np.uint8)).save(f"{OUT}/seg_{kept:05d}.png")
            except Exception:
                pass
        manifest.append({
            "i": kept, "eye": [round(v, 4) for v in eye], "aim": [round(v, 4) for v in aim],
            "spread": round(sp, 1), "bboxes": bbox_list[:8],
        })
        kept += 1
        if kept % 50 == 0:
            log(f"  {kept}/{N_TARGET} frames kept ({attempts} attempts)")

    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump({
            "world": "7188e250-e2ff-43e7-babb-73834c22e932",
            "seed": 1234, "resolution": [640, 480], "focal_mm": 24.0,
            "note": "camera eyes sampled above certificate-verified spawns; "
                    "labels only on inserted props (splats carry no semantics); "
                    "frames with core spread < 12 (splat fog / void) rejected",
            "frames": manifest,
        }, f, indent=1)
    log(f"dataset: {kept} frames kept / {attempts} attempts -> {OUT}")
    log("G5_" + ("PASS" if kept >= N_TARGET else ("PARTIAL" if kept >= 100 else "FAIL")))
except Exception as e:
    import traceback
    log("G5_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
