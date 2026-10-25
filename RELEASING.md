# Windows-Releases

Windows-x64-Installer werden automatisch aus einem Versions-Tag `vMAJOR.MINOR.PATCH` gebaut und als Entwurf eines GitHub-Releases vorbereitet. Normale Pushes auf `main` erzeugen kein Release; ein Release wird nicht automatisch veröffentlicht.

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

Der Workflow prüft die Tag-Version gegen alle Desktop-Manifeste und Lockfiles, testet und baut die Anwendung auf `windows-latest`, erstellt die signierten Installer-Aliase, prüft Signaturen und Update-Manifest und lädt fünf Release-Assets in einen Draft hoch. Nach der Assetprüfung bleibt der Draft unveröffentlicht. Schlägt ein Test, Build oder Artefaktschritt fehl, wird der Release-Job nicht ausgeführt; bei einem Fehler während des Uploads bleibt der Release-Entwurf unveröffentlicht.

## Repository-Voraussetzungen

- GitHub Actions muss für `GorillaKeks/LegionOS` aktiviert sein und Push-Ereignisse für Tags zulassen.
- Die Organisations-/Repository-Richtlinie muss dem Workflow `GITHUB_TOKEN` die deklarierte `contents: write`-Berechtigung für den Release-Job erlauben. Der Build-Job hat nur `contents: read`.
- Die referenzierten Actions und GitHub CLI-Aufrufe müssen durch die Actions-Richtlinie des Repositories erlaubt sein.
- Es wird kein persönliches Token benötigt. Der Workflow wird nicht bei normalen Pushes auf `main` ausgelöst.

Der Workflow baut die signierten Installer und den Updater-Feed. Er erstellt nach erfolgreicher Prüfung einen GitHub-Release-Entwurf, veröffentlicht ihn jedoch nicht automatisch.

## Release-Artefakte

## Signierter Tauri-Updater

LegionOS 1.0.1 enthält den Tauri-Updater. Die Prüfung wird ausschließlich manuell in den Einstellungen gestartet; ein Download und eine Installation benötigen eine weitere Bestätigung. Der Client prüft die Minisign-Signatur und die signierte Versionsbindung. Ohne gültige Signatur wird das Update abgelehnt.

Der öffentliche Schlüssel steht in `src-tauri/tauri.conf.json`. Der private Schlüssel bleibt außerhalb des Repositorys unter `%USERPROFILE%\.tauri\LegionOS.key`. GitHub Actions erhält `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nur im Windows-Installer-Build-Schritt. Die Werte dürfen weder in Projektdateien noch in Logs oder Artefakte kopiert werden.

Der Release-Build erzeugt signierte `.sig`-Dateien für NSIS und MSI und ein `latest.json`. Für automatische Updates ordnet das Manifest `windows-x86_64` dem NSIS-Installer `LegionOS_x64-setup.exe` zu. MSI bleibt für Neuinstallationen verfügbar; MSI-Selbstaktualisierung ist nicht zugesichert.

Der Workflow erstellt nach erfolgreichem Build und Asset-Prüfung ausschließlich einen GitHub-Release-Entwurf und veröffentlicht ihn nicht. Prüfe den Entwurf, die Assets und den Updateablauf mit einer Testinstallation, bevor du den Entwurf manuell veröffentlichst. Die URL `releases/latest/download/latest.json` wird erst auf einen veröffentlichten neuesten Release auflösen.

Installationen von 1.0.0 enthalten noch keinen Updater. Sie müssen einmal manuell auf 1.0.1 aktualisiert werden. Erst danach kann die manuelle Updateprüfung nach neueren signierten Versionen suchen.

`upload-artifact` bewahrt die Ordner `nsis/` und `msi/`. Das geprüfte Artefakt enthält die beiden Installer, beide `.sig`-Dateien und `latest.json`. Der Release-Job prüft alle fünf Dateien, lädt sie in einen Entwurf hoch und lässt diesen unveröffentlicht. Prüfe den Entwurf und veröffentliche ihn erst nach manueller Freigabe.
