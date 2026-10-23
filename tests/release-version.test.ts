import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkReleaseVersion } from "../tools/check-release-version.mjs";

function withProject(run: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "legionos-release-version-"));
  mkdirSync(path.join(root, "src-tauri"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeVersionFiles(root: string, version: string) {
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    version,
    packages: { "": { version } },
  }));
  writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version }));
  writeFileSync(path.join(root, "src-tauri", "Cargo.toml"), `[package]\nname = "phone"\nversion = "${version}"\n`);
  writeFileSync(path.join(root, "src-tauri", "Cargo.lock"), `version = 4\n\n[[package]]\nname = "phone"\nversion = "${version}"\n`);
}

test("accepts a release tag matching all project manifests and lockfiles", () => {
  withProject((root) => {
    writeVersionFiles(root, "0.2.0");
    assert.equal(checkReleaseVersion("v0.2.0", root), "0.2.0");
  });
});

test("rejects invalid tags and version drift between project files", () => {
  withProject((root) => {
    writeVersionFiles(root, "0.2.0");
    assert.throws(() => checkReleaseVersion("0.2.0", root), /vMAJOR\.MINOR\.PATCH/);

    writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "0.2.1" }));
    assert.throws(() => checkReleaseVersion("v0.2.0", root), /tauri\.conf\.json: 0\.2\.1/);
  });
});
