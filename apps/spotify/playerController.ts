// Owns the single Spotify Web Playback SDK player for LegionOS.
//
// React-free so it can be tested with a mocked SDK. The UI subscribes to
// snapshots; opening, minimizing or switching screens never creates a second
// player. Only `shutdown()` (closing or uninstalling the app, disconnecting)
// destroys it.

export type SdkTrack = {
  uri: string;
  name: string;
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string; width?: number | null }[] };
};

export type SdkState = {
  paused: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat_mode: number;
  track_window: { current_track: SdkTrack | null };
};

export type SdkEvent = "ready" | "not_ready" | "player_state_changed" | "initialization_error" | "authentication_error" | "account_error" | "playback_error" | "autoplay_failed";

export type SdkPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: SdkEvent, callback: (payload: any) => void): boolean;
  removeListener(event: SdkEvent, callback?: (payload: any) => void): boolean;
  togglePlay(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  activateElement?(): Promise<void>;
};

export type SdkNamespace = {
  Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number }) => SdkPlayer;
};

export type PlayerDeps = {
  loadSdk: () => Promise<SdkNamespace>;
  /** Short-lived access token from Rust. Rust refreshes it when needed. */
  fetchToken: () => Promise<string>;
  /** Drops the cached token in Rust after the SDK rejected it. */
  invalidateToken: () => Promise<void>;
  now: () => number;
};

export type PlayerStatus = "idle" | "loading" | "connecting" | "ready" | "offline" | "error";
export type PlayerErrorKind = "sdk_load" | "unsupported" | "authentication" | "account" | "connect_failed" | "token";
export type RepeatMode = "off" | "context" | "track";

export type TrackInfo = { uri: string; name: string; artists: string; album: string; imageUrl: string | null };

export type PlaybackInfo = {
  track: TrackInfo | null;
  paused: boolean;
  positionMs: number;
  durationMs: number;
  /** `now()` when the position was reported; the UI extrapolates while playing. */
  updatedAt: number;
  shuffle: boolean;
  repeat: RepeatMode;
};

export type PlayerSnapshot = {
  status: PlayerStatus;
  deviceId: string | null;
  playback: PlaybackInfo | null;
  volume: number;
  error: { kind: PlayerErrorKind; code: string | null } | null;
  /** Non-fatal problem with the last playback action (shown briefly, player stays usable). */
  notice: string | null;
};

export const PLAYER_NAME = "LegionOS";
const DEFAULT_VOLUME = 0.5;
const REPEAT_MODES: RepeatMode[] = ["off", "context", "track"];

export const initialPlayerSnapshot: PlayerSnapshot = { status: "idle", deviceId: null, playback: null, volume: DEFAULT_VOLUME, error: null, notice: null };

export function mapState(state: SdkState | null, now: number): PlaybackInfo | null {
  if (!state) return null;
  const track = state.track_window?.current_track ?? null;
  const images = track?.album?.images ?? [];
  const image = [...images].sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0];
  return {
    track: track ? {
      uri: track.uri,
      name: track.name || "—",
      artists: (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(", "),
      album: track.album?.name ?? "",
      imageUrl: image?.url?.startsWith("https://") ? image.url : null,
    } : null,
    paused: state.paused,
    positionMs: Math.max(0, state.position || 0),
    durationMs: Math.max(0, state.duration || 0),
    updatedAt: now,
    shuffle: !!state.shuffle,
    repeat: REPEAT_MODES[state.repeat_mode] ?? "off",
  };
}

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length];
}

/** Current position, extrapolated while playing and clamped to the track length. */
export function currentPosition(playback: PlaybackInfo, now: number): number {
  const position = playback.paused ? playback.positionMs : playback.positionMs + Math.max(0, now - playback.updatedAt);
  return playback.durationMs > 0 ? Math.min(position, playback.durationMs) : position;
}

export function createSpotifyPlayer(deps: PlayerDeps) {
  let snapshot: PlayerSnapshot = initialPlayerSnapshot;
  let player: SdkPlayer | null = null;
  let starting: Promise<void> | null = null;
  let generation = 0;
  let authRetried = false;
  let activated = false;
  const listeners = new Set<() => void>();
  const sdkListeners: [SdkEvent, (payload: any) => void][] = [];

  const set = (changes: Partial<PlayerSnapshot>) => {
    snapshot = { ...snapshot, ...changes };
    for (const listener of listeners) listener();
  };

  const fail = (kind: PlayerErrorKind, code: string | null = null) => set({ status: "error", error: { kind, code } });

  const teardown = () => {
    generation += 1;
    starting = null;
    const current = player;
    player = null;
    activated = false;
    if (current) {
      for (const [event, callback] of sdkListeners) current.removeListener(event, callback);
      current.disconnect();
    }
    sdkListeners.length = 0;
  };

  const start = (): Promise<void> => {
    if (player && snapshot.status !== "error") return Promise.resolve();
    if (starting) return starting;
    if (player) teardown(); // a failed player is replaced, never duplicated
    const run = ++generation;
    authRetried = false;
    set({ status: "loading", error: null, notice: null });
    starting = (async () => {
      let sdk: SdkNamespace;
      try {
        sdk = await deps.loadSdk();
      } catch {
        if (run === generation) fail("sdk_load");
        return;
      }
      if (run !== generation) return; // shut down while the SDK was loading
      const created = new sdk.Player({
        name: PLAYER_NAME,
        volume: snapshot.volume,
        getOAuthToken: (callback) => {
          deps.fetchToken().then(callback, (error: unknown) => {
            if (run === generation) fail("token", errorCode(error));
          });
        },
      });
      player = created;
      const on = (event: SdkEvent, callback: (payload: any) => void) => {
        // The exact function registered with the SDK is kept so teardown can remove it.
        const guarded = (payload: any) => { if (run === generation) callback(payload); };
        sdkListeners.push([event, guarded]);
        created.addListener(event, guarded);
      };
      on("ready", ({ device_id }: { device_id: string }) => { authRetried = false; set({ status: "ready", deviceId: device_id, error: null }); });
      on("not_ready", () => set({ status: "offline" }));
      on("player_state_changed", (state: SdkState | null) => set({ playback: mapState(state, deps.now()) }));
      on("initialization_error", () => fail("unsupported"));
      on("account_error", () => fail("account"));
      on("playback_error", ({ message }: { message?: string }) => set({ notice: message || "playback_error" }));
      on("autoplay_failed", () => set({ notice: "autoplay_failed" }));
      on("authentication_error", () => {
        if (authRetried) { fail("authentication"); return; }
        // One automatic recovery: drop the rejected token and reconnect.
        authRetried = true;
        void deps.invalidateToken().catch(() => undefined).then(() => {
          if (run !== generation) return;
          created.disconnect();
          void created.connect();
        });
      });
      set({ status: "connecting" });
      const connected = await created.connect().catch(() => false);
      if (run === generation && !connected && snapshot.status === "connecting") fail("connect_failed");
    })().finally(() => { if (run === generation) starting = null; });
    return starting;
  };

  const act = async (action: (current: SdkPlayer) => Promise<void>) => {
    const current = player;
    if (!current || snapshot.status !== "ready") return false;
    try {
      await action(current);
      return true;
    } catch {
      set({ notice: "playback_error" });
      return false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start,
    /** Destroys the player (close/uninstall/disconnect). Safe to call repeatedly. */
    shutdown() {
      teardown();
      set({ ...initialPlayerSnapshot, volume: snapshot.volume });
    },
    reconnect() {
      teardown();
      set({ status: "idle", deviceId: null, playback: null, error: null, notice: null });
      return start();
    },
    /** Must run inside a click handler: unlocks audio in the WebView without autoplaying. */
    activate() {
      if (activated || !player?.activateElement) return Promise.resolve();
      activated = true;
      return player.activateElement().catch(() => { activated = false; });
    },
    togglePlay: () => act((current) => current.togglePlay()),
    previousTrack: () => act((current) => current.previousTrack()),
    nextTrack: () => act((current) => current.nextTrack()),
    seek: (positionMs: number) => act((current) => current.seek(Math.max(0, Math.round(positionMs)))),
    setVolume(volume: number) {
      const clamped = Math.min(1, Math.max(0, volume));
      set({ volume: clamped });
      return act((current) => current.setVolume(clamped));
    },
    clearNotice: () => { if (snapshot.notice) set({ notice: null }); },
    reportNotice: (notice: string) => set({ notice }),
  };
}

export type SpotifyPlayerController = ReturnType<typeof createSpotifyPlayer>;

export function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") return (error as { code: string }).code;
  return "internal";
}
