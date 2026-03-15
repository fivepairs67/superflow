import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const rootDir = path.resolve(process.cwd());
const extensionDir = path.join(rootDir, "extension");
const sourceDir = path.join(extensionDir, "src");
const outDir = path.join(rootDir, "dist", "extension");
const watchMode = process.argv.includes("--watch");
const sidepanelEntry = path.join(sourceDir, "sidepanel", "main.tsx");

await prepareOutput();
await writeStaticFiles();

const contexts = await Promise.all([
  esbuild.context({
    absWorkingDir: rootDir,
    entryPoints: {
      background: path.join(sourceDir, "background", "index.ts"),
    },
    bundle: true,
    format: "esm",
    outdir: outDir,
    entryNames: "[name]",
    platform: "browser",
    target: ["chrome116"],
    sourcemap: watchMode ? "inline" : false,
    logLevel: "info",
  }),
  esbuild.context({
    absWorkingDir: rootDir,
    entryPoints: {
      content: path.join(sourceDir, "content", "index.ts"),
      "page-bridge": path.join(sourceDir, "bridge", "index.ts"),
      sidepanel: sidepanelEntry,
    },
    bundle: true,
    format: "iife",
    outdir: outDir,
    entryNames: "[name]",
    assetNames: "assets/[name]-[hash]",
    loader: {
      ".css": "css",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(watchMode ? "development" : "production"),
    },
    jsx: "automatic",
    platform: "browser",
    target: ["chrome116"],
    sourcemap: watchMode ? "inline" : false,
    logLevel: "info",
  }),
]);

if (watchMode) {
  await Promise.all(contexts.map((context) => context.watch()));
  console.log(`Watching extension sources -> ${outDir}`);
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
  console.log(`Built extension -> ${outDir}`);
}

async function prepareOutput() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

async function writeStaticFiles() {
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = await readFile(manifestPath, "utf8");
  const sidepanelHtml = createSidepanelHtml();
  const assetsDir = path.join(extensionDir, "assets");
  const iconsDir = path.join(extensionDir, "icons");

  await Promise.all([
    writeFile(path.join(outDir, "manifest.json"), manifest),
    writeFile(path.join(outDir, "sidepanel.html"), sidepanelHtml),
    cp(assetsDir, path.join(outDir, "assets"), { recursive: true, force: true }).catch(() => {}),
    cp(iconsDir, path.join(outDir, "icons"), { recursive: true, force: true }).catch(() => {}),
  ]);
}

function createSidepanelHtml() {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SuperFLOW</title>
    <link rel="stylesheet" href="./sidepanel.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./sidepanel.js"></script>
  </body>
</html>
`;
}
