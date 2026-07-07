# G4: the PRETRAINED rsl_rl lift policy (Isaac-Lift-Cube-Franka-v0) running
# inside the Certified World Pack --- hand-rolled inference (no Nucleus, no
# internet): obs = [q_rel(9), qd(9), cube_in_base(3), cmd(7), last_action(8)]
# = 36, exactly matching actor.0.weight (256, 36). Actor 36-256-128-64-8 ELU,
# no normalization (actor_obs_normalization=False). Arm action: targets =
# default + 0.5*a (JointPositionAction, use_default_offset). Gripper binary:
# a<0 close(0.0) else open(0.04). Trained gains: arm k=80 Nm/rad d=4,
# fingers k=2e3 N/m d=1e2. Policy 50 Hz, physics 100 Hz (decimation 2).
# Episode 1 Earth g (sanity), episode 2 lunar 1.62 (the artifact) --- no
# world.stop(), state restored by hand between episodes.
# Inherits every g3c law: root-level camera, single reset, dest_path URDF
# import, NuRec visuals active, center-spread render verification.
import json
import math
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g4-results.txt"
FRAMES = "/scratch/gilbreth/gupta596/surveyor/g4-frames"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
URDF = "/isaac-sim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/franka_description/robots/panda_arm_hand.urdf"
ROBOT_USD = "/scratch/gilbreth/gupta596/surveyor/franka-imported.usd"
CKPT = "/scratch/gilbreth/gupta596/surveyor/checkpoints/lift-rsl_rl-5.1.pt"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g4 start (pretrained policy in the pack)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import numpy as np
    import torch
    import omni.kit.commands
    import omni.usd
    from isaacsim.core.utils.extensions import enable_extension

    enable_extension("isaacsim.asset.importer.urdf")
    enable_extension("isaacsim.sensors.camera")
    log("extensions enabled")

    # ---- actor network from the checkpoint --------------------------------
    ck = torch.load(CKPT, map_location="cpu", weights_only=False)
    sd = ck["model_state_dict"]
    actor = torch.nn.Sequential(
        torch.nn.Linear(36, 256), torch.nn.ELU(),
        torch.nn.Linear(256, 128), torch.nn.ELU(),
        torch.nn.Linear(128, 64), torch.nn.ELU(),
        torch.nn.Linear(64, 8),
    )
    with torch.no_grad():
        for i, li in enumerate([0, 2, 4, 6]):
            actor[li * 1 if li == 0 else li].weight.copy_(sd[f"actor.{li}.weight"])
            actor[li].bias.copy_(sd[f"actor.{li}.bias"])
    actor.eval()
    log(f"actor loaded (iter {ck.get('iter')}) --- mean-action inference")

    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"stage open: {ok}")
    from pxr import Gf, PhysxSchema, Sdf, UsdGeom, UsdLux, UsdPhysics
    stage = ctx.get_stage()

    vis = stage.GetPrimAtPath("/World/Visuals")
    log(f"NuRec visuals active: {bool(vis and vis.IsValid() and vis.IsActive())}")

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    B = (s["x"], -s["z"], s["y"])
    log(f"franka base: ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    dome = UsdLux.DomeLight.Define(stage, Sdf.Path("/g4_dome"))
    dome.CreateIntensityAttr(600)
    sun = UsdLux.DistantLight.Define(stage, Sdf.Path("/g4_sun"))
    sun.CreateIntensityAttr(2500)
    UsdGeom.XformCommonAPI(sun.GetPrim()).SetRotate((55.0, 0.0, 35.0))

    # ---- robot (dest_path import law) --------------------------------------
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
    log(f"robot referenced at {robot_path}")
    omni.kit.commands.execute(
        "TransformPrimSRT", path=robot_path,
        new_translation=Gf.Vec3d(B[0], B[1], B[2]),
        new_rotation_euler=Gf.Vec3d(0, 0, 0), new_scale=Gf.Vec3d(1, 1, 1),
    )
    art = PhysxSchema.PhysxArticulationAPI.Get(stage, robot_path)
    art.CreateSolverPositionIterationCountAttr(16)
    art.CreateSolverVelocityIterationCountAttr(1)

    # TRAINED actuator gains (franka.py): arm k=80 Nm/rad d=4 (USD angular
    # drives are per-degree: author radians(x)); effort limits 87 (j1-4), 12
    # (j5-7). Fingers: LINEAR drives, k=2e3 N/m d=1e2, effort 200.
    for j in range(1, 8):
        drive = UsdPhysics.DriveAPI.Get(
            stage.GetPrimAtPath(f"{robot_path}/joints/panda_joint{j}"), "angular"
        )
        drive.GetStiffnessAttr().Set(math.radians(80.0))
        drive.GetDampingAttr().Set(math.radians(4.0))
        drive.CreateMaxForceAttr(87.0 if j <= 4 else 12.0)
    for fj in ("panda_finger_joint1", "panda_finger_joint2"):
        prim = stage.GetPrimAtPath(f"{robot_path}/joints/{fj}")
        try:
            drive = UsdPhysics.DriveAPI.Apply(prim, "linear")
            drive.CreateStiffnessAttr(2e3)
            drive.CreateDampingAttr(1e2)
            drive.CreateMaxForceAttr(200.0)
        except Exception as fe:
            log(f"finger drive skipped ({fj}): {fe!r}")
    log("trained gains applied (arm 80/4, fingers 2e3/1e2)")

    # ---- camera + marker (root level; g3c pose family) ---------------------
    cam_path = "/g4_cam"
    camprim = UsdGeom.Camera.Define(stage, Sdf.Path(cam_path))
    camprim.CreateFocalLengthAttr(28.0)  # wider than the 50mm default: the
    # lift tops out ~0.5 m above the raised base; keep grasp AND carry in frame
    eye = Gf.Vec3d(B[0] - 1.25, B[1] - 1.35, B[2] + 1.25)
    aim = Gf.Vec3d(B[0] + 0.40, B[1], B[2] + 0.42)
    view = Gf.Matrix4d().SetLookAt(eye, aim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(cam_path)).MakeMatrixXform().Set(view.GetInverse())
    # visual-only riser under the (to-be-raised) robot base - plain USD, no
    # physics: renders, never collides
    riser = UsdGeom.Cube.Define(stage, Sdf.Path("/g4_riser"))
    riser.CreateSizeAttr(1.0)
    UsdGeom.XformCommonAPI(riser.GetPrim()).SetTranslate((B[0], B[1], B[2] + 0.052))
    UsdGeom.XformCommonAPI(riser.GetPrim()).SetScale((0.18, 0.18, 0.105))
    riser.CreateDisplayColorAttr([Gf.Vec3f(0.3, 0.3, 0.34)])
    marker = UsdGeom.Cube.Define(stage, Sdf.Path("/g4_marker"))
    marker.CreateSizeAttr(0.25)
    marker.CreateDisplayColorAttr([Gf.Vec3f(1.0, 0.1, 0.1)])
    UsdGeom.XformCommonAPI(marker.GetPrim()).SetTranslate((aim[0], aim[1], aim[2] + 0.3))
    log("camera + marker authored")

    # ---- world + props (all pre-reset; trained geometry replicated) --------
    # trained frame: robot base z=0, cube starts (0.5, 0, 0.055) in BASE frame
    # (dex cube 0.8 scale --- 0.052 m). Pedestal top = base + 0.029.
    from isaacsim.core.api import World
    from isaacsim.core.api.objects import DynamicCuboid, FixedCuboid
    from isaacsim.core.api.robots import Robot

    world = World(stage_units_in_meters=1.0, physics_dt=0.01, rendering_dt=0.02)
    robot = world.scene.add(Robot(prim_path=robot_path, name="franka"))

    CUBE = 0.052
    # policy trained with cube ALWAYS at base-frame z=0.055 (reset randomizes
    # x/y only) - z is out-of-distribution poison. Probe-measure the pedestal
    # top (the g3b law: never trust FixedCuboid scale math) and correct.
    cube_start = np.array([B[0] + 0.5, B[1] + 0.0, B[2] + 0.055])
    world.scene.add(FixedCuboid(
        prim_path="/World/g4_pedestal", name="pedestal",
        position=(cube_start[0], cube_start[1], B[2] + 0.0145),
        scale=(0.24, 0.24, 0.029), color=np.array([0.35, 0.35, 0.4]),
    ))
    cube = world.scene.add(DynamicCuboid(
        prim_path="/World/g4_cube", name="cube",
        position=tuple(cube_start + np.array([0.0, 0.0, 0.4])), size=CUBE, mass=0.15,
        color=np.array([0.85, 0.55, 0.1]),
    ))
    log("pedestal + cube authored (cube dropped from above for measurement)")

    from isaacsim.core.prims import RigidPrim as RigidPrimView
    hand = RigidPrimView(prim_paths_expr=f"{robot_path}/panda_hand", name="hand_view")

    world.get_physics_context().set_gravity(-9.81)
    world.reset()
    dof_names = list(robot.dof_names)
    log(f"world reset; dofs: {dof_names}")

    # joint-order map: obs/action order is [panda_joint1..7, finger1, finger2]
    ORDER = [f"panda_joint{i}" for i in range(1, 8)] + ["panda_finger_joint1", "panda_finger_joint2"]
    idx = [dof_names.index(n) for n in ORDER]
    arm_idx = np.array(idx[:7])
    fin_idx = np.array(idx[7:])
    DEFAULT = np.array([0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04])

    from isaacsim.core.utils.types import ArticulationAction
    ctrl = robot.get_articulation_controller()

    def set_pose_to_default():
        q = robot.get_joint_positions()
        for k, name_i in enumerate(idx):
            q[name_i] = DEFAULT[k]
        robot.set_joint_positions(q)
        robot.set_joint_velocities(np.zeros_like(q))
        ctrl.apply_action(ArticulationAction(
            joint_positions=DEFAULT[:7], joint_indices=arm_idx))
        ctrl.apply_action(ArticulationAction(
            joint_positions=np.array([0.04, 0.04]), joint_indices=fin_idx))

    set_pose_to_default()
    for _ in range(150):
        world.step(render=False)
    # v4: the pedestal cannot be moved mid-sim (USD edits are inert once
    # physics owns the body - our own law). The policy only sees RELATIVE
    # geometry, so measure where the cube rests on the untouched pedestal and
    # TELEPORT THE ROBOT BASE (runtime physics API) so cube - base = 0.055.
    cp, _ = cube.get_world_pose()
    rest_z = float(cp[2])
    log(f"cube rest (untouched pedestal): base-z {rest_z - B[2]:.4f}, xy ({float(cp[0]) - B[0]:.3f}, {float(cp[1]) - B[1]:.3f})")
    new_base_z = rest_z - 0.055
    robot.set_world_pose(position=np.array([B[0], B[1], new_base_z]),
                         orientation=np.array([1.0, 0.0, 0.0, 0.0]))
    for _ in range(20):
        world.step(render=False)
    bp, _ = robot.get_world_pose()
    B_eff = (float(bp[0]), float(bp[1]), float(bp[2]))
    log(f"robot base teleported: z {B[2]:.3f} -> {B_eff[2]:.3f} (raise {B_eff[2] - B[2]:+.4f})")
    cp, _ = cube.get_world_pose()
    cube_start = np.array([float(cp[0]), float(cp[1]), float(cp[2])])
    log(f"cube in NEW base frame: ({cube_start[0] - B_eff[0]:.3f}, {cube_start[1] - B_eff[1]:.3f}, {cube_start[2] - B_eff[2]:.4f}) - target z 0.0550")
    log("robot settled at trained default pose")

    # ---- capture plumbing (post-reset wrapper; center-spread verified) -----
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
    wm = frame_spread()
    marker.GetPrim().SetActive(False)
    for _ in range(10):
        world.step(render=True)
    sc = frame_spread()
    log(f"render check: marker {wm:.0f}, scene {sc:.0f}")
    if wm <= 8 or sc <= 8:
        raise RuntimeError("render check failed --- aborting before episodes")

    # ---- policy loop --------------------------------------------------------
    GOAL = np.array([0.5, 0.0, 0.35])          # base frame
    CMD = np.array([0.5, 0.0, 0.35, 1.0, 0.0, 0.0, 0.0], dtype=np.float32)

    def run_episode(tag, steps=350, record=True):
        last_a = np.zeros(8, dtype=np.float32)
        cp0, _ = cube.get_world_pose()
        start_z = float(cp0[2])
        max_lift = 0.0
        min_goal_d = 1e9
        for t in range(steps):
            q = np.asarray(robot.get_joint_positions())[idx]
            qd = np.asarray(robot.get_joint_velocities())[idx]
            cp, _ = cube.get_world_pose()
            cube_b = np.array([float(cp[0]) - B_eff[0], float(cp[1]) - B_eff[1], float(cp[2]) - B_eff[2]])
            obs = np.concatenate([q - DEFAULT, qd, cube_b, CMD, last_a]).astype(np.float32)
            with torch.no_grad():
                a = actor(torch.from_numpy(obs)).numpy()
            last_a = a.copy()
            arm_t = DEFAULT[:7] + 0.5 * a[:7]
            fin_t = np.array([0.0, 0.0]) if a[7] < 0 else np.array([0.04, 0.04])
            ctrl.apply_action(ArticulationAction(joint_positions=arm_t, joint_indices=arm_idx))
            ctrl.apply_action(ArticulationAction(joint_positions=fin_t, joint_indices=fin_idx))
            # decimation 2: policy 50 Hz over 100 Hz physics; snap at 25 fps
            for k in range(2):
                render = record and ((t * 2 + k) % 4 == 0)
                world.step(render=render)
                if render:
                    snap()
            lift = float(cp[2]) - start_z
            gd = float(np.linalg.norm(cube_b - GOAL))
            max_lift = max(max_lift, lift)
            min_goal_d = min(min_goal_d, gd)
            if t % 50 == 0:
                hp, _ = hand.get_world_poses()
                ee = np.array([float(hp[0][0]) - B_eff[0], float(hp[0][1]) - B_eff[1], float(hp[0][2]) - B_eff[2]])
                ee_cube = float(np.linalg.norm(ee - cube_b))
                log(f"  [{tag} t={t}] cube_b ({cube_b[0]:.2f},{cube_b[1]:.2f},{cube_b[2]:.2f}) ee ({ee[0]:.2f},{ee[1]:.2f},{ee[2]:.2f}) ee-cube {ee_cube:.3f} lift {lift:.3f} goal_d {gd:.3f} grip {'C' if a[7] < 0 else 'O'}")
        log(f"episode {tag}: max_lift {max_lift:.3f} m, min_goal_dist {min_goal_d:.3f} m, frames {frame_no[0]}")
        return max_lift, min_goal_d

    lift_e, gd_e = run_episode("earth-g", steps=350)

    # restore state by hand (no stop, no reset) and switch to lunar gravity
    cube.set_world_pose(np.array(cube_start), np.array([1.0, 0.0, 0.0, 0.0]))
    cube.set_linear_velocity(np.zeros(3))
    cube.set_angular_velocity(np.zeros(3))
    set_pose_to_default()
    world.get_physics_context().set_gravity(-1.62)
    for _ in range(80):
        world.step(render=False)
    log("state restored; gravity 1.62")

    lift_m, gd_m = run_episode("lunar-g", steps=350)

    ok_earth = lift_e > 0.10
    ok_lunar = lift_m > 0.10
    log(f"earth: lift {lift_e:.3f} (ok {ok_earth}) goal_d {gd_e:.3f} | lunar: lift {lift_m:.3f} (ok {ok_lunar}) goal_d {gd_m:.3f} | frames {frame_no[0]}")
    log("G4_" + ("PASS" if ok_lunar else ("PARTIAL" if ok_earth else "FAIL")))
except Exception as e:
    import traceback
    log("G4_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
