import assert from "node:assert/strict";
import test from "node:test";
import { getGreeting } from "../src/greeting.ts";

const at = (hour: number, minute: number) => new Date(2026, 0, 1, hour, minute);

test("greeting changes at each configured local-time boundary", () => {
  assert.deepEqual(getGreeting(at(4, 59)), { text: "Gute Nacht", icon: "moon" });
  assert.deepEqual(getGreeting(at(5, 0)), { text: "Guten Morgen", icon: "sun" });
  assert.deepEqual(getGreeting(at(10, 59)), { text: "Guten Morgen", icon: "sun" });
  assert.deepEqual(getGreeting(at(11, 0)), { text: "Guten Tag", icon: "spark" });
  assert.deepEqual(getGreeting(at(17, 59)), { text: "Guten Tag", icon: "spark" });
  assert.deepEqual(getGreeting(at(18, 0)), { text: "Guten Abend", icon: "sunset" });
  assert.deepEqual(getGreeting(at(21, 59)), { text: "Guten Abend", icon: "sunset" });
  assert.deepEqual(getGreeting(at(22, 0)), { text: "Gute Nacht", icon: "moon" });
});
