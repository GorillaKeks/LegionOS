import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLatestManifest } from "./updater-manifest.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.join(projectRoot, "src-tauri", "target", "release", "bundle");

export const installerDefinitions = [
  {
    folder: "nsis",
    pattern: /_x64-setup\.exe$/i,
    outputName: "LegionOS_x64-setup.exe",
  },
  {
    folder: "msi",
    pattern: /_x64_en-US\.msi$/i,
    outputName: "LegionOS_x64_en-US.msi",
  },
];

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(entryPath));
    else if (entry.isFile()) result.push(entryPath);
  }
  return result;
}

function fileFingerprint(filePath) {
  const stat = statSync(filePath);
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, digest };
}

export function snapshotInstallerFiles(directory) {
  const snapshot = new Map();
  for (const filePath of walkFiles(directory)) {
    if (/\.(exe|msi)\.sig$|\.(exe|msi)$/i.test(filePath)) snapshot.set(path.resolve(filePath), fileFingerprint(filePath));
  }
  return snapshot;
}

function changedSinceSnapshot(filePath, snapshot) {
  const previous = snapshot.get(path.resolve(filePath));
  if (!previous) return true;
  const current = fileFingerprint(filePath);
  return current.size !== previous.size
    || current.mtimeMs !== previous.mtimeMs
    || current.ctimeMs !== previous.ctimeMs
    || current.digest !== previous.digest;
}

export function findFreshInstaller(directory, definition, snapshot) {
  const candidates = walkFiles(directory).filter((filePath) => {
    const baseName = path.basename(filePath);
    return definition.pattern.test(baseName)
      && baseName.toLowerCase() !== definition.outputName.toLowerCase()
      && changedSinceSnapshot(filePath, snapshot);
  });

  if (candidates.length === 0) {
    throw new Error(
      `No fresh x64 ${definition.folder.toUpperCase()} installer matching ${definition.pattern} was produced in ${directory}.`,
    );
  }

  return candidates
    .map((filePath) => ({ filePath, modifiedAt: statSync(filePath).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0].filePath;
}

export function findFreshSignature(installerPath, snapshot) {
  const signaturePath = `${installerPath}.sig`;
  if (!existsSync(signaturePath) || !changedSinceSnapshot(signaturePath, snapshot)) {
    throw new Error(`Fresh updater signature is missing for ${path.basename(installerPath)}.`);
  }
  const signature = readFileSync(signaturePath, "utf8");
  if (!signature.startsWith("untrusted comment: ") || signature.trim().split(/\r?\n/).length < 2) {
    throw new Error(`Updater signature is empty or invalid: ${signaturePath}`);
  }
  if (statSync(signaturePath).size === 0) throw new Error(`Updater signature is empty: ${signaturePath}`);
  return signaturePath;
}

function removeFixedInstallers() {
  for (const definition of installerDefinitions) {
    const aliasPath = path.join(bundleRoot, definition.folder, definition.outputName);
    rmSync(aliasPath, { force: true });
    rmSync(`${aliasPath}.sig`, { force: true });
  }
  rmSync(path.join(bundleRoot, "latest.json"), { force: true });
}

function publishFixedInstallers(sources) {
  const staged = [];
  try {
    for (const { definition, source, signature } of sources) {
      const outputPath = path.join(bundleRoot, definition.folder, definition.outputName);
      const temporaryPath = `${outputPath}.${process.pid}.tmp`;
      const signatureOutputPath = `${outputPath}.sig`;
      const signatureTemporaryPath = `${signatureOutputPath}.${process.pid}.tmp`;
      copyFileSync(source, temporaryPath);
      staged.push({ temporaryPath, outputPath });
      copyFileSync(signature, signatureTemporaryPath);
      staged.push({ temporaryPath: signatureTemporaryPath, outputPath: signatureOutputPath });
    }
    for (const { temporaryPath, outputPath } of staged) renameSync(temporaryPath, outputPath);
  } catch (error) {
    for (const { temporaryPath } of staged) rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function runWindowsBuild() {
  if (process.platform !== "win32") {
    throw new Error("The Windows installer build must be run on Windows.");
  }

  const snapshot = snapshotInstallerFiles(bundleRoot);
  removeFixedInstallers();

  const tauriCli = path.join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  if (!existsSync(tauriCli)) {
    throw new Error("Tauri CLI was not found. Install the existing npm dependencies before building.");
  }

  console.log("Building the Windows NSIS and MSI release installers...");
  const build = spawnSync(process.execPath, [tauriCli, "build", "--bundles", "nsis,msi"], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (build.error) throw new Error(`Tauri release build could not start: ${build.error.message}`);
  if (build.status !== 0) {
    throw new Error(`Tauri release build failed with exit code ${build.status ?? "unknown"}. Fixed installer names were removed.`);
  }

  const sources = installerDefinitions.map((definition) => ({
    definition,
    source: findFreshInstaller(path.join(bundleRoot, definition.folder), definition, snapshot),
  })).map((entry) => ({
    ...entry,
    signature: findFreshSignature(entry.source, snapshot),
  }));
  publishFixedInstallers(sources);

  const version = JSON.parse(readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8")).version;
  const nsisAlias = path.join(bundleRoot, "nsis", "LegionOS_x64-setup.exe");
  writeLatestManifest(path.join(bundleRoot, "latest.json"), version, readFileSync(`${nsisAlias}.sig`, "utf8"));

  for (const { definition } of sources) {
    console.log(`Updated ${path.join(bundleRoot, definition.folder, definition.outputName)}`);
    console.log(`Updated ${path.join(bundleRoot, definition.folder, `${definition.outputName}.sig`)}`);
  }
  console.log(`Updated ${path.join(bundleRoot, "latest.json")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runWindowsBuild();
  } catch (error) {
    console.error(`Windows installer build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
