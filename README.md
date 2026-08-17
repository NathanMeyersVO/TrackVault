# TrackVault

A cross-platform desktop music player (Windows and macOS) with an iTunes-like layout. Scan local folders, browse your library, manage playlists, and play tracks with a waveform view powered by [wavesurfer.js](https://wavesurfer.xyz/).

## Stack

- **Backend:** Rust (Tauri 2) — library scanning, SQLite, audio playback, waveform peaks
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
cd Projects/trackvault
npm install
npm run tauri dev
```

Build a release installer:

```bash
npm run tauri build
```

- Windows output: `src-tauri/target/release/bundle/`
- macOS output: build on macOS (or CI) for `.app` / `.dmg`

## Usage

1. Click **Add music folder** in the sidebar.
2. TrackVault scans for MP3, FLAC, WAV, OGG, and M4A files and reads tags.
3. Double-click a track (or select and press play) to start playback.
4. Create playlists from the sidebar and add tracks from the library.
5. Click the waveform to seek within the current track.

## Project structure

```
src/                 React UI
src-tauri/src/       Rust backend
  db.rs              SQLite library + playlists
  scanner.rs         Folder scan + tag reading
  waveform.rs        Peak generation (cached in DB)
  player.rs          Audio playback (rodio)
  commands.rs        Tauri IPC commands
```

## Supported formats

MP3, FLAC, WAV, OGG, M4A/AAC (via symphonia/lofty).

## License

MIT
