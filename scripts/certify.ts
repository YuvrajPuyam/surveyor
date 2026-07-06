/**
 * Certify a world bundle from the command line — thin wrapper over the same
 * CLI main the `surveyor` bin uses, so `npm run certify -- <dir>` and
 * `surveyor certify <dir>` are one code path with one set of exit codes.
 * Usage: npm run certify -- assets/marble/<id> [--gravity mars] [--probes 2000] [--out cert.json]
 */
import { certifyMain } from "../src/cli/certifyMain.js";

process.exit(await certifyMain(process.argv.slice(2)));
