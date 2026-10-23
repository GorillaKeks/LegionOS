import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findFreshInstaller, installerDefinitions, snapshotInstallerFiles } from "../tools/build-windows.mjs";

function withTempDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "legionos-installer-test-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("selects the newly produced x64 installers and ignores old versioned outputs", () => {
  withTempDirectory((root) => {
    const nsis = path.join(root, "nsis");
    const msi = path.join(root, "msi");
    mkdirSync(nsis);
    mkdirSync(msi);
    writeFileSync(path.join(nsis, "Phone_0.1.0_x64-setup.exe"), "old-nsis");
    writeFileSync(path.join(msi, "Phone_0.1.0_x64_en-US.msi"), "old-msi");
    const beforeBuild = snapshotInstallerFiles(root);

    const freshNsis = path.join(nsis, "Phone_0.2.0_x64-setup.exe");
    const freshMsi = path.join(msi, "Phone_0.2.0_x64_en-US.msi");
    writeFileSync(freshNsis, "fresh-nsis");
    writeFileSync(freshMsi, "fresh-msi");

    assert.equal(findFreshInstaller(nsis, installerDefinitions[0], beforeBuild), freshNsis);
    assert.equal(findFreshInstaller(msi, installerDefinitions[1], beforeBuild), freshMsi);
  });
});

test("rejects unchanged stale installers and fixed-name aliases as source artifacts", () => {
  withTempDirectory((root) => {
    const nsis = path.join(root, "nsis");
    mkdirSync(nsis);
    const stalePath = path.join(nsis, "Phone_0.1.0_x64-setup.exe");
    writeFileSync(stalePath, "old-nsis");
    const aliasPath = path.join(nsis, "LegionOS_x64-setup.exe");
    writeFileSync(aliasPath, "previous-alias");
    const beforeBuild = snapshotInstallerFiles(root);

    assert.throws(
      () => findFreshInstaller(nsis, installerDefinitions[0], beforeBuild),
      /No fresh x64 NSIS installer matching/,
    );
  });
});

test("fails clearly when a fresh expected installer was not produced", () => {
  withTempDirectory((root) => {
    const msi = path.join(root, "msi");
    mkdirSync(msi);
    const beforeBuild = snapshotInstallerFiles(root);
    const expected = path.join(msi, "Phone_0.2.0_arm64_en-US.msi");
    writeFileSync(expected, "fresh-but-wrong-architecture");

    assert.throws(
      () => findFreshInstaller(msi, installerDefinitions[1], beforeBuild),
      /No fresh x64 MSI installer matching/,
    );
  });
});
