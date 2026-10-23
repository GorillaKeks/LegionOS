import assert from "node:assert/strict";
import test from "node:test";
import { clampWindowPosition, clampWindowSize, initialWindowState, selectOpenAppIcons, windowReducer } from "../src/windowManager.ts";

test("opening apps creates one window per app and activates it", () => {
  const settings = windowReducer(initialWindowState, { type: "open", appId: "settings" });
  const notes = windowReducer(settings, { type: "open", appId: "notes" });

  assert.equal(notes.windows.length, 2);
  assert.equal(notes.windows[0]?.appId, "settings");
  assert.equal(notes.activeId, notes.windows[1]?.id);
});

test("opening an existing app restores its minimized window", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "notes" });
  const minimized = windowReducer(opened, { type: "minimize", id: opened.activeId! });
  const restored = windowReducer(minimized, { type: "open", appId: "notes" });

  assert.equal(restored.windows.length, 1);
  assert.equal(restored.windows[0]?.minimized, false);
  assert.equal(restored.activeId, opened.activeId);
});

test("tablet open-app icons follow window order and reflect active, minimized, restored, and closed state", () => {
  const settings = windowReducer(initialWindowState, { type: "open", appId: "settings" });
  const notes = windowReducer(settings, { type: "open", appId: "notes" });
  const demo = windowReducer(notes, { type: "open", appId: "demo" });
  const notesId = demo.windows.find((window) => window.appId === "notes")!.id;
  const minimized = windowReducer(demo, { type: "minimize", id: notesId });
  const icons = selectOpenAppIcons(minimized);

  assert.deepEqual(icons.map(({ window }) => window.appId), ["settings", "notes", "demo"]);
  assert.deepEqual(icons.map(({ active, minimized: isMinimized }) => ({ active, minimized: isMinimized })), [
    { active: false, minimized: false },
    { active: false, minimized: true },
    { active: true, minimized: false },
  ]);

  const restored = windowReducer(minimized, { type: "activate", id: notesId });
  assert.deepEqual(selectOpenAppIcons(restored).find(({ window }) => window.id === notesId), {
    window: { id: notesId, appId: "notes", minimized: false },
    active: true,
    minimized: false,
  });

  const closed = windowReducer(restored, { type: "close", id: notesId });
  assert.deepEqual(selectOpenAppIcons(closed).map(({ window }) => window.appId), ["settings", "demo"]);
  assert.deepEqual(selectOpenAppIcons(initialWindowState), []);
});

test("minimizing and closing the active window select the next available window", () => {
  const first = windowReducer(initialWindowState, { type: "open", appId: "settings" });
  const second = windowReducer(first, { type: "open", appId: "demo" });
  const minimized = windowReducer(second, { type: "minimize", id: second.activeId! });

  assert.equal(minimized.activeId, first.activeId);
  const closed = windowReducer(minimized, { type: "close", id: first.activeId! });
  assert.equal(closed.windows.length, 1);
  assert.equal(closed.activeId, null);
});

test("internal app windows can move in tablet mode and remain inside the display", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "notes" });
  const moved = windowReducer(opened, {
    type: "move",
    id: opened.activeId!,
    mode: "tablet",
    position: { x: 920, y: 620 },
    bounds: { displayWidth: 1200, displayHeight: 760, windowWidth: 500, windowHeight: 540 },
  });

  assert.deepEqual(moved.layouts.notes?.position, { x: 700, y: 220 });
  assert.equal(moved.activeId, opened.activeId);
});

test("internal app window movement is disabled in smartphone mode", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "settings" });
  const moved = windowReducer(opened, {
    type: "move",
    id: opened.activeId!,
    mode: "phone",
    position: { x: 120, y: 80 },
    bounds: { displayWidth: 460, displayHeight: 860, windowWidth: 390, windowHeight: 500 },
  });

  assert.equal(moved, opened);
  assert.equal(moved.layouts.settings, undefined);
});

test("switching back to smartphone resets tablet window positions", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "demo" });
  const moved = windowReducer(opened, {
    type: "move",
    id: opened.activeId!,
    mode: "tablet",
    position: { x: 140, y: 75 },
    bounds: { displayWidth: 1200, displayHeight: 760, windowWidth: 500, windowHeight: 540 },
  });
  const reset = windowReducer(moved, { type: "resetPositions" });

  assert.equal(reset.layouts.demo?.position, null);
});

test("an internal app window larger than the display is pinned to its origin", () => {
  assert.deepEqual(
    clampWindowPosition({ x: 30, y: 40 }, { displayWidth: 320, displayHeight: 240, windowWidth: 500, windowHeight: 400 }),
    { x: 0, y: 0 },
  );
});

test("resizing clamps dimensions to minimums and keeps the window inside the display", () => {
  const bounds = {
    displayWidth: 1000,
    displayHeight: 700,
    maxWidth: 968,
    maxHeight: 668,
    minWidth: 320,
    minHeight: 240,
  };
  assert.deepEqual(clampWindowSize({ width: 180, height: 900 }, bounds), { width: 320, height: 668 });

  const opened = windowReducer(initialWindowState, { type: "open", appId: "notes" });
  const resized = windowReducer(opened, {
    type: "resize",
    id: opened.activeId!,
    mode: "tablet",
    position: { x: 850, y: 600 },
    size: { width: 600, height: 450 },
    bounds,
  });
  assert.deepEqual(resized.layouts.notes?.size, { width: 600, height: 450 });
  assert.deepEqual(resized.layouts.notes?.position, { x: 400, y: 250 });
});

test("resizing is ignored in smartphone mode", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "settings" });
  const resized = windowReducer(opened, {
    type: "resize",
    id: opened.activeId!,
    mode: "phone",
    position: { x: 20, y: 20 },
    size: { width: 700, height: 600 },
    bounds: { displayWidth: 720, displayHeight: 900, maxWidth: 688, maxHeight: 868, minWidth: 320, minHeight: 240 },
  });
  assert.equal(resized, opened);
});

test("per-app geometry remains available after closing and reopening an internal app", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "demo" });
  const resized = windowReducer(opened, {
    type: "resize",
    id: opened.activeId!,
    mode: "tablet",
    position: { x: 80, y: 45 },
    size: { width: 520, height: 360 },
    bounds: { displayWidth: 1200, displayHeight: 760, maxWidth: 1168, maxHeight: 728, minWidth: 320, minHeight: 240 },
  });
  const closed = windowReducer(resized, { type: "close", id: resized.activeId! });
  const reopened = windowReducer(closed, { type: "open", appId: "demo" });

  assert.deepEqual(reopened.layouts.demo, { position: { x: 80, y: 45 }, size: { width: 520, height: 360 } });
});
