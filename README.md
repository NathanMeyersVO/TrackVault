# TrackVault

A cross-platform desktop music player (Windows and macOS) with an iTunes-like layout. Manage **projects** (each with its own project library folder (`library/` under app data), browse tracks, manage playlists and taglists, apply **EMS download** updates (for US Figure Skating EMS projects), and play audio with a waveform view powered by [wavesurfer.js](https://wavesurfer.xyz/).

## Stack

- **Backend:** Rust (Tauri 2) — project library scanning, SQLite, audio playback, waveform peaks
- **Frontend:** React, TypeScript, Tailwind CSS, Zustand, wavesurfer.js

## Prerequisites

### All platforms

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain via rustup)

### Windows

```powershell
winget install Rustlang.Rustup
# Restart your terminal, then:
rustc --version
```

Also ensure [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) is installed (included on Windows 10/11).

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version
```

## Getting started

```bash
git clone https://github.com/NathanMeyersVO/TrackVault.git
cd TrackVault
npm install
npm run tauri dev
```

Build a release installer:

```bash
npm run tauri build
```

- Windows output: `src-tauri/target/release/bundle/`
- macOS output: build on macOS for `.app` / `.dmg` (release installers are not built in CI)

### Git remotes

- **`github`** — [github.com/NathanMeyersVO/TrackVault](https://github.com/NathanMeyersVO/TrackVault) (primary for CI and releases)
- **`origin`** — local bare backup on your machine (optional mirror: `git push origin main`)

If line endings look wrong after cloning, run `git add --renormalize .` once (see [`.gitattributes`](.gitattributes)).

### Windows installers (GitHub Releases)

Pre-built Windows installers are published as [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) assets (after the repo is on GitHub):

1. Open **Releases** on [github.com/NathanMeyersVO/TrackVault/releases](https://github.com/NathanMeyersVO/TrackVault/releases) and download the latest installer (`.msi` and/or `.exe` setup, depending on what the build produced).
2. Unsigned builds may trigger a SmartScreen warning until the app is code-signed.

**Maintainers — ship a new version**

1. Bump the same version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`.
2. Commit on `main` and push.
3. Tag and push the tag (this triggers [`.github/workflows/release.yml`](.github/workflows/release.yml)):

   ```powershell
   git tag v0.9.0
   git push github v0.9.0
   ```

4. In GitHub **Actions**, wait for the **Release** workflow to finish.
5. Open the new **draft** release under **Releases**, verify the Windows assets, then **Publish release**.

Use tag names like `v0.9.0` that match the app version `0.9.0`.

## Usage

1. Open **Library → Projects…** and create a project (name + application), or **Import EMS download…** from a folder of EMS downloads (ZIP archives and/or event schedule spreadsheet).
2. Open a project. TrackVault scans the project library for MP3, FLAC, WAV, OGG, and M4A files and reads tags. Playlists and taglists load from the project library’s `library/trackvault.json` (kept up to date automatically).
3. Double-click a track (or select and press play) to start playback.
4. Use **Library → Apply EMS Download…** to stage a folder of EMS downloads, preview changes, and apply updates to the open project.
5. **Library → Export Project…** saves the open project to a `.tvproject.zip` archive. In the Projects hub, **Import from archive** (file picker or drop zone) restores a copy as a **new** project (new ID).
6. Create stored collections from the sidebar; import/export `.tvcollection.zip` stored collections separately from full projects.

### Privacy / demo copies

To share a project library or record demos without real names in tags or filenames, use the **anonymize-library** CLI. It copies audio into a subfolder under your project library root (default `DEMO_COPY/`), replaces **Track Title** with stable fake names, and renames file stems accordingly. Original files are not modified.

From the repo root:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin anonymize-library -- `
  --library "C:\path\to\your\project\library"
```

Use `--dry-run` to preview changes. Optional flags: `--output-subdir`, `--seed`.

### Demo EMS dataset

To build a fake meet folder for testing **Import EMS download** (event schedule plus tagged tracks under `tracks/`), use **generate-demo-dataset**. You supply the real **Event Schedule** spreadsheet and a **track pool** folder tree. Each generated file copies a distinct pool track chosen by a random walk into leaf subfolders; only files **longer than 1 minute** (by default) are eligible. Some fake skaters are placed in two or three events.

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin generate-demo-dataset -- `
  --schedule "D:\meets\event-schedule.xlsx" `
  --output "D:\drops\demo-meet" `
  --track-pool "D:\Music\pool" `
  --seed 42
```

Use `--dry-run` to preview paths. Tune roster size with `--competitors-min`, `--competitors-max`, and `--multi-event-2-weight` / `--multi-event-3-weight`. Override the length filter with `--min-duration-secs` (default `60` means strictly greater than one minute).

## Project structure

```
src/                 React UI
src-tauri/src/       Rust backend
  db.rs              SQLite project library index + playlists
  scanner.rs         Folder scan + tag reading
  projects.rs        Managed project folders + manifests
  project_archive.rs Project .tvproject.zip export/import
  delivery/          Vendor delivery staging, preview, apply
  player.rs          Audio playback
```

## License

[MIT](LICENSE) — Copyright (c) 2026 Nathan Meyers
