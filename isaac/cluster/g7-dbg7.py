# G7-DBG7: inspect the NuRec visuals prim — what proxy/occlusion linkage does
# the OmniNuRecFieldAsset expose? (The Marble->Isaac guide's occlusion step.)
# No physics, no cameras: open the stage, dump every prim under /World/Visuals
# with attribute + relationship names, plus any 'proxy' hits stage-wide.
RESULTS = "/scratch/gilbreth/gupta596/surveyor/g7-dbg7-results.txt"

lines = []
def log(msg):
    lines.append(str(msg))
    with open(RESULTS, "w") as f:
        f.write("\n".join(lines) + "\n")

log("g7-dbg7 start (NuRec prim inspection)")
from isaaclab.app import AppLauncher
app = AppLauncher(headless=True, enable_cameras=True).app
log("kit booted")

try:
    import omni.usd
    ctx = omni.usd.get_context()
    ok = ctx.open_stage("/scratch/gilbreth/gupta596/surveyor/canonical-pack/world/7188e250-e2ff-43e7-babb-73834c22e932.usda")
    stage = ctx.get_stage()
    log(f"stage open: {ok}")

    from pxr import Usd
    vis = stage.GetPrimAtPath("/World/Visuals")
    if not (vis and vis.IsValid()):
        raise RuntimeError("/World/Visuals missing")
    for prim in Usd.PrimRange(vis):
        log(f"PRIM {prim.GetPath()}  type={prim.GetTypeName()}  active={prim.IsActive()}")
        for a in prim.GetAttributes():
            try:
                v = a.Get()
                vs = str(v)
                if len(vs) > 60:
                    vs = vs[:60] + "…"
                log(f"  attr {a.GetName()} = {vs}")
            except Exception:
                log(f"  attr {a.GetName()} (unreadable)")
        for r in prim.GetRelationships():
            log(f"  REL {r.GetName()} -> {r.GetTargets()}")

    # any 'proxy'-ish names anywhere in the stage
    hits = []
    for prim in stage.Traverse():
        for a in list(prim.GetAttributes()) + list(prim.GetRelationships()):
            if "proxy" in a.GetName().lower():
                hits.append(f"{prim.GetPath()}::{a.GetName()}")
    log(f"stage-wide 'proxy' properties: {hits if hits else 'NONE'}")
    log("G7DBG7_DONE")
except Exception as e:
    import traceback
    log("G7DBG7_ERROR " + repr(e))
    log(traceback.format_exc())
finally:
    app.close()
    import os
    os._exit(0)
