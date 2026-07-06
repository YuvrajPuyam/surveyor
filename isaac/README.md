# surveyor-isaac — the certificate is the contract

Isaac Lab task package around the SURVEYOR certificate. Every sim/training
parameter of `Certified-Resupply-Rover-v0` traces to a certificate field:

| certificate field | becomes |
|---|---|
| `spawns.json` (verified spawn points) | reset-state distribution (pose + uniform yaw) |
| `quarantine.json` (roped-off regions) | termination masks + reward penalty — no episode step earns reward inside ghost geometry |
| friction prior + scale trust | domain-randomization ranges (wide band while scale is unverified) |
| `gravity` | `sim.gravity = (0, 0, −g)` |
| open **critical** defects | `ContractRefused` — the config will not construct on a broken floor |

## Headless (runs anywhere, no Isaac)

```bash
# from the repo root
python -m unittest discover isaac/tests -v          # golden tests of the mapping
python -m surveyor_isaac.validate <bundle-dir>      # print the contract for a bundle
```

`surveyor_isaac.contract` is pure python and mirrors
`src/export/isaacContract.ts` constant-for-constant — the two compilers must
never disagree about a number.

## On the cluster (Gilbreth, gate G-lane)

```bash
# 0. inside the Isaac Lab container/venv (Isaac Lab 2.x)
cd worlds-in-action/isaac
pip install -e .

# 1. point the task at a repaired bundle (certificate + spawns + quarantine + pack USD)
export SURVEYOR_BUNDLE_DIR=/path/to/habitat-repaired
export SURVEYOR_WORLD_USD=/path/to/habitat-repaired/pack/world/<worldId>.usda

# 2. train / play (rsl_rl example)
python scripts/reinforcement_learning/rsl_rl/train.py --task Certified-Resupply-Rover-v0 --headless
python scripts/reinforcement_learning/rsl_rl/play.py  --task Certified-Resupply-Rover-v0 --num_envs 32
```

## What the cluster must verify (honest caveats — untested off-cluster)

1. **Isaac Lab version**: written against Isaac Lab 2.x module paths
   (`isaaclab.envs`, `isaaclab.managers`, `isaaclab_assets`). Older
   `omni.isaac.lab` builds need the import prefix renamed.
2. **Wheeled asset**: the cfg imports `isaaclab_assets.robots.jetbot.JETBOT_CONFIG`.
   If the build ships a different wheeled platform, swap that ONE import —
   the certificate wiring is robot-agnostic.
3. **mdp helper names**: `randomize_rigid_body_material`, `JointVelocityActionCfg`,
   `base_lin_vel/base_ang_vel/root_pos_w` — standard in 2.x, verify at import.
4. The drag-in pack test (open `pack/world/*.usda`, press Play, rover stands
   on the repaired floor) is gate **G2** and pairs with this package.

Everything in `surveyor_isaac/tasks/` imports Isaac Lab at module load —
that is intentional (standard task-registration pattern); do not import it
in headless contexts. `contract.py`/`validate.py` never touch Isaac.
