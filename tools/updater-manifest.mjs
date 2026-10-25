import { writeFileSync } from "node:fs";

export const UPDATE_REPOSITORY = "GorillaKeks/LegionOS";
export const UPDATE_TARGET = "windows-x86_64";
export const UPDATE_INSTALLER = "LegionOS_x64-setup.exe";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function normalizeSignature(signature) {
  if (typeof signature !== "string" || signature.trim().length === 0) throw new Error("The NSIS updater signature is missing.");
  const withoutBom = signature.charCodeAt(0) === 0xfeff ? signature.slice(1) : signature;
  const normalized = withoutBom.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.split("\n");
  if (!lines[0]?.startsWith("untrusted comment: ") || lines.length < 2 || !lines[1]?.trim()) {
    throw new Error("The NSIS .sig file does not contain a valid Minisign signature payload.");
  }
  return normalized;
}

export function createLatestManifest(version, signature) {
  if (typeof version !== "string" || !versionPattern.test(version)) {
    throw new Error(`Invalid updater version: ${String(version)}.`);
  }
  const normalizedSignature = normalizeSignature(signature);
  return {
    version,
    platforms: {
      [UPDATE_TARGET]: {
        signature: normalizedSignature,
        url: `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${UPDATE_INSTALLER}`,
      },
    },
  };
}

export function validateLatestManifest(manifest, { expectedVersion, expectedSignature } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("latest.json must contain a JSON object.");
  }
  if (typeof manifest.version !== "string" || !versionPattern.test(manifest.version)) {
    throw new Error("latest.json has a missing or invalid version.");
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(`latest.json version ${manifest.version} does not match ${expectedVersion}.`);
  }
  const platform = manifest.platforms?.[UPDATE_TARGET];
  if (!platform || typeof platform !== "object") {
    throw new Error(`latest.json is missing platform ${UPDATE_TARGET}.`);
  }
  const signature = normalizeSignature(platform.signature);
  if (expectedSignature !== undefined && signature !== normalizeSignature(expectedSignature)) {
    throw new Error("latest.json signature does not match the shipped NSIS .sig file.");
  }
  const expectedUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${manifest.version}/${UPDATE_INSTALLER}`;
  if (platform.url !== expectedUrl) {
    throw new Error(`latest.json must point to the versioned NSIS installer URL ${expectedUrl}.`);
  }
  if (Object.keys(manifest.platforms).length !== 1) {
    throw new Error(`latest.json must map only the supported ${UPDATE_TARGET} update package.`);
  }
  return manifest;
}

export function writeLatestManifest(filePath, version, signature) {
  const manifest = createLatestManifest(version, signature);
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
