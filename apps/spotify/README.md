# Spotify (personal build)

A LegionOS app that plays Spotify Premium music inside the LegionOS WebView2 window with the official [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk). It needs no Spotify Desktop and no helper program.

**This is for one owner's personal LegionOS installation only.** It is not approved or endorsed by Spotify. Do not ship a Client ID with public releases. See [Policy and distribution](#policy-and-distribution).

## 1. Spotify Developer Dashboard setup

1. Sign in at <https://developer.spotify.com/dashboard> with the Spotify account that owns the app. This account needs **Spotify Premium** for a Development Mode app to work.
2. Choose **Create app**:
   - Any name and description, for example "LegionOS personal".
   - **Redirect URI:** `http://127.0.0.1/callback`. Use the IP literal without a port: Spotify adds a dynamic port for loopback IP literals at sign-in. `localhost` is not allowed.
   - **APIs used:** tick *Web API* and *Web Playback SDK*.
3. Open the app's **Settings** and copy the **Client ID**. It is public OAuth configuration, not a secret. LegionOS never uses the Client Secret, so don't copy it anywhere.
4. Under **User Management**, add every Spotify account that should use it. Development Mode allows at most **5 accounts**. Each one needs Premium; mobile-only plans don't work.

If Spotify rejects the dynamic port, register a fixed one instead, for example `http://127.0.0.1:43821/callback`, and set `"redirectPort": 43821` in the config file.

## 2. Local configuration (never committed, never bundled)

Create `spotify.local.json` with this content:

```json
{
  "clientId": "YOUR_32_CHARACTER_CLIENT_ID",
  "redirectPort": 0
}
```

LegionOS looks for it in this order:

1. `%APPDATA%\com.phone.overlay\spotify.local.json`. Used by installed builds and `npm run tauri dev`.
2. `<repository>\spotify.local.json`. Debug builds only.

`spotify.local.json` is listed in `.gitignore`. It is never put in `apps/`, because that folder is bundled into installers. An example without an ID is in `spotify.local.example.json` at the repository root.

**Without a valid config, Spotify is hidden from the App Store.** Builds made elsewhere, such as CI releases, therefore never offer it.

## 3. Using the app

1. Restart LegionOS, then install **Spotify** from the App Store and open it.
2. Click **Connect Spotify**. Your default browser opens Spotify's sign-in page. After you approve, the browser shows "Spotify is connected" and LegionOS continues.
3. The player registers as a Spotify Connect device named **LegionOS**. Nothing plays until you choose **Play here**, which continues your last session, or pick a playlist.
4. **Minimizing** keeps the music playing. **Closing** or uninstalling the app stops the player.
5. To remove the stored sign-in, go to **Connection → Disconnect Spotify**.

## Scopes

| Scope | Why |
|---|---|
| `streaming`, `user-read-email`, `user-read-private` | Required by the Web Playback SDK |
| `user-read-playback-state`, `user-modify-playback-state` | Transfer playback to LegionOS, shuffle, repeat, start a playlist |
| `playlist-read-private`, `playlist-read-collaborative` | List your playlists |

## Architecture

| Part | Location |
|---|---|
| UI, player lifecycle, SDK loader, strings | `apps/spotify/` (`SpotifyApp.tsx`, `playerController.ts`, `player.ts`, `sdkLoader.ts`, `backend.ts`, `strings.ts`, `spotify.css`) |
| OAuth, tokens, credentials, Web API calls | `src-tauri/src/spotify/` (`mod.rs`, `config.rs`, `pkce.rs`, `callback.rs`, `tokens.rs`, `credentials.rs`, `api.rs`, `error.rs`) |
| Registration | `apps/spotify/manifest.json` (id `spotify-player`), `app_catalog.rs` allow-list, `src/apps.ts`, `src/App.tsx`, `src/i18n.ts` (app name only) |

The app ID is `spotify-player`, not `spotify`. LegionOS's config migration permanently removes the ID of a retired app called `spotify`.

`playerController.ts` owns the only SDK player. Opening the window again, or switching tabs, reuses it. A failed player is replaced, never duplicated. Late events from an old player are ignored.

## Security

- **Login:** OAuth 2.0 Authorization Code with **PKCE (S256)**. There is no Client Secret and no implicit grant, and the password is entered only on Spotify's page in the external browser.
- **Verifier and state:** a 64-byte random verifier and a 32-byte random state, both from the OS random generator. The state is compared in constant time.
- **Callback listener:**
  - Binds to **127.0.0.1 only** and answers only `GET /callback`.
  - Rejects state mismatches, duplicate parameters and oversized codes.
  - Times out after 3 minutes, can be cancelled, and closes as soon as the flow ends.
- **Refresh token:**
  - Stored in **Windows Credential Manager** as "LegionOS Spotify (personal build)".
  - Only the Rust `spotify` module can reach it, and it is never sent to JavaScript.
  - Rotated when Spotify issues a new one, and deleted when it's revoked or when you disconnect.
- **Access tokens:** kept in Rust memory and refreshed 60 s before they expire. One lock means concurrent callers share a single refresh. JavaScript only receives one when the SDK's `getOAuthToken` asks for it.
- **Web API calls** (profile, playlists, transfer, shuffle, repeat, play) are made in Rust. Device IDs and Spotify URIs are checked before use.
- **Nothing sensitive is stored in the frontend:** no `localStorage`, no tokens in `phone.json`, and no tokens, codes or verifiers in logs or error messages.

## Policy and distribution

Checked against Spotify's documentation as of November 2026:

- **Development Mode:** up to 5 allowlisted users, one Development Mode Client ID per developer, and the owner needs Premium. These are the Feb/Mar 2026 changes.
- **Extended Quota Mode,** the only way past 5 users, is for organizations with at least 250k monthly active users. It isn't available to this project.
- **Developer Terms §III.1.a** license streaming apps for *private personal use*.
- **The Web Playback SDK** must not be used in commercial projects without Spotify's prior written approval.
- **Developer Policy §III.11** forbids products that "replicate or attempt to replace a core user experience of Spotify" without prior written permission.

Whether a personal SDK player falls under §III.11 is **not settled** by the documentation. The SDK exists to build players, and this app adds no features beyond Spotify's own, but there is no written confirmation from Spotify. Treat this build as personal use within Development Mode only. Spotify can change these rules or the SDK at any time.

Since February 2026, `GET /me` no longer returns `product` or `email` for Development Mode apps. The app therefore learns about missing Premium from the SDK's `account_error` or a `PREMIUM_REQUIRED` API response, not up front.
