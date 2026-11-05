import assert from "node:assert/strict";
import test from "node:test";
import { createSpotifyPlayer, currentPosition, mapState, nextRepeatMode, type PlayerDeps, type SdkEvent, type SdkNamespace, type SdkState } from "../apps/spotify/playerController.ts";
import { loadSpotifySdk, resetSpotifySdkLoader, SDK_URL } from "../apps/spotify/sdkLoader.ts";

// Mocked Web Playback SDK. Nothing here talks to Spotify; it only proves the
// controller's lifecycle logic, not that real playback works.
function mockSdk(connectResult = true) {
  const players: MockPlayer[] = [];
  class MockPlayer {
    listeners = new Map<SdkEvent, Set<(payload: any) => void>>();
    calls: string[] = [];
    connectResult = connectResult;
    options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number };
    constructor(options: MockPlayer["options"]) { this.options = options; players.push(this); }
    connect() { this.calls.push("connect"); return Promise.resolve(this.connectResult); }
    disconnect() { this.calls.push("disconnect"); }
    addListener(event: SdkEvent, callback: (payload: any) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(callback);
      return true;
    }
    removeListener(event: SdkEvent, callback?: (payload: any) => void) {
      if (callback) this.listeners.get(event)?.delete(callback); else this.listeners.delete(event);
      return true;
    }
    emit(event: SdkEvent, payload?: unknown) { for (const callback of [...(this.listeners.get(event) ?? [])]) callback(payload); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
    togglePlay() { this.calls.push("togglePlay"); return Promise.resolve(); }
    previousTrack() { this.calls.push("previous"); return Promise.resolve(); }
    nextTrack() { this.calls.push("next"); return Promise.resolve(); }
    seek(ms: number) { this.calls.push(`seek:${ms}`); return Promise.resolve(); }
    setVolume(volume: number) { this.calls.push(`volume:${volume}`); return Promise.resolve(); }
    activateElement() { this.calls.push("activate"); return Promise.resolve(); }
  }
  const sdk = { Player: MockPlayer } as unknown as SdkNamespace;
  return { sdk, players };
}

function setup(overrides: Partial<PlayerDeps> = {}) {
  const { sdk, players } = mockSdk();
  const counts = { loads: 0, tokens: 0, invalidations: 0 };
  let clock = 1_000;
  const controller = createSpotifyPlayer({
    loadSdk: async () => { counts.loads++; return sdk; },
    fetchToken: async () => `token-${++counts.tokens}`,
    invalidateToken: async () => { counts.invalidations++; },
    now: () => clock,
    ...overrides,
  });
  return { controller, players, counts, tick: (ms: number) => { clock += ms; } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const sdkState = (overrides: Partial<SdkState> = {}): SdkState => ({
  paused: false, position: 30_000, duration: 200_000, shuffle: true, repeat_mode: 1,
  track_window: { current_track: { uri: "spotify:track:1", name: "Song", artists: [{ name: "A" }, { name: "B" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/small", width: 64 }, { url: "https://i.scdn.co/large", width: 640 }] } } },
  ...overrides,
});

test("SDK initialization registers a LegionOS Connect device and reports readiness", async () => {
  const { controller, players } = setup();
  const started = controller.start();
  assert.equal(controller.getSnapshot().status, "loading");
  await started;
  assert.equal(players.length, 1);
  assert.equal(players[0].options.name, "LegionOS");
  assert.equal(controller.getSnapshot().status, "connecting");
  players[0].emit("ready", { device_id: "device-1" });
  assert.equal(controller.getSnapshot().status, "ready");
  assert.equal(controller.getSnapshot().deviceId, "device-1");
  assert.deepEqual(players[0].calls, ["connect"], "no playback is started automatically");
});

test("duplicate initialization is prevented across repeated opens and concurrent starts", async () => {
  const { controller, players, counts } = setup();
  await Promise.all([controller.start(), controller.start(), controller.start()]);
  players[0].emit("ready", { device_id: "d" });
  await controller.start(); // reopening the app window
  await controller.start();
  assert.equal(players.length, 1);
  assert.equal(counts.loads, 1);
  assert.equal(players[0].calls.filter((call) => call === "connect").length, 1);
});

test("the SDK authentication callback receives a token from the backend each time it asks", async () => {
  const { controller, players } = setup();
  await controller.start();
  const received: string[] = [];
  players[0].options.getOAuthToken((token) => received.push(token));
  players[0].options.getOAuthToken((token) => received.push(token)); // SDK asks again when the token expires
  await flush();
  assert.deepEqual(received, ["token-1", "token-2"]);
});

test("a failing token fetch surfaces an error instead of hanging", async () => {
  const { controller, players } = setup({ fetchToken: () => Promise.reject({ code: "revoked" }) });
  await controller.start();
  players[0].options.getOAuthToken(() => assert.fail("must not be called"));
  await flush();
  assert.deepEqual(controller.getSnapshot().error, { kind: "token", code: "revoked" });
  assert.equal(controller.getSnapshot().status, "error");
});

test("playback state changes are mapped, including missing artwork and metadata", async () => {
  const { controller, players } = setup();
  await controller.start();
  players[0].emit("player_state_changed", sdkState());
  const playback = controller.getSnapshot().playback!;
  assert.deepEqual(playback.track, { uri: "spotify:track:1", name: "Song", artists: "A, B", album: "Album", imageUrl: "https://i.scdn.co/large" });
  assert.equal(playback.repeat, "context");
  assert.equal(playback.shuffle, true);
  players[0].emit("player_state_changed", sdkState({ track_window: { current_track: { uri: "u", name: "", album: { images: [{ url: "http://insecure" }] } } } }));
  assert.deepEqual(controller.getSnapshot().playback!.track, { uri: "u", name: "—", artists: "", album: "", imageUrl: null });
  players[0].emit("player_state_changed", null); // playback moved to another device
  assert.equal(controller.getSnapshot().playback, null);
});

test("progress is extrapolated only while playing and clamped to the duration", () => {
  const playing = mapState(sdkState(), 1_000)!;
  assert.equal(currentPosition(playing, 6_000), 35_000);
  assert.equal(currentPosition(playing, 10_000_000), 200_000);
  assert.equal(currentPosition({ ...playing, paused: true }, 6_000), 30_000);
  assert.equal(nextRepeatMode("off"), "context");
  assert.equal(nextRepeatMode("context"), "track");
  assert.equal(nextRepeatMode("track"), "off");
});

test("player disconnection is reported and reconnect replaces the player cleanly", async () => {
  const { controller, players } = setup();
  await controller.start();
  players[0].emit("ready", { device_id: "d1" });
  players[0].emit("not_ready", { device_id: "d1" });
  assert.equal(controller.getSnapshot().status, "offline");
  await controller.reconnect();
  assert.equal(players.length, 2);
  assert.ok(players[0].calls.includes("disconnect"));
  assert.equal(players[0].listenerCount(), 0, "old listeners are removed");
  players[0].emit("ready", { device_id: "stale" }); // late event from the old player
  assert.notEqual(controller.getSnapshot().deviceId, "stale");
  players[1].emit("ready", { device_id: "d2" });
  assert.equal(controller.getSnapshot().deviceId, "d2");
});

test("authentication_error refreshes the token once, then reports a persistent failure", async () => {
  const { controller, players, counts } = setup();
  await controller.start();
  players[0].emit("authentication_error", { message: "Authentication failed" });
  await flush();
  assert.equal(counts.invalidations, 1);
  assert.deepEqual(players[0].calls, ["connect", "disconnect", "connect"]);
  assert.equal(controller.getSnapshot().error, null);
  players[0].emit("authentication_error", { message: "Authentication failed" });
  assert.deepEqual(controller.getSnapshot().error, { kind: "authentication", code: null });
});

test("initialization, account and connect failures become recoverable errors", async () => {
  for (const [event, kind] of [["initialization_error", "unsupported"], ["account_error", "account"]] as const) {
    const { controller, players } = setup();
    await controller.start();
    players[0].emit(event, { message: "x" });
    assert.equal(controller.getSnapshot().error?.kind, kind);
    await controller.start(); // retry replaces the failed player instead of duplicating it
    assert.equal(players.length, 2);
    assert.ok(players[0].calls.includes("disconnect"));
  }
  const { sdk } = mockSdk(false); // connect() resolving false = Connect registration failed
  const failing = setup({ loadSdk: async () => sdk });
  await failing.controller.start();
  assert.equal(failing.controller.getSnapshot().error?.kind, "connect_failed");
});

test("SDK load failure is reported and can be retried", async () => {
  let attempts = 0;
  const { sdk } = mockSdk();
  const { controller } = setup({ loadSdk: async () => { attempts++; if (attempts === 1) throw new Error("offline"); return sdk; } });
  await controller.start();
  assert.equal(controller.getSnapshot().error?.kind, "sdk_load");
  await controller.start();
  assert.equal(controller.getSnapshot().status, "connecting");
});

test("playback_error is a temporary notice, not a fatal error", async () => {
  const { controller, players } = setup();
  await controller.start();
  players[0].emit("ready", { device_id: "d" });
  players[0].emit("playback_error", { message: "Cannot play track" });
  assert.equal(controller.getSnapshot().status, "ready");
  assert.equal(controller.getSnapshot().notice, "Cannot play track");
  controller.clearNotice();
  assert.equal(controller.getSnapshot().notice, null);
});

test("controls call the SDK only when ready; activation runs once per player", async () => {
  const { controller, players } = setup();
  await controller.start();
  assert.equal(await controller.togglePlay(), false, "not ready yet");
  players[0].emit("ready", { device_id: "d" });
  await controller.activate();
  await controller.activate();
  await controller.togglePlay();
  await controller.nextTrack();
  await controller.previousTrack();
  await controller.seek(12_345.6);
  await controller.setVolume(1.7);
  assert.deepEqual(players[0].calls.slice(1), ["activate", "togglePlay", "next", "previous", "seek:12346", "volume:1"]);
  assert.equal(controller.getSnapshot().volume, 1);
});

test("shutdown cleans up listeners and the player, and a late SDK load is discarded", async () => {
  const { controller, players } = setup();
  await controller.start();
  players[0].emit("ready", { device_id: "d" });
  controller.shutdown();
  assert.ok(players[0].calls.includes("disconnect"));
  assert.equal(players[0].listenerCount(), 0);
  assert.equal(controller.getSnapshot().status, "idle");
  assert.equal(controller.getSnapshot().deviceId, null);
  controller.shutdown(); // idempotent

  let release!: () => void;
  const { sdk, players: late } = mockSdk();
  const slow = setup({ loadSdk: () => new Promise((resolve) => { release = () => resolve(sdk); }) });
  const pending = slow.controller.start();
  slow.controller.shutdown(); // window closed while the SDK script was loading
  release();
  await pending;
  assert.equal(late.length, 0, "no player is created after shutdown");
  assert.equal(slow.controller.getSnapshot().status, "idle");
});

test("subscribers are notified and can unsubscribe", async () => {
  const { controller } = setup();
  let calls = 0;
  const unsubscribe = controller.subscribe(() => { calls++; });
  await controller.start();
  const seen = calls;
  assert.ok(seen > 0);
  unsubscribe();
  controller.shutdown();
  assert.equal(calls, seen);
});

test("the SDK script is the official URL, loaded once, and a failed load can be retried", async () => {
  resetSpotifySdkLoader();
  const appended: any[] = [];
  const win: any = {};
  const doc: any = { createElement: () => ({ src: "", async: false, onerror: null, remove() { this.removed = true; } }), head: { appendChild: (node: any) => appended.push(node) } };
  const first = loadSpotifySdk(win, doc, 1_000);
  const second = loadSpotifySdk(win, doc, 1_000);
  assert.equal(first, second);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, SDK_URL);
  assert.equal(SDK_URL, "https://sdk.scdn.co/spotify-player.js");
  appended[0].onerror();
  await assert.rejects(first);
  assert.equal(appended[0].removed, true);

  const retry = loadSpotifySdk(win, doc, 1_000);
  assert.equal(appended.length, 2);
  win.Spotify = { Player: class {} };
  win.onSpotifyWebPlaybackSDKReady();
  assert.equal(await retry, win.Spotify);
  assert.equal(await loadSpotifySdk(win, doc), win.Spotify, "already loaded: no new script");
  assert.equal(appended.length, 2);
  resetSpotifySdkLoader();
});
