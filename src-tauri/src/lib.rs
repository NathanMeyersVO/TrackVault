pub mod anonymize;
mod app_settings;
mod application;
mod audio_cache;
mod audio_scan;
mod collections;
mod commands;
mod config;
mod db;
mod delivery;
mod drop_staging;
mod file_hash;
mod project_archive;
mod project_config;
mod projects;
mod models;
mod library_path;
mod library_setup;
mod playback;
mod player;
mod scanner;
mod seek_index;
mod tag_index;
mod tags;
mod title_map;
mod upload;
mod replace_track;
mod replace_upload_log;
mod replace_remote_upload;
mod phone_upload_settings;
mod phone_upload_probe;
mod upload_relay;
mod waveform;

use commands::{
    add_track_to_playlist, check_collection_upload_conflicts, check_upload_conflicts,
    close_library, create_collection, create_playlist, create_taglist, delete_collection,
    delete_collection_track, delete_playlist, delete_taglist, delete_track, export_collection,
    get_app_settings, get_application_settings, get_collection_playback_state, get_collection_tracks,
    apply_staged_delivery, create_project, delete_project, export_project, get_active_project,
    get_library_folder, import_project_archive,
    list_projects, open_project, preview_delivery_with_mode,
    browse_delivery_folder, get_last_delivery_folder,
    restore_active_project_in_background, set_last_delivery_folder, stage_delivery,
    update_project_application,
    get_playback_state, get_playlist_tracks, get_taglist_tracks, get_track, get_track_peaks,
    get_track_tags, get_volume, import_collection, import_taglist_titles, init_state,
    list_collections, list_playlists, list_taglist_values, list_taglists, list_tracks,
    pause_playback, play_track, remove_track_from_playlist, rename_collection, rename_playlist,
    reorder_collection_tracks, reorder_collections, reorder_playlist_tracks, reorder_playlists,
    reorder_taglist_tracks, reorder_taglist_values, resume_playback, load_library_config,
    list_taglist_swap_targets, swap_taglist_entries,
    save_collection_playback_state, save_library_config, seek_playback,
    set_app_settings, set_application_settings, set_collection_continuous_volume, set_collection_playback_mode,
    set_library_folder, set_taglist_value_title, set_volume, stop_playback, update_track_tags, upload_collection_tracks, upload_tracks,
    preview_replace_library_track_file, replace_library_track_file,
    stage_drop_source_path, stage_drop_source_paths, cleanup_drop_staging,
    start_replace_remote_upload, start_library_remote_upload, start_collection_remote_upload,
    stop_replace_remote_upload, get_replace_remote_upload_status,
    get_replace_remote_upload_log_path, get_replace_remote_upload_logs_dir,
    get_phone_upload_settings, set_phone_upload_settings, probe_cloudflared,
    probe_phone_upload_local_port,
    probe_phone_upload_path,
};
use commands::AppState;
use tauri::{Manager, RunEvent, WebviewEvent};
use tauri::DragDropEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let (state, restore_project_id) = init_state(app.handle())?;
            app.manage(state);
            if let Some(project_id) = restore_project_id {
                restore_active_project_in_background(app.handle().clone(), project_id);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tracks,
            get_track,
            get_library_folder,
            set_library_folder,
            list_projects,
            get_active_project,
            create_project,
            open_project,
            update_project_application,
            delete_project,
            export_project,
            import_project_archive,
            browse_delivery_folder,
            get_last_delivery_folder,
            set_last_delivery_folder,
            stage_delivery,
            preview_delivery_with_mode,
            apply_staged_delivery,
            save_library_config,
            load_library_config,
            close_library,
            upload_tracks,
            check_upload_conflicts,
            preview_replace_library_track_file,
            replace_library_track_file,
            stage_drop_source_path,
            stage_drop_source_paths,
            cleanup_drop_staging,
            start_replace_remote_upload,
            start_library_remote_upload,
            start_collection_remote_upload,
            stop_replace_remote_upload,
            get_replace_remote_upload_status,
            get_replace_remote_upload_log_path,
            get_replace_remote_upload_logs_dir,
            get_phone_upload_settings,
            set_phone_upload_settings,
            probe_cloudflared,
            probe_phone_upload_local_port,
            probe_phone_upload_path,
            delete_track,
            create_collection,
            delete_collection,
            list_collections,
            get_collection_tracks,
            reorder_collection_tracks,
            reorder_collections,
            rename_collection,
            upload_collection_tracks,
            check_collection_upload_conflicts,
            delete_collection_track,
            export_collection,
            import_collection,
            set_collection_playback_mode,
            set_collection_continuous_volume,
            get_collection_playback_state,
            save_collection_playback_state,
            create_playlist,
            delete_playlist,
            list_playlists,
            get_playlist_tracks,
            add_track_to_playlist,
            remove_track_from_playlist,
            reorder_playlist_tracks,
            rename_playlist,
            reorder_playlists,
            create_taglist,
            delete_taglist,
            list_taglists,
            list_taglist_values,
            import_taglist_titles,
            set_taglist_value_title,
            get_taglist_tracks,
            reorder_taglist_tracks,
            reorder_taglist_values,
            list_taglist_swap_targets,
            swap_taglist_entries,
            play_track,
            pause_playback,
            resume_playback,
            stop_playback,
            seek_playback,
            get_playback_state,
            get_volume,
            set_volume,
            get_track_peaks,
            get_track_tags,
            update_track_tags,
            get_app_settings,
            set_app_settings,
            get_application_settings,
            set_application_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::WebviewEvent { event, .. } = event {
                if let WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                    let state = app_handle.state::<AppState>();
                    crate::drop_staging::stage_drop_on_drag(
                        &state.app_data_dir,
                        &state.drop_staging_cache,
                        &state.drop_staging_failures,
                        &paths,
                    );
                }
            }
        });
}
