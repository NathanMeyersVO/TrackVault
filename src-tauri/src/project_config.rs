use std::path::Path;

use crate::config;
use crate::db::Database;

pub fn autosave_trackvault_json(db: &Database, library_root: &Path) -> Result<(), String> {
    config::save_config(db, library_root).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_trackvault_json_if_present(db: &Database, library_root: &Path) -> Result<bool, String> {
    let Some(config) = config::load_config_file(library_root)? else {
        return Ok(false);
    };
    config::apply_config(db, library_root, &config)?;
    Ok(true)
}
