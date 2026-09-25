use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::application::{entry_tag_key, ApplicationId};
use crate::db::Database;

pub const SEARCH_RESULT_LIMIT: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectSearchHit {
    pub track_id: i64,
    pub taglist_id: i64,
    pub taglist_name: String,
    pub partition_value: Option<String>,
    pub partition_display_title: Option<String>,
    pub match_label: String,
}

pub fn search_project(
    db: &Database,
    application: ApplicationId,
    query: &str,
    limit: usize,
) -> Result<Vec<ProjectSearchHit>, String> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let needle_norm = Database::normalize_tag_value_for_match(needle);
    if needle_norm.is_empty() {
        return Ok(Vec::new());
    }

    let entry_key = entry_tag_key(application);
    let mut hits: Vec<ProjectSearchHit> = Vec::new();
    let mut seen: HashSet<(i64, i64, Option<String>)> = HashSet::new();

    let taglists = db.list_taglists().map_err(|e| e.to_string())?;
    for taglist in taglists {
        if hits.len() >= limit {
            break;
        }

        let titles = db
            .list_taglist_value_titles(taglist.id)
            .map_err(|e| e.to_string())?;
        let value_order = db
            .list_taglist_value_order(taglist.id)
            .map_err(|e| e.to_string())?;
        let track_order = build_track_order_map(
            db.list_taglist_track_order(taglist.id)
                .map_err(|e| e.to_string())?,
        );

        let sublists = db
            .list_taglist_values(&taglist.tag_key, taglist.id)
            .map_err(|e| e.to_string())?;

        let mut ordered_sublists: Vec<_> = sublists.into_iter().collect();
        ordered_sublists.sort_by(|a, b| {
            partition_sort_key(&value_order, a.value.as_deref())
                .cmp(&partition_sort_key(&value_order, b.value.as_deref()))
        });

        for sublist in ordered_sublists {
            if hits.len() >= limit {
                break;
            }

            let tracks = db
                .list_taglist_tracks(taglist.id, &taglist.tag_key, sublist.value.as_deref())
                .map_err(|e| e.to_string())?;

            let mut ordered_tracks = tracks;
            sort_tracks_in_partition(
                &mut ordered_tracks,
                track_order.get(sublist.value.as_deref().unwrap_or("")),
            );

            for track in ordered_tracks {
                if hits.len() >= limit {
                    break;
                }

                let Some(match_label) =
                    match_label_for_track(db, &track.path, track.id, entry_key, &needle_norm)?
                else {
                    continue;
                };

                let key = (taglist.id, track.id, sublist.value.clone());
                if !seen.insert(key) {
                    continue;
                }

                let display_title = sublist
                    .value
                    .as_deref()
                    .and_then(|v| titles.get(v).cloned())
                    .or(sublist.display_title.clone());

                hits.push(ProjectSearchHit {
                    track_id: track.id,
                    taglist_id: taglist.id,
                    taglist_name: taglist.name.clone(),
                    partition_value: sublist.value.clone(),
                    partition_display_title: display_title,
                    match_label,
                });
            }
        }
    }

    Ok(hits)
}

fn match_label_for_track(
    db: &Database,
    path: &str,
    track_id: i64,
    entry_key: Option<&str>,
    needle_norm: &str,
) -> Result<Option<String>, String> {
    if let Some(key) = entry_key {
        let values = db
            .get_track_tag_values(track_id, key)
            .map_err(|e| e.to_string())?;
        if values.len() != 1 {
            return Ok(None);
        }
        let label = values[0].clone();
        if Database::normalize_tag_value_for_match(&label).contains(needle_norm) {
            return Ok(Some(label));
        }
        return Ok(None);
    }

    let stem = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if Database::normalize_tag_value_for_match(stem).contains(needle_norm) {
        let file_name = Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(stem)
            .to_string();
        return Ok(Some(file_name));
    }
    Ok(None)
}

fn build_track_order_map(rows: Vec<(String, i64, i64)>) -> HashMap<String, HashMap<i64, i64>> {
    let mut map: HashMap<String, HashMap<i64, i64>> = HashMap::new();
    for (tag_value, track_id, position) in rows {
        map.entry(tag_value).or_default().insert(track_id, position);
    }
    map
}

fn partition_sort_key(order: &[String], value: Option<&str>) -> usize {
    let key = value.unwrap_or("");
    order
        .iter()
        .position(|entry| entry == key)
        .unwrap_or(usize::MAX)
}

fn sort_tracks_in_partition(tracks: &mut [crate::models::Track], order: Option<&HashMap<i64, i64>>) {
    let Some(order) = order else {
        return;
    };
    tracks.sort_by(|a, b| {
        let pos_a = order.get(&a.id).copied().unwrap_or(i64::MAX);
        let pos_b = order.get(&b.id).copied().unwrap_or(i64::MAX);
        pos_a.cmp(&pos_b)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ApplicationId;
    use crate::db::Database;

    fn test_db() -> Database {
        Database::open(std::path::Path::new(":memory:")).expect("db")
    }

    fn insert_track(db: &Database, path: &str, title: &str) -> i64 {
        let (track_id, _) = db
            .upsert_track(path, title, "Artist", "Album", 1000, None)
            .expect("insert track");
        track_id
    }

    fn setup_taglist_with_tracks(db: &Database) -> (i64, i64) {
        let taglist_id = db
            .create_taglist("Events", "Composer", "Track Title", "Event")
            .unwrap();
        let track_a = insert_track(db, "/music/a.mp3", "a");
        let track_b = insert_track(db, "/music/b.mp3", "b");
        db.replace_track_tags(
            track_a,
            &[("Composer".into(), "01".into()), ("Track Title".into(), "Short Program".into())],
        )
        .unwrap();
        db.replace_track_tags(
            track_b,
            &[("Composer".into(), "01".into()), ("Track Title".into(), "Free Skate".into())],
        )
        .unwrap();
        (taglist_id, track_a)
    }

    #[test]
    fn search_by_entry_tag_finds_partition_hit() {
        let db = test_db();
        let (_taglist_id, track_a) = setup_taglist_with_tracks(&db);

        let hits = search_project(
            &db,
            ApplicationId::UsFigureSkatingEms,
            "short",
            SEARCH_RESULT_LIMIT,
        )
        .expect("search");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_label, "Short Program");
        assert_eq!(hits[0].partition_value.as_deref(), Some("01"));
        assert_eq!(hits[0].track_id, track_a);
    }

    #[test]
    fn search_by_filename_when_no_application_entry_tag() {
        let db = test_db();
        let _taglist_id = db
            .create_taglist("All", "Genre", "", "Genre")
            .unwrap();
        let _track_id = insert_track(&db, "/music/my-song.mp3", "title");
        db.replace_track_tags(_track_id, &[("Genre".into(), "Rock".into())])
            .unwrap();

        let hits = search_project(
            &db,
            ApplicationId::None,
            "my-song",
            SEARCH_RESULT_LIMIT,
        )
        .expect("search");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].match_label, "my-song.mp3");
    }

    #[test]
    fn empty_query_returns_no_hits() {
        let db = test_db();
        let _ = setup_taglist_with_tracks(&db);
        let hits =
            search_project(&db, ApplicationId::UsFigureSkatingEms, "  ", SEARCH_RESULT_LIMIT)
                .expect("search");
        assert!(hits.is_empty());
    }
}
