use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::project_path;
use crate::replace_track::{build_track_file_side, ReplaceTrackFileSide};
use crate::tags::{read_human_tag_pairs, write_track_tags, TagFieldInput};
use crate::waveform::probe_duration_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapTaglistPreview {
    pub source: ReplaceTrackFileSide,
    pub partner: ReplaceTrackFileSide,
    pub source_project_path: String,
    pub partner_project_path: String,
    pub source_path_after: String,
    pub partner_path_after: String,
    pub partition_key: String,
    pub partner_track_id: i64,
    pub partner_title: String,
    pub different_parent_dirs: bool,
    pub path_swap_collision: bool,
    pub collision_message: Option<String>,
}

struct SwapContext {
    partition_key: String,
    source_track_id: i64,
    partner_track_id: i64,
    source_path: String,
    partner_path: String,
    source_order: Vec<i64>,
    target_order: Vec<i64>,
}

pub fn preview_swap_taglist_entries(
    db: &Database,
    taglist_id: i64,
    source_value: Option<&str>,
    target_value: Option<&str>,
    source_track_id: i64,
    swap_project_paths: bool,
    swap_basenames: bool,
) -> Result<SwapTaglistPreview, String> {
    let ctx = resolve_swap_context(db, taglist_id, source_value, target_value, source_track_id)?;
    let source_path = Path::new(&ctx.source_path);
    let partner_path = Path::new(&ctx.partner_path);

    project_path::ensure_under_project_folder(db, source_path)?;
    project_path::ensure_under_project_folder(db, partner_path)?;

    let source = build_track_file_side(source_path)?;
    let partner = build_track_file_side(partner_path)?;

    let different_parent_dirs = different_parent_dirs(source_path, partner_path);
    let swap_project_paths = swap_project_paths || different_parent_dirs;
    let (new_source, new_partner) =
        compute_swapped_paths(source_path, partner_path, swap_project_paths, swap_basenames);
    let (path_swap_collision, collision_message) = path_swap_collision_message(
        db,
        source_path,
        partner_path,
        &new_source,
        &new_partner,
        ctx.source_track_id,
        ctx.partner_track_id,
    )?;

    Ok(SwapTaglistPreview {
        source_project_path: ctx.source_path.clone(),
        partner_project_path: ctx.partner_path.clone(),
        source_path_after: new_source.to_string_lossy().to_string(),
        partner_path_after: new_partner.to_string_lossy().to_string(),
        partition_key: ctx.partition_key,
        partner_track_id: ctx.partner_track_id,
        partner_title: db
            .get_track(ctx.partner_track_id)
            .map_err(|e| e.to_string())?
            .map(|t| t.title)
            .unwrap_or_else(|| "Partner track".to_string()),
        different_parent_dirs,
        source,
        partner,
        path_swap_collision,
        collision_message,
    })
}

pub fn swap_taglist_entries(
    db: &Database,
    taglist_id: i64,
    source_value: Option<&str>,
    target_value: Option<&str>,
    source_track_id: i64,
    swap_tag_keys: &[String],
    swap_project_paths: bool,
    swap_basenames: bool,
) -> Result<Vec<crate::models::Track>, String> {
    let ctx = resolve_swap_context(db, taglist_id, source_value, target_value, source_track_id)?;
    let source_path = PathBuf::from(&ctx.source_path);
    let partner_path = PathBuf::from(&ctx.partner_path);

    project_path::ensure_under_project_folder(db, &source_path)?;
    project_path::ensure_under_project_folder(db, &partner_path)?;

    let swap_project_paths =
        swap_project_paths || different_parent_dirs(&source_path, &partner_path);
    let (new_source, new_partner) =
        compute_swapped_paths(&source_path, &partner_path, swap_project_paths, swap_basenames);

    if swap_project_paths {
        if let Some(message) = path_swap_collision_message(
            db,
            &source_path,
            &partner_path,
            &new_source,
            &new_partner,
            ctx.source_track_id,
            ctx.partner_track_id,
        )?
        .1
        {
            return Err(message);
        }
        apply_path_swap(&source_path, &partner_path, &new_source, &new_partner)?;
    }

    let final_source_path = if swap_project_paths {
        new_source
    } else {
        source_path.clone()
    };
    let final_partner_path = if swap_project_paths {
        new_partner
    } else {
        partner_path.clone()
    };

    let source_pairs = read_human_tag_pairs(&final_source_path)?;
    let partner_pairs = read_human_tag_pairs(&final_partner_path)?;
    let swap_keys = effective_swap_tag_keys(&ctx.partition_key, swap_tag_keys, &source_pairs);

    let (final_source, final_partner) = compute_final_tag_maps(
        &source_pairs,
        &partner_pairs,
        &ctx.partition_key,
        &swap_keys,
    );

    let source_fields = map_to_fields(&final_source);
    let partner_fields = map_to_fields(&final_partner);

    let source_meta = write_track_tags(db, &final_source_path, &source_fields)?;
    let source_track = db
        .update_project_track_after_replace(
            ctx.source_track_id,
            &final_source_path.to_string_lossy(),
            &source_meta.title,
            &source_meta.artist,
            &source_meta.album,
            probe_duration_ms(&final_source_path).unwrap_or(0),
            source_meta.track_number,
        )
        .map_err(|e| e.to_string())?;
    crate::tag_index::index_track_tags(db, ctx.source_track_id, &final_source_path)?;
    db.sync_taglist_order_for_track(ctx.source_track_id)
        .map_err(|e| e.to_string())?;

    let partner_meta = write_track_tags(db, &final_partner_path, &partner_fields)?;
    let partner_track = db
        .update_project_track_after_replace(
            ctx.partner_track_id,
            &final_partner_path.to_string_lossy(),
            &partner_meta.title,
            &partner_meta.artist,
            &partner_meta.album,
            probe_duration_ms(&final_partner_path).unwrap_or(0),
            partner_meta.track_number,
        )
        .map_err(|e| e.to_string())?;
    crate::tag_index::index_track_tags(db, ctx.partner_track_id, &final_partner_path)?;
    db.sync_taglist_order_for_track(ctx.partner_track_id)
        .map_err(|e| e.to_string())?;

    db.apply_taglist_swap_order_slots(
        taglist_id,
        source_value,
        target_value,
        ctx.source_track_id,
        ctx.partner_track_id,
        &ctx.source_order,
        &ctx.target_order,
    )
    .map_err(|e| e.to_string())?;

    Ok(vec![source_track, partner_track])
}

pub fn compute_swapped_paths(
    source_path: &Path,
    partner_path: &Path,
    swap_project_paths: bool,
    swap_basenames: bool,
) -> (PathBuf, PathBuf) {
    if !swap_project_paths || source_path == partner_path {
        return (source_path.to_path_buf(), partner_path.to_path_buf());
    }

    let source_name = source_path.file_name().unwrap_or_default();
    let partner_name = partner_path.file_name().unwrap_or_default();
    let Some(source_parent) = source_path.parent() else {
        return (source_path.to_path_buf(), partner_path.to_path_buf());
    };
    let Some(partner_parent) = partner_path.parent() else {
        return (source_path.to_path_buf(), partner_path.to_path_buf());
    };

    if source_parent == partner_parent {
        if swap_basenames {
            return (partner_path.to_path_buf(), source_path.to_path_buf());
        }
        return (source_path.to_path_buf(), partner_path.to_path_buf());
    }

    let new_source = if swap_basenames {
        partner_parent.join(partner_name)
    } else {
        partner_parent.join(source_name)
    };
    let new_partner = if swap_basenames {
        source_parent.join(source_name)
    } else {
        source_parent.join(partner_name)
    };
    (new_source, new_partner)
}

fn different_parent_dirs(source_path: &Path, partner_path: &Path) -> bool {
    source_path.parent() != partner_path.parent()
}

fn resolve_swap_context(
    db: &Database,
    taglist_id: i64,
    source_value: Option<&str>,
    target_value: Option<&str>,
    source_track_id: i64,
) -> Result<SwapContext, String> {
    crate::tag_index::backfill_unindexed_tracks(db)?;
    let taglist = db
        .get_taglist(taglist_id)
        .map_err(|e| e.to_string())?
        .ok_or("Taglist not found")?;
    if taglist.entry_tag_key.trim().is_empty() {
        return Err("Taglist has no entry tag configured".to_string());
    }

    let partner_track_id = db
        .resolve_taglist_swap_partner(
            taglist_id,
            source_value,
            target_value,
            source_track_id,
        )
        .map_err(|e| e.to_string())?;

    let source_track = db
        .get_track(source_track_id)
        .map_err(|e| e.to_string())?
        .ok_or("Source track not found")?;
    let partner_track = db
        .get_track(partner_track_id)
        .map_err(|e| e.to_string())?
        .ok_or("Partner track not found")?;

    let source_tracks = db
        .list_taglist_tracks(taglist_id, &taglist.tag_key, source_value)
        .map_err(|e| e.to_string())?;
    let target_tracks = db
        .list_taglist_tracks(taglist_id, &taglist.tag_key, target_value)
        .map_err(|e| e.to_string())?;

    Ok(SwapContext {
        partition_key: taglist.tag_key,
        source_track_id,
        partner_track_id,
        source_path: source_track.path,
        partner_path: partner_track.path,
        source_order: source_tracks.iter().map(|t| t.id).collect(),
        target_order: target_tracks.iter().map(|t| t.id).collect(),
    })
}

fn effective_swap_tag_keys(
    partition_key: &str,
    swap_tag_keys: &[String],
    source_pairs: &[(String, String)],
) -> HashSet<String> {
    let mut keys: HashSet<String> = swap_tag_keys.iter().cloned().collect();
    if source_pairs.iter().any(|(key, _)| key == partition_key) {
        keys.insert(partition_key.to_string());
    }
    keys
}

pub fn compute_final_tag_maps(
    source_pairs: &[(String, String)],
    partner_pairs: &[(String, String)],
    partition_key: &str,
    swap_tag_keys: &HashSet<String>,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let source_map = pairs_to_map(source_pairs);
    let partner_map = pairs_to_map(partner_pairs);
    let mut all_keys: HashSet<String> = source_map.keys().cloned().collect();
    all_keys.extend(partner_map.keys().cloned());

    let mut final_source = HashMap::new();
    let mut final_partner = HashMap::new();

    for key in all_keys {
        let source_val = source_map.get(&key).cloned().unwrap_or_default();
        let partner_val = partner_map.get(&key).cloned().unwrap_or_default();
        if key == partition_key {
            final_source.insert(key.clone(), partner_val);
            final_partner.insert(key.clone(), source_val);
        } else if swap_tag_keys.contains(&key) {
            final_source.insert(key.clone(), partner_val);
            final_partner.insert(key.clone(), source_val);
        } else {
            final_source.insert(key.clone(), source_val);
            final_partner.insert(key, partner_val);
        }
    }

    (final_source, final_partner)
}

fn pairs_to_map(pairs: &[(String, String)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn map_to_fields(map: &HashMap<String, String>) -> Vec<TagFieldInput> {
    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    keys.into_iter()
        .map(|key| TagFieldInput {
            key: key.clone(),
            value: map.get(&key).cloned().unwrap_or_default(),
        })
        .collect()
}

fn path_swap_collision_message(
    db: &Database,
    source_path: &Path,
    partner_path: &Path,
    new_source: &Path,
    new_partner: &Path,
    source_track_id: i64,
    partner_track_id: i64,
) -> Result<(bool, Option<String>), String> {
    if new_source == source_path && new_partner == partner_path {
        return Ok((false, None));
    }
    if !source_path.is_file() || !partner_path.is_file() {
        return Ok((
            true,
            Some("Both tracks must exist on disk to swap library paths.".to_string()),
        ));
    }
    if new_source == new_partner {
        return Ok((
            true,
            Some("Swap would place both tracks at the same path.".to_string()),
        ));
    }
    for (target, label) in [(new_source, "source"), (new_partner, "partner")] {
        if target.exists() && target != source_path && target != partner_path {
            let name = target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            if let Some(other_id) = db
                .get_track_id_by_path(&target.to_string_lossy())
                .map_err(|e| e.to_string())?
            {
                if other_id != source_track_id && other_id != partner_track_id {
                    let title = db
                        .get_track(other_id)
                        .map_err(|e| e.to_string())?
                        .map(|t| t.title)
                        .unwrap_or_else(|| "another track".to_string());
                    return Ok((
                        true,
                        Some(format!(
                            "Cannot swap: \"{name}\" is already used by \"{title}\" ({label} target)."
                        )),
                    ));
                }
            }
            return Ok((
                true,
                Some(format!(
                    "A file named \"{name}\" already exists at the {label} target location."
                )),
            ));
        }
    }
    Ok((false, None))
}

fn apply_path_swap(
    source_path: &Path,
    partner_path: &Path,
    new_source: &Path,
    new_partner: &Path,
) -> Result<(), String> {
    if new_source == source_path && new_partner == partner_path {
        return Ok(());
    }
    if new_source == partner_path && new_partner == source_path {
        return exchange_paths_same_parent(source_path, partner_path);
    }

    let temp_source = temp_swap_path(source_path);
    let temp_partner = temp_swap_path(partner_path);

    if temp_source.exists() {
        fs::remove_file(&temp_source)
            .map_err(|e| format!("Failed to clear swap temp file: {e}"))?;
    }
    if temp_partner.exists() {
        fs::remove_file(&temp_partner)
            .map_err(|e| format!("Failed to clear swap temp file: {e}"))?;
    }

    fs::rename(source_path, &temp_source)
        .map_err(|e| format!("Failed to start path swap: {e}"))?;
    if let Err(err) = fs::rename(partner_path, &temp_partner) {
        let _ = fs::rename(&temp_source, source_path);
        return Err(format!("Failed to start path swap: {err}"));
    }

    if let Err(err) = fs::rename(&temp_source, new_source) {
        let _ = fs::rename(&temp_partner, partner_path);
        let _ = fs::rename(&temp_source, source_path);
        return Err(format!("Failed to complete path swap: {err}"));
    }
    fs::rename(&temp_partner, new_partner)
        .map_err(|e| format!("Failed to complete path swap: {e}"))?;
    Ok(())
}

fn exchange_paths_same_parent(source_path: &Path, partner_path: &Path) -> Result<(), String> {
    let parent = source_path
        .parent()
        .ok_or("Track has no parent directory.")?;
    let temp_path = parent.join(format!(".trackvault-swap-{}.tmp", std::process::id()));
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|e| format!("Failed to clear swap temp file: {e}"))?;
    }
    fs::rename(source_path, &temp_path)
        .map_err(|e| format!("Failed to start path swap: {e}"))?;
    if let Err(err) = fs::rename(partner_path, source_path) {
        let _ = fs::rename(&temp_path, source_path);
        return Err(format!("Failed to swap paths: {err}"));
    }
    fs::rename(&temp_path, partner_path)
        .map_err(|e| format!("Failed to complete path swap: {e}"))?;
    Ok(())
}

fn temp_swap_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("track");
    parent.join(format!(
        ".trackvault-swap-{stem}-{}.tmp",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_swapped_paths_same_parent_basenames_only() {
        let a = Path::new(r"C:\lib\foo.mp3");
        let b = Path::new(r"C:\lib\bar.mp3");
        let (na, nb) = compute_swapped_paths(a, b, true, true);
        assert_eq!(na, b);
        assert_eq!(nb, a);
        let (na, nb) = compute_swapped_paths(a, b, true, false);
        assert_eq!(na, a);
        assert_eq!(nb, b);
    }

    #[test]
    fn compute_swapped_paths_cross_folder() {
        let a = Path::new(r"C:\lib\event01\foo.mp3");
        let b = Path::new(r"C:\lib\event02\bar.mp3");
        let (na, nb) = compute_swapped_paths(a, b, true, false);
        assert_eq!(na, Path::new(r"C:\lib\event02\foo.mp3"));
        assert_eq!(nb, Path::new(r"C:\lib\event01\bar.mp3"));
        let (na, nb) = compute_swapped_paths(a, b, true, true);
        assert_eq!(na, b);
        assert_eq!(nb, a);
    }

    #[test]
    fn compute_final_tag_maps_always_swaps_partition() {
        let source = vec![
            ("Composer".to_string(), "01".to_string()),
            ("Track Title".to_string(), "Short Program".to_string()),
        ];
        let partner = vec![
            ("Composer".to_string(), "02".to_string()),
            ("Track Title".to_string(), "Short Program".to_string()),
        ];
        let keys: HashSet<String> = HashSet::new();
        let (final_source, final_partner) =
            compute_final_tag_maps(&source, &partner, "Composer", &keys);
        assert_eq!(final_source.get("Composer").map(String::as_str), Some("02"));
        assert_eq!(final_partner.get("Composer").map(String::as_str), Some("01"));
    }
}
