"""Gym registration for the certified tasks.

Importing this module requires gymnasium (ships with Isaac Lab). The env
config itself imports isaaclab lazily via the string entry point, per the
standard Isaac Lab task-registration pattern.
"""

import gymnasium as gym

gym.register(
    id="Certified-Resupply-Rover-v0",
    entry_point="isaaclab.envs:ManagerBasedRLEnv",
    disable_env_checker=True,
    kwargs={
        "env_cfg_entry_point": "surveyor_isaac.tasks.certified_resupply_rover:CertifiedResupplyRoverEnvCfg",
    },
)
