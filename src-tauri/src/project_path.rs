//! Path checks for tracks under the open project's library folder (project).

use std::path::Path;

use crate::db::Database;



pub fn ensure_under_project_folder(db: &Database, path: &Path) -> Result<(), String> {

    if path_is_under_project_folder(db, path)? {

        return Ok(());

    }

    Err("Track path is not under the project folder.".to_string())

}



pub fn ensure_writable_track_path(db: &Database, path: &Path) -> Result<(), String> {

    if path_is_under_project_folder(db, path)? {

        return Ok(());

    }

    let path_str = path.to_string_lossy();

    if db

        .get_track_collection_id_by_path(&path_str)

        .map_err(|e| format!("Database error: {e}"))?

        .is_some()

    {

        return Ok(());

    }

    Err("Track path is not under the project folder or a collection folder.".to_string())

}



fn path_is_under_project_folder(db: &Database, path: &Path) -> Result<bool, String> {

    let Some(folder) = db

        .get_project_folder()

        .map_err(|e| format!("Database error: {e}"))?

    else {

        return Ok(false);

    };

    path_is_under_root(path, Path::new(&folder))

}



fn path_is_under_root(path: &Path, root: &Path) -> Result<bool, String> {

    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid track path: {e}"))?;

    let canonical_root = std::fs::canonicalize(root)

        .unwrap_or_else(|_| root.to_path_buf());

    Ok(canonical.starts_with(&canonical_root))

}

