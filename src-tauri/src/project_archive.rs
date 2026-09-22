use std::fs::{self, File};
use std::io::copy;
use std::path::{Component, Path};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use tar::{Archive, Builder};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::projects::{
    self, library_dir, load_manifest, ProjectManifest, ProjectSummary,
    LIBRARY_SUBDIR, PROJECT_MANIFEST,
};

pub const ARCHIVE_VERSION: u32 = 1;
pub const ARCHIVE_META_NAME: &str = "project-archive.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectArchiveMeta {
    version: u32,
    exported_at: i64,
    source_project_id: String,
    project_name: String,
}

pub fn export_project(
    app_data: &Path,
    project_id: &str,
    destination: &Path,
) -> Result<(), String> {
    let root = projects::project_dir(app_data, project_id);
    if !root.is_dir() {
        return Err("Project not found".to_string());
    }
    let manifest = load_manifest(&root)?;

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).ok();
    }

    let meta = ProjectArchiveMeta {
        version: ARCHIVE_VERSION,
        exported_at: unix_now(),
        source_project_id: manifest.id.clone(),
        project_name: manifest.name.clone(),
    };

    let file = File::create(destination)
        .map_err(|e| format!("Failed to create archive: {e}"))?;
    let mut encoder = GzEncoder::new(file, Compression::default());
    {
        let mut builder = Builder::new(&mut encoder);

        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        append_bytes(&mut builder, ARCHIVE_META_NAME, meta_json.as_bytes())?;

        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if should_skip_file(path) {
                continue;
            }
            let rel = path
                .strip_prefix(&root)
                .map_err(|e| e.to_string())?;
            let archive_path = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            builder
                .append_path_with_name(path, &archive_path)
                .map_err(|e| format!("Failed to add {} to archive: {e}", path.display()))?;
        }

        builder
            .finish()
            .map_err(|e| format!("Failed to finish archive: {e}"))?;
    }
    encoder
        .finish()
        .map_err(|e| format!("Failed to finalize archive compression: {e}"))?;
    Ok(())
}

pub fn import_project(app_data: &Path, source: &Path) -> Result<ProjectSummary, String> {
    let file = File::open(source).map_err(|e| format!("Failed to open archive: {e}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    let temp_dir = std::env::temp_dir().join(format!(
        "trackvault-project-import-{}-{}",
        std::process::id(),
        unix_now()
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    let cleanup = || {
        let _ = fs::remove_dir_all(&temp_dir);
    };

    let extract_result = (|| -> Result<(), String> {
        for entry in archive
            .entries()
            .map_err(|e| format!("Failed to read archive: {e}"))?
        {
            let mut entry = entry.map_err(|e| format!("Invalid archive entry: {e}"))?;
            let path = entry
                .path()
                .map_err(|e| format!("Invalid archive path: {e}"))?
                .into_owned();

            if path
                .components()
                .any(|component| matches!(component, Component::ParentDir))
            {
                return Err("Archive contains invalid paths".to_string());
            }

            if path.as_os_str().is_empty() {
                continue;
            }

            let destination = temp_dir.join(&path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            if entry.header().entry_type().is_dir() {
                fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
                continue;
            }
            let mut out = File::create(&destination)
                .map_err(|e| format!("Failed to extract {}: {e}", path.display()))?;
            copy(&mut entry, &mut out)
                .map_err(|e| format!("Failed to extract {}: {e}", path.display()))?;
        }
        Ok(())
    })();

    if extract_result.is_err() {
        cleanup();
        return extract_result.map(|_| unreachable!());
    }

    let manifest_path = temp_dir.join(PROJECT_MANIFEST);
    if !manifest_path.is_file() {
        cleanup();
        return Err("Archive is missing project.json".to_string());
    }

    let library_src = temp_dir.join(LIBRARY_SUBDIR);
    if !library_src.is_dir() {
        cleanup();
        return Err("Archive is missing library folder".to_string());
    }

    if let Ok(meta_data) = fs::read_to_string(temp_dir.join(ARCHIVE_META_NAME)) {
        if let Ok(meta) = serde_json::from_str::<ProjectArchiveMeta>(&meta_data) {
            if meta.version != ARCHIVE_VERSION {
                cleanup();
                return Err(format!(
                    "Unsupported archive version {} (expected {ARCHIVE_VERSION})",
                    meta.version
                ));
            }
        }
    }

    let imported = load_manifest(&temp_dir).map_err(|e| {
        cleanup();
        e
    })?;

    let new_id = Uuid::new_v4().to_string();
    let mut manifest = ProjectManifest {
        version: imported.version,
        id: new_id.clone(),
        name: imported.name,
        created_at: unix_now(),
        application_id: crate::application::normalize_application_id(&imported.application_id)
            .as_str()
            .to_string(),
        schedule_relative_path: imported.schedule_relative_path,
        schedule_last_imported_mtime: None,
    };

    let project_root = projects::create_project_dirs(app_data, &manifest)?;

    copy_dir_all(&library_src, &library_dir(&project_root)).map_err(|e| {
        let _ = projects::delete_project_dir(app_data, &new_id);
        cleanup();
        e
    })?;

    let schedule_path = projects::schedule_path(&project_root, &manifest);
    if schedule_path.is_file() {
        manifest.schedule_last_imported_mtime = file_mtime_secs(&schedule_path);
    }
    projects::save_manifest(&project_root, &manifest).map_err(|e| {
        let _ = projects::delete_project_dir(app_data, &new_id);
        cleanup();
        e
    })?;

    cleanup();

    projects::list_projects(app_data)?
        .into_iter()
        .find(|p| p.id == new_id)
        .ok_or_else(|| "Imported project not found".to_string())
}

fn append_bytes(builder: &mut Builder<&mut GzEncoder<File>>, name: &str, data: &[u8]) -> Result<(), String> {
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, name, data)
        .map_err(|e| format!("Failed to write {name}: {e}"))
}

fn should_skip_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name == ".DS_Store" || name == "Thumbs.db"
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn file_mtime_secs(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| {
            modified
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs() as i64)
        })
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
    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "trackvault-project-archive-test-{}-{}-{}",
            label,
            std::process::id(),
            unix_now()
        ))
    }

    #[test]
    fn export_import_round_trip_new_id() {
        let app_data = temp_root("roundtrip");
        let _ = fs::remove_dir_all(&app_data);

        let id = "source-id-123".to_string();
        let manifest = ProjectManifest::new(
            id.clone(),
            "Test Event".to_string(),
            "usfs_ems".to_string(),
        );
        let root = projects::create_project_dirs(&app_data, &manifest).unwrap();
        let track = library_dir(&root).join("clip.mp3");
        fs::write(&track, b"fake-mp3").unwrap();

        let archive_path = app_data.join("export.tgz");
        export_project(&app_data, &id, &archive_path).unwrap();

        let imported = import_project(&app_data, &archive_path).unwrap();
        assert_ne!(imported.id, id);
        assert_eq!(imported.name, "Test Event");
        assert_eq!(imported.application_id, "usfs_ems");
        assert_eq!(imported.track_count, 1);

        let imported_root = projects::project_dir(&app_data, &imported.id);
        assert!(projects::manifest_path(&imported_root).is_file());
        assert!(library_dir(&imported_root).join("clip.mp3").is_file());

        let _ = fs::remove_dir_all(&app_data);
    }
}
