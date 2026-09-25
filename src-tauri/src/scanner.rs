use std::collections::HashSet;
use std::path::{Path, PathBuf};

use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::Accessor;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::Database;
use crate::delivery::DeliveryProgressCtx;
use crate::models::{AudioCacheProgress, DeliveryProgressPhase, ProjectLoadPhase, ScanProgress};
use crate::project_load::ProjectLoadProgressCtx;
use crate::waveform::probe_duration_ms;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "mp4", "aiff"];

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn read_tags(path: &Path) -> (String, String, String, Option<i32>, i64) {
    let file_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut title = file_name.clone();
    let mut artist = String::new();
    let mut album = String::new();
    let mut track_number = None;

    if let Ok(tagged) = Probe::open(path).and_then(|p| p.read()) {
        if let Some(tag) = tagged.primary_tag() {
            if let Some(t) = tag.title().map(|s| s.to_string()) {
                title = t;
            }
            if let Some(a) = tag.artist().map(|s| s.to_string()) {
                artist = a;
            }
            if let Some(a) = tag.album().map(|s| s.to_string()) {
                album = a;
            }
            track_number = tag.track().map(|n| n as i32);
        }
    }

    let duration_ms = probe_duration_ms(path).unwrap_or(0);
    (title, artist, album, track_number, duration_ms)
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn emit_scan_progress(
    app: &AppHandle,
    done: u32,
    total: u32,
    finished: bool,
    current_path: Option<&Path>,
    delivery: Option<&DeliveryProgressCtx>,
    project_load: Option<&ProjectLoadProgressCtx>,
) {
    let _ = app.emit(
        "project-scan-progress",
        AudioCacheProgress {
            done,
            total,
            finished,
        },
    );
    let current = current_path.map(file_label);
    if let Some(ctx) = delivery {
        ctx.emit(
            DeliveryProgressPhase::ScanningLibrary,
            done,
            total,
            finished,
            current.clone(),
        );
    }
    if let Some(ctx) = project_load {
        if !finished {
            ctx.emit(
                ProjectLoadPhase::Scanning,
                done,
                total,
                false,
                current,
            );
        }
    }
}

pub fn scan_folder(
    db: &Database,
    folder: &Path,
    seen: &mut HashSet<String>,
    app: &AppHandle,
    delivery: Option<&DeliveryProgressCtx>,
    project_load: Option<&ProjectLoadProgressCtx>,
) -> Result<ScanProgress, String> {
    let files: Vec<PathBuf> = WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_audio_file(path))
        .collect();

    let total = files.len() as u32;
    emit_scan_progress(app, 0, total, false, None, delivery, project_load);

    let mut scanned = 0u32;
    let mut added = 0u32;

    for path in files {
        scanned += 1;
        let path_str = path.to_string_lossy().to_string();
        seen.insert(path_str.clone());
        let (title, artist, album, track_number, duration_ms) = read_tags(&path);

        match db.upsert_track(
            &path_str,
            &title,
            &artist,
            &album,
            duration_ms,
            track_number,
        ) {
            Ok((track_id, is_new)) => {
                if is_new {
                    added += 1;
                }
                if let Err(e) = crate::tag_index::index_track_tags(db, track_id, &path) {
                    eprintln!("Failed to index tags for {}: {}", path_str, e);
                }
            }
            Err(e) => eprintln!("Failed to upsert {}: {}", path_str, e),
        }

        emit_scan_progress(app, scanned, total, false, Some(&path), delivery, project_load);
    }

    Ok(ScanProgress {
        scanned,
        added,
        removed: 0,
        done: true,
    })
}

pub fn scan_project_folder(
    db: &Database,
    app: &AppHandle,
    delivery: Option<&DeliveryProgressCtx>,
    project_load: Option<&ProjectLoadProgressCtx>,
) -> Result<ScanProgress, String> {
    emit_scan_progress(app, 0, 0, false, None, delivery, project_load);

    let mut seen = HashSet::new();
    let mut total = ScanProgress {
        scanned: 0,
        added: 0,
        removed: 0,
        done: true,
    };

    let folder = db.get_project_folder().map_err(|e| e.to_string())?;
    let Some(folder) = folder else {
        emit_scan_progress(app, 0, 0, true, None, delivery, project_load);
        return Ok(total);
    };

    let path = PathBuf::from(&folder);
    if path.exists() {
        let progress = scan_folder(db, &path, &mut seen, app, delivery, project_load)?;
        total.scanned += progress.scanned;
        total.added += progress.added;
    }

    let existing = db
        .list_project_track_paths()
        .map_err(|e| e.to_string())?;
    let missing: Vec<String> = existing
        .into_iter()
        .filter(|path| !seen.contains(path))
        .collect();
    total.removed = db
        .delete_project_tracks_by_paths(&missing)
        .map_err(|e| e.to_string())?;

    emit_scan_progress(app, total.scanned, total.scanned, true, None, delivery, project_load);
    Ok(total)
}
