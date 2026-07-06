/**
 * ASCII trust map — see what the instrument sees.
 *   # wall/obstacle   . floor   ' observed floor-ish   space: outside domain
 *   O hole-claiming void   F probe fall confirmed   v visual-no-physics
 *   p physics-no-visual    r probe rested (verified)
 * Usage: npx tsx scripts/trust-map-ascii.ts <bundle-dir> [--probes 1500]
 */
import { loadWorldBundle } from "../src/ingest/bundleIO.js";
import { runSurvey, DEFAULT_SURVEY } from "../src/certify/survey.js";
import { runMetrology } from "../src/certify/metrology.js";

const dir = process.argv[2];
const probesArg = process.argv.indexOf("--probes");
const probeCount = probesArg > -1 ? parseInt(process.argv[probesArg + 1], 10) : 1500;

const world = await loadWorldBundle(dir);
const survey = await runSurvey(world.collider, world.visualPoints, {
  ...DEFAULT_SURVEY,
  probeCount,
});
const metrology = runMetrology(survey.rayGrid, 1234, world.metadata);

const rg = survey.rayGrid;
const tg = survey.trustGrid;
const classes = rg.channel("class");
const domain = rg.channel("domain");
const standable = rg.channel("standable");
const band = rg.channel("visualFloorBand");
const total = rg.channel("visualTotal");

const fall = tg.channel("fallConfirmed");
const contact = tg.channel("probeContact");
const vnp = tg.channel("visualNoPhys");
const pnv = tg.channel("physNoVisual");

// render at trust resolution (0.25 m) for a terminal-sized map
const rows: string[] = [];
for (let r = tg.rows - 1; r >= 0; r--) {
  let line = "";
  for (let c = 0; c < tg.cols; c++) {
    const i = r * tg.cols + c;
    const [x, z] = tg.center(i);
    const ri = rg.index(x, z);
    let ch = " ";
    if (domain[ri]) {
      if (classes[ri] === 3) ch = "#";
      else if (classes[ri] === 2) ch = "=";
      else if (classes[ri] === 1) ch = ".";
      else if (classes[ri] === 0 && band[ri] >= 1 && band[ri] / Math.max(1, total[ri]) >= 0.3) ch = "O";
      else ch = "'";
    }
    if (contact[i] > 0) ch = "r";
    if (pnv[i] >= 3) ch = "p";
    if (vnp[i] >= 3) ch = "v";
    if (fall[i] > 0) ch = "F";
    line += ch;
  }
  rows.push(line);
}
console.log(`world ${world.worldId} — ${tg.cols}x${tg.rows} cells at ${tg.cellSize} m (x → right, z → up)`);
console.log(rows.join("\n"));
console.log(`\nfloor plane y=${metrology.floorPlane.y.toFixed(2)} tilt=${metrology.floorPlane.tiltDeg.toFixed(1)}deg inliers=${metrology.floorPlane.inliers}`);
console.log(`doorways: ${metrology.doorways.map((d) => `${d.widthM.value.toFixed(2)}x${d.heightM.value.toFixed(2)}m`).join(", ") || "none"}`);
console.log(
  `steps: ${metrology.steps.length}, holes: ${metrology.interiorVoids.filter((v) => !v.openEdge).length} enclosed + ${metrology.interiorVoids.filter((v) => v.openEdge).length} open-edge`,
);
console.log(`probes: ${JSON.stringify(survey.probeStats)}`);
