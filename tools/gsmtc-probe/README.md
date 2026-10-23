# Legion OS

Legion OS is an early-stage project exploring a compact desktop command center for Windows. This repository currently contains only a small, isolated proof of concept for Windows Global System Media Transport Controls (GSMTC); it is not yet a user-facing desktop application.

## Project goals

- Explore a focused overlay and local desktop utilities for Windows.
- Investigate whether Windows media sessions can provide metadata and playback controls for a future media tile.
- Keep integrations local and explicit, with clear failure behavior.

## Development status

**Early stage — GSMTC proof of concept only.** The current console tool asks Windows for GSMTC sessions, looks for a session whose source app user model ID contains `Spotify`, and, when found, reads available metadata, playback status, control support, and thumbnail bytes. Playback commands are opt-in command-line arguments and are sent only to the matched Spotify session after checking the advertised capability.

There is no overlay, app store, settings system, or media dashboard in this repository yet.

## Planned capabilities

These are roadmap items, not implemented features:

- A compact Windows desktop command center.
- A media tile backed by a verified Windows media-session integration.
- Local utilities and a small local app catalog.

## Architecture

The repository uses a single Rust binary and the official `windows` Rust bindings. The GSMTC code lives in `src/gsmtc.rs`, separate from the process entry point. This keeps the experiment small and avoids selecting a UI framework before the Windows API feasibility question is answered.

The proof of concept targets Windows 10 version 1809 or later, which is the minimum version documented for the GSMTC session manager. It currently builds and runs on the development machine's Windows 10 build 26300.

## Prerequisites and commands

Install Rust with the MSVC Windows target and the Visual Studio C++ build tools required by Rust's MSVC toolchain.

The following commands were run successfully on the development machine:

```powershell
cargo fmt --check
cargo test
cargo check
cargo run
```

Run the metadata/session inspection without sending playback commands:

```powershell
cargo run
```

The commands below send one explicit action to the Spotify GSMTC session, but only if that session advertises support. They can change playback, so run them only when that is intended:

```powershell
cargo run -- --play-pause
cargo run -- --next
cargo run -- --previous
```

## GSMTC experiment scope and observed result

The tool calls `GlobalSystemMediaTransportControlsSessionManager::RequestAsync`, enumerates available sessions, and matches Spotify by `SourceAppUserModelId`; it does not use `GetCurrentSession`, so it will not deliberately send controls to whichever unrelated player Windows considers current. When Spotify is found, it reads title, artist, album, playback status, enabled control flags, and the thumbnail stream if present. Artwork is read into memory only, with a 10 MiB limit; it is not written to disk. Empty metadata and absent artwork are reported explicitly.

The Windows run on this machine reported:

```text
Package identity: none (unpackaged desktop process)
Available GSMTC sessions: 0
Spotify GSMTC session: unavailable (Spotify is not exposing a matching session).
```

This is evidence that the GSMTC manager request and session enumeration completed successfully from an unpackaged desktop process on this machine. It does **not** prove that Spotify metadata, artwork, or playback controls work: Spotify was not running, so no Spotify session could be inspected. Microsoft documents the `globalMediaControl` app capability for `RequestAsync`; actual behavior can depend on Windows version, package model, and session provider. The experiment deliberately does not infer Spotify support from an empty session list.

No separate Spotify Connect device is created or selected. The tool reads the Spotify desktop session only when Spotify exposes one through GSMTC. No Spotify Web API, OAuth, credentials, or network calls are used.

## Manual Windows test plan

1. Start Spotify Desktop and play a track on the local computer. Run `cargo run` and verify that its source app ID matches Spotify, metadata and playback status are populated, and artwork is either read or clearly reported unavailable.
2. Pause Spotify and run `cargo run` again. Verify that the playback status changes while the metadata stays associated with Spotify.
3. With Spotify paused or playing, inspect the reported support flags. Run `cargo run -- --play-pause`, `cargo run -- --next`, or `cargo run -- --previous` only for an action reported as supported and only when changing playback is intended.
4. Close Spotify and run `cargo run`; the tool should report no Spotify session without failing.
5. Repeat with a track/session that has no artwork or incomplete metadata, if available.
6. Run the ordinary executable from a desktop installation without opening a separate Connect device. This repository has not yet produced an installer, so installation behavior remains untested.

## Roadmap

1. Validate Spotify session matching and metadata on Windows with Spotify playing and paused.
2. Validate artwork availability and command support with real sessions.
3. Decide whether the isolated GSMTC component is suitable for a future desktop UI and document any packaging requirements found in those tests.
4. Only after the API path is verified, select a UI framework and design the first user-facing shell.

## Known limitations and open questions

- No Spotify media session was available during the automated Windows run; Spotify was not running.
- The actual metadata, artwork, playback status changes, and Play/Pause/Next/Previous actions still require manual tests with Spotify Desktop.
- Microsoft lists `globalMediaControl` as an app capability for the GSMTC manager API. The unpackaged probe succeeded on this machine, but compatibility across Windows versions and deployment modes is not yet established.
- The experiment polls only once per process invocation. Event-driven update behavior for a future UI has not been implemented or tested.
- No installer, package identity, signing setup, or release configuration exists.
- No license has been selected.
