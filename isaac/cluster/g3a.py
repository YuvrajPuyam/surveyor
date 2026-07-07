# G3a: press Play on the Certified World Pack â€” a rigid body must REST on
# the repaired floor at a certificate-verified spawn. Results to a file (kit
# swallows stdout). Runs inside isaaclab.sh -p on the cluster.
import json
import sys

RESULTS = "/scratch/gilbreth/gupta596/surveyor/g3a-results.txt"
STAGE = "/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda"
SPAWNS = "/scratch/gilbreth/gupta596/surveyor/7188e250-e2ff-43e7-babb-73834c22e932/spawns.json"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g3a start")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True).app
log("kit booted")

try:
    import omni.usd
    ctx = omni.usd.get_context()
    ok = ctx.open_stage(STAGE)
    log(f"stage open: {ok}")

    # isaac core World API (pip-based 5.x first, classic fallback)
    try:
        from isaacsim.core.api import World
        from isaacsim.core.api.objects import DynamicCuboid
        log("api: isaacsim.core.api")
    except ImportError:
        from omni.isaac.core import World
        from omni.isaac.core.objects import DynamicCuboid
        log("api: omni.isaac.core")

    world = World(stage_units_in_meters=1.0)

    # first verified spawn, bundle Y-up -> stage Z-up under the /World +90degX root
    with open(SPAWNS) as f:
        spawns = json.load(f)
    s = spawns[0]
    sx, sy, sz = s["x"], s["y"], s["z"]
    pos = (sx, -sz, sy + 0.5)  # 0.5 m above the verified floor point
    log(f"spawn (y-up): ({sx:.2f}, {sy:.2f}, {sz:.2f}) -> drop at (z-up): ({pos[0]:.2f}, {pos[1]:.2f}, {pos[2]:.2f})")

    cube = world.scene.add(
        DynamicCuboid(prim_path="/World/g3a_probe", name="g3a_probe",
                      position=pos, size=0.15, mass=1.0)
    )
    world.reset()
    log("world reset (Play)")

    import numpy as np
    track = []
    for i in range(360):  # 3 s at 1/120
        world.step(render=False)
        if i % 60 == 59:
            p, _ = cube.get_world_pose()
            track.append([round(float(v), 3) for v in p])
            log(f"step {i+1}: cube at {track[-1]}")

    zs = [t[2] for t in track[-3:]]
    settled = max(zs) - min(zs) < 0.01
    floor_z = sy  # spawn floor height maps to stage z at that point
    resting_near_floor = abs(zs[-1] - (floor_z + 0.075)) < 0.25
    log(f"settled: {settled}; final z {zs[-1]:.3f} vs floor+half {floor_z + 0.075:.3f}; near: {resting_near_floor}")
    log("G3A_" + ("PASS" if settled and resting_near_floor else "FAIL"))
except Exception as e:
    import traceback
    log("G3A_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
