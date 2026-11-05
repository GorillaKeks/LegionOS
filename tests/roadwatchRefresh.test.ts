import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createRefreshController, type RefreshSnapshot } from "../apps/roadwatch/refreshController.ts";

type Deferred = { resolve: (value: string) => void; reject: (reason: unknown) => void };

/** A controller whose backend calls stay pending until the test settles them. */
function setup() {
  const calls: Deferred[] = [];
  const snapshots: RefreshSnapshot<string>[] = [];
  const load = () => new Promise<string>((resolve, reject) => { calls.push({ resolve, reject }); });
  const controller = createRefreshController(load, (snapshot) => snapshots.push(snapshot), () => new Date(0));
  return { controller, calls, snapshots };
}

/** Mirrors the RoadWatchApp effect: attach, refresh at once, poll every 60 s, detach on cleanup. */
function runEffect(controller: ReturnType<typeof setup>["controller"]) {
  const owner = controller.attach();
  const first = controller.refresh(owner);
  const interval = setInterval(() => void controller.refresh(owner), 60_000);
  return { owner, first, cleanup: () => { clearInterval(interval); controller.detach(owner); } };
}

test("Test A: an effect restart during a pending request still receives fresh data", async () => {
  const { controller, calls } = setup();
  const first = runEffect(controller);
  assert.equal(controller.snapshot().loading, true);

  first.cleanup();
  const second = runEffect(controller);
  assert.equal(calls.length, 2, "the restarted effect must start its own request instead of waiting");
  assert.equal(controller.snapshot().loading, true);

  calls[0].resolve("stale");
  await first.first;
  assert.equal(controller.snapshot().data, null, "the obsolete request must not reach the screen");
  assert.equal(controller.snapshot().loading, true, "the current request is still running");

  calls[1].resolve("fresh");
  await second.first;
  assert.equal(controller.snapshot().data, "fresh");
  assert.equal(controller.snapshot().loading, false);
  second.cleanup();
});

test("Test B: an older request finishing after a newer one cannot overwrite it", async () => {
  const { controller, calls } = setup();
  const first = runEffect(controller);
  first.cleanup();
  const second = runEffect(controller);

  calls[1].resolve("newer");
  await second.first;
  assert.equal(controller.snapshot().data, "newer");

  calls[0].resolve("older");
  await first.first;
  assert.equal(controller.snapshot().data, "newer");
  assert.equal(controller.snapshot().loading, false);
  second.cleanup();
});

test("Test B: an older request failing after a newer success leaves the newer data and no error", async () => {
  const { controller, calls } = setup();
  const first = runEffect(controller);
  first.cleanup();
  const second = runEffect(controller);

  calls[1].resolve("newer");
  await second.first;
  calls[0].reject(new Error("old failure"));
  await first.first;
  assert.equal(controller.snapshot().data, "newer");
  assert.equal(controller.snapshot().error, null);
  second.cleanup();
});

test("Test C: loading clears after success and the next manual refresh can start", async () => {
  const { controller, calls } = setup();
  const effect = runEffect(controller);
  assert.equal(controller.snapshot().loading, true);

  void controller.refresh(effect.owner);
  assert.equal(calls.length, 1, "a second click while loading must not start a parallel request");

  calls[0].resolve("ok");
  await effect.first;
  assert.deepEqual(controller.snapshot(), { data: "ok", loading: false, error: null, lastUpdated: new Date(0) });

  const manual = controller.refresh(effect.owner); // the button is enabled again (disabled={loading})
  assert.equal(calls.length, 2);
  assert.equal(controller.snapshot().loading, true);
  calls[1].resolve("ok again");
  await manual;
  assert.equal(controller.snapshot().loading, false);
  effect.cleanup();
});

test("Test C: loading clears after an error, the error is shown, and a retry works", async () => {
  const { controller, calls } = setup();
  const effect = runEffect(controller);
  calls[0].reject("TruckersMP unreachable");
  await effect.first;
  assert.equal(controller.snapshot().loading, false);
  assert.equal(controller.snapshot().error, "TruckersMP unreachable");

  const retry = controller.refresh(effect.owner);
  assert.equal(controller.snapshot().error, null, "starting a retry clears the old error");
  calls[1].resolve("recovered");
  await retry;
  assert.equal(controller.snapshot().data, "recovered");
  assert.equal(controller.snapshot().loading, false);
  effect.cleanup();
});

test("Test C: an error keeps the last good data visible", async () => {
  const { controller, calls } = setup();
  const effect = runEffect(controller);
  calls[0].resolve("good");
  await effect.first;
  const retry = controller.refresh(effect.owner);
  calls[1].reject("timeout");
  await retry;
  assert.equal(controller.snapshot().data, "good");
  assert.equal(controller.snapshot().error, "timeout");
  effect.cleanup();
});

test("Test D: React StrictMode double effect shows data without waiting for the 60 s poll", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { controller, calls } = setup();
    // StrictMode in development: mount effect, simulated cleanup, mount effect again.
    const simulated = runEffect(controller);
    simulated.cleanup();
    const real = runEffect(controller);

    calls[0].resolve("discarded");
    calls[1].resolve("data");
    await Promise.all([simulated.first, real.first]);
    assert.equal(controller.snapshot().data, "data", "no timer tick was needed");
    assert.equal(controller.snapshot().loading, false);

    mock.timers.tick(60_000);
    assert.equal(calls.length, 3, "only the live effect keeps polling");
    calls[2].resolve("polled");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.snapshot().data, "polled");
    real.cleanup();
  } finally {
    mock.timers.reset();
  }
});

test("losing and regaining focus mid-request does not leave the window stuck", async () => {
  const { controller, calls } = setup();
  const first = runEffect(controller);
  first.cleanup(); // another window was clicked: RoadWatch becomes inactive
  assert.equal(controller.snapshot().loading, false, "an inactive window shows no spinner for a result it will ignore");

  const second = runEffect(controller); // RoadWatch clicked again before the first request finished
  calls[0].resolve("old");
  calls[1].resolve("new");
  await Promise.all([first.first, second.first]);
  assert.equal(controller.snapshot().data, "new");
  assert.equal(controller.snapshot().loading, false);
  second.cleanup();
});

test("a detached or unknown consumer cannot start requests", async () => {
  const { controller, calls } = setup();
  await controller.refresh(0);
  const effect = runEffect(controller);
  effect.cleanup();
  await controller.refresh(effect.owner);
  assert.equal(calls.length, 1);
});
