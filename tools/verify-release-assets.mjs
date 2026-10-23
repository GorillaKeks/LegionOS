import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installerPaths = [
  "nsis/LegionOS_x64-setup.exe",
  "msi/LegionOS_x64_en-US.msi",
];

export function verifyReleaseAssets(root) {
  return installerPaths.map((relativePath) => {
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const filePath of verifyReleaseAssets(process.argv[2] ?? "installers")) {
      console.log(`Verified release asset: ${filePath}`);
    }
  } catch (error) {
    console.error(`Release asset verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
