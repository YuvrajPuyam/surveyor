/**
 * Assemble the complete Certified World Pack (ENDGAME §1) from a repaired
 * bundle — the artifact that goes on the Devpost:
 *
 *   <out>/
 *   ├── world/<worldId>.usda        drag into Isaac Sim, press Play
 *   ├── world/validator-report.*    SimReady text-rule report
 *   ├── contract/surveyor_contract.py + contract.json + README.md
 *   ├── dataset/README.md           (cluster-generated — honest placeholder)
 *   ├── policy/README.md            (cluster-generated — honest placeholder)
 *   ├── certificate.json + report.html
 *   ├── HASHES.txt                  sha256 of every file + the certificate content hash
 *   └── README.md                   what this is, how to verify it
 *
 * Usage: npx tsx scripts/make-pack.ts <repaired-bundle-dir> [--out <dir>]
 * (a repaired bundle = engine exportBundle output: collider.glb,
 *  certificate.json, spawns.json, quarantine.json, surveyor_contract.py,
 *  contract.json, metadata.json)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { aabbOfPositions } from "../src/core/geom.js";
import { CertificateSchema } from "../src/core/types.js";
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import type { QuarantineZone } from "../src/export/isaacContract.js";
import type { SpawnPoint } from "../src/repair/engine.js";
import { buildUsdaStage } from "../src/export/usdPack.js";
import { reportToMarkdown, validateUsdaStage } from "../src/export/usdValidate.js";
import { certificateSha256, renderReportHtml } from "../src/report/reportHtml.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npx tsx scripts/make-pack.ts <repaired-bundle-dir> [--out <dir>]");
  process.exit(2);
}
const outIdx = args.indexOf("--out");
const out = outIdx > -1 ? args[outIdx + 1] : join(dir, "certified-world-pack");

const world = await loadWorldBundle(dir);
const certificate = CertificateSchema.parse(JSON.parse(readFileSync(join(dir, "certificate.json"), "utf8")));
const readJson = <T>(p: string): T | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined);
const spawns = readJson<SpawnPoint[]>(join(dir, "spawns.json")) ?? [];
const quarantine = readJson<QuarantineZone[]>(join(dir, "quarantine.json")) ?? [];
const contentSha = certificateSha256(certificate);

for (const d of ["world", "contract", "dataset", "policy"]) mkdirSync(join(out, d), { recursive: true });

// ---- world/
const usda = buildUsdaStage({ collider: world.collider, certificate, spawns, quarantine });
const report = validateUsdaStage(usda, {
  colliderAabb: aabbOfPositions(world.collider.positions),
  pointCount: world.collider.positions.length / 3,
  triCount: world.collider.indices.length / 3,
  spawnCount: spawns.length,
  quarantineCount: quarantine.length,
  gravityMps2: certificate.gravity.g,
});
writeFileSync(join(out, "world", `${certificate.worldId}.usda`), usda);
writeFileSync(join(out, "world", "validator-report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(out, "world", "validator-report.md"), reportToMarkdown(report, certificate.worldId));

// ---- certificate + report
copyFileSync(join(dir, "certificate.json"), join(out, "certificate.json"));
writeFileSync(join(out, "report.html"), renderReportHtml(certificate));

// ---- self-validation appendix (instrument-level CIs, ENDGAME §1) — shipped
// as a SIBLING file so certificate.json stays byte-identical to the bundle's
// (the parity/hash artifact); regenerate with `npm run self-validate -- --out docs/validation/self-validation.json`
const appendix = join("docs", "validation", "self-validation.json");
if (existsSync(appendix)) copyFileSync(appendix, join(out, "self-validation.json"));

// ---- contract/
for (const f of ["surveyor_contract.py", "contract.json", "spawns.json", "quarantine.json"]) {
  if (existsSync(join(dir, f))) copyFileSync(join(dir, f), join(out, "contract", f));
}
writeFileSync(
  join(out, "contract", "README.md"),
  `# Training contract — generated from the certificate

- \`surveyor_contract.py\` / \`contract.json\`: every value traces to a certificate field.
- Installable task package: \`pip install -e <repo>/isaac\` →
  \`--task Certified-Resupply-Rover-v0\` (spawns→resets, quarantine→terminations,
  friction uncertainty→domain randomization, gravity→sim config; open critical
  defects refuse to build a config at all).
- Headless check without Isaac: \`python -m surveyor_isaac.validate <this pack's parent bundle>\`.
`,
);

// ---- honest placeholders for cluster-generated layers
writeFileSync(
  join(out, "dataset", "README.md"),
  `# Dataset — generated on the GPU cluster (gate G5)

~5,000 labeled frames (RGB/depth/segmentation) via Isaac Replicator, cameras
masked to certificate-verified free space: zero geometric poisoning — no
ghost-geometry labels, no clipped cameras, scale-true depth.

Not yet generated at pack-assembly time; this placeholder is replaced by the
Replicator output. Everything needed to generate it is in ../world and
../contract.
`,
);
writeFileSync(
  join(out, "policy", "README.md"),
  `# Policy — trained on the GPU cluster (gates G3/G4)

Lift checkpoint (+ ONNX) and task video, trained with every parameter taken
from ../contract (nothing hand-placed). Not yet generated at pack-assembly
time; this placeholder is replaced by the checkpoint.
`,
);

// ---- pack README
writeFileSync(
  join(out, "README.md"),
  `# Certified World Pack — ${certificate.worldId}

**Input: one sentence to a world model. Output: a working robot, its training
data, and the receipt.**

- **world/**: one USD stage — drag into Isaac Sim, press Play. Visual splats
  (NuRec payload), repaired collider (patch triangles provenance-tagged),
  physics materials, verified spawn points, quarantined regions.
- **contract/**: the Isaac Lab training contract generated FROM the
  certificate. The certificate is the contract.
- **certificate.json / report.html**: the warranty — what is verified, to what
  tolerance, for which robot; every number carries uncertainty and a methods
  line; grade ${certificate.grade}; ${certificate.defects.length} defects each with a recorded outcome.
- **self-validation.json**: the instrument's own bench appendix — recall and
  precision with one-sided 95% Clopper–Pearson lower bounds on planted-defect
  worlds, including the disclosed miss.
- **dataset/, policy/**: cluster-generated layers (placeholders until gate G3–G5).

## Verify this pack

Certificate content SHA-256 (timestamp-normalized, reproducible by re-running
the survey with the same seed):

    ${contentSha}

Re-run: \`npx surveyor certify <bundle> --seed ${certificate.seed}\` — the
survey is deterministic for (world, seed, gravity); the hash chip in the
viewer, the report footer, and this file must all agree. Per-file integrity:
see HASHES.txt.

Nothing is called a defect unless two independent instruments agree; nothing
is called repaired until the same instruments pass it again.
`,
);

// ---- integrity manifest (last: hashes everything above)
const lines: string[] = [`certificate content sha256 (timestamp-normalized): ${contentSha}`, ""];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const p of walk(out).sort()) {
  if (p.endsWith("HASHES.txt")) continue;
  const h = createHash("sha256").update(readFileSync(p)).digest("hex");
  lines.push(`${h}  ${relative(out, p).replace(/\\/g, "/")}`);
}
writeFileSync(join(out, "HASHES.txt"), lines.join("\n") + "\n");

console.log(`pack → ${out}`);
console.log(`  world stage: ${(usda.length / 1024 / 1024).toFixed(1)} MB, validator ${report.pass ? "ALL RULES PASS" : "FAILURES"}`);
console.log(`  spawns ${spawns.length} · quarantine ${quarantine.length} · grade ${certificate.grade}`);
console.log(`  certificate content sha256: ${contentSha}`);
process.exit(report.pass ? 0 : 1);
