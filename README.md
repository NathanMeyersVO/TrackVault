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

Replace `OWNER/REPO` with your GitHub repository path after you publish this project.

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
npm install
npm run tauri dev
```

Build a release installer:

```bash
npm run tauri build
```

- Windows output: `src-tauri/target/release/bundle/`
- macOS output: build on macOS for `.app` / `.dmg` (release installers are not built in CI)

### Publishing to GitHub

1. Create an empty repository on GitHub (`OWNER/REPO`).
2. Add it as a remote and push `main` (this repo keeps its existing `origin` unless you change it).
3. After the first push, confirm the **CI** workflow passes on GitHub.

If line endings look wrong locally after cloning, run `git add --renormalize .` once (see [`.gitattributes`](.gitattributes)).

## Usage

1. Open **Library → Projects…** and create a project (name + application), or **Import EMS download…** from a folder of EMS downloads (ZIP archives and/or event schedule spreadsheet).
2. Open a project. TrackVault scans the project library for MP3, FLAC, WAV, OGG, and M4A files and reads tags. Playlists and taglists load from the project library’s `library/trackvault.json` (kept up to date automatically).
3. Double-click a track (or select and press play) to start playback.
4. Use **Library → Apply EMS Download…** to stage a folder of EMS downloads, preview changes, and apply updates to the open project.
5. **Library → Export Project…** saves the open project to a `.tgz` archive. In the Projects hub, **Import project archive…** restores a copy as a **new** project (new ID).
6. Create stored collections from the sidebar; import/export `.tgz` stored collections separately from full projects.

### Privacy / demo copies

To share a project library or record demos without real names in tags or filenames, use the **anonymize-library** CLI. It copies audio into a subfolder under your project library root (default `DEMO_COPY/`), replaces **Track Title** with stable fake names, and renames file stems accordingly. Original files are not modified.

From the repo root:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin anonymize-library -- `
  --library "C:\path\to\your\project\library"
```

Use `--dry-run` to preview changes. Optional flags: `--output-subdir`, `--seed`.

## Project structure

```
src/                 React UI
src-tauri/src/       Rust backend
  db.rs              SQLite project library index + playlists
  scanner.rs         Folder scan + tag reading
  projects.rs        Managed project folders + manifests
  project_archive.rs Project .tgz export/import
  delivery/          Vendor delivery staging, preview, apply
  player.rs          Audio playback
```

## License

[MIT](LICENSE) — Copyright (c) 2026 Nathan Meyers
