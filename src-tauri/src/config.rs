use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const CONFIG_VERSION: u32 = 1;
pub const CONFIG_FILENAME: &str = "trackvault.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryConfig {
    pub version: u32,
    pub playlists: Vec<ConfigPlaylist>,
    pub taglists: Vec<ConfigTaglist>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigPlaylist {
    pub name: String,
    pub tracks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConfigTaglist {
    pub name: String,
    pub tag_key: String,
    #[serde(default)]
    pub entry_tag_key: String,
    #[serde(default)]
    pub value_singular_name: String,
    #[serde(default)]
    pub value_titles: HashMap<String, String>,
    #[serde(default)]
    pub track_order: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub value_order: Vec<String>,
}

pub fn config_file_path(library_root: &Path) -> PathBuf {
    library_root.join(CONFIG_FILENAME)
}

pub fn relative_path(library_root: &Path, absolute: &Path) -> Option<String> {
    if let Some(rel) = strip_path_prefix(library_root, absolute) {
        return Some(rel);
    }

    let root = library_root
        .canonicalize()
        .unwrap_or_else(|_| library_root.to_path_buf());
    let abs = absolute
        .canonicalize()
        .unwrap_or_else(|_| absolute.to_path_buf());
    strip_path_prefix(&root, &abs)
}

fn strip_path_prefix(root: &Path, absolute: &Path) -> Option<String> {
    let root = normalize_path_key(root);
    let abs = normalize_path_key(absolute);
    if abs.len() < root.len() {
        return None;
    }
    if !abs[..root.len()].eq_ignore_ascii_case(&root) {
        return None;
    }
    let suffix = abs[root.len()..].trim_start_matches('/');
    if suffix.is_empty() {
        return None;
    }
    Some(suffix.to_string())
}

fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

pub fn resolve_path(library_root: &Path, relative: &str) -> PathBuf {
    let relative = relative.replace('/', std::path::MAIN_SEPARATOR_STR);
    library_root.join(relative)
}

fn resolve_track_id(
    db: &Database,
    library_root: &Path,
    relative: &str,
) -> Result<Option<i64>, String> {
    let absolute = resolve_path(library_root, relative);
    for candidate in path_lookup_candidates(&absolute) {
        if let Some(track_id) = db
            .get_track_id_by_path(&candidate)
            .map_err(|e| e.to_string())?
        {
            return Ok(Some(track_id));
        }
    }

    let normalized_relative = normalize_path_key(Path::new(relative));
    for track in db.list_tracks().map_err(|e| e.to_string())? {
        if let Some(track_relative) = relative_path(library_root, Path::new(&track.path)) {
            if normalize_path_key(Path::new(&track_relative)) == normalized_relative {
                return Ok(Some(track.id));
            }
        }
    }

    Ok(None)
}

fn path_lookup_candidates(path: &Path) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut push = |value: String| {
        if !candidates.iter().any(|existing| existing == &value) {
            candidates.push(value);
        }
    };

    push(path.to_string_lossy().to_string());
    push(normalize_path_key(path));
    if let Ok(canonical) = path.canonicalize() {
        push(canonical.to_string_lossy().to_string());
        push(normalize_path_key(&canonical));
    }
    candidates
}

pub fn export_config(db: &Database, library_root: &Path) -> Result<LibraryConfig, String> {
    let library_root = library_root
        .canonicalize()
        .unwrap_or_else(|_| library_root.to_path_buf());

    let mut playlists = Vec::new();
    for playlist in db.list_playlists().map_err(|e| e.to_string())? {
        let tracks = db
            .list_playlist_tracks(playlist.id)
            .map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        for track in tracks {
            if let Some(rel) = relative_path(&library_root, Path::new(&track.path)) {
                paths.push(rel);
            }
        }
        playlists.push(ConfigPlaylist {
            name: playlist.name,
            tracks: paths,
        });
    }

    let mut taglists = Vec::new();
    for taglist in db.list_taglists().map_err(|e| e.to_string())? {
        let value_titles = db
            .list_taglist_value_titles(taglist.id)
            .map_err(|e| e.to_string())?;
        let value_order = db
            .list_taglist_value_order(taglist.id)
            .map_err(|e| e.to_string())?;
        let order_rows = db
            .list_taglist_track_order(taglist.id)
            .map_err(|e| e.to_string())?;

        let mut track_order: HashMap<String, Vec<(i64, String)>> = HashMap::new();
        for (tag_value, track_id, position) in order_rows {
            if !db
                .track_in_taglist_sublist(&taglist.tag_key, &tag_value, track_id)
                .map_err(|e| e.to_string())?
            {
                continue;
            }
            let path = db
                .get_track_path(track_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Track {track_id} not found"))?;
            let rel = relative_path(&library_root, Path::new(&path))
                .ok_or_else(|| format!("Track path not under library: {path}"))?;
            track_order
                .entry(tag_value)
                .or_default()
                .push((position, rel));
        }
        let track_order = track_order
            .into_iter()
            .map(|(tag_value, mut entries)| {
                entries.sort_by_key(|(position, _)| *position);
                let paths = entries.into_iter().map(|(_, path)| path).collect();
                (tag_value, paths)
            })
            .collect();

        taglists.push(ConfigTaglist {
            name: taglist.name,
            tag_key: taglist.tag_key,
            entry_tag_key: taglist.entry_tag_key,
            value_singular_name: taglist.value_singular_name,
            value_titles,
            track_order,
            value_order,
        });
    }

    Ok(LibraryConfig {
        version: CONFIG_VERSION,
        playlists,
        taglists,
    })
}

pub fn save_config(db: &Database, library_root: &Path) -> Result<PathBuf, String> {
    let config = export_config(db, library_root)?;
    let path = config_file_path(library_root);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(path)
}

pub fn load_config_file(library_root: &Path) -> Result<Option<LibraryConfig>, String> {
    let path = config_file_path(library_root);
    if !path.exists() {
        return Ok(None);
    }
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {e}"))?;
    let config: LibraryConfig =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid config JSON: {e}"))?;
    if config.version != CONFIG_VERSION {
        return Err(format!(
            "Unsupported config version {} (expected {CONFIG_VERSION})",
            config.version
        ));
    }
    Ok(Some(config))
}

pub fn apply_config(
    db: &Database,
    library_root: &Path,
    config: &LibraryConfig,
) -> Result<(), String> {
    let library_root = library_root
        .canonicalize()
        .unwrap_or_else(|_| library_root.to_path_buf());

    for playlist in &config.playlists {
        let playlist_id = db
            .create_playlist(&playlist.name)
            .map_err(|e| e.to_string())?;
        let mut track_ids = Vec::new();
        for rel in &playlist.tracks {
            if let Some(track_id) = resolve_track_id(db, &library_root, rel)? {
                db.add_track_to_playlist(playlist_id, track_id)
                    .map_err(|e| e.to_string())?;
                track_ids.push(track_id);
            }
        }
        if !track_ids.is_empty() {
            db.reorder_playlist_tracks(playlist_id, &track_ids)
                .map_err(|e| e.to_string())?;
        }
    }

    for taglist in &config.taglists {
        let taglist_id = db
            .create_taglist(
                &taglist.name,
                &taglist.tag_key,
                &taglist.entry_tag_key,
                &taglist.value_singular_name,
            )
            .map_err(|e| e.to_string())?;
        if !taglist.value_titles.is_empty() {
            db.import_taglist_titles(taglist_id, &taglist.value_titles)
                .map_err(|e| e.to_string())?;
        }
        if !taglist.value_order.is_empty() {
            db.reorder_taglist_values(taglist_id, &taglist.value_order)
                .map_err(|e| e.to_string())?;
        }
        for (tag_value, rel_paths) in &taglist.track_order {
            let value = if tag_value.is_empty() {
                None
            } else {
                Some(tag_value.as_str())
            };
            let mut track_ids = Vec::new();
            for rel in rel_paths {
                if let Some(track_id) = resolve_track_id(db, &library_root, rel)? {
                    track_ids.push(track_id);
                }
            }
            if !track_ids.is_empty() {
                db.reorder_taglist_tracks(taglist_id, value, &track_ids)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn test_db_with_library() -> (Database, PathBuf) {
        let db = Database::open(std::path::Path::new(":memory:")).expect("in-memory db");
        let library = std::env::temp_dir().join(format!(
            "trackvault-config-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&library).expect("create library dir");
        let library = library.canonicalize().unwrap_or(library);
        db.set_library_folder(library.to_str().unwrap())
            .expect("set library");

        let track_a = library.join("01-intro.mp3");
        let track_b = library.join("02-build.mp3");
        std::fs::write(&track_a, b"track-a").expect("write track a");
        std::fs::write(&track_b, b"track-b").expect("write track b");

        let track_a_path = track_a.canonicalize().unwrap_or(track_a);
        let track_b_path = track_b.canonicalize().unwrap_or(track_b);

        db.upsert_track(
            track_a_path.to_str().unwrap(),
            "Intro",
            "Artist",
            "Album",
            1000,
            Some(1),
        )
        .expect("insert track a");
        db.upsert_track(
            track_b_path.to_str().unwrap(),
            "Build",
            "Artist",
            "Album",
            2000,
            Some(2),
        )
        .expect("insert track b");

        (db, library)
    }

    #[test]
    fn export_import_round_trip() {
        let (db, library) = test_db_with_library();

        let playlist_id = db.create_playlist("Warm-up").unwrap();
        let tracks = db.list_tracks().unwrap();
        db.add_track_to_playlist(playlist_id, tracks[0].id).unwrap();
        db.add_track_to_playlist(playlist_id, tracks[1].id).unwrap();
        db.reorder_playlist_tracks(playlist_id, &[tracks[1].id, tracks[0].id])
            .unwrap();

        let taglist_id = db.create_taglist("By Comment", "Comment", "", "").unwrap();
        db.replace_track_tags(
            tracks[0].id,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();
        db.replace_track_tags(
            tracks[1].id,
            &[("Comment".to_string(), "02".to_string())],
        )
        .unwrap();
        db.set_taglist_value_title(taglist_id, "01", Some("Opening"))
            .unwrap();
        db.reorder_taglist_values(taglist_id, &["02".to_string(), "01".to_string()])
            .unwrap();
        db.reorder_taglist_tracks(taglist_id, Some("01"), &[tracks[0].id])
            .unwrap();

        let exported = export_config(&db, &library).unwrap();
        assert_eq!(exported.version, CONFIG_VERSION);
        assert_eq!(exported.playlists.len(), 1);
        assert_eq!(exported.playlists[0].name, "Warm-up");
        assert_eq!(exported.playlists[0].tracks.len(), 2);
        assert_eq!(exported.taglists.len(), 1);
        assert_eq!(
            exported.taglists[0].value_titles.get("01"),
            Some(&"Opening".to_string())
        );
        assert_eq!(
            exported.taglists[0].value_order,
            vec!["02".to_string(), "01".to_string()]
        );

        db.clear_user_config().unwrap();
        assert!(db.list_playlists().unwrap().is_empty());

        apply_config(&db, &library, &exported).unwrap();

        let playlists = db.list_playlists().unwrap();
        assert_eq!(playlists.len(), 1);
        let restored = db.list_playlist_tracks(playlists[0].id).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].title, "Build");
        assert_eq!(restored[1].title, "Intro");

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        let values = db
            .list_taglist_value_titles(taglists[0].id)
            .unwrap();
        assert_eq!(values.get("01"), Some(&"Opening".to_string()));
        let sublists = db
            .list_taglist_values("Comment", taglists[0].id)
            .unwrap();
        assert_eq!(sublists[0].value.as_deref(), Some("02"));
        assert_eq!(sublists[1].value.as_deref(), Some("01"));

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn import_skips_missing_tracks() {
        let (db, library) = test_db_with_library();

        let config = LibraryConfig {
            version: CONFIG_VERSION,
            playlists: vec![ConfigPlaylist {
                name: "Partial".to_string(),
                tracks: vec![
                    "01-intro.mp3".to_string(),
                    "Sets/missing.mp3".to_string(),
                ],
            }],
            taglists: vec![],
        };

        apply_config(&db, &library, &config).unwrap();

        let playlists = db.list_playlists().unwrap();
        assert_eq!(playlists.len(), 1);
        let tracks = db.list_playlist_tracks(playlists[0].id).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "Intro");

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn clear_user_config_keeps_tracks() {
        let (db, library) = test_db_with_library();
        db.create_playlist("Test").unwrap();
        let count_before = db.list_tracks().unwrap().len();
        db.clear_user_config().unwrap();
        assert!(db.list_playlists().unwrap().is_empty());
        assert_eq!(db.list_tracks().unwrap().len(), count_before);

        std::fs::remove_dir_all(&library).ok();
    }
}
