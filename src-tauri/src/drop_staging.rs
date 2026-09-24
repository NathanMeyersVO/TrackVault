use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;

use crate::scanner::is_audio_file;

const DROP_STAGING_DIR: &str = "drop-staging";

pub type DropStagingCache = Arc<Mutex<HashMap<String, String>>>;

pub fn new_drop_staging_cache() -> DropStagingCache {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn drop_staging_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DROP_STAGING_DIR)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn normalized_path_str(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn path_is_under_temp(source: &Path) -> bool {
    let temp = std::env::temp_dir();
    if source.starts_with(&temp) {
        return true;
    }
    let temp_norm = normalized_path_str(&temp);
    let source_norm = normalized_path_str(source);
    if source_norm.starts_with(&temp_norm) {
        return true;
    }
    let Ok(canonical_temp) = temp.canonicalize() else {
        return false;
    };
    match source.canonicalize() {
        Ok(canonical_source) => canonical_source.starts_with(&canonical_temp),
        Err(_) => false,
    }
}

pub fn path_needs_staging(source: &Path) -> bool {
    if path_is_under_temp(source) {
        return true;
    }
    let s = normalized_path_str(source);
    s.contains("/temp/") || s.contains("/tmp/")
}

fn safe_file_name(source: &Path) -> String {
    source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("dropped-audio")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn copy_to_staging(app_data_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let staging_dir = drop_staging_dir(app_data_dir);
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create drop staging directory: {e}"))?;

    let unique = format!("{}_{}", chrono_like_nonce(), safe_file_name(source));
    let destination = staging_dir.join(unique);
    fs::copy(source, &destination).map_err(|e| {
        format!(
            "Failed to copy dropped file from {}: {e}",
            source.to_string_lossy()
        )
    })?;
    Ok(destination)
}

/// Copy ephemeral drag sources into app data so they remain readable after the source app deletes them.
pub fn stage_drop_source(
    app_data_dir: &Path,
    source: &Path,
    force: bool,
) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err(format!("Not a file: {}", source.to_string_lossy()));
    }
    if !is_audio_file(source) {
        return Err(format!(
            "Unsupported file type: {}",
            source.to_string_lossy()
        ));
    }
    if !force && !path_needs_staging(source) {
        return Ok(source.to_path_buf());
    }

    copy_to_staging(app_data_dir, source)
}

pub fn cache_lookup(cache: &DropStagingCache, source: &Path) -> Option<PathBuf> {
    let key = path_key(source);
    cache.lock().get(&key).map(|s| PathBuf::from(s.as_str()))
}

pub fn cache_insert(cache: &DropStagingCache, source: &Path, staged: &Path) {
    cache
        .lock()
        .insert(path_key(source), staged.to_string_lossy().into_owned());
}

pub fn resolve_staged_path(
    app_data_dir: &Path,
    cache: &DropStagingCache,
    source: &Path,
    force: bool,
) -> Result<PathBuf, String> {
    if let Some(staged) = cache_lookup(cache, source) {
        if staged.is_file() {
            return Ok(staged);
        }
    }
    let staged = stage_drop_source(app_data_dir, source, force)?;
    if staged != source {
        cache_insert(cache, source, &staged);
    }
    Ok(staged)
}

pub fn resolve_paths(
    app_data_dir: &Path,
    cache: &DropStagingCache,
    sources: &[PathBuf],
    force: bool,
) -> Result<Vec<PathBuf>, String> {
    sources
        .iter()
        .map(|source| resolve_staged_path(app_data_dir, cache, source, force))
        .collect()
}

/// Called synchronously from the native drag-drop handler (before frontend IPC).
pub fn stage_drop_on_drag(
    app_data_dir: &Path,
    cache: &DropStagingCache,
    paths: &[PathBuf],
) {
    for source in paths {
        if !source.is_file() || !is_audio_file(source) {
            continue;
        }
        match copy_to_staging(app_data_dir, source) {
            Ok(staged) => cache_insert(cache, source, &staged),
            Err(err) => eprintln!("drop staging on drag failed for {}: {err}", source.display()),
        }
    }
}

pub fn cleanup_drop_staging(app_data_dir: &Path, cache: &DropStagingCache) -> Result<(), String> {
    cache.lock().clear();
    let dir = drop_staging_dir(app_data_dir);
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read drop staging: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read drop staging entry: {e}"))?;
        let path = entry.path();
        if path.is_file() {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn chrono_like_nonce() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_needs_staging_detects_temp_segment() {
        let path = Path::new(r"C:\Users\me\AppData\Local\Temp\attachment.mp3");
        assert!(path_needs_staging(path));
    }

    #[test]
    fn stage_copies_file_under_temp() {
        let base = std::env::temp_dir().join(format!("tv-drop-stage-{}", std::process::id()));
        let app_data = base.join("app-data");
        let source = base.join("source.mp3");
        fs::create_dir_all(&app_data).expect("app data");
        fs::write(&source, b"fake-mp3").expect("write source");

        let staged = stage_drop_source(&app_data, &source, false).expect("stage");
        assert!(staged.starts_with(drop_staging_dir(&app_data)));
        assert!(staged.exists());
        assert_ne!(staged, source);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn cache_lookup_returns_staged_path() {
        let cache = new_drop_staging_cache();
        let source = PathBuf::from(r"C:\Temp\a.mp3");
        let staged = PathBuf::from(r"C:\app\drop-staging\1_a.mp3");
        cache_insert(&cache, &source, &staged);
        assert_eq!(cache_lookup(&cache, &source), Some(staged));
    }
}
