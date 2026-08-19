mod audio_scan;
mod commands;
mod db;
mod models;
mod playback;
mod player;
mod scanner;
mod seek_index;
mod tag_index;
mod tags;
mod waveform;

use commands::{
    add_track_to_playlist, add_watch_folder, create_playlist, create_taglist, delete_playlist,
    delete_taglist, get_playback_state, get_playlist_tracks, get_taglist_tracks,
    get_track_peaks, get_track_tags, get_volume, init_state, list_playlists, list_taglist_values,
    list_taglists, list_tracks, list_watch_folders, pause_playback, play_track,
    remove_track_from_playlist, resume_playback, scan_library, seek_playback, set_volume,
    stop_playback, update_track_tags,
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
            list_watch_folders,
            add_watch_folder,
            scan_library,
            create_playlist,
            delete_playlist,
            list_playlists,
            get_playlist_tracks,
            add_track_to_playlist,
            remove_track_from_playlist,
            create_taglist,
            delete_taglist,
            list_taglists,
            list_taglist_values,
            get_taglist_tracks,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
