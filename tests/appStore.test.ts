import test from "node:test";
import assert from "node:assert/strict";
import { getAppUsageState, selectAvailableApps, selectInstalledApps, selectInstalledCatalogApps, type LocalAppStoreSnapshot } from "../src/appStore.ts";
import { initialWindowState, windowReducer } from "../src/windowManager.ts";

const entry = (id: string, installed: boolean, valid = true) => ({
  folder: id,
  manifest: valid ? { id, name: id, version: "1.0.0", description: "Lokale App", icon: "spark" as const, type: "internal" as const, entry: id } : null,
  error: valid ? null : "Manifest ungültig",
  installed,
});

test("store selection separates available apps from installed apps and rejects invalid entries", () => {
  const snapshot: LocalAppStoreSnapshot = { apps: [entry("settings", true), entry("focus", false), entry("bad", false, false)], installedIds: ["settings"] };
  assert.deepEqual(selectInstalledApps(snapshot).map((app) => app.id), ["settings"]);
  assert.deepEqual(selectAvailableApps(snapshot).map((app) => app.manifest?.id), ["focus"]);
  assert.deepEqual(selectInstalledCatalogApps(snapshot).map((app) => app.manifest?.id), ["settings"]);
});

test("Spotify is available before install and listed as installed without an internal window", () => {
  const available: LocalAppStoreSnapshot = { apps: [entry("spotify", false)], installedIds: [] };
  const installed: LocalAppStoreSnapshot = { apps: [entry("spotify", true)], installedIds: ["spotify"] };
  assert.deepEqual(selectInstalledApps(available), []);
  assert.deepEqual(selectAvailableApps(available).map((app) => app.manifest?.id), ["spotify"]);
  assert.deepEqual(selectInstalledApps(installed).map((app) => app.id), ["spotify"]);
  assert.equal(getAppUsageState("spotify", installed, initialWindowState), "installed");
});

test("Pong appears as a local store app and uses the shared installed-window state", () => {
  const manifest = { id: "pong" as const, name: "Pong", version: "1.0.0", description: "Pong gegen die LegionOS-KI", icon: "pong" as const, type: "internal" as const, entry: "pong" };
  const available: LocalAppStoreSnapshot = { apps: [{ folder: "pong", manifest, error: null, installed: false }], installedIds: [] };
  const installed: LocalAppStoreSnapshot = { apps: [{ folder: "pong", manifest, error: null, installed: true }], installedIds: ["pong"] };
  assert.deepEqual(selectAvailableApps(available).map((app) => app.manifest?.id), ["pong"]);
  assert.deepEqual(selectInstalledApps(installed).map((app) => app.id), ["pong"]);
  let windows = windowReducer(initialWindowState, { type: "open", appId: "pong" });
  assert.equal(getAppUsageState("pong", installed, windows), "active");
  const id = windows.windows[0].id;
  windows = windowReducer(windows, { type: "minimize", id });
  assert.equal(getAppUsageState("pong", installed, windows), "minimized");
});

test("app usage state distinguishes available, installed, open, minimized, active, and closed", () => {
  const snapshot: LocalAppStoreSnapshot = { apps: [entry("notes", true)], installedIds: ["notes"] };
  const available: LocalAppStoreSnapshot = { apps: [entry("focus", false)], installedIds: [] };
  assert.equal(getAppUsageState("focus", available, initialWindowState), "available");
  assert.equal(getAppUsageState("notes", snapshot, initialWindowState), "installed");
  let state = windowReducer(initialWindowState, { type: "open", appId: "notes" });
  const sessionId = state.windows[0].id;
  assert.equal(getAppUsageState("notes", snapshot, state), "active");
  state = windowReducer(state, { type: "open", appId: "demo" });
  assert.equal(getAppUsageState("notes", snapshot, state), "open");
  state = windowReducer(state, { type: "minimize", id: sessionId });
  assert.equal(getAppUsageState("notes", snapshot, state), "minimized");
  state = windowReducer(state, { type: "close", id: sessionId });
  assert.equal(getAppUsageState("notes", snapshot, state), "installed");
});
