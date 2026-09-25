use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const PROJECT_MANIFEST: &str = "project.json";
pub const LIBRARY_SUBDIR: &str = "library";
pub const DEFAULT_SCHEDULE_REL: &str = "event-schedule.xlsx";
const SCHEDULE_BASENAME: &str = "event-schedule";
pub const ACTIVE_PROJECT_KEY: &str = "active_project_id";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectOrigin {
    #[default]
    Created,
    Imported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectManifest {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub application_id: String,
    pub schedule_relative_path: String,
    #[serde(default)]
    pub schedule_last_imported_mtime: Option<i64>,
    #[serde(default)]
    pub origin: ProjectOrigin,
}

impl ProjectManifest {
    pub fn new(id: String, name: String, application_id: String) -> Self {
        Self {
            version: 1,
            id,
            name,
            created_at: unix_now(),
            application_id,
            schedule_relative_path: DEFAULT_SCHEDULE_REL.to_string(),
            schedule_last_imported_mtime: None,
            origin: ProjectOrigin::Created,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub application_id: String,
    pub track_count: u32,
    pub last_modified: i64,
    pub origin: ProjectOrigin,
}

pub fn projects_root(app_data: &Path) -> PathBuf {
    app_data.join("projects")
}

pub fn project_dir(app_data: &Path, project_id: &str) -> PathBuf {
    projects_root(app_data).join(project_id)
}

/// Audio and schedule files for a project live under this directory (`library/` on disk).
pub fn library_dir(project_root: &Path) -> PathBuf {
    project_root.join(LIBRARY_SUBDIR)
}

pub fn manifest_path(project_root: &Path) -> PathBuf {
    project_root.join(PROJECT_MANIFEST)
}

pub fn schedule_path(project_root: &Path, manifest: &ProjectManifest) -> PathBuf {
    library_dir(project_root).join(&manifest.schedule_relative_path)
}

/// Canonical library-relative path for a staged vendor schedule (preserves `.xls` vs `.xlsx`).
pub fn canonical_schedule_relative_path(staged: &Path) -> String {
    let ext = staged
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| e == "xls" || e == "xlsx")
        .unwrap_or_else(|| "xlsx".to_string());
    format!("{SCHEDULE_BASENAME}.{ext}")
}

pub fn load_manifest(project_root: &Path) -> Result<ProjectManifest, String> {
    let path = manifest_path(project_root);
    let data = fs::read_to_string(&path).map_err(|e| format!("Read {}: {e}", path.display()))?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

pub fn save_manifest(project_root: &Path, manifest: &ProjectManifest) -> Result<(), String> {
    let path = manifest_path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn create_project_dirs(app_data: &Path, manifest: &ProjectManifest) -> Result<PathBuf, String> {
    let root = project_dir(app_data, &manifest.id);
    let library = library_dir(&root);
    fs::create_dir_all(&library).map_err(|e| e.to_string())?;
    save_manifest(&root, manifest)?;
    Ok(root)
}

pub fn parse_active_project_id_setting(value_json: &str) -> Option<String> {
    let trimmed = value_json.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(id) = serde_json::from_str::<String>(trimmed) {
        return (!id.is_empty()).then_some(id);
    }
    serde_json::from_str::<Option<String>>(trimmed)
        .ok()
        .flatten()
        .filter(|id| !id.is_empty())
}

pub fn get_active_project_id(db: &Database) -> Result<Option<String>, String> {
    let Some(json) = db
        .get_app_setting(ACTIVE_PROJECT_KEY)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    Ok(parse_active_project_id_setting(&json))
}

pub fn set_active_project_id(db: &Database, project_id: &str) -> Result<(), String> {
    let id_json = serde_json::to_string(project_id).map_err(|e| e.to_string())?;
    db.set_app_setting(ACTIVE_PROJECT_KEY, &id_json)
        .map_err(|e| e.to_string())
}

pub fn clear_active_project_id(db: &Database) -> Result<(), String> {
    db.delete_app_setting(ACTIVE_PROJECT_KEY)
        .map_err(|e| e.to_string())
}

pub fn delete_project_dir(app_data: &Path, project_id: &str) -> Result<(), String> {
    let root = project_dir(app_data, project_id);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_projects(app_data: &Path) -> Result<Vec<ProjectSummary>, String> {
    let root = projects_root(app_data);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let project_root = entry.path();
        let manifest = match load_manifest(&project_root) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let library = library_dir(&project_root);
        let (track_count, last_modified) = library_stats(&library);
        out.push(ProjectSummary {
            id: manifest.id,
            name: manifest.name,
            created_at: manifest.created_at,
            application_id: manifest.application_id,
            track_count,
            last_modified,
            origin: manifest.origin,
        });
    }
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(out)
}

fn library_stats(library: &Path) -> (u32, i64) {
    if !library.is_dir() {
        return (0, 0);
    }
    let mut count = 0u32;
    let mut last_modified = 0i64;
    for entry in walkdir::WalkDir::new(library)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && crate::scanner::is_audio_file(path) {
            count += 1;
            if let Ok(meta) = fs::metadata(path) {
                if let Ok(modified) = meta.modified() {
                    let secs = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    last_modified = last_modified.max(secs);
                }
            }
        }
    }
    (count, last_modified)
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parse_active_project_id_from_json_string() {
        let id = "550e8400-e29b-41d4-a716-446655440000";
        let json = serde_json::to_string(id).unwrap();
        assert_eq!(
            parse_active_project_id_setting(&json),
            Some(id.to_string())
        );
    }

    #[test]
    fn parse_active_project_id_from_json_null() {
        assert_eq!(parse_active_project_id_setting("null"), None);
    }

    #[test]
    fn parse_active_project_id_empty_string() {
        assert_eq!(parse_active_project_id_setting(""), None);
    }

    #[test]
    fn canonical_schedule_relative_path_preserves_extension() {
        assert_eq!(
            canonical_schedule_relative_path(Path::new("vendor/Event Schedule.xls")),
            "event-schedule.xls"
        );
        assert_eq!(
            canonical_schedule_relative_path(Path::new("event-schedule.xlsx")),
            "event-schedule.xlsx"
        );
    }
}
