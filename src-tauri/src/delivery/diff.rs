use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::staging::{collect_audio_relative, find_schedule_xlsx};
use super::{DeliveryChange, DeliveryChangeKind};
use crate::application::{self, ApplicationId};
use crate::file_hash::sha256_file;
use crate::scanner;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryApplyModeHint {
    Merge,
    LikelyFullSet,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeliveryPreview {
    pub staging_session_id: String,
    pub changes: Vec<DeliveryChange>,
    pub apply_mode_hint: DeliveryApplyModeHint,
    pub staged_audio_count: u32,
    pub library_audio_count: u32,
    pub unchanged_audio_count: u32,
}

struct LibraryFile {
    rel: String,
    abs: PathBuf,
    hash: Option<String>,
}

pub fn build_preview(
    staging_session_id: &str,
    staging_root: &Path,
    library_root: &Path,
    for_update: bool,
    existing_library_schedule: Option<&Path>,
    application: ApplicationId,
) -> Result<DeliveryPreview, String> {
    let staged = collect_audio_relative(staging_root)?;
    let library = collect_library_audio(library_root)?;

    let mut lib_by_rel: HashMap<String, LibraryFile> = HashMap::new();
    let mut lib_by_hash: HashMap<String, Vec<String>> = HashMap::new();
    for file in &library {
        lib_by_rel.insert(file.rel.clone(), file.clone());
        if let Some(h) = &file.hash {
            lib_by_hash.entry(h.clone()).or_default().push(file.rel.clone());
        }
    }

    let staged_rels: HashSet<String> = staged.iter().map(|(r, _)| r.clone()).collect();
    let mut changes = Vec::new();
    let mut move_sources_used: HashSet<String> = HashSet::new();
    let mut unchanged_audio_count: u32 = 0;

    for (rel, abs) in &staged {
        let staged_hash = sha256_file(abs).ok();
        if let Some(existing) = lib_by_rel.get(rel) {
            let same_hash = staged_hash.as_deref() == existing.hash.as_deref();
            if same_hash {
                if tags_differ(abs, &existing.abs)? {
                    changes.push(change(
                        DeliveryChangeKind::AudioUpdate,
                        format!("Update metadata: {rel}"),
                        rel,
                    ));
                } else {
                    unchanged_audio_count += 1;
                }
            } else {
                changes.push(change(
                    DeliveryChangeKind::AudioReplace,
                    format!("Replace audio: {rel}"),
                    rel,
                ));
            }
            continue;
        }

        if let Some(hash) = &staged_hash {
            if let Some(candidates) = lib_by_hash.get(hash) {
                let old_rel = candidates
                    .iter()
                    .find(|c| !staged_rels.contains(*c) && !move_sources_used.contains(*c))
                    .cloned();
                if let Some(old_rel) = old_rel {
                    move_sources_used.insert(old_rel.clone());
                    let details = format!("from={old_rel};to={rel}");
                    changes.push(DeliveryChange {
                        change_id: stable_change_id(DeliveryChangeKind::AudioMove, &details),
                        kind: DeliveryChangeKind::AudioMove,
                        summary: format!("Move: {old_rel} → {rel}"),
                        details,
                        default_selected: true,
                    });
                    continue;
                }
            }
        }

        changes.push(change(
            DeliveryChangeKind::AudioAdd,
            format!("Add: {rel}"),
            rel,
        ));
    }

    if application::supports_schedule_delivery(application) {
        if let Some(schedule) = find_schedule_xlsx(staging_root)? {
            if for_update {
                diff_schedule(
                    application,
                    &mut changes,
                    &schedule,
                    library_root,
                    existing_library_schedule,
                )?;
            } else if let Ok(mappings) = application::parse_title_map_for_application(application, &schedule)
            {
                for (tag, title) in mappings {
                    changes.push(change(
                        DeliveryChangeKind::ScheduleEventAdd,
                        format!("Event {tag}: {title}"),
                        &tag,
                    ));
                }
            }
        }
    }

    let library_count = library.len() as u32;
    let staged_count = staged.len() as u32;
    let hint = if for_update && library_count > 0 && staged_count as f32 >= library_count as f32 * 0.9 {
        DeliveryApplyModeHint::LikelyFullSet
    } else {
        DeliveryApplyModeHint::Merge
    };

    Ok(DeliveryPreview {
        staging_session_id: staging_session_id.to_string(),
        changes,
        apply_mode_hint: hint,
        staged_audio_count: staged_count,
        library_audio_count: library_count,
        unchanged_audio_count,
    })
}

pub fn append_full_replace_removals(
    preview: &mut DeliveryPreview,
    staging_root: &Path,
    library_root: &Path,
) -> Result<(), String> {
    let staged = collect_audio_relative(staging_root)?;
    let staged_set: HashSet<String> = staged.into_iter().map(|(r, _)| r).collect();
    for file in collect_library_audio(library_root)? {
        if !staged_set.contains(&file.rel) {
            preview.changes.push(DeliveryChange {
                change_id: stable_change_id(DeliveryChangeKind::AudioRemove, &file.rel),
                kind: DeliveryChangeKind::AudioRemove,
                summary: format!("Remove: {}", file.rel),
                details: file.rel.clone(),
                default_selected: true,
            });
        }
    }
    Ok(())
}

pub fn stable_change_id(kind: DeliveryChangeKind, details: &str) -> String {
    format!("{}:{}", delivery_change_kind_key(kind), details)
}

fn delivery_change_kind_key(kind: DeliveryChangeKind) -> &'static str {
    match kind {
        DeliveryChangeKind::AudioAdd => "audio_add",
        DeliveryChangeKind::AudioUpdate => "audio_update",
        DeliveryChangeKind::AudioReplace => "audio_replace",
        DeliveryChangeKind::AudioMove => "audio_move",
        DeliveryChangeKind::AudioRemove => "audio_remove",
        DeliveryChangeKind::ScheduleEventAdd => "schedule_event_add",
        DeliveryChangeKind::ScheduleEventUpdate => "schedule_event_update",
        DeliveryChangeKind::ScheduleEventRemove => "schedule_event_remove",
    }
}

fn change(kind: DeliveryChangeKind, summary: String, details: &str) -> DeliveryChange {
    DeliveryChange {
        change_id: stable_change_id(kind, details),
        kind,
        summary,
        details: details.to_string(),
        default_selected: true,
    }
}

/// Map UI-selected change IDs onto a freshly rebuilt preview (stable IDs + kind/details fallback).
pub fn map_selected_change_ids(
    client_ids: &[String],
    session_preview: &DeliveryPreview,
    fresh_preview: &DeliveryPreview,
) -> HashSet<String> {
    let mut selected = HashSet::new();
    for id in client_ids {
        if fresh_preview
            .changes
            .iter()
            .any(|c| c.change_id == *id)
        {
            selected.insert(id.clone());
            continue;
        }
        let Some(logical) = session_preview.changes.iter().find(|c| c.change_id == *id) else {
            continue;
        };
        for c in &fresh_preview.changes {
            if c.kind == logical.kind && c.details == logical.details {
                selected.insert(c.change_id.clone());
                break;
            }
        }
    }
    selected
}

fn collect_library_audio(library_root: &Path) -> Result<Vec<LibraryFile>, String> {
    if !library_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (rel, abs) in collect_audio_relative(library_root)? {
        let hash = sha256_file(&abs).ok();
        out.push(LibraryFile { rel, abs, hash });
    }
    Ok(out)
}

fn tags_differ(staged: &Path, library: &Path) -> Result<bool, String> {
    let a = scanner::read_tags(staged);
    let b = scanner::read_tags(library);
    Ok(a.0 != b.0 || a.1 != b.1 || a.2 != b.2)
}

fn diff_schedule(
    application: ApplicationId,
    changes: &mut Vec<DeliveryChange>,
    staged_schedule: &Path,
    library_root: &Path,
    existing_library_schedule: Option<&Path>,
) -> Result<(), String> {
    let new_map = application::parse_title_map_for_application(application, staged_schedule)?;
    let canonical = existing_library_schedule
        .filter(|p| p.is_file())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| library_root.join(crate::projects::DEFAULT_SCHEDULE_REL));
    let old_map = if canonical.is_file() {
        application::parse_title_map_for_application(application, &canonical).unwrap_or_default()
    } else {
        HashMap::new()
    };

    for (tag, title) in &new_map {
        match old_map.get(tag) {
            None => changes.push(change(
                DeliveryChangeKind::ScheduleEventAdd,
                format!("Event {tag}: {title}"),
                tag,
            )),
            Some(old) if old != title => changes.push(change(
                DeliveryChangeKind::ScheduleEventUpdate,
                format!("Event {tag}: {old} → {title}"),
                tag,
            )),
            _ => {}
        }
    }
    for tag in old_map.keys() {
        if !new_map.contains_key(tag) {
            changes.push(change(
                DeliveryChangeKind::ScheduleEventRemove,
                format!("Event {tag} removed from schedule"),
                tag,
            ));
        }
    }
    Ok(())
}

impl Clone for LibraryFile {
    fn clone(&self) -> Self {
        Self {
            rel: self.rel.clone(),
            abs: self.abs.clone(),
            hash: self.hash.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn identical_staged_and_library_audio_counts_as_unchanged() {
        let base = std::env::temp_dir().join(format!("tv-diff-unchanged-{}", uuid::Uuid::new_v4()));
        let staging = base.join("staging");
        let library = base.join("library");
        fs::create_dir_all(staging.join("tracks")).expect("mkdir staging");
        fs::create_dir_all(library.join("tracks")).expect("mkdir library");
        let bytes = b"same-audio-bytes-for-hash";
        fs::write(staging.join("tracks/01.mp3"), bytes).expect("write staged");
        fs::write(library.join("tracks/01.mp3"), bytes).expect("write library");

        let preview =
            build_preview("sess", &staging, &library, true, None, ApplicationId::None).expect("preview");
        assert_eq!(preview.staged_audio_count, 1);
        assert_eq!(preview.library_audio_count, 1);
        assert_eq!(preview.unchanged_audio_count, 1);
        assert!(
            preview
                .changes
                .iter()
                .all(|c| !matches!(
                    c.kind,
                    DeliveryChangeKind::AudioAdd
                        | DeliveryChangeKind::AudioUpdate
                        | DeliveryChangeKind::AudioReplace
                        | DeliveryChangeKind::AudioMove
                        | DeliveryChangeKind::AudioRemove
                )),
            "expected no audio diff rows, got {:?}",
            preview.changes
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rebuild_preview_uses_stable_change_ids() {
        let base = std::env::temp_dir().join(format!("tv-diff-stable-{}", uuid::Uuid::new_v4()));
        let staging = base.join("staging");
        let library = base.join("library");
        fs::create_dir_all(&staging).expect("mkdir staging");
        fs::create_dir_all(&library).expect("mkdir library");
        fs::write(staging.join("new.mp3"), b"new").expect("write");

        let a =
            build_preview("sess", &staging, &library, true, None, ApplicationId::None).expect("preview a");
        let b =
            build_preview("sess", &staging, &library, true, None, ApplicationId::None).expect("preview b");
        assert_eq!(a.changes.len(), 1);
        assert_eq!(a.changes[0].change_id, b.changes[0].change_id);
        assert_eq!(
            a.changes[0].change_id,
            stable_change_id(DeliveryChangeKind::AudioAdd, "new.mp3")
        );

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
    fn preview_ignores_schedule_for_none_application() {
        let base = std::env::temp_dir().join(format!("tv-diff-no-sched-{}", uuid::Uuid::new_v4()));
        let staging = base.join("staging");
        fs::create_dir_all(&staging).expect("mkdir staging");
        fs::write(staging.join("track.mp3"), b"audio").expect("audio");
        write_minimal_schedule_xlsx(&staging.join("event-schedule.xlsx"));

        let preview = build_preview(
            "sess",
            &staging,
            &base.join("library"),
            false,
            None,
            ApplicationId::None,
        )
        .expect("preview");
        assert!(
            preview
                .changes
                .iter()
                .all(|c| !matches!(
                    c.kind,
                    DeliveryChangeKind::ScheduleEventAdd
                        | DeliveryChangeKind::ScheduleEventUpdate
                        | DeliveryChangeKind::ScheduleEventRemove
                ))
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn preview_includes_schedule_for_ems_application() {
        let base = std::env::temp_dir().join(format!("tv-diff-ems-sched-{}", uuid::Uuid::new_v4()));
        let staging = base.join("staging");
        fs::create_dir_all(&staging).expect("mkdir staging");
        fs::write(staging.join("track.mp3"), b"audio").expect("audio");
        write_minimal_schedule_xlsx(&staging.join("event-schedule.xlsx"));

        let preview = build_preview(
            "sess",
            &staging,
            &base.join("library"),
            false,
            None,
            ApplicationId::UsFigureSkatingEms,
        )
        .expect("preview");
        assert!(
            preview.changes.iter().any(|c| matches!(
                c.kind,
                DeliveryChangeKind::ScheduleEventAdd
            ))
        );

        let _ = fs::remove_dir_all(&base);
    }
}
