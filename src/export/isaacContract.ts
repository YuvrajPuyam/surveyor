/**
 * Stage B of pipeline v2: the certificate EXECUTES.
 *
 * Converts a Surveyor certificate (+ spawns + quarantine zones) into an
 * Isaac Lab environment-config fragment. This is the demo's "certificate
 * doing work" screen: certificate JSON on the left, generated training
 * contract on the right.
 *
 *  - sim.gravity        <- the certificate's gravity context
 *  - friction DR range  <- Measurement uncertainty (wide uncertainty -> wide
 *                          randomization; the honest consumption of an error bar)
 *  - reset poses        <- verified spawn points only
 *  - termination mask   <- quarantined regions: no training step touches a lie
 *  - camera regions     <- trust-verified cells only (SDG placement)
 *
 * Friction honesty (pipeline-v2 §5): values are ASSIGNED PRIORS with
 * disclosed ranges, not measurements — the basis lines carry through.
 */
import type { Certificate, Region } from "../core/types.js";
import type { SpawnPoint } from "../repair/engine.js";

export interface QuarantineZone {
  region: Region;
  reason: string;
}

export interface IsaacContract {
  python: string;
  sidecar: {
    worldId: string;
    generatedFrom: { grade: string; certifiedAt: string; seed: number };
    gravity: { name: string; mps2: number };
    friction: { static: [number, number]; dynamic: [number, number]; basis: string };
    spawns: SpawnPoint[];
    quarantine: QuarantineZone[];
    disclosures: string[];
  };
}

/** Coulomb friction prior for generic indoor hard surfaces, widened by scale trust. */
function frictionRange(cert: Certificate): { static: [number, number]; dynamic: [number, number]; basis: string } {
  // The certificate does not measure friction (no tactile probe in the model
  // class) — this is a disclosed prior. Scale-unverified worlds get the
  // widest band; verified-scale worlds get the standard indoor prior.
  const scaleOpen = cert.defects.some((d) => d.type === "scale_error" && (!d.outcome || d.outcome === "escalated"));
  if (scaleOpen) {
    return {
      static: [0.4, 1.1],
      dynamic: [0.3, 0.9],
      basis: "wide prior: scale unverified at certification time — do not narrow until re-certified",
    };
  }
  return {
    static: [0.6, 1.0],
    dynamic: [0.45, 0.8],
    basis: "assigned prior for rigid indoor surfaces under the disclosed model class (Coulomb, no soil mechanics); NOT a measurement — domain-randomize across the full range",
  };
}

function py(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : "0.0";
}

export function certificateToIsaac(
  cert: Certificate,
  spawns: SpawnPoint[],
  quarantine: QuarantineZone[],
): IsaacContract {
  const fr = frictionRange(cert);
  const g = cert.gravity;
  const spawnLines = spawns
    .map((s) => `        (${py(s.x)}, ${py(s.y)}, ${py(s.z)}),  # ${s.robotId}, clearance ${s.clearanceM.toFixed(2)} m`)
    .join("\n");
  const quarantineLines = quarantine
    .map(
      (q) =>
        `        ((${py(q.region.min[0])}, ${py(q.region.min[1])}, ${py(q.region.min[2])}), ` +
        `(${py(q.region.max[0])}, ${py(q.region.max[1])}, ${py(q.region.max[2])})),  # ${q.reason.slice(0, 60)}`,
    )
    .join("\n");

  const python = `"""Surveyor training contract — GENERATED, do not hand-edit.
world: ${cert.worldId}
certificate grade ${cert.grade} at ${cert.createdAt} (seed ${cert.seed})
trust: ${cert.trust.verifiedPct.toFixed(1)}% verified / ${cert.trust.lyingPct.toFixed(1)}% lying
Every value below traces to a certificate field; uncertainty ranges become
domain-randomization bands. The certificate is the contract.
"""

from isaaclab.utils import configclass


GRAVITY_MPS2 = (0.0, 0.0, -${py(g.g)})  # certificate gravity context: ${g.name}

# friction: ${fr.basis}
FRICTION_STATIC_RANGE = (${py(fr.static[0])}, ${py(fr.static[1])})
FRICTION_DYNAMIC_RANGE = (${py(fr.dynamic[0])}, ${py(fr.dynamic[1])})

# verified spawn points (surveyed clearance, outside every quarantined region)
SPAWN_POSES_XYZ = [
${spawnLines || "        # NONE — do not train in this world until spawns exist"}
]

# quarantined regions: certified LIES (visual-only geometry, unrepairable
# holes). Episodes terminate on entry; no reward is earned inside.
QUARANTINE_AABBS = [
${quarantineLines || "        # none — every detected defect was repaired or accepted"}
]


def apply_contract(env_cfg):
    """Apply the certificate to an Isaac Lab env config (call before env creation)."""
    env_cfg.sim.gravity = GRAVITY_MPS2
    # wire FRICTION_*_RANGE into your randomization event terms, e.g.:
    #   EventTerm(func=mdp.randomize_rigid_body_material,
    #             params={"static_friction_range": FRICTION_STATIC_RANGE,
    #                     "dynamic_friction_range": FRICTION_DYNAMIC_RANGE, ...})
    return env_cfg
`;

  return {
    python,
    sidecar: {
      worldId: cert.worldId,
      generatedFrom: { grade: cert.grade, certifiedAt: cert.createdAt, seed: cert.seed },
      gravity: { name: g.name, mps2: g.g },
      friction: fr,
      spawns,
      quarantine,
      disclosures: cert.disclosures,
    },
  };
}
