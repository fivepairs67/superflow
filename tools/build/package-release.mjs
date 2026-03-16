import { cp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const rootDir = path.resolve(process.cwd());
const distDir = path.join(rootDir, "dist");
const extensionDir = path.join(distDir, "extension");
const releaseDir = path.join(distDir, "release");

const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const version = packageJson.version;
const releaseFolderName = `superflow-extension-v${version}`;
const stagedDir = path.join(releaseDir, releaseFolderName);
const zipPath = path.join(releaseDir, `${releaseFolderName}.zip`);

await rm(stagedDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(releaseDir, { recursive: true });
await cp(extensionDir, stagedDir, { recursive: true });

await runPythonZip();

console.log(`Built release archive -> ${zipPath}`);

function runPythonZip() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      ["-m", "zipfile", "-c", zipPath, releaseFolderName],
      {
        cwd: releaseDir,
        stdio: "inherit",
      },
    );

    child.on("error", (error) => {
      reject(new Error(`Failed to start python3 for release packaging: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Release packaging failed with exit code ${code}`));
    });
  });
}
