import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestManifest, validateLatestManifest } from "../tools/updater-manifest.mjs";

const rawSignature = "untrusted comment: signature from tauri secret key\nYWJjZGVm\ntrusted comment: timestamp: 0\nZ2hpamts\n";
const signature = Buffer.from(rawSignature, "utf8").toString("base64");

test("creates a versioned Windows x64 manifest with the NSIS download and signature contents", () => {
  const manifest = createLatestManifest("1.0.1", signature);
  assert.equal(manifest.version, "1.0.1");
  assert.deepEqual(Object.keys(manifest.platforms), ["windows-x86_64"]);
  assert.equal(manifest.platforms["windows-x86_64"].url,
    "https://github.com/GorillaKeks/LegionOS/releases/download/v1.0.1/LegionOS_x64-setup.exe");
  assert.equal(manifest.platforms["windows-x86_64"].signature, signature.trimEnd());
});

test("accepts Tauri's one-line Base64 signature with a UTF-8 BOM and CRLF envelope", () => {
  const windowsSignature = Buffer.from(rawSignature.replace(/\n/g, "\r\n"), "utf8").toString("base64");
  const manifest = createLatestManifest("1.0.1", `\uFEFF${windowsSignature}\r\n`);
  assert.equal(manifest.platforms["windows-x86_64"].signature, windowsSignature);
});

test("validates the release version, platform, NSIS signature, and version-bound URL", () => {
  const manifest = createLatestManifest("1.0.1", signature);
  assert.equal(validateLatestManifest(manifest, { expectedVersion: "1.0.1", expectedSignature: signature }), manifest);
  assert.throws(() => validateLatestManifest(manifest, { expectedVersion: "1.0.2" }), /does not match/);
  assert.throws(() => validateLatestManifest({ ...manifest, platforms: {} }), /missing platform/);
  assert.throws(() => validateLatestManifest({ ...manifest, platforms: { ...manifest.platforms, "windows-x86_64": { ...manifest.platforms["windows-x86_64"], signature: "wrong" } } }), /Base64-encoded Minisign/);
  assert.throws(() => validateLatestManifest({ ...manifest, platforms: { ...manifest.platforms, "windows-x86_64": { ...manifest.platforms["windows-x86_64"], url: "https://example.invalid/app.exe" } } }), /must point/);
  assert.throws(() => validateLatestManifest({ ...manifest, platforms: { ...manifest.platforms, "windows-aarch64": {} } }), /only the supported/);
});

test("rejects malformed release versions and missing signature payloads", () => {
  assert.throws(() => createLatestManifest("v1.0.1", signature), /Invalid updater version/);
  assert.throws(() => createLatestManifest("1.0.1", ""), /signature is missing/);
  assert.throws(() => createLatestManifest("1.0.1", "not minisign"), /Base64-encoded Minisign/);
});
