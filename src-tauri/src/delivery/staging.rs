use std::fs;
use std::io::{copy, BufReader};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use tar::Archive;
use walkdir::WalkDir;

pub fn stage_delivery_sources(
    sessions_dir: &Path,
    session_id: &str,
    source_paths: &[String],
) -> Result<PathBuf, String> {
    let staging_root = sessions_dir.join(session_id).join("staging");
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging_root).map_err(|e| e.to_string())?;

    for source in source_paths {
        let path = PathBuf::from(source);
        if !path.exists() {
            return Err(format!("Path not found: {}", path.display()));
        }
        if path.is_dir() {
            copy_tree_into(&path, &staging_root)?;
        } else if is_tar_archive(&path) {
            extract_tar_into(&path, &staging_root)?;
        } else if path.is_file() {
            let name = path
                .file_name()
                .ok_or_else(|| format!("Invalid file: {}", path.display()))?;
            fs::copy(&path, staging_root.join(name)).map_err(|e| e.to_string())?;
        } else {
            return Err(format!("Unsupported path: {}", path.display()));
        }
    }
    Ok(staging_root)
}

fn is_tar_archive(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) {
        Some(ext) if ext == "tar" => true,
        Some(ext) if ext == "tgz" || ext == "gz" => true,
        _ => {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.ends_with(".tar.gz") || name.ends_with(".tar")
        }
    }
}

fn extract_tar_into(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let reader: Box<dyn std::io::Read> =
        if archive_path
            .to_string_lossy()
            .to_lowercase()
            .ends_with(".gz")
            && !archive_path
                .to_string_lossy()
                .to_lowercase()
                .ends_with(".tar")
        {
            Box::new(GzDecoder::new(BufReader::new(file)))
        } else if archive_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gz"))
            .unwrap_or(false)
        {
            Box::new(GzDecoder::new(BufReader::new(file)))
        } else {
            Box::new(BufReader::new(file))
        };
    let mut archive = Archive::new(reader);
    archive.unpack(dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_tree_into(from: &Path, dest: &Path) -> Result<(), String> {
    for entry in WalkDir::new(from).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        let rel = entry
            .path()
            .strip_prefix(from)
            .map_err(|e| e.to_string())?;
        let target = dest.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut src = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
            let mut dst = fs::File::create(&target).map_err(|e| e.to_string())?;
            copy(&mut src, &mut dst).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn find_schedule_xlsx(staging_root: &Path) -> Result<Option<PathBuf>, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(staging_root)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());
        if matches!(ext.as_deref(), Some("xlsx") | Some("xls")) {
            candidates.push(path.to_path_buf());
        }
    }
    if candidates.is_empty() {
        return Ok(None);
    }
    if candidates.len() == 1 {
        return Ok(Some(candidates.remove(0)));
    }
    candidates.sort_by_key(|p| p.to_string_lossy().len());
    Ok(candidates.into_iter().next())
}

pub fn collect_audio_relative(staging_root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(staging_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && crate::scanner::is_audio_file(path) {
            let rel = path
                .strip_prefix(staging_root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.push((rel, path.to_path_buf()));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}
