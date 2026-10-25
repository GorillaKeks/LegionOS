import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLatestManifest } from "./updater-manifest.mjs";

const releasePaths = [
  "nsis/LegionOS_x64-setup.exe",
  "nsis/LegionOS_x64-setup.exe.sig",
  "msi/LegionOS_x64_en-US.msi",
  "msi/LegionOS_x64_en-US.msi.sig",
  "latest.json",
];

export function verifyReleaseAssets(root, expectedVersion) {
  const verified = releasePaths.map((relativePath) => {
    const fullPath = path.join(root, relativePath);
    let size;
    try {
      size = statSync(fullPath).size;
    } catch {
      throw new Error(`Required release asset is missing: ${fullPath}`);
    }
    if (size === 0) throw new Error(`Required release asset is empty: ${fullPath}`);
    return fullPath;
  });
  const nsisSignature = readFileSync(path.join(root, "nsis/LegionOS_x64-setup.exe.sig"), "utf8");
  const msiSignature = readFileSync(path.join(root, "msi/LegionOS_x64_en-US.msi.sig"), "utf8");
  if (!msiSignature.startsWith("untrusted comment: ") || msiSignature.trim().split(/\r?\n/).length < 2) {
    throw new Error("The MSI .sig file does not contain a valid Minisign signature payload.");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(root, "latest.json"), "utf8"));
  } catch (error) {
    throw new Error(`latest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateLatestManifest(manifest, {
    expectedVersion,
    expectedSignature: nsisSignature,
  });
  return verified;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tagVersion = process.argv[3]?.startsWith("v") ? process.argv[3].slice(1) : process.argv[3];
    for (const filePath of verifyReleaseAssets(process.argv[2] ?? "installers", tagVersion)) {
      console.log(`Verified release asset: ${filePath}`);
    }
  } catch (error) {
    console.error(`Release asset verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
