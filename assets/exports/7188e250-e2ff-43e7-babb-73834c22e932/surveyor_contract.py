"""Surveyor training contract — GENERATED, do not hand-edit.
world: 7188e250-e2ff-43e7-babb-73834c22e932
certificate grade A at 2026-07-06T12:41:13.322Z (seed 1234)
trust: 51.3% confirmed / 22.7% divergent
Every value below traces to a certificate field; uncertainty ranges become
domain-randomization bands. The certificate is the contract.
"""

from isaaclab.utils import configclass


GRAVITY_MPS2 = (0.0, 0.0, -9.8100)  # certificate gravity context: earth

# friction: assigned prior for rigid indoor surfaces under the disclosed model class (Coulomb, no soil mechanics); NOT a measurement — domain-randomize across the full range
FRICTION_STATIC_RANGE = (0.6000, 1.0000)
FRICTION_DYNAMIC_RANGE = (0.4500, 0.8000)

# verified spawn points (surveyed clearance, outside every quarantined region)
SPAWN_POSES_XYZ = [
        (0.3010, -0.8314, -3.5942),  # rover, clearance 0.92 m
        (0.0010, -0.9660, 10.3058),  # rover, clearance 0.78 m
        (-1.4990, -0.8355, 6.2058),  # rover, clearance 0.70 m
        (3.2010, -0.8351, -0.8942),  # rover, clearance 0.67 m
        (-0.2990, -1.0554, 12.1058),  # rover, clearance 0.64 m
        (0.3010, -0.8314, -3.5942),  # quadruped, clearance 0.92 m
        (0.0010, -0.9660, 10.3058),  # quadruped, clearance 0.78 m
        (-1.4990, -0.8355, 6.2058),  # quadruped, clearance 0.70 m
        (3.2010, -0.8351, -0.8942),  # quadruped, clearance 0.67 m
        (-0.2990, -1.0554, 12.1058),  # quadruped, clearance 0.64 m
]

# quarantined regions: certified LIES (visual-only geometry, unrepairable
# holes). Episodes terminate on entry; no reward is earned inside.
QUARANTINE_AABBS = [
        ((-1.8390, -0.8455, -1.2142), (1.1610, 1.6545, 2.2858)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((1.1610, -0.8455, -1.2142), (1.6610, 1.6545, -0.4642)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((1.4110, -0.8455, -0.2142), (1.9110, 1.6545, 0.7858)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((0.4110, -0.8455, 2.5358), (0.9110, 1.6545, 2.7858)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((0.9110, -0.8455, 4.7858), (1.4110, 1.6545, 5.7858)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((-1.5890, -0.8455, 8.0358), (-0.8390, 1.6545, 9.5358)),  # Ghost geometry: visual samples >0.15 m from any collider sur
        ((-1.5890, -0.8455, 4.2858), (-0.8390, 1.6545, 5.5358)),  # Ghost geometry surfaced by re-probing the mid-corridor (d-vi
        ((-1.0890, -0.8455, 7.0358), (-0.8390, 1.6545, 7.5358)),  # Ghost geometry surfaced by re-probing the mid-corridor (d-vi
        ((-3.1190, -0.8451, -1.7142), (-2.8690, 1.6549, -0.4642)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((1.1310, -0.8451, 3.7858), (1.3810, 1.6549, 4.7858)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((0.8810, -0.8451, 7.7858), (1.3810, 1.6549, 8.0358)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((0.8810, -0.8451, 9.2858), (1.3810, 1.6549, 9.5358)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((-1.8690, -0.8451, 10.2858), (-1.6190, 1.6549, 11.5358)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((0.6310, -0.8451, 12.7858), (0.8810, 1.6549, 13.0358)),  # Ghost geometry surfaced by re-probing at true scale (visual 
        ((-2.8390, -0.8455, -1.7142), (-2.5890, 1.6545, -1.2142)),  # d-phantom-14: collider already fully removed (0 triangles) b
        ((-2.1190, -0.8524, -2.4942), (1.3810, 1.6476, 2.2558)),  # d-phantom-14: collider already fully removed (0 triangles) b
        ((3.1310, -0.8524, -0.4942), (3.3810, 1.6476, 0.2558)),  # d-phantom-14: collider already fully removed (0 triangles) b
        ((0.8810, -0.8524, 8.0058), (1.1310, 1.6476, 8.2558)),  # d-phantom-14: collider already fully removed (0 triangles) b
        ((1.1010, -0.8475, -1.9942), (1.6010, 1.6525, -0.4942)),  # Ghost geometry (160 and 75 visual samples >0.15 m from any c
        ((-1.8990, -0.8475, 10.2558), (-1.3990, 1.6525, 11.5058)),  # Ghost geometry (160 and 75 visual samples >0.15 m from any c
        ((2.8510, -0.8474, -1.7442), (3.1010, 1.6526, -1.4942)),  # Genuine invisible barriers (d-phantom-6: 7 visual/100 collid
        ((-0.1490, -0.8474, 14.2558), (0.3510, 1.6526, 14.7558)),  # Genuine invisible barriers (d-phantom-6: 7 visual/100 collid
]


def apply_contract(env_cfg):
    """Apply the certificate to an Isaac Lab env config (call before env creation)."""
    env_cfg.sim.gravity = GRAVITY_MPS2
    # wire FRICTION_*_RANGE into your randomization event terms, e.g.:
    #   EventTerm(func=mdp.randomize_rigid_body_material,
    #             params={"static_friction_range": FRICTION_STATIC_RANGE,
    #                     "dynamic_friction_range": FRICTION_DYNAMIC_RANGE, ...})
    return env_cfg
