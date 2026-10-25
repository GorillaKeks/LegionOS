import assert from "node:assert/strict";
import test from "node:test";
import { getGreeting } from "../src/greeting.ts";

const at = (hour: number, minute: number) => new Date(2026, 0, 1, hour, minute);

test("greeting changes at each configured local-time boundary", () => {
  assert.deepEqual(getGreeting(at(4, 59)), { text: "Good night", icon: "moon" });
  assert.deepEqual(getGreeting(at(5, 0)), { text: "Good morning", icon: "sun" });
  assert.deepEqual(getGreeting(at(10, 59)), { text: "Good morning", icon: "sun" });
  assert.deepEqual(getGreeting(at(11, 0)), { text: "Hello", icon: "spark" });
  assert.deepEqual(getGreeting(at(17, 59)), { text: "Hello", icon: "spark" });
  assert.deepEqual(getGreeting(at(18, 0)), { text: "Good evening", icon: "sunset" });
  assert.deepEqual(getGreeting(at(21, 59)), { text: "Good evening", icon: "sunset" });
  assert.deepEqual(getGreeting(at(22, 0)), { text: "Good night", icon: "moon" });
});
