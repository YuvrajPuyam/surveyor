/** Write the standard synthetic validation set to assets/generated/. */
import { join } from "node:path";
import { saveWorldBundle } from "../src/ingest/bundleIO.js";
import { standardValidationSet } from "../src/ingest/synthetic.js";

const outRoot = join(process.cwd(), "assets", "generated");
for (const world of standardValidationSet()) {
  const dir = join(outRoot, world.worldId);
  await saveWorldBundle(dir, world);
  console.log(`wrote ${dir} (${world.manifest.length} planted defect(s), ${world.visualPoints.length / 3} visual points)`);
}
