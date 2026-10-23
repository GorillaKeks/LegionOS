import test from "node:test";
import assert from "node:assert/strict";
import { setFocusTaskChecked } from "../src/focusTasks.ts";
import { initialWindowState, windowReducer } from "../src/windowManager.ts";

test("Focus checklist toggles only the selected item", () => {
  const initial = [false, false, false];
  const checked = setFocusTaskChecked(initial, 1, true);
  assert.deepEqual(checked, [false, true, false]);
  assert.deepEqual(setFocusTaskChecked(checked, 1, false), initial);
  assert.equal(setFocusTaskChecked(checked, -1, false), checked);
});

test("activating the internal Focus window does not minimize it", () => {
  const opened = windowReducer(initialWindowState, { type: "open", appId: "focus" });
  const id = opened.windows[0].id;
  const activated = windowReducer(opened, { type: "activate", id });
  assert.equal(activated.windows[0].minimized, false);
  assert.equal(activated.activeId, id);
});
