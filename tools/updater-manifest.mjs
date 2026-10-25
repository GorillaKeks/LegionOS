import { writeFileSync } from "node:fs";

export const UPDATE_REPOSITORY = "GorillaKeks/LegionOS";
export const UPDATE_TARGET = "windows-x86_64";
export const UPDATE_INSTALLER = "LegionOS_x64-setup.exe";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isStandardBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return value.length > 0 && Buffer.from(value, "base64").toString("base64") === value;
}

function decodeTauriSignature(signature) {
  if (typeof signature !== "string" || signature.trim().length === 0) {
    throw new Error("The updater signature is missing.");
  }
  const withoutBom = signature.charCodeAt(0) === 0xfeff ? signature.slice(1) : signature;
  const encoded = withoutBom.trim();
  if (!isStandardBase64(encoded)) {
    throw new Error("The .sig file is not Tauri's Base64-encoded Minisign signature format.");
  }

  const envelope = Buffer.from(encoded, "base64").toString("utf8");
  if (envelope.includes("\uFFFD")) {
    throw new Error("The decoded .sig payload is not valid UTF-8.");
  }
  const lines = envelope.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  if (
    !lines[0]?.startsWith("untrusted comment: ")
    || !isStandardBase64(lines[1] ?? "")
    || !lines[2]?.startsWith("trusted comment: ")
    || !isStandardBase64(lines[3] ?? "")
    || lines.slice(4).some((line) => line.trim().length > 0)
  ) {
    throw new Error("The decoded .sig payload is not a valid Minisign signature envelope.");
  }
  return encoded;
}

export function inspectSignatureFormat(signature) {
  const value = typeof signature === "string" ? signature : "";
  const hasUtf8Bom = value.charCodeAt(0) === 0xfeff;
  const encoded = (hasUtf8Bom ? value.slice(1) : value).trim();
  const base64Canonical = isStandardBase64(encoded);
  const envelope = base64Canonical ? Buffer.from(encoded, "base64").toString("utf8") : "";
  const lines = envelope.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  return {
    bytes: Buffer.byteLength(value, "utf8"),
    utf8Bom: hasUtf8Bom,
    outerLines: value.split(/\r\n?|\n/).length,
    base64Canonical,
    decodedBytes: base64Canonical ? Buffer.byteLength(envelope, "utf8") : 0,
    decodedLines: base64Canonical ? lines.length : 0,
    minisignPrefix: lines[0]?.startsWith("untrusted comment: ") ?? false,
    signatureContentsLogged: false,
  };
}

export function normalizeSignature(signature) {
  return decodeTauriSignature(signature);
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
