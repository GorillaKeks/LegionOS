import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function checkReleaseVersion(tag, root = projectRoot) {
  const semverPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
  const tagMatch = semverPattern.exec(tag ?? "");
  if (!tagMatch) throw new Error(`Release tag must use vMAJOR.MINOR.PATCH format; received ${tag || "<empty>"}.`);

  const expectedVersion = tag.slice(1);
  const readJsonAt = (relativePath) => JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
  const readCargoTomlAt = () => {
    const contents = readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
    const packageSection = contents.split(/(?=^\[[^\]]+\]\s*$)/m).find((section) => /^\[package\]\s*$/m.test(section));
    const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!version) throw new Error("Could not read [package].version from src-tauri/Cargo.toml.");
    return version;
  };
  const readCargoLockAt = () => {
    const contents = readFileSync(path.join(root, "src-tauri", "Cargo.lock"), "utf8");
    const packageEntries = contents.split(/(?=^\[\[package\]\]\s*$)/m).slice(1);
    for (const entry of packageEntries) {
      const name = entry.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
      if (name === "phone") {
        const version = entry.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
        if (version) return version;
      }
    }
    throw new Error("Could not find package phone in src-tauri/Cargo.lock.");
  };

  const packageJson = readJsonAt("package.json");
  const packageLock = readJsonAt("package-lock.json");
  const tauriConfig = readJsonAt("src-tauri/tauri.conf.json");
  const versions = new Map([
    ["package.json", packageJson.version],
    ["package-lock.json", packageLock.version],
    ["package-lock.json root package", packageLock.packages?.[""]?.version],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
    ["src-tauri/Cargo.toml", readCargoTomlAt()],
    ["src-tauri/Cargo.lock (phone)", readCargoLockAt()],
  ]);

  const mismatches = [...versions]
    .filter(([, version]) => version !== expectedVersion)
    .map(([file, version]) => `${file}: ${version ?? "missing"}`);
  if (mismatches.length > 0) {
    throw new Error(`Tag ${tag} requires version ${expectedVersion}; mismatched project versions: ${mismatches.join(", ")}.`);
  }

  return expectedVersion;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = checkReleaseVersion(process.argv[2]);
    console.log(`Release tag and project manifests match: ${version}`);
  } catch (error) {
    console.error(`Release version check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
