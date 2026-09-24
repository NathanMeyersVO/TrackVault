use std::fs;

use std::path::{Path, PathBuf};



use serde::{Deserialize, Serialize};



use crate::db::Database;

use crate::library_path;

use crate::scanner::{is_audio_file, read_tags};

use crate::tags::{read_human_tag_pairs, read_track_tags, write_track_tags, TagFieldInput};

use crate::waveform::probe_duration_ms;



#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ReplaceTrackTagValue {

    pub key: String,

    pub value: String,

}



#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ReplaceTrackFileSide {

    pub file_name: String,

    pub duration_ms: i64,

    pub file_size_bytes: u64,

    pub tags: Vec<ReplaceTrackTagValue>,

}



#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct ReplaceTrackFilePreview {

    pub existing: ReplaceTrackFileSide,

    pub replacement: ReplaceTrackFileSide,

    pub library_path_before: String,

    pub library_path_after: String,

    pub path_collision: bool,

    pub collision_message: Option<String>,

}



pub fn preview_replace_library_track_file(

    db: &Database,

    track_id: i64,

    source_path: &Path,

) -> Result<ReplaceTrackFilePreview, String> {

    let dest_path = resolve_library_dest_path(db, track_id)?;

    let dest = Path::new(&dest_path);

    validate_source_for_replace(&dest_path, source_path)?;



    let (target_path, collision_message) =

        resolve_target_path(db, track_id, dest, source_path)?;



    let existing = build_side(dest)?;

    let replacement = build_side(source_path)?;



    Ok(ReplaceTrackFilePreview {

        existing,

        replacement,

        library_path_before: dest_path,

        library_path_after: target_path.to_string_lossy().to_string(),

        path_collision: collision_message.is_some(),

        collision_message,

    })

}



pub fn replace_library_track_file(

    db: &Database,

    track_id: i64,

    source_path: &Path,

) -> Result<crate::models::Track, String> {

    let dest_path = resolve_library_dest_path(db, track_id)?;

    validate_source_for_replace(&dest_path, source_path)?;



    let dest_path_buf = PathBuf::from(&dest_path);

    let (target_path, collision_message) =

        resolve_target_path(db, track_id, &dest_path_buf, source_path)?;

    if let Some(message) = collision_message {

        return Err(message);

    }



    let tag_pairs = read_human_tag_pairs(&dest_path_buf)?;

    let fields: Vec<TagFieldInput> = tag_pairs

        .into_iter()

        .map(|(key, value)| TagFieldInput { key, value })

        .collect();



    install_replacement_file(

        db,

        source_path,

        &dest_path_buf,

        &target_path,

        &fields,

    )?;



    let (title, artist, album, track_number, _) = read_tags(&target_path);

    let duration_ms = probe_duration_ms(&target_path).unwrap_or(0);

    let path_str = target_path.to_string_lossy().to_string();



    db.update_library_track_after_replace(

        track_id,

        &path_str,

        &title,

        &artist,

        &album,

        duration_ms,

        track_number,

    )

    .map_err(|e| e.to_string())?;



    crate::tag_index::index_track_tags(db, track_id, &target_path)?;

    db.sync_taglist_order_for_track(track_id)

        .map_err(|e| e.to_string())?;



    db.get_track(track_id)

        .map_err(|e| e.to_string())?

        .ok_or_else(|| "Track not found after replace".to_string())

}



fn install_replacement_file(

    db: &Database,

    source_path: &Path,

    dest_path: &Path,

    target_path: &Path,

    fields: &[TagFieldInput],

) -> Result<(), String> {

    let temp_path = temp_replace_path(target_path);



    if temp_path.exists() {

        let _ = fs::remove_file(&temp_path);

    }



    fs::copy(source_path, &temp_path)

        .map_err(|e| format!("Failed to copy replacement file: {e}"))?;



    if let Err(error) = write_track_tags(db, &temp_path, fields) {

        let _ = fs::remove_file(&temp_path);

        return Err(error);

    }



    let dest_is_target = paths_are_same_file(dest_path, target_path)?;



    if !dest_is_target && dest_path.exists() {

        fs::remove_file(dest_path)

            .map_err(|e| format!("Failed to remove existing project library file: {e}"))?;

    }



    if target_path.exists() {

        fs::remove_file(target_path)

            .map_err(|e| format!("Failed to remove existing file at target path: {e}"))?;

    }



    if let Err(rename_error) = fs::rename(&temp_path, target_path) {

        fs::copy(&temp_path, target_path)

            .map_err(|e| format!("Failed to install replacement file: {e}"))?;

        let _ = fs::remove_file(&temp_path);

        if rename_error.kind() != std::io::ErrorKind::AlreadyExists {

            // copy succeeded

        }

    }



    Ok(())

}



fn resolve_target_path(

    db: &Database,

    track_id: i64,

    dest_path: &Path,

    source_path: &Path,

) -> Result<(PathBuf, Option<String>), String> {

    let parent = dest_path

        .parent()

        .ok_or_else(|| "Project library track has no parent directory.".to_string())?;

    let file_name = source_path

        .file_name()

        .and_then(|name| name.to_str())

        .filter(|name| !name.is_empty())

        .ok_or_else(|| "Replacement file has no valid name.".to_string())?;



    let target_path = parent.join(file_name);



    if paths_are_same_file(dest_path, &target_path)? {

        return Ok((dest_path.to_path_buf(), None));

    }



    if let Some(message) = path_collision_message(db, track_id, dest_path, &target_path)? {

        return Ok((target_path, Some(message)));

    }



    Ok((target_path, None))

}



fn path_collision_message(

    db: &Database,

    track_id: i64,

    dest_path: &Path,

    target_path: &Path,

) -> Result<Option<String>, String> {

    if paths_are_same_file(dest_path, target_path)? {

        return Ok(None);

    }



    let target_str = target_path.to_string_lossy().to_string();



    if target_path.exists() {

        if let Some(other_id) = db.get_track_id_by_path(&target_str).map_err(|e| e.to_string())? {

            if other_id != track_id {

                let title = db

                    .get_track(other_id)

                    .map_err(|e| e.to_string())?

                    .map(|track| track.title)

                    .unwrap_or_else(|| "another track".to_string());

                return Ok(Some(format!(

                    "A file named \"{}\" already exists in this folder (indexed as \"{}\"). Choose a differently named file or resolve the folder outside TrackVault.",

                    target_path

                        .file_name()

                        .and_then(|n| n.to_str())

                        .unwrap_or("file"),

                    title

                )));

            }

        }

        return Ok(Some(format!(

            "A file named \"{}\" already exists in this folder. Choose a differently named file or resolve the folder outside TrackVault.",

            target_path

                .file_name()

                .and_then(|n| n.to_str())

                .unwrap_or("file")

        )));

    }



    if let Some(other_id) = db.get_track_id_by_path(&target_str).map_err(|e| e.to_string())? {

        if other_id != track_id {

            return Ok(Some(format!(

                "The path \"{}\" is already used by another project library track.",

                target_str

            )));

        }

    }



    Ok(None)

}



fn resolve_library_dest_path(db: &Database, track_id: i64) -> Result<String, String> {

    if !db.is_library_track(track_id).map_err(|e| e.to_string())? {

        return Err("Only project library tracks can be replaced".to_string());

    }

    let path = db

        .get_track_path(track_id)

        .map_err(|e| e.to_string())?

        .ok_or("Track not found")?;

    library_path::ensure_under_library_folder(db, Path::new(&path))?;

    Ok(path)

}



pub fn validate_replacement_source(
    db: &Database,
    track_id: i64,
    source_path: &Path,
) -> Result<(), String> {
    let dest_path = resolve_library_dest_path(db, track_id)?;
    validate_source_for_replace(&dest_path, source_path)
}

fn validate_source_for_replace(dest_path: &str, source_path: &Path) -> Result<(), String> {

    if !source_path.is_file() {

        return Err(format!(

            "Not a file: {}",

            source_path.to_string_lossy()

        ));

    }

    if !is_audio_file(source_path) {

        return Err(format!(

            "Unsupported file type: {}",

            source_path.to_string_lossy()

        ));

    }

    if probe_duration_ms(source_path).is_none() {

        return Err(format!(

            "Could not read audio from file: {}",

            source_path.to_string_lossy()

        ));

    }

    if paths_are_same_file(Path::new(dest_path), source_path)? {

        return Err("Choose a different file than the project library track itself.".to_string());

    }

    Ok(())

}



fn paths_are_same_file(a: &Path, b: &Path) -> Result<bool, String> {
    let a_exists = a
        .try_exists()
        .map_err(|e| format!("Invalid path {}: {e}", a.to_string_lossy()))?;
    let b_exists = b
        .try_exists()
        .map_err(|e| format!("Invalid path {}: {e}", b.to_string_lossy()))?;
    if !a_exists || !b_exists {
        return Ok(false);
    }
    let canonical_a = fs::canonicalize(a)
        .map_err(|e| format!("Invalid path {}: {e}", a.to_string_lossy()))?;
    let canonical_b = fs::canonicalize(b)
        .map_err(|e| format!("Invalid path {}: {e}", b.to_string_lossy()))?;
    Ok(canonical_a == canonical_b)
}



fn build_side(path: &Path) -> Result<ReplaceTrackFileSide, String> {

    let file_name = path

        .file_name()

        .and_then(|name| name.to_str())

        .unwrap_or("Unknown")

        .to_string();

    let duration_ms = probe_duration_ms(path).unwrap_or(0);

    let file_size_bytes = fs::metadata(path)

        .map_err(|e| format!("Failed to read file size: {e}"))?

        .len();

    let info = read_track_tags(path)?;

    let tags = info

        .fields

        .into_iter()

        .map(|field| ReplaceTrackTagValue {

            key: field.key,

            value: field.value,

        })

        .collect();

    Ok(ReplaceTrackFileSide {

        file_name,

        duration_ms,

        file_size_bytes,

        tags,

    })

}



fn temp_replace_path(target: &Path) -> PathBuf {
    let stem = target
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("track");
    let ext = target
        .extension()
        .and_then(|name| name.to_str())
        .map(|name| format!(".{name}"))
        .unwrap_or_default();
    target.with_file_name(format!("{stem}.trackvault-replace{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_same_file_false_when_planned_target_missing() {
        let base = std::env::temp_dir().join(format!(
            "trackvault_replace_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let dest = base.join("old.mp3");
        fs::write(&dest, b"test").unwrap();
        let target = base.join("new.mp3");
        assert!(!paths_are_same_file(&dest, &target).unwrap());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn temp_replace_path_preserves_audio_extension() {
        let target = Path::new(r"C:\library\Berniece Pacocha.mp3");
        let temp = temp_replace_path(target);
        assert_eq!(
            temp.file_name().and_then(|n| n.to_str()),
            Some("Berniece Pacocha.trackvault-replace.mp3")
        );
    }
}

