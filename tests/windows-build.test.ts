import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findFreshInstaller, findFreshSignature, installerDefinitions, snapshotInstallerFiles } from "../tools/build-windows.mjs";

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

test("requires a new non-empty Minisign signature next to each fresh installer", () => {
  withTempDirectory((root) => {
    const nsis = path.join(root, "nsis");
    mkdirSync(nsis);
    const installer = path.join(nsis, "Phone_1.0.1_x64-setup.exe");
    const signaturePath = `${installer}.sig`;
    writeFileSync(installer, "new-installer");
    const beforeBuild = snapshotInstallerFiles(root);
    writeFileSync(signaturePath, "untrusted comment: signature from minisign secret key\nYWJjZGVm\n");
    assert.equal(findFreshSignature(installer, beforeBuild), signaturePath);
  });
});

test("accepts a UTF-8 BOM and Windows line endings without logging signature data", () => {
  withTempDirectory((root) => {
    const installer = path.join(root, "Phone_1.0.1_x64-setup.exe");
    const signaturePath = `${installer}.sig`;
    writeFileSync(installer, "installer");
    const beforeBuild = snapshotInstallerFiles(root);
    writeFileSync(signaturePath, "\uFEFFuntrusted comment: signature from tauri secret key\r\nYWJjZGVm\r\n");

    assert.equal(findFreshSignature(installer, beforeBuild), signaturePath);
  });
});

test("reports safe structural diagnostics for an empty signature file", () => {
  withTempDirectory((root) => {
    const installer = path.join(root, "Phone_1.0.1_x64-setup.exe");
    const signaturePath = `${installer}.sig`;
    writeFileSync(installer, "installer");
    const beforeBuild = snapshotInstallerFiles(root);
    writeFileSync(signaturePath, "");

    assert.throws(() => findFreshSignature(installer, beforeBuild), /signature file is empty.*0 bytes/);
  });
});

test("reports format metadata without including malformed signature contents", () => {
  withTempDirectory((root) => {
    const installer = path.join(root, "Phone_1.0.1_x64-setup.exe");
    const signaturePath = `${installer}.sig`;
    writeFileSync(installer, "installer");
    const beforeBuild = snapshotInstallerFiles(root);
    const signaturePayload = "this must never appear in an error";
    writeFileSync(signaturePath, signaturePayload);

    assert.throws(() => findFreshSignature(installer, beforeBuild), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /bytes=\d+, utf8Bom=false, lines=1, expectedPrefix=false/);
      assert.doesNotMatch(error.message, new RegExp(signaturePayload));
      return true;
    });
  });
});

test("rejects a missing, unchanged, or malformed updater signature", () => {
  withTempDirectory((root) => {
    const installer = path.join(root, "Phone_1.0.1_x64-setup.exe");
    writeFileSync(installer, "installer");
    const beforeBuild = snapshotInstallerFiles(root);
    assert.throws(() => findFreshSignature(installer, beforeBuild), /signature is missing/);
    const signaturePath = `${installer}.sig`;
    writeFileSync(signaturePath, "untrusted comment: stale signature\nYWJjZGVm\n");
    const afterSignature = snapshotInstallerFiles(root);
    assert.throws(() => findFreshSignature(installer, afterSignature), /signature is missing/);
    const beforeMalformed = new Map(beforeBuild);
    writeFileSync(signaturePath, "not a minisign signature\n");
    assert.throws(() => findFreshSignature(installer, beforeMalformed), /invalid format/);
  });
});
