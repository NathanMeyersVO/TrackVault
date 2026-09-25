use std::fs;
use std::io::{copy, BufReader};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tar::Archive;
use walkdir::WalkDir;

use super::progress::{short_path_label, DeliveryProgressCtx};
use crate::models::DeliveryProgressPhase;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryEntryKind {
    Folder,
    Archive,
    Schedule,
    Audio,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryFolderSummary {
    pub archives: Vec<String>,
    pub schedules: Vec<String>,
    pub audio_files: Vec<String>,
}

impl DeliveryFolderSummary {
    pub fn can_import(&self) -> bool {
        !self.archives.is_empty() || !self.audio_files.is_empty() || !self.schedules.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryBrowseEntry {
    pub name: String,
    pub path: String,
    pub kind: DeliveryEntryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryFolderBrowseResult {
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<DeliveryBrowseEntry>,
    pub summary: DeliveryFolderSummary,
}

pub fn classify_delivery_file(path: &Path) -> DeliveryEntryKind {
    if is_tar_archive(path) || is_zip_archive(path) {
        DeliveryEntryKind::Archive
    } else if is_schedule_spreadsheet(path) {
        DeliveryEntryKind::Schedule
    } else if crate::scanner::is_audio_file(path) {
        DeliveryEntryKind::Audio
    } else {
        DeliveryEntryKind::Other
    }
}

pub fn summarize_delivery_folder(root: &Path) -> Result<DeliveryFolderSummary, String> {
    let mut archives = Vec::new();
    let mut schedules = Vec::new();
    let mut audio_files = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        match classify_delivery_file(path) {
            DeliveryEntryKind::Archive => archives.push(rel),
            DeliveryEntryKind::Schedule => schedules.push(rel),
            DeliveryEntryKind::Audio => audio_files.push(rel),
            _ => {}
        }
    }

    archives.sort();
    schedules.sort();
    audio_files.sort();

    Ok(DeliveryFolderSummary {
        archives,
        schedules,
        audio_files,
    })
}

pub fn browse_delivery_folder_at(dir: &Path) -> Result<DeliveryFolderBrowseResult, String> {
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir.display()));
    }
    let path = dir
        .canonicalize()
        .unwrap_or_else(|_| dir.to_path_buf());
    let path_str = path.to_string_lossy().to_string();

    let parent_path = path.parent().and_then(|p| {
        if p == path {
            None
        } else {
            Some(p.to_string_lossy().to_string())
        }
    });

    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let kind = if entry_path.is_dir() {
            DeliveryEntryKind::Folder
        } else {
            classify_delivery_file(&entry_path)
        };
        entries.push(DeliveryBrowseEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            kind,
        });
    }

    entries.sort_by(|a, b| {
        let ord = folder_first(a.kind).cmp(&folder_first(b.kind));
        if ord == std::cmp::Ordering::Equal {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else {
            ord
        }
    });

    let summary = summarize_delivery_folder(&path)?;

    Ok(DeliveryFolderBrowseResult {
        path: path_str,
        parent_path,
        entries,
        summary,
    })
}

fn folder_first(kind: DeliveryEntryKind) -> u8 {
    if kind == DeliveryEntryKind::Folder {
        0
    } else {
        1
    }
}

pub fn default_delivery_browse_root() -> PathBuf {
    if let Some(doc) = dirs::document_dir() {
        return doc;
    }
    if let Some(home) = dirs::home_dir() {
        return home;
    }
    PathBuf::from(".")
}

enum StagingWorkItem {
    ExtractArchive(PathBuf),
    CopyTopLevelFile(PathBuf),
    CopyRelative { src: PathBuf, rel: PathBuf },
}

fn staging_item_step_count(item: &StagingWorkItem) -> Result<u32, String> {
    match item {
        StagingWorkItem::ExtractArchive(path) => {
            if is_tar_archive(path) {
                count_tar_archive_steps(path)
            } else if is_zip_archive(path) {
                let file = fs::File::open(path).map_err(|e| e.to_string())?;
                let archive = zip::ZipArchive::new(BufReader::new(file))
                    .map_err(|e| format!("Invalid zip: {e}"))?;
                Ok(archive.len() as u32)
            } else {
                Ok(1)
            }
        }
        StagingWorkItem::CopyTopLevelFile(_) | StagingWorkItem::CopyRelative { .. } => Ok(1),
    }
}

fn count_tar_archive_steps(archive_path: &Path) -> Result<u32, String> {
    let reader = open_tar_reader(archive_path)?;
    let mut archive = Archive::new(reader);
    let mut count = 0u32;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        entry.map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count.max(1))
}

fn staging_step(
    progress: &DeliveryProgressCtx,
    done: &mut u32,
    total: u32,
    current: String,
    work: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    progress.emit(
        DeliveryProgressPhase::Staging,
        *done,
        total,
        false,
        Some(current.clone()),
    );
    work()?;
    *done += 1;
    progress.emit(
        DeliveryProgressPhase::Staging,
        *done,
        total,
        false,
        Some(current),
    );
    Ok(())
}

fn collect_staging_work(source_paths: &[String]) -> Result<Vec<StagingWorkItem>, String> {
    let mut work = Vec::new();
    for source in source_paths {
        let path = PathBuf::from(source);
        if !path.exists() {
            return Err(format!("Path not found: {}", path.display()));
        }
        if path.is_dir() {
            collect_work_from_tree(&path, &mut work)?;
        } else if is_tar_archive(&path) || is_zip_archive(&path) {
            work.push(StagingWorkItem::ExtractArchive(path));
        } else if path.is_file() {
            work.push(StagingWorkItem::CopyTopLevelFile(path));
        } else {
            return Err(format!("Unsupported path: {}", path.display()));
        }
    }
    Ok(work)
}

fn collect_work_from_tree(from: &Path, work: &mut Vec<StagingWorkItem>) -> Result<(), String> {
    for entry in WalkDir::new(from)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_tar_archive(path) {
            work.push(StagingWorkItem::ExtractArchive(path.to_path_buf()));
        } else if is_zip_archive(path) {
            work.push(StagingWorkItem::ExtractArchive(path.to_path_buf()));
        } else if is_schedule_spreadsheet(path) || crate::scanner::is_audio_file(path) {
            let rel = path.strip_prefix(from).map_err(|e| e.to_string())?;
            work.push(StagingWorkItem::CopyRelative {
                src: path.to_path_buf(),
                rel: rel.to_path_buf(),
            });
        }
    }
    Ok(())
}

fn execute_staging_work(
    item: &StagingWorkItem,
    staging_root: &Path,
    progress: &DeliveryProgressCtx,
    done: &mut u32,
    staging_total: u32,
) -> Result<(), String> {
    match item {
        StagingWorkItem::ExtractArchive(p) => {
            if is_tar_archive(p) {
                extract_tar_into(p, staging_root, progress, done, staging_total)?;
            } else {
                extract_zip_into(p, staging_root, progress, done, staging_total)?;
            }
        }
        StagingWorkItem::CopyTopLevelFile(p) => {
            let label = short_path_label(p);
            staging_step(progress, done, staging_total, label, || {
                let name = p
                    .file_name()
                    .ok_or_else(|| format!("Invalid file: {}", p.display()))?;
                fs::copy(p, staging_root.join(name)).map_err(|e| e.to_string())?;
                Ok(())
            })?;
        }
        StagingWorkItem::CopyRelative { src, rel } => {
            let label = rel.to_string_lossy().replace('\\', "/");
            let src = src.clone();
            let rel = rel.clone();
            staging_step(progress, done, staging_total, label, || {
                copy_file_preserving_relative(&src, staging_root, &rel)
            })?;
        }
    }
    Ok(())
}

pub fn stage_delivery_sources(
    sessions_dir: &Path,
    session_id: &str,
    source_paths: &[String],
    progress: &DeliveryProgressCtx,
) -> Result<PathBuf, String> {
    let staging_root = sessions_dir.join(session_id).join("staging");
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging_root).map_err(|e| e.to_string())?;

    progress.emit(DeliveryProgressPhase::Scanning, 0, 0, false, None);
    let work = collect_staging_work(source_paths)?;
    let staging_total = work
        .iter()
        .map(staging_item_step_count)
        .try_fold(0u32, |acc, n| n.map(|steps| acc + steps))?;
    let mut done = 0u32;

    for item in &work {
        execute_staging_work(item, &staging_root, progress, &mut done, staging_total)?;
    }

    Ok(staging_root)
}

fn is_zip_archive(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
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

fn open_tar_reader(archive_path: &Path) -> Result<Box<dyn std::io::Read>, String> {
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let lower = archive_path.to_string_lossy().to_lowercase();
    let reader: Box<dyn std::io::Read> = if lower.ends_with(".gz") && !lower.ends_with(".tar") {
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
    Ok(reader)
}

fn extract_tar_into(
    archive_path: &Path,
    dest: &Path,
    progress: &DeliveryProgressCtx,
    done: &mut u32,
    staging_total: u32,
) -> Result<(), String> {
    let archive_label = short_path_label(archive_path);
    let reader = open_tar_reader(archive_path)?;
    let mut archive = Archive::new(reader);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let entry_label = path.to_string_lossy().replace('\\', "/");
        let current = format!("{archive_label} › {entry_label}");
        staging_step(progress, done, staging_total, current, || {
            entry
                .unpack_in(dest)
                .map_err(|e| e.to_string())
                .map(|_| ())
        })?;
    }
    Ok(())
}

fn extract_zip_into(
    archive_path: &Path,
    dest: &Path,
    progress: &DeliveryProgressCtx,
    done: &mut u32,
    staging_total: u32,
) -> Result<(), String> {
    let archive_label = short_path_label(archive_path);
    let file = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("Invalid zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry {i}: {e}"))?;
        let entry_name = entry.name().replace('\\', "/");
        let current = format!("{archive_label} › {entry_name}");
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!(
                "Zip entry has an unsafe path: {}",
                entry.name()
            ));
        };
        let target = dest.join(rel);
        progress.emit(
            DeliveryProgressPhase::Staging,
            *done,
            staging_total,
            false,
            Some(current.clone()),
        );
        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
            copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
        *done += 1;
        progress.emit(
            DeliveryProgressPhase::Staging,
            *done,
            staging_total,
            false,
            Some(current),
        );
    }
    Ok(())
}

fn is_schedule_spreadsheet(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase()),
        Some(ext) if ext == "xls" || ext == "xlsx" || ext == "csv"
    )
}

/// Vendor drop folder: extract archives, copy audio and schedule files; skip other files.
pub fn ingest_delivery_folder(from: &Path, dest: &Path) -> Result<(), String> {
    for entry in WalkDir::new(from)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_tar_archive(path) {
            let mut done = 0u32;
            extract_tar_into(path, dest, &DeliveryProgressCtx::none(), &mut done, 1)?;
        } else if is_zip_archive(path) {
            let mut done = 0u32;
            extract_zip_into(path, dest, &DeliveryProgressCtx::none(), &mut done, 1)?;
        } else if is_schedule_spreadsheet(path) || crate::scanner::is_audio_file(path) {
            let rel = path.strip_prefix(from).map_err(|e| e.to_string())?;
            copy_file_preserving_relative(path, dest, rel)?;
        }
    }
    Ok(())
}

fn copy_file_preserving_relative(src: &Path, dest: &Path, rel: &Path) -> Result<(), String> {
    let target = dest.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(src, &target).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn write_test_zip(path: &Path, inner_path: &str, contents: &[u8]) {
        let file = fs::File::create(path).expect("create zip");
        let mut zip = ZipWriter::new(file);
        zip.start_file(inner_path, SimpleFileOptions::default())
            .expect("start_file");
        zip.write_all(contents).expect("write");
        zip.finish().expect("finish");
    }

    #[test]
    fn zip_archive_yields_staged_audio() {
        let base = std::env::temp_dir().join(format!("tv-staging-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).expect("mkdir");
        let zip_path = base.join("delivery.zip");
        write_test_zip(&zip_path, "tracks/01.mp3", b"fake-mp3");

        let sessions = base.join("sessions");
        let staging_root = stage_delivery_sources(
            &sessions,
            "test-session",
            &[zip_path.to_string_lossy().into()],
            &DeliveryProgressCtx::none(),
        )
            .expect("stage");

        let audio = collect_audio_relative(&staging_root).expect("collect");
        assert_eq!(audio.len(), 1);
        assert_eq!(audio[0].0, "tracks/01.mp3");

        let _ = fs::remove_dir_all(&base);
    }

    fn write_minimal_schedule_xlsx(path: &Path) {
        use rust_xlsxwriter::{Workbook, Worksheet};
        let mut workbook = Workbook::new();
        let mut worksheet = Worksheet::new();
        worksheet.set_name("Event Schedule").unwrap();
        worksheet.write_string(0, 0, "#").unwrap();
        worksheet.write_string(0, 1, "Title").unwrap();
        worksheet.write_string(1, 0, "01").unwrap();
        worksheet.write_string(1, 1, "Test Event").unwrap();
        workbook.push_worksheet(worksheet);
        workbook.save(path).unwrap();
    }

    #[test]
    fn delivery_folder_extracts_zip_and_keeps_schedule() {
        let base = std::env::temp_dir().join(format!("tv-staging-{}", uuid::Uuid::new_v4()));
        let drop = base.join("vendor");
        fs::create_dir_all(&drop).expect("mkdir");
        write_test_zip(&drop.join("tracks.zip"), "tracks/01.mp3", b"fake-mp3");
        write_minimal_schedule_xlsx(&drop.join("event-schedule.xlsx"));

        let sessions = base.join("sessions");
        let staging_root = stage_delivery_sources(
            &sessions,
            "folder-session",
            &[drop.to_string_lossy().into()],
            &DeliveryProgressCtx::none(),
        )
        .expect("stage");

        let audio = collect_audio_relative(&staging_root).expect("collect");
        assert_eq!(audio.len(), 1);

        let schedule = find_schedule_xlsx(&staging_root).expect("find schedule");
        assert!(schedule.is_some());

        let zip_blob = staging_root.join("tracks.zip");
        assert!(!zip_blob.is_file(), "archive should be extracted, not copied");

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn summarize_classifies_vendor_drop() {
        let base = std::env::temp_dir().join(format!("tv-summary-{}", uuid::Uuid::new_v4()));
        let drop = base.join("vendor");
        fs::create_dir_all(&drop).expect("mkdir");
        write_test_zip(&drop.join("tracks.zip"), "a.mp3", b"x");
        write_minimal_schedule_xlsx(&drop.join("sched.xlsx"));
        fs::write(drop.join("loose.wav"), b"wav").expect("wav");

        let summary = summarize_delivery_folder(&drop).expect("summary");
        assert_eq!(summary.archives.len(), 1);
        assert_eq!(summary.schedules.len(), 1);
        assert_eq!(summary.audio_files.len(), 1);
        assert!(summary.can_import());

        let _ = fs::remove_dir_all(&base);
    }
}
