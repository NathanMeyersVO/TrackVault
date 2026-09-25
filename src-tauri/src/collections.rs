use std::fs::File;
use std::io::{copy, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::ZipArchive;
use zip::ZipWriter;

use crate::archive_export_progress::ArchiveExportProgressCtx;
use crate::db::Database;
use crate::models::UploadResult;
use crate::scanner::{is_audio_file, read_tags};
use crate::upload::unique_destination_path;

pub const COLLECTIONS_DIR: &str = "collections";
pub const ARCHIVE_VERSION: u32 = 1;
pub const MANIFEST_NAME: &str = "collection.json";
pub const FILES_DIR: &str = "files";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionManifest {
    pub version: u32,
    pub name: String,
    #[serde(default = "default_playback_mode")]
    pub playback_mode: String,
    #[serde(default = "default_continuous_volume")]
    pub continuous_volume: f64,
    pub tracks: Vec<CollectionManifestTrack>,
}

fn default_playback_mode() -> String {
    "discrete".to_string()
}

fn default_continuous_volume() -> f64 {
    crate::db::default_continuous_volume()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionManifestTrack {
    pub file: String,
}

pub fn collections_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(COLLECTIONS_DIR)
}

pub fn collection_dir(app_data_dir: &Path, collection_id: i64) -> PathBuf {
    collections_root(app_data_dir).join(collection_id.to_string())
}

pub fn ensure_collection_dir(app_data_dir: &Path, collection_id: i64) -> Result<PathBuf, String> {
    let dir = collection_dir(app_data_dir, collection_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create collection directory: {e}"))?;
    Ok(dir)
}

pub fn check_collection_upload_conflicts(
    app_data_dir: &Path,
    collection_id: i64,
    source_paths: &[PathBuf],
) -> Result<Vec<String>, String> {
    let upload_dir = collection_dir(app_data_dir, collection_id);
    let mut conflicts = Vec::new();

    for source_path in source_paths {
        let Some(file_name) = source_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if upload_dir.join(file_name).exists() {
            conflicts.push(file_name.to_string());
        }
    }

    conflicts.sort_unstable();
    conflicts.dedup();
    Ok(conflicts)
}

pub fn upload_to_collection(
    db: &Database,
    app_data_dir: &Path,
    collection_id: i64,
    source_paths: &[PathBuf],
    overwrite: bool,
) -> Result<UploadResult, String> {
    if db
        .get_collection(collection_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err("Collection not found".to_string());
    }

    let upload_dir = ensure_collection_dir(app_data_dir, collection_id)?;
    let mut uploaded = 0u32;
    let mut skipped = 0u32;
    let mut errors = Vec::new();

    for source_path in source_paths {
        match upload_one(db, collection_id, &upload_dir, source_path, overwrite) {
            Ok(true) => uploaded += 1,
            Ok(false) => skipped += 1,
            Err(error) => errors.push(error),
        }
    }

    Ok(UploadResult {
        uploaded,
        skipped,
        errors,
    })
}

fn upload_one(
    db: &Database,
    collection_id: i64,
    upload_dir: &Path,
    source_path: &Path,
    overwrite: bool,
) -> Result<bool, String> {
    if !source_path.is_file() {
        return Err(format!("Not a file: {}", source_path.to_string_lossy()));
    }

    if !is_audio_file(source_path) {
        return Err(format!(
            "Unsupported file type: {}",
            source_path.to_string_lossy()
        ));
    }

    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file name: {}", source_path.to_string_lossy()))?;

    let destination = if overwrite {
        upload_dir.join(file_name)
    } else {
        unique_destination_path(upload_dir, file_name)
    };

    std::fs::copy(source_path, &destination)
        .map_err(|e| format!("Failed to copy {}: {e}", source_path.to_string_lossy()))?;

    let path_str = destination.to_string_lossy().to_string();
    let (title, artist, album, track_number, duration_ms) = read_tags(&destination);

    let (track_id, _) = db
        .upsert_collection_track(
            collection_id,
            &path_str,
            &title,
            &artist,
            &album,
            duration_ms,
            track_number,
        )
        .map_err(|e| format!("Failed to index {}: {e}", destination.to_string_lossy()))?;

    if let Err(error) = crate::tag_index::index_track_tags(db, track_id, &destination) {
        eprintln!("Failed to index tags for {path_str}: {error}");
    }

    Ok(true)
}

pub fn delete_collection_with_files(
    db: &Database,
    app_data_dir: &Path,
    collection_id: i64,
) -> Result<(), String> {
    if db
        .get_collection(collection_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err("Collection not found".to_string());
    }
    db.delete_collection(collection_id)
        .map_err(|e| e.to_string())?;
    let dir = collection_dir(app_data_dir, collection_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to remove collection files: {e}"))?;
    }
    Ok(())
}

pub fn delete_collection_track(
    db: &Database,
    track_id: i64,
) -> Result<String, String> {
    let collection_id = db
        .get_track_collection_id(track_id)
        .map_err(|e| e.to_string())?
        .ok_or("Track is not in a collection")?;
    let _ = collection_id;
    let path = db
        .delete_track(track_id)
        .map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn export_collection(
    db: &Database,
    app_data_dir: &Path,
    collection_id: i64,
    destination: &Path,
    progress: &mut ArchiveExportProgressCtx,
) -> Result<(), String> {
    let collection = db
        .get_collection(collection_id)
        .map_err(|e| e.to_string())?
        .ok_or("Collection not found")?;
    let tracks = db
        .list_collection_tracks(collection_id)
        .map_err(|e| e.to_string())?;

    let manifest = CollectionManifest {
        version: ARCHIVE_VERSION,
        name: collection.name,
        playback_mode: collection.playback_mode,
        continuous_volume: collection.continuous_volume,
        tracks: tracks
            .iter()
            .filter_map(|track| {
                Path::new(&track.path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|file| CollectionManifestTrack {
                        file: file.to_string(),
                    })
            })
            .collect(),
    };

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let track_count = tracks.len() as u32;
    let total = track_count.saturating_add(2);
    let mut done = 0u32;
    progress.step(done, total, "Preparing export…");

    let file = File::create(destination)
        .map_err(|e| format!("Failed to create archive: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    progress.step(done, total, MANIFEST_NAME);
    zip.start_file(MANIFEST_NAME, options)
        .map_err(|e| format!("Failed to write manifest: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest: {e}"))?;
    done += 1;
    progress.emit(done, total, false, None);

    let _collection_folder = collection_dir(app_data_dir, collection_id);
    for track in &tracks {
        let source = Path::new(&track.path);
        if !source.is_file() {
            let file_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&track.path);
            return Err(format!("Missing collection file: {file_name}"));
        }
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Invalid file name for {}", track.path))?;
        let archive_path = format!("{FILES_DIR}/{file_name}");
        progress.step(done, total, &archive_path);
        zip.start_file(&archive_path, options)
            .map_err(|e| format!("Failed to add {file_name} to archive: {e}"))?;
        let mut source_file = File::open(source)
            .map_err(|e| format!("Failed to read {file_name}: {e}"))?;
        copy(&mut source_file, &mut zip)
            .map_err(|e| format!("Failed to add {file_name} to archive: {e}"))?;
        done += 1;
        progress.emit(done, total, false, None);
    }

    progress.step(done, total, "Finalizing archive");
    zip.finish()
        .map_err(|e| format!("Failed to finish archive: {e}"))?;
    Ok(())
}

pub fn import_collection(
    db: &Database,
    app_data_dir: &Path,
    source: &Path,
) -> Result<i64, String> {
    let file = File::open(source).map_err(|e| format!("Failed to open archive: {e}"))?;
    let mut archive = ZipArchive::new(BufReader::new(file))
        .map_err(|e| format!("Invalid zip archive: {e}"))?;

    let mut manifest: Option<CollectionManifest> = None;
    let temp_dir = std::env::temp_dir().join(format!(
        "trackvault-import-{}-{}",
        std::process::id(),
        chrono_now()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Invalid archive entry: {e}"))?;
        let Some(path) = entry.enclosed_name() else {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err("Archive contains invalid paths".to_string());
        };

        if path.as_os_str() == MANIFEST_NAME {
            let mut contents = String::new();
            entry
                .read_to_string(&mut contents)
                .map_err(|e| format!("Failed to read manifest: {e}"))?;
            manifest = Some(
                serde_json::from_str(&contents).map_err(|e| format!("Invalid manifest: {e}"))?,
            );
            continue;
        }

        if let Ok(relative) = path.strip_prefix(FILES_DIR) {
            if relative.components().count() != 1 {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err("Archive contains invalid file paths".to_string());
            }
            let file_name = relative
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid file name in archive")?;
            if !is_audio_file(Path::new(file_name)) {
                continue;
            }
            let destination = temp_dir.join(file_name);
            let mut out = File::create(&destination)
                .map_err(|e| format!("Failed to extract {file_name}: {e}"))?;
            copy(&mut entry, &mut out).map_err(|e| format!("Failed to extract {file_name}: {e}"))?;
        }
    }

    let manifest = manifest.ok_or("Archive is missing collection.json")?;
    if manifest.version != ARCHIVE_VERSION {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Unsupported archive version {} (expected {ARCHIVE_VERSION})",
            manifest.version
        ));
    }

    let name = db
        .unique_collection_name(&manifest.name)
        .map_err(|e| e.to_string())?;
    let collection_id = db.create_collection(&name).map_err(|e| e.to_string())?;
    db.set_collection_playback_mode(
        collection_id,
        crate::db::normalize_collection_playback_mode(&manifest.playback_mode),
    )
    .map_err(|e| e.to_string())?;
    db.set_collection_continuous_volume(
        collection_id,
        crate::db::clamp_continuous_volume(manifest.continuous_volume),
    )
    .map_err(|e| e.to_string())?;
    let collection_folder = ensure_collection_dir(app_data_dir, collection_id)?;

    let mut track_ids = Vec::new();
    for entry in &manifest.tracks {
        let source = temp_dir.join(&entry.file);
        if !source.is_file() {
            let _ = std::fs::remove_dir_all(&temp_dir);
            let _ = delete_collection_with_files(db, app_data_dir, collection_id);
            return Err(format!("Archive is missing file: {}", entry.file));
        }
        let destination = collection_folder.join(&entry.file);
        std::fs::copy(&source, &destination)
            .map_err(|e| format!("Failed to copy {}: {e}", entry.file))?;
        let path_str = destination.to_string_lossy().to_string();
        let (title, artist, album, track_number, duration_ms) = read_tags(&destination);
        let (track_id, _) = db
            .upsert_collection_track(
                collection_id,
                &path_str,
                &title,
                &artist,
                &album,
                duration_ms,
                track_number,
            )
            .map_err(|e| e.to_string())?;
        if let Err(error) = crate::tag_index::index_track_tags(db, track_id, &destination) {
            eprintln!("Failed to index tags for {path_str}: {error}");
        }
        track_ids.push(track_id);
    }

    db.reorder_collection_tracks(collection_id, &track_ids)
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_dir_all(&temp_dir);
    Ok(collection_id)
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn test_app_data() -> (Database, PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let db = Database::open(std::path::Path::new(":memory:")).expect("db");
        let dir = std::env::temp_dir().join(format!(
            "trackvault-collections-test-{}-{unique}-{}",
            std::process::id(),
            chrono_now()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (db, dir)
    }

    #[test]
    fn upload_to_collection_indexes_track_outside_library_list() {
        let (db, app_data) = test_app_data();
        let collection_id = db.create_collection("Shared").unwrap();
        let source = app_data.join("incoming.mp3");
        std::fs::write(&source, b"fake-audio").unwrap();

        let result = upload_to_collection(
            &db,
            &app_data,
            collection_id,
            &[source],
            false,
        )
        .unwrap();
        assert_eq!(result.uploaded, 1);

        assert_eq!(db.list_tracks().unwrap().len(), 0);
        assert_eq!(db.list_collection_tracks(collection_id).unwrap().len(), 1);

        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn close_project_keeps_collection_tracks() {
        let (db, app_data) = test_app_data();
        let collection_id = db.create_collection("Keep").unwrap();
        let dir = ensure_collection_dir(&app_data, collection_id).unwrap();
        let file = dir.join("song.mp3");
        std::fs::write(&file, b"audio").unwrap();
        db.upsert_collection_track(
            collection_id,
            file.to_str().unwrap(),
            "Song",
            "Artist",
            "Album",
            1000,
            None,
        )
        .unwrap();
        db.upsert_track("/library/track.mp3", "Lib", "A", "B", 1000, None)
            .unwrap();

        db.close_project_state().unwrap();

        assert_eq!(db.list_tracks().unwrap().len(), 0);
        assert_eq!(db.list_collection_tracks(collection_id).unwrap().len(), 1);
        assert_eq!(db.list_collections().unwrap().len(), 1);

        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn export_import_round_trip() {
        let (db, app_data) = test_app_data();
        let collection_id = db.create_collection("Pack").unwrap();
        let dir = ensure_collection_dir(&app_data, collection_id).unwrap();
        let track_file = dir.join("track-one.mp3");
        std::fs::write(&track_file, b"fake-audio").unwrap();
        let path = track_file.canonicalize().unwrap_or(track_file);
        db.upsert_collection_track(
            collection_id,
            path.to_str().unwrap(),
            "Track One",
            "Artist",
            "Album",
            1000,
            None,
        )
        .unwrap();

        let archive = app_data.join("pack.tvcollection.zip");
        export_collection(
            &db,
            &app_data,
            collection_id,
            &archive,
            &mut ArchiveExportProgressCtx::none(),
        )
        .unwrap();

        let imported_id = import_collection(&db, &app_data, &archive).unwrap();
        let tracks = db.list_collection_tracks(imported_id).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "track-one");

        std::fs::remove_dir_all(&app_data).ok();
    }

    #[test]
    fn export_import_preserves_playback_mode() {
        let (db, app_data) = test_app_data();
        let collection_id = db.create_collection("Ambient").unwrap();
        db.set_collection_playback_mode(collection_id, "continuous")
            .unwrap();
        db.set_collection_continuous_volume(collection_id, 0.35)
            .unwrap();
        let dir = ensure_collection_dir(&app_data, collection_id).unwrap();
        let track_file = dir.join("track-one.mp3");
        std::fs::write(&track_file, b"fake-audio").unwrap();
        let path = track_file.canonicalize().unwrap_or(track_file);
        db.upsert_collection_track(
            collection_id,
            path.to_str().unwrap(),
            "Track One",
            "Artist",
            "Album",
            1000,
            None,
        )
        .unwrap();

        let archive = app_data.join("ambient.tvcollection.zip");
        export_collection(
            &db,
            &app_data,
            collection_id,
            &archive,
            &mut ArchiveExportProgressCtx::none(),
        )
        .unwrap();

        let imported_id = import_collection(&db, &app_data, &archive).unwrap();
        let imported = db.get_collection(imported_id).unwrap().expect("collection");
        assert_eq!(imported.playback_mode, "continuous");
        assert!((imported.continuous_volume - 0.35).abs() < f64::EPSILON);

        std::fs::remove_dir_all(&app_data).ok();
    }
}
