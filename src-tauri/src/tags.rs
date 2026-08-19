use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag};
use serde::{Deserialize, Serialize};

use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagField {
    pub key: String,
    pub value: String,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackTagInfo {
    pub file_name: String,
    pub path: String,
    pub tag_type: Option<String>,
    pub fields: Vec<TagField>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TagFieldInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_number: Option<i32>,
}

pub fn read_track_tags(path: &Path) -> Result<TrackTagInfo, String> {
    let path_str = path.to_string_lossy().to_string();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read tags: {e}"))?;

    let primary_type = tagged
        .primary_tag()
        .map(|tag| format!("{:?}", tag.tag_type()));

    let mut fields = Vec::new();
    if let Some(tag) = tagged.primary_tag() {
        collect_human_tag_fields(tag, &mut fields);
    }

    Ok(TrackTagInfo {
        file_name,
        path: path_str,
        tag_type: primary_type,
        fields,
    })
}

pub fn write_track_tags(
    db: &Database,
    path: &Path,
    fields: &[TagFieldInput],
) -> Result<TrackMetadata, String> {
    ensure_writable_watch_path(db, path)?;
    check_file_writable(path)?;

    let mut tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read file: {e}"))?;

    if !tagged.file_type().supports_tag_type(tagged.primary_tag_type()) {
        return Err("This file format does not support tag writing.".to_string());
    }

    let tag_type = tagged.primary_tag_type();
    if tagged.primary_tag_mut().is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged
        .primary_tag_mut()
        .ok_or("Failed to access writable tag")?;

    let expected: HashMap<String, String> = fields
        .iter()
        .map(|field| (field.key.clone(), field.value.clone()))
        .collect();

    for (key, value) in &expected {
        let item_key = parse_item_key(key)
            .ok_or_else(|| format!("Unsupported or ambiguous tag key: {key}"))?;
        if value.trim().is_empty() {
            tag.remove_key(&item_key);
        } else {
            tag.insert_text(item_key, value.clone());
        }
    }

    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to write tags to file: {e}"))?;

    verify_written_tags(path, &expected)?;

    Ok(extract_metadata(path)?)
}

pub fn read_human_tag_pairs(path: &Path) -> Result<Vec<(String, String)>, String> {
    let tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read tags: {e}"))?;

    let mut fields = Vec::new();
    if let Some(tag) = tagged.primary_tag() {
        collect_human_tag_fields(tag, &mut fields);
    }

    Ok(fields
        .into_iter()
        .filter_map(|field| {
            let value = field.value.trim();
            if value.is_empty() {
                None
            } else {
                Some((field.key, value.to_string()))
            }
        })
        .collect())
}

pub fn extract_metadata(path: &Path) -> Result<TrackMetadata, String> {
    let tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let file_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut title = file_name;
    let mut artist = String::new();
    let mut album = String::new();
    let mut track_number = None;

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

    Ok(TrackMetadata {
        title,
        artist,
        album,
        track_number,
    })
}

fn verify_written_tags(path: &Path, expected: &HashMap<String, String>) -> Result<(), String> {
    let info = read_track_tags(path)?;
    let mut actual: HashMap<String, String> = HashMap::new();
    for field in info.fields {
        if field.editable {
            actual.insert(field.key, field.value);
        }
    }

    for (key, value) in expected {
        if !field_value_matches(value, actual.get(key).map(String::as_str)) {
            return Err(
                "Tags were written but could not be verified. Try rescanning the library."
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn collect_human_tag_fields(tag: &Tag, fields: &mut Vec<TagField>) {
    for item in tag.items() {
        let key = item_key_label(item.key());
        if !is_human_tag_key(&key) {
            continue;
        }

        match item.value() {
            ItemValue::Text(text) => fields.push(TagField {
                key,
                value: text.clone(),
                editable: true,
            }),
            ItemValue::Locator(loc) => fields.push(TagField {
                key,
                value: loc.clone(),
                editable: true,
            }),
            _ => fields.push(TagField {
                key,
                value: "[Binary data]".to_string(),
                editable: false,
            }),
        }
    }
}

fn field_value_matches(expected: &str, actual: Option<&str>) -> bool {
    if expected.trim().is_empty() {
        actual.map(|value| value.trim().is_empty()).unwrap_or(true)
    } else {
        actual == Some(expected)
    }
}

fn check_file_writable(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("File not found.".to_string());
    }

    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot access file: {e}"))?;
    if metadata.permissions().readonly() {
        return Err("Cannot save tags: file is read-only or write access denied.".to_string());
    }

    OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|_| "Cannot save tags: file is read-only or write access denied.".to_string())?;

    Ok(())
}

fn ensure_writable_watch_path(db: &Database, path: &Path) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid track path: {e}"))?;
    let folder = db
        .get_library_folder()
        .map_err(|e| format!("Database error: {e}"))?
        .ok_or("No library folder configured.")?;

    let folder_path = PathBuf::from(&folder);
    let canonical_folder = std::fs::canonicalize(&folder_path)
        .map_err(|e| format!("Invalid library folder path: {e}"))?;
    if canonical.starts_with(&canonical_folder) {
        return Ok(());
    }

    Err("Track path is not under the library folder.".to_string())
}

fn item_key_label(key: &ItemKey) -> String {
    match key {
        ItemKey::TrackTitle => "Track Title".to_string(),
        ItemKey::TrackArtist => "Track Artist".to_string(),
        ItemKey::AlbumTitle => "Album Title".to_string(),
        ItemKey::AlbumArtist => "Album Artist".to_string(),
        ItemKey::TrackNumber => "Track Number".to_string(),
        ItemKey::TrackTotal => "Track Total".to_string(),
        ItemKey::DiscNumber => "Disc Number".to_string(),
        ItemKey::DiscTotal => "Disc Total".to_string(),
        ItemKey::Genre => "Genre".to_string(),
        ItemKey::Comment => "Comment".to_string(),
        ItemKey::RecordingDate => "Recording Date".to_string(),
        ItemKey::Year => "Year".to_string(),
        ItemKey::Composer => "Composer".to_string(),
        ItemKey::Conductor => "Conductor".to_string(),
        ItemKey::Label => "Label".to_string(),
        ItemKey::CopyrightMessage => "Copyright".to_string(),
        ItemKey::Unknown(description) => description.clone(),
        other => format!("{other:?}"),
    }
}

fn is_human_tag_key(key: &str) -> bool {
    parse_item_key(key).is_some()
}

fn parse_item_key(key: &str) -> Option<ItemKey> {
    let base = key
        .rsplit_once(": ")
        .map(|(_, value)| value)
        .unwrap_or(key);

    match base {
        "Track Title" => Some(ItemKey::TrackTitle),
        "Track Artist" => Some(ItemKey::TrackArtist),
        "Album Title" => Some(ItemKey::AlbumTitle),
        "Album Artist" => Some(ItemKey::AlbumArtist),
        "Track Number" => Some(ItemKey::TrackNumber),
        "Track Total" => Some(ItemKey::TrackTotal),
        "Disc Number" => Some(ItemKey::DiscNumber),
        "Disc Total" => Some(ItemKey::DiscTotal),
        "Genre" => Some(ItemKey::Genre),
        "Comment" => Some(ItemKey::Comment),
        "Recording Date" => Some(ItemKey::RecordingDate),
        "Year" => Some(ItemKey::Year),
        "Composer" => Some(ItemKey::Composer),
        "Conductor" => Some(ItemKey::Conductor),
        "Label" => Some(ItemKey::Label),
        "Copyright" => Some(ItemKey::CopyrightMessage),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_strips_tag_prefix() {
        assert_eq!(
            parse_item_key("Id3v2: Track Title"),
            Some(ItemKey::TrackTitle)
        );
    }

    #[test]
    fn human_tag_key_includes_all_labels() {
        for label in [
            "Track Title",
            "Track Artist",
            "Album Title",
            "Album Artist",
            "Track Number",
            "Track Total",
            "Disc Number",
            "Disc Total",
            "Genre",
            "Comment",
            "Recording Date",
            "Year",
            "Composer",
            "Conductor",
            "Label",
            "Copyright",
        ] {
            assert!(is_human_tag_key(label), "{label}");
            assert!(is_human_tag_key(&format!("Id3v2: {label}")), "Id3v2: {label}");
        }
    }

    #[test]
    fn human_tag_key_excludes_advanced_tags() {
        assert!(!is_human_tag_key("ContentGroup"));
        assert!(!is_human_tag_key("Id3v2: ContentGroup"));
        assert!(!is_human_tag_key("MusicBrainzRecordingId"));
    }

    #[test]
    fn field_value_matches_empty_expected_as_removed() {
        assert!(field_value_matches("", None));
        assert!(field_value_matches("  ", None));
        assert!(field_value_matches("", Some("")));
        assert!(!field_value_matches("Title", None));
        assert!(field_value_matches("Title", Some("Title")));
    }
}
