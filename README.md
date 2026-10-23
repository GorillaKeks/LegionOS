# Phone

Phone is a desktop application built with Tauri 2, React, TypeScript, and Vite.

## Development

Install dependencies with `npm install`, then start the desktop app with:

```bash
npm run tauri dev
```

The homescreen includes Settings, Notes, and Demo. Settings, notes, the selected view mode, and the native window bounds persist between launches. The Demo counter remains session-only. The phone/tablet switch updates both the interface and the native desktop window size; it does not rotate the operating system display.

The versioned JSON configuration is `phone.json` in Tauri's `app_config_dir()` (on Windows: `%APPDATA%\com.phone.overlay\phone.json`). Writes use a temporary sibling file and atomic rename. Invalid files are preserved as `.corrupt-*` backups; older schemas are migrated with defaults; newer schemas are opened read-only to avoid overwriting data. No filesystem plugin permission is added: persistence uses typed Rust commands, while the existing `core:default` capability remains for core window APIs. Notes are stored as plain text in this local configuration file. Schema version 2 also stores the configurable overlay hotkey.

The overlay uses the official `tauri-plugin-global-shortcut` plugin (Rust API, no JavaScript bindings required) to register one Windows global shortcut without polling keyboard input. The initial binding is `Ctrl+Shift+Space`; change it in Settings using accelerator syntax such as `ctrl+shift+space` or `alt+f10`. Registration conflicts and malformed combinations are reported in the settings panel, and a failed change leaves the previous binding active. Alt Gr alone is not the default: Windows reports it using right Alt plus Ctrl semantics, while this global-shortcut API registers a key plus modifiers, so a modifier-only binding cannot be relied on consistently. Closing the native window hides the overlay and keeps Phone running; use **Phone beenden** in Settings to exit. The implementation does not enable transparency, always-on-top, or mouse click-through, and game focus/input behavior has not been verified interactively.

Native phone and tablet sizes are selected in logical pixels, scaled for the active display, and clamped to the monitor work area. Restored bounds are clamped to an available monitor. Resize and move events update saved bounds with a short write throttle, and close/exit performs a final flush. Internal React app windows remain separate from the native Tauri window and are not restored between launches.

Build the frontend with `npm run build`. Check the Rust application with:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Run the window-management tests with `npm test`.

Run Rust unit tests with `cargo test --manifest-path src-tauri/Cargo.toml`.

The Tauri bundle identifier is `com.phone.overlay`.

## Recommended IDE setup

Use [Visual Studio Code](https://code.visualstudio.com/) with the [Tauri extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) and [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
