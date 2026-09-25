use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::progress::DeliveryProgressCtx;
use super::staging::{collect_audio_relative, find_schedule_xlsx};
use super::{DeliveryChange, DeliveryChangeKind};
use crate::application::{self, ApplicationId};
use crate::models::DeliveryProgressPhase;
use crate::config;
use crate::project_config::autosave_trackvault_json;
use crate::projects::{self, ProjectManifest};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplyMode {
    Merge,
    FullReplace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyDeliveryResult {
    pub applied: u32,
    pub skipped: u32,
}

pub fn apply_delivery(
    db: &crate::db::Database,
    project_root: &Path,
    manifest: &mut ProjectManifest,
    staging_root: &Path,
    changes: &[DeliveryChange],
    selected_ids: &HashSet<String>,
    apply_mode: ApplyMode,
    application: ApplicationId,
    progress: &DeliveryProgressCtx,
) -> Result<ApplyDeliveryResult, String> {
    let library_root = projects::library_dir(project_root);
    fs::create_dir_all(&library_root).map_err(|e| e.to_string())?;

    let selected: Vec<&DeliveryChange> = changes
        .iter()
        .filter(|c| selected_ids.contains(&c.change_id))
        .collect();

    let staged_audio: HashMap<String, PathBuf> = collect_audio_relative(staging_root)?
        .into_iter()
        .collect();

    let mut applied = 0u32;
    let skipped = (changes.len().saturating_sub(selected.len())) as u32;
    let total = selected.len() as u32;
    if total > 0 {
        progress.emit(DeliveryProgressPhase::Applying, 0, total, false, None);
    }

    for (index, change) in selected.iter().enumerate() {
        progress.emit(
            DeliveryProgressPhase::Applying,
            index as u32,
            total,
            false,
            Some(change.summary.clone()),
        );
        match change.kind {
            DeliveryChangeKind::AudioRemove => {
                let rel = change.details.trim();
                let target = library_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
                if target.is_file() {
                    fs::remove_file(&target).map_err(|e| e.to_string())?;
                }
                applied += 1;
            }
            DeliveryChangeKind::AudioMove => {
                let (from, to) = parse_move_details(&change.details)?;
                copy_staged_file(&staged_audio, &library_root, &to)?;
                let old = library_root.join(from.replace('/', std::path::MAIN_SEPARATOR_STR));
                if old.is_file() {
                    fs::remove_file(&old).map_err(|e| e.to_string())?;
                }
                migrate_path_in_config(db, &library_root, &from, &to)?;
                applied += 1;
            }
            DeliveryChangeKind::AudioAdd
            | DeliveryChangeKind::AudioUpdate
            | DeliveryChangeKind::AudioReplace => {
                let rel = change.details.trim();
                copy_staged_file(&staged_audio, &library_root, rel)?;
                applied += 1;
            }
            DeliveryChangeKind::ScheduleEventAdd
            | DeliveryChangeKind::ScheduleEventUpdate
            | DeliveryChangeKind::ScheduleEventRemove => {
                // Handled in batch after loop
            }
        }
        progress.emit(
            DeliveryProgressPhase::Applying,
            index as u32 + 1,
            total,
            false,
            Some(change.summary.clone()),
        );
    }

    let schedule_selected = selected.iter().any(|c| {
        matches!(
            c.kind,
            DeliveryChangeKind::ScheduleEventAdd
                | DeliveryChangeKind::ScheduleEventUpdate
                | DeliveryChangeKind::ScheduleEventRemove
        )
    });

    if application::supports_schedule_delivery(application) && schedule_selected {
        if let Some(staged_schedule) = find_schedule_xlsx(staging_root)? {
            let old_dest = projects::schedule_path(project_root, manifest);
            manifest.schedule_relative_path =
                projects::canonical_schedule_relative_path(&staged_schedule);
            let dest = projects::schedule_path(project_root, manifest);
            if old_dest != dest && old_dest.is_file() {
                fs::remove_file(&old_dest).map_err(|e| e.to_string())?;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&staged_schedule, &dest).map_err(|e| e.to_string())?;
            import_schedule_merge(db, application, &dest, selected.iter().copied())?;
            if let Ok(meta) = fs::metadata(&dest) {
                if let Ok(modified) = meta.modified() {
                    manifest.schedule_last_imported_mtime = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_secs() as i64);
                }
            }
        }
    }

    projects::save_manifest(project_root, manifest)?;
    let _ = apply_mode;
    autosave_trackvault_json(db, &library_root)?;

    Ok(ApplyDeliveryResult { applied, skipped })
}

fn copy_staged_file(
    staged: &HashMap<String, PathBuf>,
    library_root: &Path,
    rel: &str,
) -> Result<(), String> {
    let src = staged
        .get(rel)
        .ok_or_else(|| format!("Staged file missing: {rel}"))?;
    let dest = library_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn parse_move_details(details: &str) -> Result<(String, String), String> {
    let mut from = None;
    let mut to = None;
    for part in details.split(';') {
        if let Some(v) = part.strip_prefix("from=") {
            from = Some(v.to_string());
        } else if let Some(v) = part.strip_prefix("to=") {
            to = Some(v.to_string());
        }
    }
    match (from, to) {
        (Some(f), Some(t)) => Ok((f, t)),
        _ => Err(format!("Invalid move details: {details}")),
    }
}

fn migrate_path_in_config(
    db: &crate::db::Database,
    library_root: &Path,
    from_rel: &str,
    to_rel: &str,
) -> Result<(), String> {
    let path = config::config_file_path(library_root);
    if !path.is_file() {
        return Ok(());
    }
    let mut cfg = config::load_config_file(library_root)?
        .ok_or_else(|| "trackvault.json missing".to_string())?;
    for playlist in &mut cfg.playlists {
        for track in &mut playlist.tracks {
            if track == from_rel {
                *track = to_rel.to_string();
            }
        }
    }
    for taglist in &mut cfg.taglists {
        for paths in taglist.track_order.values_mut() {
            for track in paths.iter_mut() {
                if track == from_rel {
                    *track = to_rel.to_string();
                }
            }
        }
    }
    config::apply_config(db, library_root, &cfg)?;
    Ok(())
}

fn import_schedule_merge<'a>(
    db: &crate::db::Database,
    application: ApplicationId,
    schedule_path: &Path,
    selected: impl Iterator<Item = &'a DeliveryChange>,
) -> Result<(), String> {
    let mappings = application::parse_title_map_for_application(application, schedule_path)?;
    let taglist = db
        .get_taglist_by_name("Events")
        .map_err(|e| e.to_string())?;
    let Some(taglist) = taglist else {
        return Ok(());
    };

    let schedule_changes: Vec<&DeliveryChange> = selected
        .filter(|c| {
            matches!(
                c.kind,
                DeliveryChangeKind::ScheduleEventAdd
                    | DeliveryChangeKind::ScheduleEventUpdate
                    | DeliveryChangeKind::ScheduleEventRemove
            )
        })
        .collect();

    if schedule_changes.is_empty() {
        return Ok(());
    }

    let existing = db
        .get_taglist_value_titles(taglist.id)
        .map_err(|e| e.to_string())?;

    let mut merged = existing.clone();
    for change in schedule_changes {
        let tag = &change.details;
        if matches!(change.kind, DeliveryChangeKind::ScheduleEventRemove) {
            merged.remove(tag);
            continue;
        }
        if let Some(title) = mappings.get(tag) {
            if existing.get(tag) == Some(title) {
                continue;
            }
            merged.insert(tag.clone(), title.clone());
        }
    }

    db.import_taglist_titles(taglist.id, &merged)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery::diff::stable_change_id;
    use crate::delivery::progress::DeliveryProgressCtx;
    use crate::delivery::{DeliveryChange, DeliveryChangeKind};
    use crate::projects::ProjectManifest;
    use std::io::Write;

    #[test]
    fn apply_delivery_honors_stable_change_ids() {
        let base = std::env::temp_dir().join(format!("tv-apply-{}", uuid::Uuid::new_v4()));
        let project_root = base.join("project");
        let library = project_root.join("library");
        let staging = base.join("staging");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::create_dir_all(&staging).unwrap();

        let track_rel = "tracks/one.mp3";
        let staged_path = staging.join(track_rel);
        std::fs::create_dir_all(staged_path.parent().unwrap()).unwrap();
        let mut f = std::fs::File::create(&staged_path).unwrap();
        f.write_all(b"fake-mp3").unwrap();

        let change_id =
            stable_change_id(DeliveryChangeKind::AudioAdd, track_rel);
        let changes = vec![DeliveryChange {
            change_id: change_id.clone(),
            kind: DeliveryChangeKind::AudioAdd,
            summary: "Add: tracks/one.mp3".to_string(),
            details: track_rel.to_string(),
            default_selected: true,
        }];

        let db = crate::db::Database::open(std::path::Path::new(":memory:")).unwrap();
        db.set_project_folder(&library.to_string_lossy()).unwrap();

        let mut manifest = ProjectManifest::new(
            "proj".to_string(),
            "Test".to_string(),
            "none".to_string(),
        );
        projects::save_manifest(&project_root, &manifest).unwrap();

        let selected = HashSet::from([change_id]);
        let result = apply_delivery(
            &db,
            &project_root,
            &mut manifest,
            &staging,
            &changes,
            &selected,
            ApplyMode::Merge,
            crate::application::ApplicationId::None,
            &DeliveryProgressCtx::none(),
        )
        .unwrap();

        assert_eq!(result.applied, 1);
        assert!(library.join(track_rel).is_file());

        let _ = std::fs::remove_dir_all(&base);
    }
}
