# G7b: a QUADRUPED WALKS the repaired photoreal world â€” pretrained Isaac Lab
# velocity policy (Unitree Go2, rsl_rl checkpoint, ZERO training), commanded
# straight ahead, recorded FP + TP. Honest label: "pretrained locomotion
# policy, fixed forward command â€” no vision, no training on this world."
#
# Offline assets (fetched on the login node; compute nodes have no internet):
#   go2-assets/go2.usd + go2-assets/Props/instanceable_meshes.usd
#   go2-assets/go2-flat-checkpoint.pt
# Heavy per-stage logging: Isaac Lab module paths vary across versions, and
# the render law makes post-construction cameras a known risk â€” every stage
# logs before it can crash, so a queue iteration costs one look at RESULTS.
import json
import os

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g7b-results.txt"
FP_FRAMES = "/scratch/gilbreth/gupta596/surveyor/g7b-frames-fp"
TP_FRAMES = "/scratch/gilbreth/gupta596/surveyor/g7b-frames-tp"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"
GO2_USD = "/scratch/gilbreth/gupta596/surveyor/go2-assets/go2.usd"
import os as _os
# flat brain first: it WALKED (0.69 m); the rough brain stands (its height
# scanner reads garbage off USD terrain). Slow command below helps the deck.
CKPT = "/scratch/gilbreth/gupta596/surveyor/go2-assets/go2-flat-checkpoint.pt"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g7b start (Go2 pretrained walk, FP+TP)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import numpy as np
    import torch
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.sensors.camera")
    log("camera sensor ext enabled")

    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]  # the certified rover corridor: 4.5 m of probe-confirmed flat floor
    B = (s["x"], -s["z"], s["y"])
    log(f"quadruped spawn (stage): ({B[0]:.2f}, {B[1]:.2f}, {B[2]:.2f})")

    # ---- env cfg (module paths vary; try the known layouts) ---------------
    EnvCfg = None
    for mod, name in [
        ("isaaclab_tasks.manager_based.locomotion.velocity.config.go2.flat_env_cfg", "UnitreeGo2FlatEnvCfg_PLAY"),
        ("isaaclab_tasks.manager_based.locomotion.velocity.config.go2.rough_env_cfg", "UnitreeGo2RoughEnvCfg_PLAY"),
        ("isaaclab_tasks.manager_based.locomotion.velocity.config.unitree_go2.flat_env_cfg", "UnitreeGo2FlatEnvCfg_PLAY"),
    ]:
        try:
            m = __import__(mod, fromlist=[name])
            EnvCfg = getattr(m, name)
            log(f"env cfg: {mod}.{name}")
            break
        except Exception as ie:
            log(f"  cfg miss {mod}.{name}: {type(ie).__name__}")
    if EnvCfg is None:
        raise RuntimeError("no Go2 flat env cfg found")

    AgentCfg = None
    for mod, name in [
        ("isaaclab_tasks.manager_based.locomotion.velocity.config.go2.agents.rsl_rl_ppo_cfg", "UnitreeGo2FlatPPORunnerCfg"),
        ("isaaclab_tasks.manager_based.locomotion.velocity.config.unitree_go2.agents.rsl_rl_ppo_cfg", "UnitreeGo2FlatPPORunnerCfg"),
    ]:
        try:
            m = __import__(mod, fromlist=[name])
            AgentCfg = getattr(m, name)
            log(f"agent cfg: {mod}.{name}")
            break
        except Exception as ie:
            log(f"  agent miss {mod}.{name}: {type(ie).__name__}")
    if AgentCfg is None:
        raise RuntimeError("no Go2 PPO runner cfg found")

    from isaaclab.terrains import TerrainImporterCfg

    cfg = EnvCfg()
    cfg.scene.num_envs = 1
    cfg.sim.device = "cuda:0"
    # offline robot asset
    cfg.scene.robot.spawn.usd_path = GO2_USD
    # terrain = OUR PACK (repaired collider + NuRec splat visuals)
    cfg.scene.terrain = TerrainImporterCfg(
        prim_path="/World/ground",
        terrain_type="usd",
        usd_path=STAGE,
        collision_group=-1,
    )
    # spawn at the certified point, nose along +X
    cfg.scene.robot.init_state.pos = (B[0], B[1], B[2] + 0.45)
    # fixed forward command (no random resampling drama on camera)
    try:
        cfg.commands.base_velocity.ranges.lin_vel_x = (0.3, 0.3)
        cfg.commands.base_velocity.ranges.lin_vel_y = (0.0, 0.0)
        cfg.commands.base_velocity.ranges.ang_vel_z = (0.0, 0.0)
        cfg.commands.base_velocity.resampling_time_range = (1000.0, 1000.0)
        if hasattr(cfg.commands.base_velocity.ranges, "heading"):
            cfg.commands.base_velocity.ranges.heading = (0.0, 0.0)
        log("command fixed: 0.3 m/s forward")
    except Exception as ce:
        log(f"command override partial: {ce!r}")
    try:
        cfg.observations.policy.enable_corruption = False
    except Exception:
        pass
    cfg.episode_length_s = 60.0
    # rough cfg: terrain curriculum + generator-relative logic assume a
    # procedural terrain — our terrain is a USD file; kill them
    for attr in ("terrain_levels",):
        try:
            setattr(cfg.curriculum, attr, None)
            log(f"curriculum.{attr} disabled")
        except Exception:
            pass
    log("cfg overrides applied")

    from isaaclab.envs import ManagerBasedRLEnv
    env = ManagerBasedRLEnv(cfg=cfg)
    log("env constructed")

    # kill any PhysicsScene that rode in with the referenced pack (the env
    # owns physics; a second scene prim under /World/ground is a landmine)
    import omni.usd
    stage = omni.usd.get_context().get_stage()
    from pxr import Sdf, UsdGeom, UsdLux, Gf
    killed = []
    ground = stage.GetPrimAtPath("/World/ground")
    if ground and ground.IsValid():
        for prim in __import__("pxr").Usd.PrimRange(ground):
            if prim.GetTypeName() == "PhysicsScene":
                prim.SetActive(False)
                killed.append(str(prim.GetPath()))
    log(f"nested physics scenes deactivated: {killed}")
    # NuRec occlusion proxy (dbg7): find the volume + collider under the
    # referenced terrain and link them
    vol_prim = None
    coll_prim = None
    for prim in stage.Traverse():
        at = prim.GetAttribute("omni:nurec:isNuRecVolume")
        if at and at.Get():
            vol_prim = prim
        if prim.GetName() == "Collider" and "/ground" in str(prim.GetPath()):
            coll_prim = prim
    if vol_prim and coll_prim:
        vol_prim.GetRelationship("proxy").SetTargets([coll_prim.GetPath()])
        log(f"NuRec proxy REL: {vol_prim.GetPath()} -> {coll_prim.GetPath()}")
    else:
        log(f"NuRec proxy link skipped (vol={vol_prim}, coll={coll_prim})")

    # ---- policy -------------------------------------------------------------
    from rsl_rl.runners import OnPolicyRunner
    try:
        from isaaclab_rl.rsl_rl import RslRlVecEnvWrapper
    except ImportError:
        from isaaclab_rl.rsl_rl.vecenv_wrapper import RslRlVecEnvWrapper
    wrapped = RslRlVecEnvWrapper(env)
    agent_dict = AgentCfg().to_dict()
    runner = OnPolicyRunner(wrapped, agent_dict, log_dir=None, device="cuda:0")
    runner.load(CKPT)
    policy = runner.get_inference_policy(device="cuda:0")
    log("policy loaded (pretrained rsl_rl checkpoint)")

    # ---- cameras on the robot base (post-construction: render-law risk â€”
    # guarded below with fast abort) ----------------------------------------
    base_path = None
    for cand in ("/World/envs/env_0/Robot/base", "/World/envs/env_0/Robot/trunk"):
        p = stage.GetPrimAtPath(cand)
        if p and p.IsValid():
            base_path = cand
            break
    if base_path is None:
        robot_prim = stage.GetPrimAtPath("/World/envs/env_0/Robot")
        kids = [str(c.GetPath()) for c in robot_prim.GetChildren()] if robot_prim else []
        log(f"robot children: {kids[:12]}")
        raise RuntimeError("no base link prim found")
    log(f"camera parent: {base_path}")

    def body_cam(name, eye, aim):
        path = f"{base_path}/{name}"
        c = UsdGeom.Camera.Define(stage, Sdf.Path(path))
        c.CreateClippingRangeAttr(Gf.Vec2f(0.05, 10000.0))  # default near=1m clips the ground
        view = Gf.Matrix4d().SetLookAt(Gf.Vec3d(*eye), Gf.Vec3d(*aim), Gf.Vec3d(0, 0, 1))
        UsdGeom.Xformable(stage.GetPrimAtPath(path)).MakeMatrixXform().Set(view.GetInverse())
        return path
    fp_path = body_cam("fp_cam", (0.30, 0.0, 0.12), (2.5, 0.0, -0.05))
    # WIDE static cam at the g3c-proven photoreal-clear eye (root level)
    wide_path = "/g7b_wide"
    wc = UsdGeom.Camera.Define(stage, Sdf.Path(wide_path))
    wc.CreateClippingRangeAttr(Gf.Vec2f(0.05, 10000.0))
    weye = Gf.Vec3d(B[0] - 1.15, B[1] - 1.05, B[2] + 1.15)
    waim = Gf.Vec3d(B[0] + 0.6, B[1] + 0.6, B[2] - 0.1)
    wview = Gf.Matrix4d().SetLookAt(weye, waim, Gf.Vec3d(0, 0, 1))
    UsdGeom.Xformable(stage.GetPrimAtPath(wide_path)).MakeMatrixXform().Set(wview.GetInverse())
    tp_path = wide_path
    UsdLux.DomeLight.Define(stage, Sdf.Path("/g7b_dome")).CreateIntensityAttr(600)

    from isaacsim.sensors.camera import Camera
    fp = Camera(prim_path=fp_path, resolution=(1280, 720))
    tp = Camera(prim_path=tp_path, resolution=(1280, 720))
    fp.initialize()
    tp.initialize()
    log("cameras initialized")

    os.makedirs(FP_FRAMES, exist_ok=True)
    os.makedirs(TP_FRAMES, exist_ok=True)
    from PIL import Image
    counts = {"fp": 0, "tp": 0}
    def snap(cam, tag, folder):
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return
        Image.fromarray(np.asarray(rgba)[:, :, :3].astype(np.uint8)).save(
            f"{folder}/frame_{counts[tag]:05d}.png")
        counts[tag] += 1
    def spread(cam):
        rgba = cam.get_rgba()
        if rgba is None or getattr(rgba, "size", 0) == 0:
            return -1.0
        rgb = np.asarray(rgba)[:, :, :3]
        h, w = rgb.shape[0], rgb.shape[1]
        core = rgb[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        return float(core.max()) - float(core.min())

    _got = wrapped.get_observations()
    obs = _got[0] if isinstance(_got, tuple) else _got
    robot = env.scene["robot"]
    start = robot.data.root_pos_w[0].detach().cpu().numpy().copy()
    log(f"reset done; base at ({start[0]:.2f}, {start[1]:.2f}, {start[2]:.2f})")

    # warm the renderer + check both cameras before spending the walk
    def render_tick():
        try:
            env.sim.render()
        except Exception:
            env.unwrapped.sim.render()
    for _ in range(20):
        with torch.inference_mode():
            actions = policy(obs)
        _st = wrapped.step(actions)
        obs = _st[0]
        render_tick()
    fp_s, tp_s = spread(fp), spread(tp)
    log(f"post-warmup spreads: fp {fp_s:.0f}, tp {tp_s:.0f}")
    if fp_s <= 8 or tp_s <= 8:
        log("G7B_FAIL cameras blank (render law: post-construction authoring)")
        raise RuntimeError("cameras blank")

    # ---- the walk, on camera ------------------------------------------------
    STEPS = 800  # ~16 s at 50 Hz control
    for i in range(STEPS):
        with torch.inference_mode():
            actions = policy(obs)
        _st = wrapped.step(actions)
        obs = _st[0]
        dones = _st[2] if len(_st) > 2 else None
        render_tick()
        snap(fp, "fp", FP_FRAMES)
        snap(tp, "tp", TP_FRAMES)
        if dones is not None and bool(dones[0]):
            log(f"episode terminated at control step {i} (fall or reset)")
            break

    end = robot.data.root_pos_w[0].detach().cpu().numpy()
    dist = float(np.hypot(end[0] - start[0], end[1] - start[1]))
    log(f"walked {dist:.2f} m; end ({end[0]:.2f}, {end[1]:.2f}, {end[2]:.2f}); frames fp {counts['fp']}, tp {counts['tp']}")
    ok_all = dist >= 2.0 and counts["fp"] >= 200 and counts["tp"] >= 200
    log("G7B_" + ("PASS" if ok_all else "FAIL"))
except Exception as e:
    import traceback
    log("G7B_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    try:
        env.close()
    except Exception:
        pass
    try:
        app.close()
    except Exception:
        pass
    import os as _os
    _os._exit(0)
