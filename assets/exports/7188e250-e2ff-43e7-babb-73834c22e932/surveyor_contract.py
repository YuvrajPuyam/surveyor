"""Surveyor training contract — GENERATED, do not hand-edit.
world: 7188e250-e2ff-43e7-babb-73834c22e932
certificate grade F at 2026-07-05T15:46:47.387Z (seed 1234)
trust: 10.9% verified / 18.7% lying
Every value below traces to a certificate field; uncertainty ranges become
domain-randomization bands. The certificate is the contract.
"""

from isaaclab.utils import configclass


GRAVITY_MPS2 = (0.0, 0.0, -1.6200)  # certificate gravity context: moon

# friction: wide prior: scale unverified at certification time — do not narrow until re-certified
FRICTION_STATIC_RANGE = (0.4000, 1.1000)
FRICTION_DYNAMIC_RANGE = (0.3000, 0.9000)

# verified spawn points (surveyed clearance, outside every quarantined region)
SPAWN_POSES_XYZ = [
        # NONE — do not train in this world until spawns exist
]

# quarantined regions: certified LIES (visual-only geometry, unrepairable
# holes). Episodes terminate on entry; no reward is earned inside.
QUARANTINE_AABBS = [
        # none — every detected defect was repaired or accepted
]


def apply_contract(env_cfg):
    """Apply the certificate to an Isaac Lab env config (call before env creation)."""
    env_cfg.sim.gravity = GRAVITY_MPS2
    # wire FRICTION_*_RANGE into your randomization event terms, e.g.:
    #   EventTerm(func=mdp.randomize_rigid_body_material,
    #             params={"static_friction_range": FRICTION_STATIC_RANGE,
    #                     "dynamic_friction_range": FRICTION_DYNAMIC_RANGE, ...})
    return env_cfg
