import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyReleaseAssets } from "../tools/verify-release-assets.mjs";

test("verifies installers in upload-artifact's retained nsis and msi folders", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-assets-"));
  try {
    mkdirSync(path.join(root, "nsis"));
    mkdirSync(path.join(root, "msi"));
    writeFileSync(path.join(root, "nsis", "LegionOS_x64-setup.exe"), "installer exe");
    writeFileSync(path.join(root, "msi", "LegionOS_x64_en-US.msi"), "installer msi");

    assert.deepEqual(verifyReleaseAssets(root), [
      path.join(root, "nsis", "LegionOS_x64-setup.exe"),
      path.join(root, "msi", "LegionOS_x64_en-US.msi"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails if a retained artifact path is missing or empty", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-assets-"));
  try {
    mkdirSync(path.join(root, "nsis"));
    mkdirSync(path.join(root, "msi"));
    writeFileSync(path.join(root, "nsis", "LegionOS_x64-setup.exe"), "installer exe");

    assert.throws(() => verifyReleaseAssets(root), /Required release asset is missing/);
    writeFileSync(path.join(root, "msi", "LegionOS_x64_en-US.msi"), "");
    assert.throws(() => verifyReleaseAssets(root), /Required release asset is empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
