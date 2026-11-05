// Typed wrappers around the Rust Spotify commands. Rust holds the refresh token;
// only `sdkToken` returns a short-lived access token, for the Web Playback SDK.
import { invoke } from "@tauri-apps/api/core";
import type { RepeatMode } from "./playerController.ts";

export type SpotifyStatus = { configured: boolean; configError: string | null; connected: boolean; loginInProgress: boolean; redirectUri: string };
export type SpotifyProfile = { displayName: string | null; imageUrl: string | null };
export type PlaylistSummary = { uri: string; name: string; owner: string | null; imageUrl: string | null; trackCount: number | null };
export type BackendError = { code: string; retryAfterSecs?: number };

export const spotifyBackend = {
  status: () => invoke<SpotifyStatus>("spotify_status"),
  connect: () => invoke<void>("spotify_connect"),
  cancelConnect: () => invoke<void>("spotify_cancel_connect"),
  disconnect: () => invoke<void>("spotify_disconnect"),
  sdkToken: () => invoke<{ accessToken: string; expiresInSecs: number }>("spotify_sdk_token").then((token) => token.accessToken),
  invalidateToken: () => invoke<void>("spotify_invalidate_token"),
  profile: () => invoke<SpotifyProfile>("spotify_profile"),
  playlists: () => invoke<PlaylistSummary[]>("spotify_playlists"),
  transferPlayback: (deviceId: string, play: boolean) => invoke<void>("spotify_transfer_playback", { deviceId, play }),
  playContext: (deviceId: string, contextUri: string) => invoke<void>("spotify_play_context", { deviceId, contextUri }),
  setShuffle: (deviceId: string, enabled: boolean) => invoke<void>("spotify_set_shuffle", { deviceId, enabled }),
  setRepeat: (deviceId: string, mode: RepeatMode) => invoke<void>("spotify_set_repeat", { deviceId, mode }),
};

export function toBackendError(error: unknown): BackendError {
  if (error && typeof error === "object" && typeof (error as BackendError).code === "string") return error as BackendError;
  return { code: "internal" };
}
