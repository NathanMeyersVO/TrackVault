use std::path::{Path, PathBuf};

use crate::db::Database;

pub fn ensure_under_library_folder(db: &Database, path: &Path) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid track path: {e}"))?;
    let folder = db
        .get_library_folder()
        .map_err(|e| format!("Database error: {e}"))?
        .ok_or("No library folder configured.")?;

    let folder_path = PathBuf::from(&folder);
    let canonical_folder = std::fs::canonicalize(&folder_path)
        .map_err(|e| format!("Invalid library folder path: {e}"))?;
    if canonical.starts_with(&canonical_folder) {
        return Ok(());
    }

    Err("Track path is not under the library folder.".to_string())
}
