// The one Spotify player instance for this LegionOS window.
import { spotifyBackend } from "./backend.ts";
import { createSpotifyPlayer } from "./playerController.ts";
import { loadSpotifySdk } from "./sdkLoader.ts";

export const spotifyPlayer = createSpotifyPlayer({
  loadSdk: () => loadSpotifySdk(),
  fetchToken: spotifyBackend.sdkToken,
  invalidateToken: spotifyBackend.invalidateToken,
  now: () => Date.now(),
});

/** Closing or uninstalling the app stops playback and aborts a pending browser sign-in. */
export function closeSpotifyApp() {
  spotifyPlayer.shutdown();
  void spotifyBackend.cancelConnect().catch(() => undefined);
}
