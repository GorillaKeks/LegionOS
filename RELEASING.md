# Windows Releases

Windows x64 installers are built automatically from a version tag named `vMAJOR.MINOR.PATCH` and prepared as a GitHub Release draft. Regular pushes to `main` do not create a release, and releases are not published automatically.

## Update the version

Before a release, the same application version must appear in these project files:

- `package.json` and both version fields in `package-lock.json` (root and `packages[""]`)
- `src-tauri/tauri.conf.json`
- `[package].version` in `src-tauri/Cargo.toml`
- The `legionos` package version in `src-tauri/Cargo.lock`

Versions in `apps/*/manifest.json` are independent app versions. Increase one only when that local app changes; it does not need to match the desktop app version.

For example, to release `v0.2.0`:

1. Update the project versions to `0.2.0`. `npm version 0.2.0 --no-git-tag-version` updates `package.json` and `package-lock.json`; then update the Tauri and Cargo versions.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml` so Cargo updates the package version in `src-tauri/Cargo.lock`.
3. Check version consistency with `node tools/check-release-version.mjs v0.2.0`, then run `npm test`, `npm run build`, and `npm run build:windows`.
4. Commit and push the version changes. Then create and push the tag on that commit:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow checks the tag version against all desktop manifests and lockfiles, tests and builds the app on `windows-latest`, creates signed installer aliases, verifies signatures and the update manifest, and uploads five release assets to a draft. The draft remains unpublished after the assets are checked. If a test, build, or artifact step fails, the release job does not run; if an upload fails, the draft remains unpublished.

## Repository requirements

- GitHub Actions must be enabled for `GorillaKeks/LegionOS`, with push events for tags allowed.
- The organization or repository policy must grant the workflow's `GITHUB_TOKEN` the declared `contents: write` permission for the release job. The build job has only `contents: read`.
- The repository's Actions policy must allow the referenced Actions and GitHub CLI calls.
- No personal token is required. The workflow is not triggered by regular pushes to `main`.

The workflow builds the signed installers and updater feed. After successful validation, it creates a GitHub Release draft but does not publish it automatically.

## Release artifacts

## Signed Tauri updater

LegionOS 1.0.3 includes the Tauri updater. Checks are started manually in Settings; downloading and installing an update require a further confirmation. The client verifies the Minisign signature and its signed version binding. Updates without a valid signature are rejected.

The public key is in `src-tauri/tauri.conf.json`. Keep the private key outside the repository at `%USERPROFILE%\.tauri\LegionOS.key`. GitHub Actions receives `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only during the Windows installer build step. Never copy these values into project files, logs, or artifacts.

The release build creates signed `.sig` files for NSIS and MSI, plus a `latest.json` file. For automatic updates, the manifest maps `windows-x86_64` to the NSIS installer `LegionOS_x64-setup.exe`. MSI remains available for new installations; MSI self-updating is not guaranteed.

After a successful build and asset check, the workflow creates only a GitHub Release draft and does not publish it. Test the draft, its assets, and the update flow with a test installation before publishing it manually. The URL `releases/latest/download/latest.json` resolves only after the latest release has been published.

Installations of version 1.0.0 do not include an updater. They must first be updated manually to a current version that includes one. Only then can the manual update check find newer signed versions.

`upload-artifact` preserves the `nsis/` and `msi/` folders. The verified artifact contains both installers, both `.sig` files, and `latest.json`. The release job checks all five files, uploads them to a draft, and leaves it unpublished. Review the draft and publish it only after manual approval.
