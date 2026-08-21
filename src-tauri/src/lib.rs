mod app_settings;
mod audio_scan;
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
    add_track_to_playlist, check_upload_conflicts, create_playlist, create_taglist, delete_playlist,
    delete_taglist, delete_track, get_app_settings, get_library_folder, get_playback_state, get_playlist_tracks, get_taglist_tracks,
    get_track_peaks, get_track_tags, get_volume, import_taglist_titles, init_state,
    list_playlists, list_taglist_values, list_taglists, list_tracks, pause_playback, play_track,
    remove_track_from_playlist, reorder_playlist_tracks, reorder_taglist_tracks,
    reorder_taglist_values, resume_playback,
    load_library_config, reset_library, save_library_config, scan_library, seek_playback, set_app_settings, set_library_folder,
    set_taglist_value_title, set_volume, stop_playback, update_track_tags, upload_tracks,
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
            get_library_folder,
            set_library_folder,
            save_library_config,
            load_library_config,
            reset_library,
            scan_library,
            upload_tracks,
            check_upload_conflicts,
            delete_track,
            create_playlist,
            delete_playlist,
            list_playlists,
            get_playlist_tracks,
            add_track_to_playlist,
            remove_track_from_playlist,
            reorder_playlist_tracks,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
