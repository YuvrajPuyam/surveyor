/**
 * USD pack assembler (ENDGAME C8): one .usda text stage that a robotics lab
 * drags into Isaac Sim and presses Play —
 *
 *   /World                      Y-up source data under an explicit Z-up root
 *     /PhysicsScene             gravity from the certificate (the contract)
 *     /Geometry/Collider        repaired tri-mesh, PhysicsCollisionAPI,
 *                               purpose=guide (never renders over the splats)
 *     /Visuals                  payload → ./nurec/<worldId>.usdz (cluster-
 *                               generated NuRec splats; stage loads without it)
 *     /PhysicsMaterials/...     friction prior from the certificate, DR band
 *                               in customData (assigned prior, NOT a measurement)
 *     /Spawns/spawn_NNN         verified spawn points (outside quarantine)
 *     /Quarantine/q_NNN         invisible guide cubes; training terminates inside
 *
 * Deterministic: same inputs → byte-identical .usda (fixed float formatting,
 * no timestamps in the body). Every number traces to a certificate field.
 */
import { aabbOfPositions, type TriMesh } from "../core/geom.js";
import type { Certificate } from "../core/types.js";
import { frictionRange } from "./isaacContract.js";
import type { QuarantineZone } from "./isaacContract.js";
import type { SpawnPoint } from "../repair/engine.js";
import { certificateSha256 } from "../report/reportHtml.js";

export interface UsdPackInput {
  collider: TriMesh;
  certificate: Certificate;
  spawns: SpawnPoint[];
  quarantine: QuarantineZone[];
}

const f = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const s = v.toFixed(5);
  return s === "-0.00000" ? "0.00000" : s;
};

const escStr = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function buildUsdaStage(input: UsdPackInput): string {
  const { collider, certificate: cert, spawns, quarantine } = input;
  const sha = certificateSha256(cert);
  const fr = frictionRange(cert);
  const frictionStatic = (fr.static[0] + fr.static[1]) / 2;
  const frictionDynamic = (fr.dynamic[0] + fr.dynamic[1]) / 2;

  // vendor scale left unapplied would make metersPerUnit a lie — bake it here
  const unappliedFactor =
    !cert.scale.vendorFactorApplied && cert.scale.vendorFactor !== undefined && cert.scale.vendorFactor !== 1
      ? cert.scale.vendorFactor
      : undefined;

  const patchedDefects = cert.defects.filter((d) => d.outcome === "fixed").map((d) => d.id);

  // ---- geometry arrays (chunked join — colliders run to 100k+ triangles)
  const pos = collider.positions;
  const idx = collider.indices;
  const triCount = idx.length / 3;
  const pts: string[] = new Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) pts[i / 3] = `(${f(pos[i])}, ${f(pos[i + 1])}, ${f(pos[i + 2])})`;
  const counts: string[] = new Array(triCount).fill("3");
  const indices: string[] = new Array(idx.length);
  for (let i = 0; i < idx.length; i++) indices[i] = String(idx[i]);

  const spawnPrims = spawns
    .map((s, i) => {
      const name = `spawn_${String(i).padStart(3, "0")}`;
      return `
        def Xform "${name}" (
            customData = {
                string surveyorRobotId = "${escStr(s.robotId)}"
                double surveyorClearanceM = ${f(s.clearanceM)}
            }
        )
        {
            double3 xformOp:translate = (${f(s.x)}, ${f(s.y)}, ${f(s.z)})
            uniform token[] xformOpOrder = ["xformOp:translate"]
        }`;
    })
    .join("\n");

  const quarantinePrims = quarantine
    .map((q, i) => {
      const name = `q_${String(i).padStart(3, "0")}`;
      const cx = (q.region.min[0] + q.region.max[0]) / 2;
      const cy = (q.region.min[1] + q.region.max[1]) / 2;
      const cz = (q.region.min[2] + q.region.max[2]) / 2;
      // Cube has size 2 — scale by half-extents (floored so flat zones stay pickable)
      const hx = Math.max(0.05, (q.region.max[0] - q.region.min[0]) / 2);
      const hy = Math.max(0.05, (q.region.max[1] - q.region.min[1]) / 2);
      const hz = Math.max(0.05, (q.region.max[2] - q.region.min[2]) / 2);
      return `
        def Cube "${name}" (
            customData = {
                string surveyorReason = "${escStr(q.reason.slice(0, 200))}"
            }
        )
        {
            double size = 2
            uniform token purpose = "guide"
            token visibility = "invisible"
            double3 xformOp:translate = (${f(cx)}, ${f(cy)}, ${f(cz)})
            double3 xformOp:scale = (${f(hx)}, ${f(hy)}, ${f(hz)})
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        }`;
    })
    .join("\n");

  return `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Z"
    doc = """SURVEYOR Certified World Pack — generated stage, do not hand-edit.
world ${cert.worldId} · certificate grade ${cert.grade} (seed ${cert.seed}) · content sha256 ${sha}
Source data is Y-up; the /World root applies the explicit +90 deg X rotation.
Every physics value traces to a certificate field. The certificate is the contract."""
    customLayerData = {
        string surveyorWorldId = "${escStr(cert.worldId)}"
        string surveyorGrade = "${cert.grade}"
        int surveyorSeed = ${cert.seed}
        string surveyorCertificateSha256 = "${sha}"
        string surveyorGravity = "${cert.gravity.name}"
    }
)

def Xform "World"
{
    float3 xformOp:rotateXYZ = (90, 0, 0)
${unappliedFactor !== undefined ? `    float3 xformOp:scale = (${f(unappliedFactor)}, ${f(unappliedFactor)}, ${f(unappliedFactor)})\n    uniform token[] xformOpOrder = ["xformOp:rotateXYZ", "xformOp:scale"]` : `    uniform token[] xformOpOrder = ["xformOp:rotateXYZ"]`}

    def PhysicsScene "PhysicsScene"
    {
        vector3f physics:gravityDirection = (0, 0, -1)
        float physics:gravityMagnitude = ${f(cert.gravity.g)}
    }

    def Scope "Geometry"
    {
        def Mesh "Collider" (
            prepend apiSchemas = ["PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"]
            customData = {
                string surveyorRole = "repaired collider — static tri-mesh"
                string[] surveyorPatchedDefects = [${patchedDefects.map((d) => `"${escStr(d)}"`).join(", ")}]
            }
        )
        {
            point3f[] points = [${pts.join(", ")}]
            int[] faceVertexCounts = [${counts.join(", ")}]
            int[] faceVertexIndices = [${indices.join(", ")}]
            uniform token purpose = "guide"
            bool physics:collisionEnabled = 1
            uniform token physics:approximation = "none"
            rel material:binding:physics = </World/PhysicsMaterials/FloorMaterial>
            bool doubleSided = 1
        }
    }

    def Xform "Visuals" (
        prepend payload = @./nurec/${cert.worldId}.usdz@
        customData = {
            string surveyorNote = "NuRec splat asset — generated on the cluster (gate G2); the stage opens without it (payload, load on demand)"
        }
    )
    {
    }

    def Scope "PhysicsMaterials"
    {
        def Material "FloorMaterial" (
            prepend apiSchemas = ["PhysicsMaterialAPI"]
            customData = {
                double2 surveyorStaticFrictionRange = (${f(fr.static[0])}, ${f(fr.static[1])})
                double2 surveyorDynamicFrictionRange = (${f(fr.dynamic[0])}, ${f(fr.dynamic[1])})
                string surveyorFrictionBasis = "${escStr(fr.basis)}"
            }
        )
        {
            uniform float physics:staticFriction = ${f(frictionStatic)}
            uniform float physics:dynamicFriction = ${f(frictionDynamic)}
            uniform float physics:restitution = 0
        }
    }

    def Scope "Spawns"
    {${spawnPrims || "\n        # NONE — do not train in this world until verified spawns exist"}
    }

    def Scope "Quarantine"
    {${quarantinePrims || "\n        # none — every detected defect was repaired or accepted"}
    }
}
`;
}
