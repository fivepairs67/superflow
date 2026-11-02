import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packageRelease } from "../build/package-release.mjs";

test("release archives have distinct roots, matching versions, and no stale files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "superflow-release-test-"));
  try {
    const extension = path.join(root, "dist", "extension");
    await mkdir(path.join(extension, "icons"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.1.3" }));
    const manifest = { manifest_version: 3, name: "SuperFLOW", version: "0.1.3" };
    await writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(extension, "background.js"), "// Synthetic build fixture\n");
    await writeFile(path.join(extension, "obsolete.txt"), "old build");
    await writeFile(path.join(extension, "icons", "icon128.png"), "fixture");
    await packageRelease(root);
    await rm(path.join(extension, "obsolete.txt"));
    const archives = await packageRelease(root);
    const list = (zip) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
    const storeFiles = list(archives.storeZipPath);
    const githubFiles = list(archives.githubZipPath);
    assert.ok(storeFiles.includes("manifest.json"));
    assert.ok(storeFiles.includes("icons/icon128.png"));
    assert.ok(githubFiles.includes("superflow-extension-v0.1.3/manifest.json"));
    assert.ok(storeFiles.every((file) => !file.startsWith("superflow-extension-")));
    assert.ok([...storeFiles, ...githubFiles].every((file) => !file.includes("obsolete.txt")));
    assert.deepEqual(JSON.parse(execFileSync("unzip", ["-p", archives.storeZipPath, "manifest.json"], { encoding: "utf8" })), manifest);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.1.4" }));
    await assert.rejects(packageRelease(root), /versions must match/);
    assert.ok((await readFile(archives.storeZipPath)).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
