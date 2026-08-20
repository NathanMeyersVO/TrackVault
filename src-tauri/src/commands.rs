use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio_scan::scan_audio;
use crate::db::Database;
use crate::models::{PlaybackState, Playlist, ScanProgress, Taglist, TaglistValue, Track, WaveformPeaks};
use crate::player::AudioPlayer;
use crate::scanner;
use crate::seek_index::{parse_seek_index, serialize_seek_index, SeekKeyframe};

pub struct AppState {
    pub db: Mutex<Database>,
    pub player: Arc<AudioPlayer>,
}

fn load_or_build_seek_index(
    db: &Database,
    track_id: i64,
    path: &Path,
) -> Result<Vec<SeekKeyframe>, String> {
    if let Some(json) = db.get_seek_index(track_id).map_err(|e| e.to_string())? {
        if let Some(index) = parse_seek_index(&json) {
            if !index.is_empty() {
                return Ok(index);
            }
        }
    }

    let scan = scan_audio(path)?;
    let json = serialize_seek_index(&scan.seek_index)?;
    db.set_seek_index(track_id, &json)
        .map_err(|e| e.to_string())?;
    Ok(scan.seek_index)
}

#[tauri::command]
pub fn list_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.db.lock().list_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_library_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state
        .db
        .lock()
        .get_library_folder()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_library_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ScanProgress, String> {
    let library_root = PathBuf::from(&path);
    {
        let db = state.db.lock();
        db.set_library_folder(&path).map_err(|e| e.to_string())?;
        db.clear_user_config().map_err(|e| e.to_string())?;
    }

    let pending_config = match crate::config::load_config_file(&library_root) {
        Ok(config) => config,
        Err(e) => {
            let _progress = {
                let db = state.db.lock();
                scanner::scan_library_folder(&db)?
            };
            let _ = app.emit("library-updated", ());
            return Err(format!(
                "Library folder set and scanned, but config could not be loaded: {e}"
            ));
        }
    };

    let progress = {
        let db = state.db.lock();
        scanner::scan_library_folder(&db)?
    };

    if let Some(config) = pending_config {
        let db = state.db.lock();
        crate::config::apply_config(&db, &library_root, &config)?;
    }

    let _ = app.emit("library-updated", ());
    Ok(progress)
}

#[tauri::command]
pub fn save_library_config(state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock();
    let library = db
        .get_library_folder()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No library folder configured".to_string())?;
    let path = crate::config::save_config(&db, Path::new(&library))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanProgress, String> {
    let progress = {
        let db = state.db.lock();
        scanner::scan_library_folder(&db)?
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
pub fn reorder_playlist_tracks(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .reorder_playlist_tracks(playlist_id, &track_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_taglist(
    state: State<'_, AppState>,
    name: String,
    tag_key: String,
) -> Result<i64, String> {
    state
        .db
        .lock()
        .create_taglist(&name, &tag_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_taglist(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state
        .db
        .lock()
        .delete_taglist(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_taglists(state: State<'_, AppState>) -> Result<Vec<Taglist>, String> {
    state.db.lock().list_taglists().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_taglist_values(
    state: State<'_, AppState>,
    taglist_id: i64,
) -> Result<Vec<TaglistValue>, String> {
    let (tag_key, taglist_id) = {
        let db = state.db.lock();
        crate::tag_index::backfill_unindexed_tracks(&db)?;
        let taglist = db
            .get_taglist(taglist_id)
            .map_err(|e| e.to_string())?
            .ok_or("Taglist not found")?;
        (taglist.tag_key, taglist.id)
    };
    state
        .db
        .lock()
        .list_taglist_values(&tag_key, taglist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_taglist_titles(
    state: State<'_, AppState>,
    taglist_id: i64,
    path: String,
) -> Result<u32, String> {
    {
        let db = state.db.lock();
        if db.get_taglist(taglist_id).map_err(|e| e.to_string())?.is_none() {
            return Err("Taglist not found".to_string());
        }
    }

    let mappings = crate::title_map::parse_title_map(Path::new(&path))?;
    state
        .db
        .lock()
        .import_taglist_titles(taglist_id, &mappings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_taglist_value_title(
    app: AppHandle,
    state: State<'_, AppState>,
    taglist_id: i64,
    tag_value: String,
    display_title: Option<String>,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        if db.get_taglist(taglist_id).map_err(|e| e.to_string())?.is_none() {
            return Err("Taglist not found".to_string());
        }
        db.set_taglist_value_title(
            taglist_id,
            &tag_value,
            display_title.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn get_taglist_tracks(
    state: State<'_, AppState>,
    taglist_id: i64,
    value: Option<String>,
) -> Result<Vec<Track>, String> {
    let tag_key = {
        let db = state.db.lock();
        crate::tag_index::backfill_unindexed_tracks(&db)?;
        let taglist = db
            .get_taglist(taglist_id)
            .map_err(|e| e.to_string())?
            .ok_or("Taglist not found")?;
        taglist.tag_key
    };
    state
        .db
        .lock()
        .list_taglist_tracks(taglist_id, &tag_key, value.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_taglist_tracks(
    state: State<'_, AppState>,
    taglist_id: i64,
    value: Option<String>,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .reorder_taglist_tracks(taglist_id, value.as_deref(), &track_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn play_track(
    state: State<'_, AppState>,
    track_id: i64,
    start_ms: Option<u64>,
    autoplay: Option<bool>,
) -> Result<PlaybackState, String> {
    let autoplay = autoplay.unwrap_or(true);
    state.player.interrupt();

    let (path, duration_ms, seek_index) = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        let seek_index = load_or_build_seek_index(
            &db,
            track_id,
            Path::new(&track.path),
        )?;
        (track.path, track.duration_ms as u64, seek_index)
    };

    let start = start_ms.unwrap_or(0).min(duration_ms);
    state.player.play(
        track_id,
        PathBuf::from(&path).as_path(),
        duration_ms,
        start,
        seek_index,
        autoplay,
    )?;

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
pub fn get_volume(state: State<'_, AppState>) -> f32 {
    state.player.get_volume()
}

#[tauri::command]
pub fn set_volume(state: State<'_, AppState>, volume: f32) -> f32 {
    state.player.set_volume(volume)
}

#[tauri::command]
pub fn get_track_peaks(state: State<'_, AppState>, track_id: i64) -> Result<WaveformPeaks, String> {
    let cached = {
        let db = state.db.lock();
        let peaks = db.get_peaks(track_id).map_err(|e| e.to_string())?;
        let seek_index = db.get_seek_index(track_id).map_err(|e| e.to_string())?;
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        (peaks, seek_index, track.path, track.duration_ms)
    };

    if let Some(json) = cached.0 {
        if let Ok(peaks) = serde_json::from_str::<Vec<f32>>(&json) {
            return Ok(WaveformPeaks {
                peaks,
                duration_ms: cached.3,
            });
        }
    }

    let scan = scan_audio(PathBuf::from(&cached.2).as_path())?;
    let peaks_json = serde_json::to_string(&scan.peaks.peaks).map_err(|e| e.to_string())?;
    let seek_index_json = serialize_seek_index(&scan.seek_index)?;
    {
        let db = state.db.lock();
        db.set_peaks(track_id, &peaks_json)
            .map_err(|e| e.to_string())?;
        if cached.1.is_none() {
            db.set_seek_index(track_id, &seek_index_json)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(scan.peaks)
}

#[tauri::command]
pub fn get_track_tags(state: State<'_, AppState>, track_id: i64) -> Result<crate::tags::TrackTagInfo, String> {
    let path = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        track.path
    };

    crate::tags::read_track_tags(Path::new(&path))
}

#[tauri::command]
pub fn update_track_tags(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
    fields: Vec<crate::tags::TagFieldInput>,
) -> Result<Track, String> {
    let path = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        track.path
    };

    let metadata = {
        let db = state.db.lock();
        crate::tags::write_track_tags(&db, Path::new(&path), &fields)?
    };

    let track = {
        let db = state.db.lock();
        db.update_track_metadata(
            track_id,
            &metadata.title,
            &metadata.artist,
            &metadata.album,
            metadata.track_number,
        )
        .map_err(|e| e.to_string())?
    };

    {
        let db = state.db.lock();
        crate::tag_index::index_track_tags_from_fields(&db, track_id, &fields)?;
    }

    let _ = app.emit("library-updated", ());
    Ok(track)
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
