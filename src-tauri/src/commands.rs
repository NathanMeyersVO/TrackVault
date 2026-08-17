use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Database;
use crate::models::{PlaybackState, Playlist, ScanProgress, Track, WaveformPeaks};
use crate::player::AudioPlayer;
use crate::scanner;
use crate::waveform;

pub struct AppState {
    pub db: Mutex<Database>,
    pub player: Arc<AudioPlayer>,
}

#[tauri::command]
pub fn list_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.db.lock().list_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_watch_folders(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .db
        .lock()
        .list_watch_folders()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_watch_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ScanProgress, String> {
    {
        let db = state.db.lock();
        db.add_watch_folder(&path).map_err(|e| e.to_string())?;
    }

    let progress = scan_library(app.clone(), state)?;
    let _ = app.emit("library-updated", ());
    Ok(progress)
}

#[tauri::command]
pub fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanProgress, String> {
    let progress = {
        let db = state.db.lock();
        scanner::scan_all_folders(&db)?
    };
    let _ = app.emit("library-updated", ());
    Ok(progress)
}

#[tauri::command]
pub fn create_playlist(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    state
        .db
        .lock()
        .create_playlist(&name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_playlist(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state
        .db
        .lock()
        .delete_playlist(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    state
        .db
        .lock()
        .list_playlists()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_tracks(state: State<'_, AppState>, playlist_id: i64) -> Result<Vec<Track>, String> {
    state
        .db
        .lock()
        .list_playlist_tracks(playlist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_track_to_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    state
        .db
        .lock()
        .add_track_to_playlist(playlist_id, track_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_track_from_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_id: i64,
) -> Result<(), String> {
    state
        .db
        .lock()
        .remove_track_from_playlist(playlist_id, track_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn play_track(
    state: State<'_, AppState>,
    track_id: i64,
    start_ms: Option<u64>,
) -> Result<PlaybackState, String> {
    let (path, duration_ms) = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        (track.path, track.duration_ms as u64)
    };

    let start = start_ms.unwrap_or(0).min(duration_ms);
    state
        .player
        .play(track_id, PathBuf::from(&path).as_path(), duration_ms, start)?;

    Ok(state.player.state())
}

#[tauri::command]
pub fn pause_playback(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    state.player.pause();
    Ok(state.player.state())
}

#[tauri::command]
pub fn resume_playback(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    state.player.resume()?;
    Ok(state.player.state())
}

#[tauri::command]
pub fn stop_playback(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    state.player.stop();
    let mut playback = state.player.state();
    playback.position_ms = 0;
    Ok(playback)
}

#[tauri::command]
pub fn seek_playback(state: State<'_, AppState>, position_ms: u64) -> Result<PlaybackState, String> {
    state.player.seek(position_ms)?;
    let mut playback = state.player.state();
    playback.position_ms = position_ms.min(playback.duration_ms);
    Ok(playback)
}

#[tauri::command]
pub fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    Ok(state.player.state())
}

#[tauri::command]
pub fn get_track_peaks(state: State<'_, AppState>, track_id: i64) -> Result<WaveformPeaks, String> {
    let cached = {
        let db = state.db.lock();
        let peaks = db.get_peaks(track_id).map_err(|e| e.to_string())?;
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        (peaks, track.path, track.duration_ms)
    };

    if let Some(json) = cached.0 {
        if let Ok(peaks) = serde_json::from_str::<Vec<f32>>(&json) {
            return Ok(WaveformPeaks {
                peaks,
                duration_ms: cached.2,
            });
        }
    }

    let generated = waveform::generate_peaks(PathBuf::from(&cached.1).as_path())?;
    let json = serde_json::to_string(&generated.peaks).map_err(|e| e.to_string())?;
    state
        .db
        .lock()
        .set_peaks(track_id, &json)
        .map_err(|e| e.to_string())?;

    Ok(generated)
}

pub fn init_state(app: &AppHandle) -> Result<AppState, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join("trackvault.db");
    let db = Database::open(&db_path).map_err(|e| e.to_string())?;
    let player = Arc::new(AudioPlayer::new()?);
    player.start_position_emitter(app.clone());

    Ok(AppState {
        db: Mutex::new(db),
        player,
    })
}
