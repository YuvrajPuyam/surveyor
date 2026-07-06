"""Certified-Resupply-Rover-v0 — a wheeled goal-reaching task where EVERY
sim/training parameter traces to the SURVEYOR certificate:

    spawns.json            -> reset-state distribution
    quarantine.json        -> termination masks (episode ends on entry)
    certificate friction   -> domain-randomization ranges (disclosed priors)
    certificate gravity    -> sim.gravity
    open critical defects  -> ContractRefused (config will not construct)

This module imports isaaclab and is therefore only importable on a machine
with Isaac Lab (the Gilbreth cluster — gate G-lane). The contract math it
consumes is pure python and unit-tested headlessly in isaac/tests/.

Bundle/world paths come from environment variables so the pip-installed
package needs no edits:
    SURVEYOR_BUNDLE_DIR  (required)  repaired-bundle dir with certificate.json,
                                     spawns.json, quarantine.json
    SURVEYOR_WORLD_USD   (optional)  defaults to <bundle>/pack/world/<worldId>.usda
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import torch

import isaaclab.sim as sim_utils
from isaaclab.assets import ArticulationCfg, AssetBaseCfg
from isaaclab.envs import ManagerBasedRLEnvCfg
from isaaclab.managers import EventTermCfg as EventTerm
from isaaclab.managers import ObservationGroupCfg as ObsGroup
from isaaclab.managers import ObservationTermCfg as ObsTerm
from isaaclab.managers import RewardTermCfg as RewTerm
from isaaclab.managers import SceneEntityCfg
from isaaclab.managers import TerminationTermCfg as DoneTerm
from isaaclab.scene import InteractiveSceneCfg
from isaaclab.utils import configclass
import isaaclab.envs.mdp as mdp

from ..contract import ContractConfig, load_contract

# The wheeled platform: Isaac Lab ships a differential-drive Jetbot asset in
# isaaclab_assets; if your Isaac Lab build names it differently, swap the cfg
# import here — the certificate wiring below does not care which robot rolls.
from isaaclab_assets.robots.jetbot import JETBOT_CONFIG  # noqa: E402


def _bundle_dir() -> Path:
    d = os.environ.get("SURVEYOR_BUNDLE_DIR")
    if not d:
        raise RuntimeError(
            "SURVEYOR_BUNDLE_DIR is not set — point it at a repaired bundle "
            "(certificate.json + spawns.json + quarantine.json)"
        )
    return Path(d)


_CONTRACT: ContractConfig = load_contract(_bundle_dir())
_WORLD_USD = os.environ.get(
    "SURVEYOR_WORLD_USD",
    str(_bundle_dir() / "pack" / "world" / f"{_CONTRACT.world_id}.usda"),
)

# Y-up bundle coordinates -> Z-up stage coordinates (the pack stage applies
# +90 deg about X): (x, y, z)_yup -> (x, -z, y)_zup.
def _to_zup(p: tuple[float, float, float]) -> tuple[float, float, float]:
    return (p[0], -p[2], p[1])


_SPAWNS_ZUP = [_to_zup((s.x, s.y, s.z)) for s in _CONTRACT.spawns]
_QUARANTINE_ZUP = [
    # boxes stay axis-aligned under the 90° rotation; recompute min/max
    tuple(
        (min(a, b), max(a, b))
        for a, b in zip(_to_zup(q.min), _to_zup(q.max))
    )
    for q in _CONTRACT.quarantine
]


def reset_from_certificate(env, env_ids: torch.Tensor, asset_cfg: SceneEntityCfg = SceneEntityCfg("robot")):
    """Reset event: sample root poses from the certificate's verified spawns."""
    asset = env.scene[asset_cfg.name]
    n = len(env_ids)
    idx = torch.randint(0, len(_SPAWNS_ZUP), (n,), device=env.device)
    spawn_tensor = torch.tensor(_SPAWNS_ZUP, device=env.device, dtype=torch.float32)
    pos = spawn_tensor[idx] + env.scene.env_origins[env_ids]
    yaw = torch.rand(n, device=env.device) * (2.0 * math.pi)
    quat = torch.stack(
        [torch.cos(yaw / 2), torch.zeros(n, device=env.device), torch.zeros(n, device=env.device), torch.sin(yaw / 2)],
        dim=-1,
    )
    root = asset.data.default_root_state[env_ids].clone()
    root[:, 0:3] = pos
    root[:, 3:7] = quat
    root[:, 7:] = 0.0
    asset.write_root_state_to_sim(root, env_ids)


def in_quarantine(env, asset_cfg: SceneEntityCfg = SceneEntityCfg("robot")) -> torch.Tensor:
    """Termination mask from the certificate: entering a quarantined region ends the episode."""
    asset = env.scene[asset_cfg.name]
    p = asset.data.root_pos_w - env.scene.env_origins
    done = torch.zeros(p.shape[0], dtype=torch.bool, device=env.device)
    for box in _QUARANTINE_ZUP:
        inside = (
            (p[:, 0] >= box[0][0]) & (p[:, 0] <= box[0][1])
            & (p[:, 1] >= box[1][0]) & (p[:, 1] <= box[1][1])
            & (p[:, 2] >= box[2][0]) & (p[:, 2] <= box[2][1])
        )
        done |= inside
    return done


def goal_progress(env, asset_cfg: SceneEntityCfg = SceneEntityCfg("robot")) -> torch.Tensor:
    """Reward: negative distance to the depot marker (first spawn of the LAST robot list entry as a stand-in goal)."""
    asset = env.scene[asset_cfg.name]
    p = asset.data.root_pos_w - env.scene.env_origins
    goal = torch.tensor(_GOAL_ZUP, device=env.device, dtype=torch.float32)
    return -torch.linalg.norm(p[:, :2] - goal[:2], dim=-1)


# Depot marker: the farthest verified spawn from the first one — a certified,
# reachable target without inventing any uncertified geometry.
def _pick_goal() -> tuple[float, float, float]:
    if len(_SPAWNS_ZUP) < 2:
        return _SPAWNS_ZUP[0] if _SPAWNS_ZUP else (0.0, 0.0, 0.0)
    a = _SPAWNS_ZUP[0]
    return max(_SPAWNS_ZUP[1:], key=lambda s: (s[0] - a[0]) ** 2 + (s[1] - a[1]) ** 2)


_GOAL_ZUP = _pick_goal()


@configclass
class SceneCfg(InteractiveSceneCfg):
    """Certified world + wheeled robot + light."""

    world = AssetBaseCfg(
        prim_path="{ENV_REGEX_NS}/World",
        spawn=sim_utils.UsdFileCfg(usd_path=_WORLD_USD),
    )
    robot: ArticulationCfg = JETBOT_CONFIG.replace(prim_path="{ENV_REGEX_NS}/Robot")
    light = AssetBaseCfg(
        prim_path="/World/light",
        spawn=sim_utils.DomeLightCfg(intensity=2000.0),
    )


@configclass
class ActionsCfg:
    wheel_velocity = mdp.JointVelocityActionCfg(asset_name="robot", joint_names=[".*"], scale=5.0)


@configclass
class ObservationsCfg:
    @configclass
    class PolicyCfg(ObsGroup):
        base_lin_vel = ObsTerm(func=mdp.base_lin_vel)
        base_ang_vel = ObsTerm(func=mdp.base_ang_vel)
        root_pos = ObsTerm(func=mdp.root_pos_w)
        actions = ObsTerm(func=mdp.last_action)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = True

    policy: PolicyCfg = PolicyCfg()


@configclass
class EventCfg:
    # resets <- certificate spawns
    reset_robot = EventTerm(func=reset_from_certificate, mode="reset")
    # friction DR <- certificate uncertainty (disclosed prior, full range)
    randomize_friction = EventTerm(
        func=mdp.randomize_rigid_body_material,
        mode="startup",
        params={
            "asset_cfg": SceneEntityCfg("robot", body_names=".*"),
            "static_friction_range": _CONTRACT.friction_static_range,
            "dynamic_friction_range": _CONTRACT.friction_dynamic_range,
            "restitution_range": (0.0, 0.0),
            "num_buckets": 64,
        },
    )


@configclass
class RewardsCfg:
    progress = RewTerm(func=goal_progress, weight=1.0)
    quarantine_penalty = RewTerm(func=in_quarantine, weight=-10.0)


@configclass
class TerminationsCfg:
    time_out = DoneTerm(func=mdp.time_out, time_out=True)
    # termination mask <- certificate quarantine zones
    quarantine = DoneTerm(func=in_quarantine)


@configclass
class CertifiedResupplyRoverEnvCfg(ManagerBasedRLEnvCfg):
    scene: SceneCfg = SceneCfg(num_envs=64, env_spacing=0.0)
    actions: ActionsCfg = ActionsCfg()
    observations: ObservationsCfg = ObservationsCfg()
    events: EventCfg = EventCfg()
    rewards: RewardsCfg = RewardsCfg()
    terminations: TerminationsCfg = TerminationsCfg()

    def __post_init__(self):
        self.decimation = 4
        self.episode_length_s = 30.0
        self.sim.dt = 1 / 120
        # sim gravity <- the certificate's gravity context
        self.sim.gravity = _CONTRACT.gravity_vec
