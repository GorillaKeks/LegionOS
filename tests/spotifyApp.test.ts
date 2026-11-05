import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { appInfo, isAppId } from "../src/apps.ts";
import { getAppUsageState, selectAvailableApps, selectInstalledApps, type LocalAppStoreSnapshot } from "../src/appStore.ts";
import { t } from "../src/i18n.ts";
import { initialWindowState, windowReducer } from "../src/windowManager.ts";
import { backendErrorMessage, formatTime, translationsForTests } from "../apps/spotify/strings.ts";

const manifest = JSON.parse(readFileSync(new URL("../apps/spotify/manifest.json", import.meta.url), "utf8"));

test("apps/spotify/manifest.json uses the existing manifest schema and a registered id", () => {
  assert.deepEqual(Object.keys(manifest).sort(), ["description", "entry", "icon", "id", "name", "type", "version"]);
  assert.equal(manifest.id, "spotify-player");
  assert.equal(manifest.entry, "spotify-player");
  assert.equal(manifest.type, "internal");
  assert.equal(manifest.icon, "music");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(isAppId(manifest.id));
  assert.equal(appInfo["spotify-player"].icon, "music");
});

const entry = (installed: boolean) => ({ folder: "spotify", manifest, error: null, installed });

test("Spotify is installed and opened through the normal store and window manager", () => {
  const available: LocalAppStoreSnapshot = { apps: [entry(false)], installedIds: [] };
  const installed: LocalAppStoreSnapshot = { apps: [entry(true)], installedIds: ["spotify-player"] };
  assert.deepEqual(selectAvailableApps(available).map((app) => app.manifest?.id), ["spotify-player"]);
  assert.deepEqual(selectInstalledApps(installed).map((app) => app.id), ["spotify-player"]);
  assert.equal(getAppUsageState("spotify-player", installed, initialWindowState), "installed");

  const opened = windowReducer(initialWindowState, { type: "open", appId: "spotify-player" });
  assert.equal(getAppUsageState("spotify-player", installed, opened), "active");
  const minimized = windowReducer(opened, { type: "minimize", id: opened.windows[0].id });
  assert.equal(getAppUsageState("spotify-player", installed, minimized), "minimized");
  const closed = windowReducer(minimized, { type: "close", id: opened.windows[0].id });
  assert.equal(getAppUsageState("spotify-player", installed, closed), "installed");
  const reopened = windowReducer(closed, { type: "open", appId: "spotify-player" });
  assert.equal(reopened.windows.length, 1);
  assert.equal(getAppUsageState("spotify-player", installed, reopened), "active");
});

test("a build without the local config hides Spotify (the Rust catalog filters it out)", () => {
  const hidden: LocalAppStoreSnapshot = { apps: [], installedIds: ["spotify-player"] };
  assert.deepEqual(selectInstalledApps(hidden), [], "a stale install record alone does not show the app");
});

test("app name and every Spotify UI string exist in English, German and Dutch", () => {
  for (const language of ["en", "de", "nl"] as const) {
    assert.equal(t(language, "app.spotify-player.name"), "Spotify");
    assert.notEqual(t(language, "app.spotify-player.subtitle"), "app.spotify-player.subtitle");
  }
  const english = Object.keys(translationsForTests.en).sort();
  assert.deepEqual(Object.keys(translationsForTests.de).sort(), english);
  assert.deepEqual(Object.keys(translationsForTests.nl).sort(), english);
});

test("every backend error code has a message, and rate limits show the wait time", () => {
  const rust = readFileSync(new URL("../src-tauri/src/spotify/error.rs", import.meta.url), "utf8");
  const variants = [...rust.matchAll(/^    ([A-Z][A-Za-z]+),$/gm)].map((match) => match[1].replace(/[A-Z]/g, (letter, index) => (index ? "_" : "") + letter.toLowerCase()));
  assert.ok(variants.length >= 20);
  for (const code of variants) assert.ok(translationsForTests.en[`error.${code}`], `missing message for ${code}`);
  assert.match(backendErrorMessage("en", { code: "rate_limited", retryAfterSecs: 12 }), /12 seconds/);
  assert.equal(backendErrorMessage("en", { code: "something_new" }), translationsForTests.en["error.internal"]);
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(61_500), "1:01");
  assert.equal(formatTime(3_725_000), "1:02:05");
});

test("the local Client ID file is Git-ignored and never placed in the bundled apps folder", () => {
  const ignored = execFileSync("git", ["check-ignore", "spotify.local.json", "apps/spotify/spotify.local.json"], { encoding: "utf8" });
  assert.match(ignored, /spotify\.local\.json/);
  assert.ok(!readdirSync(new URL("../apps/spotify/", import.meta.url)).some((name) => /local|token|\.env/i.test(name)));
});

test("no Spotify Client ID or token-like value is hard-coded in the Spotify sources", () => {
  const files = [
    ...readdirSync(new URL("../apps/spotify/", import.meta.url)).map((name) => new URL(`../apps/spotify/${name}`, import.meta.url)),
    ...readdirSync(new URL("../src-tauri/src/spotify/", import.meta.url)).map((name) => new URL(`../src-tauri/src/spotify/${name}`, import.meta.url)),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Test fixtures use obvious placeholders such as 0123456789abcdef...; real IDs are random hex.
    for (const match of text.matchAll(/\b[0-9a-f]{32}\b/g)) assert.equal(match[0], "0123456789abcdef0123456789abcdef", `${file.pathname} contains a 32-hex value`);
    assert.ok(!/localStorage/.test(text) || file.pathname.endsWith(".md"), `${file.pathname} must not use localStorage`);
    assert.ok(!/client_secret\s*[:=]/i.test(text), `${file.pathname} must not contain a client secret`);
  }
});
