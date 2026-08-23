mod app_settings;
mod application;
mod audio_cache;
mod audio_scan;
mod collections;
mod commands;
mod config;
mod db;
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
mod waveform;

use commands::{
    add_track_to_playlist, check_collection_upload_conflicts, check_upload_conflicts,
    close_library, create_collection, create_playlist, create_taglist, delete_collection,
    delete_collection_track, delete_playlist, delete_taglist, delete_track, export_collection,
    get_app_settings, get_application_settings, get_collection_playback_state, get_collection_tracks, get_library_folder,
    get_playback_state, get_playlist_tracks, get_taglist_tracks, get_track, get_track_peaks,
    get_track_tags, get_volume, import_collection, import_taglist_titles, init_state,
    list_collections, list_playlists, list_taglist_values, list_taglists, list_tracks,
    pause_playback, play_track, remove_track_from_playlist, rename_collection, rename_playlist,
    reorder_collection_tracks, reorder_collections, reorder_playlist_tracks, reorder_playlists,
    reorder_taglist_tracks, reorder_taglist_values, resume_playback, load_library_config,
    save_collection_playback_state, save_library_config, scan_library, seek_playback,
    set_app_settings, set_application_settings, set_collection_continuous_volume, set_collection_playback_mode,
    set_library_folder, set_taglist_value_title, set_volume, stop_playback, update_track_tags, upload_collection_tracks, upload_tracks,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = init_state(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tracks,
            get_track,
            get_library_folder,
            set_library_folder,
            save_library_config,
            load_library_config,
            close_library,
            scan_library,
            upload_tracks,
            check_upload_conflicts,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
