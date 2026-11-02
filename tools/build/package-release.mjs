import { cp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function packageRelease(rootDir = process.cwd()) {
  const extensionDir = path.resolve(rootDir, "dist", "extension");
  const releaseDir = path.resolve(rootDir, "dist", "release");
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || manifest.version !== version) {
    throw new Error("Package and built manifest versions must match. Rebuild the extension first.");
  }
  const releaseFolderName = `superflow-extension-v${version}`;
  const stagedDir = path.join(releaseDir, releaseFolderName);
  const githubZipPath = path.join(releaseDir, `${releaseFolderName}.zip`);
  const storeZipPath = path.join(releaseDir, `superflow-chrome-store-v${version}.zip`);

  await mkdir(releaseDir, { recursive: true });
  await rm(stagedDir, { recursive: true, force: true });
  await cp(extensionDir, stagedDir, { recursive: true });
  await rm(githubZipPath, { force: true });
  await rm(storeZipPath, { force: true });
  await runPythonZip(githubZipPath, [releaseFolderName], releaseDir);
  // The Web Store requires manifest.json at the archive root, unlike the GitHub download.
  await runPythonZip(storeZipPath, (await readdir(stagedDir)).sort(), stagedDir);
  return { githubZipPath, storeZipPath };
}

function runPythonZip(zipPath, files, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      ["-m", "zipfile", "-c", zipPath, ...files],
      {
        cwd,
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archives = await packageRelease();
  console.log(`GitHub download -> ${archives.githubZipPath}`);
  console.log(`Chrome Web Store upload -> ${archives.storeZipPath}`);
}
