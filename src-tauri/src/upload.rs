use std::path::{Path, PathBuf};

use crate::db::Database;
use crate::models::UploadResult;
use crate::scanner::{is_audio_file, read_tags};

pub const UPLOADED_DIR: &str = "UPLOADED";

pub fn ensure_upload_dir(library_root: &Path) -> Result<PathBuf, String> {
    let upload_dir = library_root.join(UPLOADED_DIR);
    std::fs::create_dir_all(&upload_dir)
        .map_err(|e| format!("Failed to create upload directory: {e}"))?;
    Ok(upload_dir)
}

pub fn unique_destination_path(upload_dir: &Path, file_name: &str) -> PathBuf {
    let mut destination = upload_dir.join(file_name);
    if !destination.exists() {
        return destination;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track");
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();

    for index in 1..10_000 {
        destination = upload_dir.join(format!("{stem} ({index}){extension}"));
        if !destination.exists() {
            return destination;
        }
    }

    upload_dir.join(format!(
        "{stem}-{}-{extension}",
        chrono_now()
    ))
}

pub fn check_upload_conflicts(
    db: &Database,
    source_paths: &[PathBuf],
) -> Result<Vec<String>, String> {
    let library_folder = db
        .get_library_folder()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No library folder configured".to_string())?;

    let library_root = PathBuf::from(&library_folder);
    let upload_dir = library_root.join(UPLOADED_DIR);
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

pub fn upload_tracks(
    db: &Database,
    source_paths: &[PathBuf],
    overwrite: bool,
) -> Result<UploadResult, String> {
    let library_folder = db
        .get_library_folder()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No library folder configured".to_string())?;

    let library_root = PathBuf::from(&library_folder);
    if !library_root.exists() {
        return Err("Library folder does not exist".to_string());
    }

    let upload_dir = ensure_upload_dir(&library_root)?;
    let mut uploaded = 0u32;
    let mut skipped = 0u32;
    let mut errors = Vec::new();

    for source_path in source_paths {
        match upload_one_track(db, &upload_dir, source_path, overwrite) {
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

fn upload_one_track(
    db: &Database,
    upload_dir: &Path,
    source_path: &Path,
    overwrite: bool,
) -> Result<bool, String> {
    if !source_path.is_file() {
        return Err(format!(
            "Not a file: {}",
            source_path.to_string_lossy()
        ));
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
        .upsert_track(
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

    fn test_db_with_library(library: &Path) -> Database {
        let db = Database::open(std::path::Path::new(":memory:")).expect("in-memory db");
        db.set_library_folder(library.to_str().unwrap())
            .expect("set library folder");
        db
    }

    #[test]
    fn ensure_upload_dir_creates_subdirectory() {
        let library = std::env::temp_dir().join(format!("trackvault-upload-{}", chrono_now()));
        std::fs::create_dir_all(&library).unwrap();

        let upload_dir = ensure_upload_dir(&library).unwrap();
        assert_eq!(upload_dir, library.join(UPLOADED_DIR));
        assert!(upload_dir.is_dir());

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn unique_destination_path_avoids_collisions() {
        let dir = std::env::temp_dir().join(format!("trackvault-upload-names-{}", chrono_now()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("song.mp3"), b"one").unwrap();

        let first = unique_destination_path(&dir, "song.mp3");
        assert_eq!(first, dir.join("song (1).mp3"));

        std::fs::write(first.clone(), b"two").unwrap();
        let second = unique_destination_path(&dir, "song.mp3");
        assert_eq!(second, dir.join("song (2).mp3"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upload_tracks_requires_library_folder() {
        let db = Database::open(std::path::Path::new(":memory:")).expect("in-memory db");
        let result = upload_tracks(&db, &[], false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No library folder configured"));
    }

    #[test]
    fn upload_tracks_rejects_non_audio() {
        let library = std::env::temp_dir().join(format!("trackvault-upload-reject-{}", chrono_now()));
        std::fs::create_dir_all(&library).unwrap();
        let db = test_db_with_library(&library);

        let text_file = library.join("notes.txt");
        std::fs::write(&text_file, b"hello").unwrap();

        let result = upload_tracks(&db, &[text_file.clone()], false).unwrap();
        assert_eq!(result.uploaded, 0);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("Unsupported file type"));

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn upload_tracks_copies_and_indexes_audio() {
        let library = std::env::temp_dir().join(format!("trackvault-upload-copy-{}", chrono_now()));
        std::fs::create_dir_all(&library).unwrap();
        let db = test_db_with_library(&library);

        let source = library.join("incoming.mp3");
        std::fs::write(&source, b"fake-audio").unwrap();

        let result = upload_tracks(&db, &[source], false).unwrap();
        assert_eq!(result.uploaded, 1);
        assert!(result.errors.is_empty());

        let uploaded_path = library.join(UPLOADED_DIR).join("incoming.mp3");
        assert!(uploaded_path.exists());

        let tracks = db.list_tracks().unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].path, uploaded_path.to_string_lossy());

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn check_upload_conflicts_detects_existing_uploaded_file() {
        let library = std::env::temp_dir().join(format!("trackvault-upload-conflict-{}", chrono_now()));
        std::fs::create_dir_all(&library).unwrap();
        let db = test_db_with_library(&library);
        let upload_dir = ensure_upload_dir(&library).unwrap();
        std::fs::write(upload_dir.join("song.mp3"), b"existing").unwrap();

        let source = library.join("song.mp3");
        std::fs::write(&source, b"new").unwrap();

        let conflicts = check_upload_conflicts(&db, &[source]).unwrap();
        assert_eq!(conflicts, vec!["song.mp3".to_string()]);

        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn upload_tracks_overwrite_replaces_existing_file() {
        let library = std::env::temp_dir().join(format!("trackvault-upload-overwrite-{}", chrono_now()));
        std::fs::create_dir_all(&library).unwrap();
        let db = test_db_with_library(&library);

        let source = library.join("incoming.mp3");
        std::fs::write(&source, b"first").unwrap();
        upload_tracks(&db, &[source.clone()], false).unwrap();

        std::fs::write(&source, b"second").unwrap();
        let result = upload_tracks(&db, &[source], true).unwrap();
        assert_eq!(result.uploaded, 1);

        let uploaded_path = library.join(UPLOADED_DIR).join("incoming.mp3");
        let contents = std::fs::read(&uploaded_path).unwrap();
        assert_eq!(contents, b"second");
        assert_eq!(db.list_tracks().unwrap().len(), 1);

        std::fs::remove_dir_all(&library).ok();
    }
}
