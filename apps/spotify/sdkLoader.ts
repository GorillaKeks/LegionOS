// Loads the official Web Playback SDK script exactly once.
import type { SdkNamespace } from "./playerController.ts";

export const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const LOAD_TIMEOUT_MS = 20_000;

type SdkWindow = { Spotify?: SdkNamespace; onSpotifyWebPlaybackSDKReady?: () => void };
type ScriptLike = { src: string; async: boolean; onerror: (() => void) | null; remove(): void };
type DocumentLike = { createElement(tag: "script"): ScriptLike; head: { appendChild(node: ScriptLike): unknown } };

let pending: Promise<SdkNamespace> | null = null;

export function loadSpotifySdk(win: SdkWindow = window as unknown as SdkWindow, doc: DocumentLike = document as unknown as DocumentLike, timeoutMs = LOAD_TIMEOUT_MS): Promise<SdkNamespace> {
  if (win.Spotify?.Player) return Promise.resolve(win.Spotify);
  if (pending) return pending;
  pending = new Promise<SdkNamespace>((resolve, reject) => {
    const script = doc.createElement("script");
    const fail = (reason: string) => {
      clearTimeout(timer);
      pending = null; // allow a later retry
      script.remove();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
    win.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      if (win.Spotify?.Player) resolve(win.Spotify);
      else fail("missing");
    };
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => fail("network");
    doc.head.appendChild(script);
  });
  return pending;
}

/** Test helper: forget a cached load. */
export function resetSpotifySdkLoader() {
  pending = null;
}
