import path from "node:path";
import process from "node:process";

import { build } from "esbuild";

const rootDir = path.resolve(process.cwd());
const entry = path.join(rootDir, "tools", "vendor", "dt-sql-parser-shim-entry.ts");
const outfile = path.join(rootDir, "extension", "vendor", "dt-sql-parser-shim.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});

console.log(`Built dt-sql-parser shim -> ${outfile}`);
