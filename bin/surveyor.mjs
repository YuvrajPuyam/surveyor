#!/usr/bin/env node
/**
 * surveyor — preflight CLI for world bundles.
 *   surveyor certify <bundle-dir> [options]   grade a world, write report.html
 *   surveyor help | version
 * TypeScript sources load directly through tsx: no build step, works from a
 * plain `npm install` checkout (tsx is a runtime dependency on purpose).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

register();

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [cmd, ...rest] = process.argv.slice(2);

const USAGE = `surveyor — inspection & repair instrument for AI-generated 3D worlds

commands:
  certify <bundle-dir>   survey + grade a world bundle, emit certificate + report
  version                print version
  help                   this text

run \`surveyor certify\` with no args for certify options and exit codes.`;

switch (cmd) {
  case "certify": {
    const { certifyMain } = await import(pathToFileURL(join(root, "src", "cli", "certifyMain.ts")).href);
    process.exit(await certifyMain(rest));
    break;
  }
  case "version": {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    console.log(pkg.version);
    break;
  }
  case "help":
  case undefined: {
    console.log(USAGE);
    process.exit(cmd ? 0 : 2);
    break;
  }
  default: {
    console.error(`unknown command "${cmd}"\n\n${USAGE}`);
    process.exit(2);
  }
}
