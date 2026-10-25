import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyReleaseAssets } from "../tools/verify-release-assets.mjs";
import { createLatestManifest } from "../tools/updater-manifest.mjs";

const nsisSignature = "untrusted comment: signature from minisign secret key\nYWJjZGVm\n";
const msiSignature = "untrusted comment: signature from minisign secret key\nZ2hpamts\n";

function writeValidRelease(root: string) {
  mkdirSync(path.join(root, "nsis"));
  mkdirSync(path.join(root, "msi"));
  writeFileSync(path.join(root, "nsis", "LegionOS_x64-setup.exe"), "installer exe");
  writeFileSync(path.join(root, "nsis", "LegionOS_x64-setup.exe.sig"), nsisSignature);
  writeFileSync(path.join(root, "msi", "LegionOS_x64_en-US.msi"), "installer msi");
  writeFileSync(path.join(root, "msi", "LegionOS_x64_en-US.msi.sig"), msiSignature);
  writeFileSync(path.join(root, "latest.json"), `${JSON.stringify(createLatestManifest("1.0.1", nsisSignature))}\n`);
}

test("verifies both signed installers and latest.json in the retained artifact layout", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-assets-"));
  try {
    writeValidRelease(root);

    assert.deepEqual(verifyReleaseAssets(root, "1.0.1"), [
      path.join(root, "nsis", "LegionOS_x64-setup.exe"),
      path.join(root, "nsis", "LegionOS_x64-setup.exe.sig"),
      path.join(root, "msi", "LegionOS_x64_en-US.msi"),
      path.join(root, "msi", "LegionOS_x64_en-US.msi.sig"),
      path.join(root, "latest.json"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails if a retained artifact path is missing or empty", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-assets-"));
  try {
    writeValidRelease(root);
    rmSync(path.join(root, "nsis", "LegionOS_x64-setup.exe.sig"));
    assert.throws(() => verifyReleaseAssets(root), /Required release asset is missing/);
    writeFileSync(path.join(root, "nsis", "LegionOS_x64-setup.exe.sig"), "");
    assert.throws(() => verifyReleaseAssets(root), /Required release asset is empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mismatched update signatures, tags, and manifest URLs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-assets-"));
  try {
    writeValidRelease(root);
    writeFileSync(path.join(root, "latest.json"), JSON.stringify(createLatestManifest("1.0.1", `${nsisSignature}tampered`)));
    assert.throws(() => verifyReleaseAssets(root, "1.0.1"), /signature does not match/);
    writeFileSync(path.join(root, "latest.json"), JSON.stringify({ ...createLatestManifest("1.0.1", nsisSignature), version: "1.0.2" }));
    assert.throws(() => verifyReleaseAssets(root, "1.0.1"), /does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
