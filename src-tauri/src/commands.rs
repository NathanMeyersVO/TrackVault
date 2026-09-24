use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio_cache::{cached_seek_index, peaks_from_cache, AudioCacheWorker};
use crate::db::Database;
use crate::models::{
    Collection, PlaybackState, Playlist, ScanProgress, Taglist, TaglistSwapTarget, TaglistValue, Track,
    UploadResult,
    WaveformPeaks,
};
use crate::player::AudioPlayer;
use crate::delivery::{
    apply_delivery, append_full_replace_removals, browse_delivery_folder_at, build_preview,
    map_selected_change_ids,
    default_delivery_browse_root, stage_delivery_sources, ApplyDeliveryResult, ApplyMode,
    DeliveryFolderBrowseResult, DeliveryPreview, DeliverySessionStore, StagingSession,
};
use crate::projects::{self, ProjectManifest, ProjectSummary};
use crate::project_config::{autosave_trackvault_json, load_trackvault_json_if_present};
use crate::drop_staging::{DropStagingCache, new_drop_staging_cache};
use crate::replace_remote_upload::ReplaceRemoteUploadManager;
use crate::scanner;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub player: Arc<AudioPlayer>,
    pub app_data_dir: PathBuf,
    pub audio_cache: AudioCacheWorker,
    pub replace_remote_upload: ReplaceRemoteUploadManager,
    pub delivery_sessions: DeliverySessionStore,
    pub drop_staging_cache: DropStagingCache,
}

fn try_autosave_project_config(state: &AppState) {
    let db = state.db.lock();
    if let Ok(Some(path)) = db.get_library_folder() {
        let _ = autosave_trackvault_json(&db, Path::new(&path));
    }
}

fn teardown_library(state: &AppState) -> Result<PlaybackState, String> {
    state.player.stop();
    {
        let db = state.db.lock();
        db.close_library_state().map_err(|e| e.to_string())?;
    }
    state.audio_cache.reset();
    let mut playback = state.player.state();
    playback.track_id = None;
    playback.position_ms = 0;
    playback.duration_ms = 0;
    playback.is_playing = false;
    Ok(playback)
}

#[tauri::command]
pub fn get_track(state: State<'_, AppState>, track_id: i64) -> Result<Track, String> {
    state
        .db
        .lock()
        .get_track(track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Track not found".to_string())
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
    teardown_library(&state)?;
    let library_root = PathBuf::from(&path);
    {
        let db = state.db.lock();
        db.set_library_folder(&path).map_err(|e| e.to_string())?;
    }

    let pending_config = match crate::config::load_config_file(&library_root) {
        Ok(config) => config,
        Err(e) => {
            let _progress = {
                let db = state.db.lock();
                scanner::scan_library_folder(&db, &app)?
            };
            let _ = app.emit("library-updated", ());
            state.audio_cache.kick();
            return Err(format!(
                "Library folder set and scanned, but config could not be loaded: {e}"
            ));
        }
    };

    let progress = {
        let db = state.db.lock();
        scanner::scan_library_folder(&db, &app)?
    };

    if let Some(config) = pending_config {
        let db = state.db.lock();
        crate::config::apply_config(&db, &library_root, &config)?;
    }

    {
        let db = state.db.lock();
        let application = crate::application::get_application(&db)?;
        crate::library_setup::apply_application_library_setup(
            &db,
            &library_root,
            application,
        )?;
    }

    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
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
pub fn load_library_config(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let (library_root, config) = {
        let db = state.db.lock();
        let library = db
            .get_library_folder()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No library folder configured".to_string())?;
        let library_root = PathBuf::from(&library);
        let config_path = crate::config::config_file_path(&library_root);
        let config = crate::config::load_config_file(&library_root)?.ok_or_else(|| {
            format!(
                "No configuration file found at {}",
                config_path.to_string_lossy()
            )
        })?;
        db.clear_user_config().map_err(|e| e.to_string())?;
        (library_root, config)
    };

    {
        let db = state.db.lock();
        crate::config::apply_config(&db, &library_root, &config)?;
    }

    let path = crate::config::config_file_path(&library_root);
    let _ = app.emit("library-updated", ());
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn close_library(app: AppHandle, state: State<'_, AppState>) -> Result<PlaybackState, String> {
    let playback = teardown_library(&state)?;
    let _ = app.emit("library-updated", ());
    Ok(playback)
}

#[tauri::command]
pub fn check_upload_conflicts(
    state: State<'_, AppState>,
    source_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    let db = state.db.lock();
    crate::upload::check_upload_conflicts(&db, &paths)
}

#[tauri::command]
pub fn stage_drop_source_path(
    state: State<'_, AppState>,
    source_path: String,
    force: Option<bool>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    let staged = crate::drop_staging::resolve_staged_path(
        &state.app_data_dir,
        &state.drop_staging_cache,
        Path::new(&source_path),
        force,
    )?;
    Ok(staged.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn stage_drop_source_paths(
    state: State<'_, AppState>,
    source_paths: Vec<String>,
    force: Option<bool>,
) -> Result<Vec<String>, String> {
    let force = force.unwrap_or(false);
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    let staged = crate::drop_staging::resolve_paths(
        &state.app_data_dir,
        &state.drop_staging_cache,
        &paths,
        force,
    )?;
    Ok(staged
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn cleanup_drop_staging(state: State<'_, AppState>) -> Result<(), String> {
    crate::drop_staging::cleanup_drop_staging(&state.app_data_dir, &state.drop_staging_cache)
}

#[tauri::command]
pub fn upload_tracks(
    app: AppHandle,
    state: State<'_, AppState>,
    source_paths: Vec<String>,
    overwrite: Option<bool>,
) -> Result<UploadResult, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    let paths = crate::drop_staging::resolve_paths(
        &state.app_data_dir,
        &state.drop_staging_cache,
        &paths,
        false,
    )?;
    let overwrite = overwrite.unwrap_or(false);
    let result = {
        let db = state.db.lock();
        crate::upload::upload_tracks(&db, &paths, overwrite)?
    };
    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(result)
}

#[tauri::command]
pub fn preview_replace_library_track_file(
    state: State<'_, AppState>,
    track_id: i64,
    source_path: String,
) -> Result<crate::replace_track::ReplaceTrackFilePreview, String> {
    let db = state.db.lock();
    crate::replace_track::preview_replace_library_track_file(
        &db,
        track_id,
        Path::new(&source_path),
    )
}

#[tauri::command]
pub fn replace_library_track_file(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
    source_path: String,
) -> Result<Track, String> {
    if state.player.state().track_id == Some(track_id) {
        state.player.stop();
    }

    let track = {
        let db = state.db.lock();
        crate::replace_track::replace_library_track_file(
            &db,
            track_id,
            Path::new(&source_path),
        )?
    };

    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(track)
}

#[tauri::command]
pub fn start_replace_remote_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<crate::replace_remote_upload::ReplaceRemoteUploadStartInfo, String> {
    state.replace_remote_upload.start(
        app,
        Arc::clone(&state.db),
        &state.app_data_dir,
        track_id,
    )
}

#[tauri::command]
pub fn start_library_remote_upload(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<crate::replace_remote_upload::ReplaceRemoteUploadStartInfo, String> {
    state.replace_remote_upload.start_library_import(
        app,
        Arc::clone(&state.db),
        &state.app_data_dir,
    )
}

#[tauri::command]
pub fn start_collection_remote_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<crate::replace_remote_upload::ReplaceRemoteUploadStartInfo, String> {
    state.replace_remote_upload.start_collection_import(
        app,
        Arc::clone(&state.db),
        &state.app_data_dir,
        collection_id,
    )
}

#[tauri::command]
pub fn stop_replace_remote_upload(state: State<'_, AppState>) -> Result<(), String> {
    state
        .replace_remote_upload
        .stop(&state.app_data_dir);
    Ok(())
}

#[tauri::command]
pub fn get_replace_remote_upload_status(
    state: State<'_, AppState>,
) -> Result<crate::replace_remote_upload::ReplaceRemoteUploadStatus, String> {
    Ok(state.replace_remote_upload.status())
}

#[tauri::command]
pub fn get_replace_remote_upload_log_path(
    state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(crate::replace_remote_upload::ReplaceRemoteUploadManager::log_file_path(
        &state.app_data_dir,
    ))
}

#[tauri::command]
pub fn get_replace_remote_upload_logs_dir(
    state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(
        crate::replace_remote_upload::ReplaceRemoteUploadManager::logs_dir_path(
            &state.app_data_dir,
        )
        .to_string_lossy()
        .into_owned(),
    )
}

#[tauri::command]
pub fn get_phone_upload_settings(
    state: State<'_, AppState>,
) -> Result<crate::phone_upload_settings::PhoneUploadSettingsResponse, String> {
    let db = state.db.lock();
    crate::phone_upload_settings::get_phone_upload_settings(&db, &state.app_data_dir)
}

#[tauri::command]
pub fn set_phone_upload_settings(
    state: State<'_, AppState>,
    settings: crate::phone_upload_settings::PhoneUploadSettings,
    tunnel_token: Option<String>,
) -> Result<crate::phone_upload_settings::PhoneUploadSettingsResponse, String> {
    let db = state.db.lock();
    crate::phone_upload_settings::set_phone_upload_settings(
        &db,
        &state.app_data_dir,
        settings,
        tunnel_token,
    )
}

#[tauri::command]
pub fn probe_cloudflared() -> Result<String, String> {
    crate::upload_relay::probe_cloudflared()
}

#[tauri::command]
pub fn probe_phone_upload_local_port(port: u16) -> Result<(), String> {
    crate::phone_upload_settings::probe_local_port(port)
}

#[tauri::command]
pub fn probe_phone_upload_path(
    state: State<'_, AppState>,
    settings: crate::phone_upload_settings::PhoneUploadSettings,
    tunnel_token: Option<String>,
) -> Result<String, String> {
    if state.replace_remote_upload.is_session_active() {
        return Err(
            "Stop the current phone upload session before testing the tunnel path.".to_string(),
        );
    }
    let config = crate::phone_upload_settings::tunnel_config_for_probe(
        &settings,
        &state.app_data_dir,
        tunnel_token,
    )?;
    crate::phone_upload_probe::run_path_probe(config)
}

#[tauri::command]
pub fn delete_track(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<PlaybackState, String> {
    let path = {
        let db = state.db.lock();
        let path = db
            .get_track_path(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        if !db.is_library_track(track_id).map_err(|e| e.to_string())? {
            return Err("Use delete collection track for collection tracks".to_string());
        }
        crate::library_path::ensure_under_library_folder(&db, Path::new(&path))?;
        if state.player.state().track_id == Some(track_id) {
            state.player.stop();
        }
        db.delete_track(track_id).map_err(|e| e.to_string())?
    };

    if let Err(error) = std::fs::remove_file(&path) {
        return Err(format!(
            "Track removed from library, but file could not be deleted: {error}"
        ));
    }

    let mut playback = state.player.state();
    if playback.track_id == Some(track_id) {
        playback.track_id = None;
        playback.position_ms = 0;
        playback.duration_ms = 0;
        playback.is_playing = false;
    }

    let _ = app.emit("library-updated", ());
    Ok(playback)
}

#[tauri::command]
pub fn create_playlist(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    let id = state
        .db
        .lock()
        .create_playlist(&name)
        .map_err(|e| e.to_string())?;
    try_autosave_project_config(&state);
    Ok(id)
}

#[tauri::command]
pub fn delete_playlist(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state
        .db
        .lock()
        .delete_playlist(id)
        .map_err(|e| e.to_string())?;
    try_autosave_project_config(&state);
    Ok(())
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
    let db = state.db.lock();
    if !db.is_library_track(track_id).map_err(|e| e.to_string())? {
        return Err("Collection tracks cannot be added to playlists".to_string());
    }
    db.add_track_to_playlist(playlist_id, track_id)
        .map_err(|e| e.to_string())?;
    drop(db);
    try_autosave_project_config(&state);
    Ok(())
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
        .map_err(|e| e.to_string())?;
    try_autosave_project_config(&state);
    Ok(())
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
        .map_err(|e| e.to_string())?;
    try_autosave_project_config(&state);
    Ok(())
}

#[tauri::command]
pub fn rename_playlist(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    state
        .db
        .lock()
        .rename_playlist(id, name)
        .map_err(|e| e.to_string())?;
    try_autosave_project_config(&state);
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn reorder_playlists(
    app: AppHandle,
    state: State<'_, AppState>,
    playlist_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .reorder_playlists(&playlist_ids)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn create_taglist(
    state: State<'_, AppState>,
    name: String,
    tag_key: String,
    entry_tag_key: String,
    value_singular_name: String,
) -> Result<i64, String> {
    let tag_key = tag_key.trim();
    let entry_tag_key = entry_tag_key.trim();
    if tag_key.is_empty() || entry_tag_key.is_empty() {
        return Err("Partition tag and entry tag are required".to_string());
    }
    if tag_key.eq_ignore_ascii_case(entry_tag_key) {
        return Err("Partition tag and entry tag must differ".to_string());
    }
    state
        .db
        .lock()
        .create_taglist(
            name.trim(),
            tag_key,
            entry_tag_key,
            value_singular_name.trim(),
        )
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
    let application = {
        let db = state.db.lock();
        if db.get_taglist(taglist_id).map_err(|e| e.to_string())?.is_none() {
            return Err("Taglist not found".to_string());
        }
        crate::application::get_application(&db)?
    };

    let mappings =
        crate::application::parse_title_map_for_application(application, Path::new(&path))?;
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
pub fn reorder_taglist_values(
    app: AppHandle,
    state: State<'_, AppState>,
    taglist_id: i64,
    tag_values: Vec<String>,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        if db.get_taglist(taglist_id).map_err(|e| e.to_string())?.is_none() {
            return Err("Taglist not found".to_string());
        }
        db.reorder_taglist_values(taglist_id, &tag_values)
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("library-updated", ());
    Ok(())
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

fn write_partition_tag_for_track(
    db: &Database,
    track_id: i64,
    path: &Path,
    partition_key: &str,
    partition_value: &str,
) -> Result<Track, String> {
    let metadata = crate::tags::write_track_tags(
        db,
        path,
        &[crate::tags::TagFieldInput {
            key: partition_key.to_string(),
            value: partition_value.to_string(),
        }],
    )?;
    let track = db
        .update_track_metadata(
            track_id,
            &metadata.title,
            &metadata.artist,
            &metadata.album,
            metadata.track_number,
        )
        .map_err(|e| e.to_string())?;
    crate::tag_index::index_track_tags(db, track_id, path)?;
    db.sync_taglist_order_for_track(track_id)
        .map_err(|e| e.to_string())?;
    Ok(track)
}

#[tauri::command]
pub fn list_taglist_swap_targets(
    state: State<'_, AppState>,
    taglist_id: i64,
    source_value: Option<String>,
    source_track_id: i64,
) -> Result<Vec<TaglistSwapTarget>, String> {
    let db = state.db.lock();
    crate::tag_index::backfill_unindexed_tracks(&db)?;
    db.list_taglist_swap_targets(taglist_id, source_value.as_deref(), source_track_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn swap_taglist_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    taglist_id: i64,
    source_value: Option<String>,
    target_value: Option<String>,
    source_track_id: i64,
) -> Result<Vec<Track>, String> {
    let (
        partition_key,
        source_path,
        partner_id,
        partner_path,
        partition_a,
        partition_b,
        source_order,
        target_order,
    ) = {
        let db = state.db.lock();
        crate::tag_index::backfill_unindexed_tracks(&db)?;
        let taglist = db
            .get_taglist(taglist_id)
            .map_err(|e| e.to_string())?
            .ok_or("Taglist not found")?;
        if taglist.entry_tag_key.trim().is_empty() {
            return Err("Taglist has no entry tag configured".to_string());
        }

        let partner_id = db
            .resolve_taglist_swap_partner(
                taglist_id,
                source_value.as_deref(),
                target_value.as_deref(),
                source_track_id,
            )
            .map_err(|e| e.to_string())?;

        let partition_a = db
            .require_single_tag_value(source_track_id, &taglist.tag_key)
            .map_err(|e| e.to_string())?;
        let partition_b = db
            .require_single_tag_value(partner_id, &taglist.tag_key)
            .map_err(|e| e.to_string())?;

        let source_track = db
            .get_track(source_track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Source track not found")?;
        let partner_track = db
            .get_track(partner_id)
            .map_err(|e| e.to_string())?
            .ok_or("Partner track not found")?;

        let source_tracks = db
            .list_taglist_tracks(
                taglist_id,
                &taglist.tag_key,
                source_value.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        let target_tracks = db
            .list_taglist_tracks(
                taglist_id,
                &taglist.tag_key,
                target_value.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        let source_order: Vec<i64> = source_tracks.iter().map(|t| t.id).collect();
        let target_order: Vec<i64> = target_tracks.iter().map(|t| t.id).collect();

        (
            taglist.tag_key,
            source_track.path,
            partner_id,
            partner_track.path,
            partition_a,
            partition_b,
            source_order,
            target_order,
        )
    };

    let track_a = {
        let db = state.db.lock();
        write_partition_tag_for_track(
            &db,
            source_track_id,
            Path::new(&source_path),
            &partition_key,
            &partition_b,
        )?
    };

    let track_b = match write_partition_tag_for_track(
        &state.db.lock(),
        partner_id,
        Path::new(&partner_path),
        &partition_key,
        &partition_a,
    ) {
        Ok(track) => track,
        Err(err) => {
            let _ = write_partition_tag_for_track(
                &state.db.lock(),
                source_track_id,
                Path::new(&source_path),
                &partition_key,
                &partition_a,
            );
            return Err(err);
        }
    };

    {
        let db = state.db.lock();
        db.apply_taglist_swap_order_slots(
            taglist_id,
            source_value.as_deref(),
            target_value.as_deref(),
            source_track_id,
            partner_id,
            &source_order,
            &target_order,
        )
        .map_err(|e| e.to_string())?;
    }

    let _ = app.emit("library-updated", ());
    Ok(vec![track_a, track_b])
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

    let (path, duration_ms, seek_index, needs_cache) = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        let (seek_index, needs_cache) =
            cached_seek_index(&db, track_id, track.duration_ms as u64)?;
        (track.path, track.duration_ms as u64, seek_index, needs_cache)
    };

    if needs_cache {
        state.audio_cache.prioritize(track_id);
    }

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
    Ok(state.player.state())
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
    let (peaks, needs_cache) = {
        let db = state.db.lock();
        let track = db
            .get_track(track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track not found")?;
        let json = db.get_peaks(track_id).map_err(|e| e.to_string())?;
        let peaks = peaks_from_cache(json.as_deref(), track.duration_ms);
        let needs_cache = peaks.peaks.is_empty();
        (peaks, needs_cache)
    };
    if needs_cache {
        state.audio_cache.prioritize(track_id);
    }
    Ok(peaks)
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
        crate::tag_index::index_track_tags(&db, track_id, Path::new(&path))?;
        db.sync_taglist_order_for_track(track_id)
            .map_err(|e| e.to_string())?;
    }

    let _ = app.emit("library-updated", ());
    Ok(track)
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<crate::app_settings::ThemeSettings, String> {
    let db = state.db.lock();
    crate::app_settings::get_theme(&db)
}

#[tauri::command]
pub fn set_app_settings(
    state: State<'_, AppState>,
    settings: crate::app_settings::ThemeSettings,
) -> Result<crate::app_settings::ThemeSettings, String> {
    let db = state.db.lock();
    crate::app_settings::set_theme(&db, settings)
}

#[tauri::command]
pub fn get_application_settings(
    state: State<'_, AppState>,
) -> Result<crate::application::ApplicationSettings, String> {
    let db = state.db.lock();
    crate::application::get_application_settings(&db)
}

#[tauri::command]
pub fn set_application_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: crate::application::ApplicationSettings,
) -> Result<crate::application::ApplicationSettings, String> {
    let normalized = {
        let db = state.db.lock();
        crate::application::set_application(&db, settings)?
    };

    if let Some(library_root) = {
        let db = state.db.lock();
        db.get_library_folder().map_err(|e| e.to_string())?
    } {
        let application = crate::application::normalize_application_id(&normalized.application_id);
        let db = state.db.lock();
        crate::library_setup::apply_application_library_setup(
            &db,
            Path::new(&library_root),
            application,
        )?;
    }

    let _ = app.emit("library-updated", ());
    Ok(normalized)
}

#[tauri::command]
pub fn create_collection(state: State<'_, AppState>, name: String) -> Result<i64, String> {
    state
        .db
        .lock()
        .create_collection(name.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    {
        let db = state.db.lock();
        crate::collections::delete_collection_with_files(&db, &state.app_data_dir, id)?;
    }
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    state
        .db
        .lock()
        .list_collections()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_collection_tracks(
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<Vec<Track>, String> {
    state
        .db
        .lock()
        .list_collection_tracks(collection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_collection_tracks(
    state: State<'_, AppState>,
    collection_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .reorder_collection_tracks(collection_id, &track_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_collections(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_ids: Vec<i64>,
) -> Result<(), String> {
    state
        .db
        .lock()
        .reorder_collections(&collection_ids)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn rename_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    {
        let db = state.db.lock();
        if db.get_collection(id).map_err(|e| e.to_string())?.is_none() {
            return Err("Collection not found".to_string());
        }
        if db
            .collection_name_taken_by_other(id, name)
            .map_err(|e| e.to_string())?
        {
            return Err("A collection with that name already exists".to_string());
        }
        db.rename_collection(id, name)
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("library-updated", ());
    Ok(())
}

#[tauri::command]
pub fn check_collection_upload_conflicts(
    state: State<'_, AppState>,
    collection_id: i64,
    source_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    crate::collections::check_collection_upload_conflicts(
        &state.app_data_dir,
        collection_id,
        &paths,
    )
}

#[tauri::command]
pub fn upload_collection_tracks(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_id: i64,
    source_paths: Vec<String>,
    overwrite: Option<bool>,
) -> Result<UploadResult, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    let paths = crate::drop_staging::resolve_paths(
        &state.app_data_dir,
        &state.drop_staging_cache,
        &paths,
        false,
    )?;
    let overwrite = overwrite.unwrap_or(false);
    let result = {
        let db = state.db.lock();
        crate::collections::upload_to_collection(
            &db,
            &state.app_data_dir,
            collection_id,
            &paths,
            overwrite,
        )?
    };
    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(result)
}

#[tauri::command]
pub fn delete_collection_track(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<PlaybackState, String> {
    let path = {
        let db = state.db.lock();
        if state.player.state().track_id == Some(track_id) {
            state.player.stop();
        }
        crate::collections::delete_collection_track(&db, track_id)?
    };

    if let Err(error) = std::fs::remove_file(&path) {
        return Err(format!(
            "Track removed from collection, but file could not be deleted: {error}"
        ));
    }

    let mut playback = state.player.state();
    if playback.track_id == Some(track_id) {
        playback.track_id = None;
        playback.position_ms = 0;
        playback.duration_ms = 0;
        playback.is_playing = false;
    }

    let _ = app.emit("library-updated", ());
    Ok(playback)
}

#[tauri::command]
pub fn export_collection(
    state: State<'_, AppState>,
    collection_id: i64,
    destination: String,
) -> Result<(), String> {
    let db = state.db.lock();
    crate::collections::export_collection(
        &db,
        &state.app_data_dir,
        collection_id,
        Path::new(&destination),
    )
}

#[tauri::command]
pub fn import_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
) -> Result<i64, String> {
    let collection_id = {
        let db = state.db.lock();
        crate::collections::import_collection(&db, &state.app_data_dir, Path::new(&source))?
    };
    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(collection_id)
}

#[tauri::command]
pub fn set_collection_playback_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_id: i64,
    playback_mode: String,
) -> Result<Collection, String> {
    let collection = {
        let db = state.db.lock();
        db.set_collection_playback_mode(
            collection_id,
            crate::db::normalize_collection_playback_mode(&playback_mode),
        )
        .map_err(|e| e.to_string())?;
        db.get_collection(collection_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Collection not found".to_string())?
    };
    let _ = app.emit("library-updated", ());
    Ok(collection)
}

#[tauri::command]
pub fn set_collection_continuous_volume(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_id: i64,
    continuous_volume: f64,
) -> Result<Collection, String> {
    let collection = {
        let db = state.db.lock();
        db.set_collection_continuous_volume(
            collection_id,
            crate::db::clamp_continuous_volume(continuous_volume),
        )
        .map_err(|e| e.to_string())?;
        db.get_collection(collection_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Collection not found".to_string())?
    };
    let _ = app.emit("library-updated", ());
    Ok(collection)
}

#[tauri::command]
pub fn get_collection_playback_state(
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<crate::models::CollectionPlaybackState, String> {
    state
        .db
        .lock()
        .get_collection_playback_state(collection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_collection_playback_state(
    state: State<'_, AppState>,
    collection_id: i64,
    track_id: Option<i64>,
    position_ms: i64,
) -> Result<(), String> {
    state
        .db
        .lock()
        .save_collection_playback_state(collection_id, track_id, position_ms)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    projects::list_projects(&state.app_data_dir)
}

#[tauri::command]
pub fn get_active_project(state: State<'_, AppState>) -> Result<Option<ProjectSummary>, String> {
    let project_id = {
        let db = state.db.lock();
        projects::get_active_project_id(&db)?
    };
    let Some(project_id) = project_id else {
        return Ok(None);
    };
    let list = projects::list_projects(&state.app_data_dir)?;
    if let Some(summary) = list.iter().find(|p| p.id == project_id) {
        return Ok(Some(summary.clone()));
    }
    projects::clear_active_project_id(&state.db.lock())?;
    Ok(None)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    name: String,
    application_id: String,
) -> Result<ProjectSummary, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let manifest = ProjectManifest::new(id.clone(), name.to_string(), application_id);
    projects::create_project_dirs(&state.app_data_dir, &manifest)?;
    Ok(ProjectSummary {
        id,
        name: manifest.name,
        created_at: manifest.created_at,
        application_id: manifest.application_id,
        track_count: 0,
        last_modified: manifest.created_at,
    })
}

#[tauri::command]
pub fn open_project(app: AppHandle, state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    open_project_internal(&app, &state, &project_id)
}

#[tauri::command]
pub fn export_project(
    state: State<'_, AppState>,
    project_id: String,
    destination: String,
) -> Result<(), String> {
    let is_active = {
        let db = state.db.lock();
        projects::get_active_project_id(&db)?
            .is_some_and(|active_id| active_id == project_id)
    };
    if is_active {
        try_autosave_project_config(&state);
    }
    crate::project_archive::export_project(
        &state.app_data_dir,
        &project_id,
        Path::new(&destination),
    )
}

#[tauri::command]
pub fn import_project_archive(
    state: State<'_, AppState>,
    source: String,
) -> Result<ProjectSummary, String> {
    crate::project_archive::import_project(&state.app_data_dir, Path::new(&source))
}

#[tauri::command]
pub fn update_project_application(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    application_id: String,
) -> Result<ProjectSummary, String> {
    let project_root = projects::project_dir(&state.app_data_dir, &project_id);
    if !project_root.is_dir() {
        return Err("Project not found".to_string());
    }
    let normalized = crate::application::normalize_application_id(&application_id);
    let mut manifest = projects::load_manifest(&project_root)?;
    manifest.application_id = normalized.as_str().to_string();
    projects::save_manifest(&project_root, &manifest)?;

    let is_active = {
        let db = state.db.lock();
        projects::get_active_project_id(&db)?
            .is_some_and(|active_id| active_id == project_id)
    };

    if is_active {
        reapply_project_application(&app, &state, &project_root, &manifest)?;
    }

    projects::list_projects(&state.app_data_dir)?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())
}

fn reapply_project_application(
    app: &AppHandle,
    state: &AppState,
    project_root: &Path,
    manifest: &ProjectManifest,
) -> Result<(), String> {
    let library_root = projects::library_dir(project_root);
    {
        let db = state.db.lock();
        let app_settings = crate::application::ApplicationSettings {
            application_id: manifest.application_id.clone(),
        };
        crate::application::set_application(&db, app_settings)?;
        let application = crate::application::normalize_application_id(&manifest.application_id);
        let schedule = projects::schedule_path(project_root, manifest);
        let schedule_ref = if schedule.is_file() {
            Some(schedule.as_path())
        } else {
            None
        };
        crate::library_setup::apply_application_library_setup_with_schedule(
            &db,
            &library_root,
            application,
            schedule_ref,
        )?;
        autosave_trackvault_json(&db, &library_root)?;
    }
    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(())
}

#[tauri::command]
pub fn delete_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<PlaybackState, String> {
    let mut playback = state.player.state();
    {
        let db = state.db.lock();
        if projects::get_active_project_id(&db)? == Some(project_id.clone()) {
            drop(db);
            playback = teardown_library(&state)?;
            projects::clear_active_project_id(&state.db.lock())?;
        }
    }
    projects::delete_project_dir(&state.app_data_dir, &project_id)?;
    let _ = app.emit("library-updated", ());
    Ok(playback)
}

#[tauri::command]
pub fn browse_delivery_folder(
    state: State<'_, AppState>,
    current: Option<String>,
) -> Result<DeliveryFolderBrowseResult, String> {
    let path = if let Some(current) = current.filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(current.trim());
        if !p.is_dir() {
            return Err(format!("Not a directory: {}", p.display()));
        }
        p
    } else if let Some(last) = crate::app_settings::get_last_delivery_folder(&state.db.lock()) {
        last
    } else {
        default_delivery_browse_root()
    };
    browse_delivery_folder_at(&path)
}

#[tauri::command]
pub fn get_last_delivery_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(crate::app_settings::get_last_delivery_folder(&state.db.lock())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn set_last_delivery_folder(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Path is required".to_string());
    }
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err(format!("Not a directory: {}", p.display()));
    }
    crate::app_settings::set_last_delivery_folder(&state.db.lock(), &p)
}

fn existing_library_schedule_path(app_data: &Path, project_id: &str) -> Option<PathBuf> {
    let project_root = projects::project_dir(app_data, project_id);
    let manifest = projects::load_manifest(&project_root).ok()?;
    let path = projects::schedule_path(&project_root, &manifest);
    path.is_file().then_some(path)
}

fn session_delivery_application(
    app_data: &Path,
    session: &StagingSession,
) -> Result<crate::application::ApplicationId, String> {
    crate::application::resolve_delivery_application(
        app_data,
        session.target_project_id.as_deref(),
        Some(session.application_id.as_str()),
    )
}

#[tauri::command]
pub fn stage_delivery(
    state: State<'_, AppState>,
    source_paths: Vec<String>,
    project_id: Option<String>,
    application_id: Option<String>,
) -> Result<DeliveryPreview, String> {
    if source_paths.is_empty() {
        return Err("Select a delivery folder".to_string());
    }
    if source_paths.len() == 1 {
        let p = PathBuf::from(&source_paths[0]);
        if p.is_dir() {
            let _ = crate::app_settings::set_last_delivery_folder(&state.db.lock(), &p);
        }
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let staging_root = stage_delivery_sources(
        state.delivery_sessions.sessions_dir(),
        &session_id,
        &source_paths,
    )?;

    let delivery_application = crate::application::resolve_delivery_application(
        &state.app_data_dir,
        project_id.as_deref(),
        application_id.as_deref(),
    )?;
    let stored_application_id = delivery_application.as_str().to_string();

    let preview = if let Some(ref pid) = project_id {
        let library = projects::library_dir(&projects::project_dir(&state.app_data_dir, pid));
        let existing_schedule = existing_library_schedule_path(&state.app_data_dir, pid);
        build_preview(
            &session_id,
            &staging_root,
            &library,
            true,
            existing_schedule.as_deref(),
            delivery_application,
        )?
    } else {
        let empty = state.app_data_dir.join("_empty_preview");
        std::fs::create_dir_all(&empty).ok();
        build_preview(
            &session_id,
            &staging_root,
            &empty,
            false,
            None,
            delivery_application,
        )?
    };

    if preview.staged_audio_count == 0 {
        return Err(
            "No audio files found in the delivery folder. Put audio archives (.zip, .tar, .tar.gz, .tgz) \
             or loose audio in the folder. Audio extensions: mp3, flac, wav, m4a, aac, ogg, aiff, mp4."
                .to_string(),
        );
    }

    state.delivery_sessions.insert(StagingSession {
        id: session_id.clone(),
        staging_root: staging_root.clone(),
        target_project_id: project_id.clone(),
        application_id: stored_application_id,
        preview: preview.clone(),
        created: std::time::Instant::now(),
    });

    Ok(preview)
}

#[tauri::command]
pub fn preview_delivery_with_mode(
    state: State<'_, AppState>,
    staging_session_id: String,
    apply_mode: String,
) -> Result<DeliveryPreview, String> {
    let session = state
        .delivery_sessions
        .get(&staging_session_id)
        .ok_or_else(|| "Staging session expired".to_string())?;
    let library = if let Some(ref pid) = session.target_project_id {
        projects::library_dir(&projects::project_dir(&state.app_data_dir, pid))
    } else {
        state.app_data_dir.join("_empty_preview")
    };
    let for_update = session.target_project_id.is_some();
    let existing_schedule = session
        .target_project_id
        .as_ref()
        .and_then(|pid| existing_library_schedule_path(&state.app_data_dir, pid));
    let delivery_application = session_delivery_application(&state.app_data_dir, &session)?;
    let mut preview = build_preview(
        &staging_session_id,
        &session.staging_root,
        &library,
        for_update,
        existing_schedule.as_deref(),
        delivery_application,
    )?;
    if apply_mode == "full_replace" && for_update {
        append_full_replace_removals(&mut preview, &session.staging_root, &library)?;
    }
    state
        .delivery_sessions
        .update_preview(&staging_session_id, preview.clone())?;
    Ok(preview)
}

#[tauri::command]
pub fn apply_staged_delivery(
    app: AppHandle,
    state: State<'_, AppState>,
    staging_session_id: String,
    change_ids: Vec<String>,
    apply_mode: String,
    new_project_name: Option<String>,
    application_id: Option<String>,
) -> Result<ApplyDeliveryResult, String> {
    let session = state
        .delivery_sessions
        .get(&staging_session_id)
        .ok_or_else(|| "Staging session expired".to_string())?;

    let mode = if apply_mode == "full_replace" {
        ApplyMode::FullReplace
    } else {
        ApplyMode::Merge
    };

    let for_update = session.target_project_id.is_some();
    let project_id = if let Some(pid) = session.target_project_id.clone() {
        pid
    } else {
        let name = new_project_name
            .filter(|n| !n.trim().is_empty())
            .ok_or_else(|| "Project name is required".to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let app_id = application_id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "none".to_string());
        let manifest = ProjectManifest::new(id.clone(), name.trim().to_string(), app_id);
        projects::create_project_dirs(&state.app_data_dir, &manifest)?;
        id
    };

    let project_root = projects::project_dir(&state.app_data_dir, &project_id);
    let library_root = projects::library_dir(&project_root);

    let session_preview = session.preview.clone();
    let existing_schedule = if for_update {
        existing_library_schedule_path(&state.app_data_dir, &project_id)
    } else {
        None
    };
    let delivery_application = {
        let manifest = projects::load_manifest(&project_root)?;
        crate::application::normalize_application_id(&manifest.application_id)
    };
    let mut preview = build_preview(
        &staging_session_id,
        &session.staging_root,
        &library_root,
        for_update,
        existing_schedule.as_deref(),
        delivery_application,
    )?;
    if matches!(mode, ApplyMode::FullReplace) && for_update {
        append_full_replace_removals(&mut preview, &session.staging_root, &library_root)?;
    }

    let mut selected = map_selected_change_ids(&change_ids, &session_preview, &preview);

    if matches!(mode, ApplyMode::FullReplace) && for_update {
        let had_removals_in_session = session_preview.changes.iter().any(|c| {
            matches!(c.kind, crate::delivery::DeliveryChangeKind::AudioRemove)
        });
        if !had_removals_in_session {
            for change in &preview.changes {
                if matches!(change.kind, crate::delivery::DeliveryChangeKind::AudioRemove) {
                    selected.insert(change.change_id.clone());
                }
            }
        }
    }

    let matching: Vec<_> = preview
        .changes
        .iter()
        .filter(|c| selected.contains(&c.change_id))
        .collect();
    if matching.is_empty() {
        return Err("No matching changes to apply".to_string());
    }

    let selected_audio = matching.iter().any(|c| {
        matches!(
            c.kind,
            crate::delivery::DeliveryChangeKind::AudioAdd
                | crate::delivery::DeliveryChangeKind::AudioUpdate
                | crate::delivery::DeliveryChangeKind::AudioReplace
                | crate::delivery::DeliveryChangeKind::AudioMove
                | crate::delivery::DeliveryChangeKind::AudioRemove
        )
    });

    let mut manifest = projects::load_manifest(&project_root)?;

    let result = {
        let db = state.db.lock();
        apply_delivery(
            &db,
            &project_root,
            &mut manifest,
            &session.staging_root,
            &preview.changes,
            &selected,
            mode,
            delivery_application,
        )?
    };

    if selected_audio && result.applied == 0 {
        return Err(
            "No audio changes were applied. Try staging the delivery again.".to_string(),
        );
    }

    open_project_internal(&app, &state, &project_id)?;

    {
        let db = state.db.lock();
        scanner::scan_library_folder(&db, &app)?;
    }

    state.delivery_sessions.remove(&staging_session_id);
    try_autosave_project_config(&state);
    let _ = app.emit("library-updated", ());
    state.audio_cache.kick();
    Ok(result)
}

fn open_project_internal(app: &AppHandle, state: &AppState, project_id: &str) -> Result<(), String> {
    let project_root = projects::project_dir(&state.app_data_dir, project_id);
    if !project_root.is_dir() {
        return Err("Project not found".to_string());
    }
    let manifest = projects::load_manifest(&project_root)?;
    let library_root = projects::library_dir(&project_root);
    std::fs::create_dir_all(&library_root).map_err(|e| e.to_string())?;
    let library_str = library_root.to_string_lossy().to_string();

    teardown_library(state)?;

    {
        let db = state.db.lock();
        db.set_library_folder(&library_str).map_err(|e| e.to_string())?;
        let app_settings = crate::application::ApplicationSettings {
            application_id: manifest.application_id.clone(),
        };
        crate::application::set_application(&db, app_settings)?;
        projects::set_active_project_id(&db, project_id)?;
    }

    scanner::scan_library_folder(&state.db.lock(), app)?;

    {
        let db = state.db.lock();
        let _ = load_trackvault_json_if_present(&db, &library_root);
    }

    reapply_project_application(app, state, &project_root, &manifest)?;
    Ok(())
}

pub fn init_state(app: &AppHandle) -> Result<(AppState, Option<String>), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join("trackvault.db");
    let db = Arc::new(Mutex::new(Database::open(&db_path).map_err(|e| e.to_string())?));
    let player = Arc::new(AudioPlayer::new()?);
    player.start_position_emitter(app.clone());
    let audio_cache = AudioCacheWorker::start(app.clone(), Arc::clone(&db), Arc::clone(&player));
    let delivery_sessions = DeliverySessionStore::new(&data_dir);

    let restore_project_id = projects::get_active_project_id(&db.lock()).ok().flatten();

    let state = AppState {
        db,
        player,
        app_data_dir: data_dir,
        audio_cache,
        replace_remote_upload: ReplaceRemoteUploadManager::new(),
        delivery_sessions,
        drop_staging_cache: new_drop_staging_cache(),
    };

    Ok((state, restore_project_id))
}

pub fn restore_active_project_in_background(app: AppHandle, project_id: String) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        if let Err(e) = open_project_internal(&app, &state, &project_id) {
            eprintln!("Failed to restore active project on startup: {e}");
        }
    });
}
