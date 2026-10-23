# Windows-Releases

Windows-x64-Installer werden automatisch aus einem Versions-Tag `vMAJOR.MINOR.PATCH` gebaut und als GitHub-Release veröffentlicht. Normale Pushes auf `main` erzeugen kein Release.

## Version aktualisieren

Vor dem Release muss dieselbe Programmversion in diesen Projektdateien stehen:

- `package.json` und beide Versionsfelder in `package-lock.json` (Root und `packages[""]`)
- `src-tauri/tauri.conf.json`
- `[package].version` in `src-tauri/Cargo.toml`
- Paketversion `phone` in `src-tauri/Cargo.lock`

Die Versionsnummern in `apps/*/manifest.json` sind eigenständige App-Versionen und werden nur erhöht, wenn sich die jeweilige lokale App ändert. Sie müssen nicht der Desktop-App-Version entsprechen.

Zum Beispiel für `v0.2.0`:

1. Aktualisiere die Projektversionen auf `0.2.0`. `npm version 0.2.0 --no-git-tag-version` aktualisiert `package.json` und `package-lock.json`; danach Tauri und Cargo-Version aktualisieren.
2. Führe `cargo check --manifest-path src-tauri/Cargo.toml` aus, damit Cargo die Paketversion in `src-tauri/Cargo.lock` nachzieht.
3. Prüfe die Übereinstimmung lokal mit `node tools/check-release-version.mjs v0.2.0` und führe `npm test`, `npm run build` sowie `npm run build:windows` aus.
4. Committe und pushe die Versionsänderung. Erstelle danach den Tag auf diesem Commit und pushe ihn:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

Der Workflow prüft die Tag-Version gegen alle Projekt-Manifeste und Lockfiles, testet und baut die Anwendung auf `windows-latest`, prüft beide festen Installer-Aliase auf Existenz und Dateigröße und überträgt sie als Release-Assets. Das Release wird zuerst als Entwurf mit beiden Dateien angelegt und erst veröffentlicht, nachdem die Assetnamen geprüft wurden. Schlägt ein Test, Build oder Artefaktschritt fehl, wird der Release-Job nicht ausgeführt. Schlägt das Hochladen oder die Assetprüfung fehl, bleibt das Release ein Entwurf.

## Repository-Voraussetzungen

- GitHub Actions muss für `GorillaKeks/LegionOS` aktiviert sein und Push-Ereignisse für Tags zulassen.
- Die Organisations-/Repository-Richtlinie muss dem Workflow `GITHUB_TOKEN` die deklarierte `contents: write`-Berechtigung für den Release-Job erlauben. Der Build-Job hat nur `contents: read`.
- Die referenzierten Actions und GitHub CLI-Aufrufe müssen durch die Actions-Richtlinie des Repositories erlaubt sein.
- Es wird kein persönliches Token benötigt. Der Workflow wird nicht bei normalen Pushes auf `main` ausgelöst.

Der Workflow erstellt nur die Release-Installer. Eine Tauri-Updater-Funktion ist damit nicht eingerichtet.

## Artifact layout in Actions

The two upload paths share `src-tauri/target/release/bundle` as their least common ancestor. `upload-artifact` therefore keeps the `nsis/` and `msi/` directories in the artifact. After downloading to `installers/`, the expected paths are `installers/nsis/LegionOS_x64-setup.exe` and `installers/msi/LegionOS_x64_en-US.msi`; the release job verifies and uploads those paths by their filenames.
