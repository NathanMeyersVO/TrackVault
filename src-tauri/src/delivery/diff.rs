use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::staging::{collect_audio_relative, find_schedule_xlsx};
use super::{DeliveryChange, DeliveryChangeKind};
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
                    changes.push(DeliveryChange {
                        change_id: Uuid::new_v4().to_string(),
                        kind: DeliveryChangeKind::AudioMove,
                        summary: format!("Move: {old_rel} → {rel}"),
                        details: format!("from={old_rel};to={rel}"),
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

    if let Some(schedule) = find_schedule_xlsx(staging_root)? {
        if for_update {
            diff_schedule(&mut changes, &schedule, library_root)?;
        } else {
            if let Ok(mappings) = crate::title_map::parse_usfs_ems_schedule(&schedule) {
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
                change_id: Uuid::new_v4().to_string(),
                kind: DeliveryChangeKind::AudioRemove,
                summary: format!("Remove: {}", file.rel),
                details: file.rel.clone(),
                default_selected: true,
            });
        }
    }
    Ok(())
}

fn change(kind: DeliveryChangeKind, summary: String, details: &str) -> DeliveryChange {
    DeliveryChange {
        change_id: Uuid::new_v4().to_string(),
        kind,
        summary,
        details: details.to_string(),
        default_selected: true,
    }
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
    changes: &mut Vec<DeliveryChange>,
    staged_schedule: &Path,
    library_root: &Path,
) -> Result<(), String> {
    let new_map = crate::title_map::parse_usfs_ems_schedule(staged_schedule)?;
    let canonical = library_root.join(crate::projects::DEFAULT_SCHEDULE_REL);
    let old_map = if canonical.is_file() {
        crate::title_map::parse_usfs_ems_schedule(&canonical).unwrap_or_default()
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
