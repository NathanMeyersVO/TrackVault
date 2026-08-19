use std::path::Path;

use rusqlite::{params, Connection};
use thiserror::Error;

use crate::models::{Playlist, Taglist, TaglistValue, Track};

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", true)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), DbError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                artist TEXT NOT NULL DEFAULT '',
                album TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER NOT NULL DEFAULT 0,
                track_number INTEGER,
                added_at INTEGER NOT NULL,
                peaks_json TEXT
            );

            CREATE TABLE IF NOT EXISTS watch_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id INTEGER NOT NULL,
                track_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position
                ON playlist_tracks(playlist_id, position);

            CREATE TABLE IF NOT EXISTS taglists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                tag_key TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_tags (
                track_id INTEGER NOT NULL,
                tag_key TEXT NOT NULL,
                tag_value TEXT NOT NULL,
                PRIMARY KEY (track_id, tag_key, tag_value),
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_track_tags_key_value
                ON track_tags(tag_key, tag_value);
            CREATE INDEX IF NOT EXISTS idx_track_tags_track_id
                ON track_tags(track_id);

            CREATE TABLE IF NOT EXISTS taglist_value_titles (
                taglist_id INTEGER NOT NULL,
                tag_value TEXT NOT NULL,
                display_title TEXT NOT NULL,
                PRIMARY KEY (taglist_id, tag_value),
                FOREIGN KEY (taglist_id) REFERENCES taglists(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS taglist_track_order (
                taglist_id INTEGER NOT NULL,
                tag_value TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (taglist_id, tag_value, track_id),
                FOREIGN KEY (taglist_id) REFERENCES taglists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_taglist_track_order_position
                ON taglist_track_order(taglist_id, tag_value, position);
            ",
        )?;
        let _ = self.conn.execute(
            "ALTER TABLE tracks ADD COLUMN seek_index_json TEXT",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE tracks ADD COLUMN tags_indexed INTEGER NOT NULL DEFAULT 0",
            [],
        );
        self.migrate_single_library_folder()?;
        Ok(())
    }

    fn migrate_single_library_folder(&self) -> Result<(), DbError> {
        let keep_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM watch_folders ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = keep_id {
            self.conn.execute(
                "DELETE FROM watch_folders WHERE id != ?1",
                params![id],
            )?;
        }
        Ok(())
    }

    pub fn get_library_folder(&self) -> Result<Option<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT path FROM watch_folders LIMIT 1")?;
        let mut rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn set_library_folder(&self, path: &str) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM watch_folders", [])?;
        tx.execute(
            "INSERT INTO watch_folders (path) VALUES (?1)",
            params![path],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_track(
        &self,
        path: &str,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
        track_number: Option<i32>,
    ) -> Result<(i64, bool), DbError> {
        let exists: bool = self.conn.query_row(
            "SELECT 1 FROM tracks WHERE path = ?1",
            params![path],
            |_| Ok(()),
        ).is_ok();

        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration_ms, track_number, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration_ms = excluded.duration_ms,
               track_number = excluded.track_number,
               peaks_json = CASE
                 WHEN tracks.duration_ms != excluded.duration_ms THEN NULL
                 ELSE tracks.peaks_json
               END,
               seek_index_json = CASE
                 WHEN tracks.duration_ms != excluded.duration_ms THEN NULL
                 ELSE tracks.seek_index_json
               END",
            params![path, title, artist, album, duration_ms, track_number, now],
        )?;
        let track_id: i64 = self.conn.query_row(
            "SELECT id FROM tracks WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )?;
        Ok((track_id, !exists))
    }

    pub fn list_unindexed_track_ids(&self) -> Result<Vec<i64>, DbError> {
        let mut stmt = self.conn.prepare("SELECT id FROM tracks WHERE tags_indexed = 0")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn replace_track_tags(
        &self,
        track_id: i64,
        tags: &[(String, String)],
    ) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM track_tags WHERE track_id = ?1",
            params![track_id],
        )?;
        for (key, value) in tags {
            self.conn.execute(
                "INSERT INTO track_tags (track_id, tag_key, tag_value) VALUES (?1, ?2, ?3)",
                params![track_id, key, value],
            )?;
        }
        self.conn.execute(
            "UPDATE tracks SET tags_indexed = 1 WHERE id = ?1",
            params![track_id],
        )?;
        Ok(())
    }

    pub fn mark_all_tracks_unindexed(&self) -> Result<(), DbError> {
        self.conn.execute("UPDATE tracks SET tags_indexed = 0", [])?;
        Ok(())
    }

    pub fn list_track_paths(&self) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT path FROM tracks")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn delete_tracks_by_paths(&self, paths: &[String]) -> Result<u32, DbError> {
        if paths.is_empty() {
            return Ok(0);
        }

        let mut stmt = self.conn.prepare("DELETE FROM tracks WHERE path = ?1")?;
        let mut removed = 0u32;
        for path in paths {
            removed += stmt.execute(params![path])? as u32;
        }
        Ok(removed)
    }

    pub fn list_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, title, artist, album, duration_ms, track_number, added_at,
                    CASE WHEN peaks_json IS NOT NULL THEN 1 ELSE 0 END
             FROM tracks ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number, title",
        )?;
        let rows = stmt.query_map([], map_track_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_track(&self, id: i64) -> Result<Option<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, title, artist, album, duration_ms, track_number, added_at,
                    CASE WHEN peaks_json IS NOT NULL THEN 1 ELSE 0 END
             FROM tracks WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(map_track_row(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_track_path(&self, id: i64) -> Result<Option<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT path FROM tracks WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn update_track_metadata(
        &self,
        id: i64,
        title: &str,
        artist: &str,
        album: &str,
        track_number: Option<i32>,
    ) -> Result<Track, DbError> {
        self.conn.execute(
            "UPDATE tracks SET title = ?1, artist = ?2, album = ?3, track_number = ?4 WHERE id = ?5",
            params![title, artist, album, track_number, id],
        )?;
        self.get_track(id)?.ok_or_else(|| {
            rusqlite::Error::QueryReturnedNoRows.into()
        })
    }

    pub fn get_peaks(&self, id: i64) -> Result<Option<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT peaks_json FROM tracks WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn set_peaks(&self, id: i64, peaks_json: &str) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET peaks_json = ?1 WHERE id = ?2",
            params![peaks_json, id],
        )?;
        Ok(())
    }

    pub fn get_seek_index(&self, id: i64) -> Result<Option<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT seek_index_json FROM tracks WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn set_seek_index(&self, id: i64, seek_index_json: &str) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET seek_index_json = ?1 WHERE id = ?2",
            params![seek_index_json, id],
        )?;
        Ok(())
    }

    pub fn create_playlist(&self, name: &str) -> Result<i64, DbError> {
        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO playlists (name, created_at) VALUES (?1, ?2)",
            params![name, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_playlist(&self, id: i64) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_playlists(&self) -> Result<Vec<Playlist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, p.created_at,
                    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
             FROM playlists p ORDER BY p.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                track_count: row.get(3)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), DbError> {
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position],
        )?;
        Ok(())
    }

    pub fn remove_track_from_playlist(
        &self,
        playlist_id: i64,
        track_id: i64,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )?;
        Ok(())
    }

    pub fn reorder_playlist_tracks(
        &self,
        playlist_id: i64,
        track_ids: &[i64],
    ) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;

        let mut existing: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT track_id FROM playlist_tracks
                 WHERE playlist_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![playlist_id], |row| row.get(0))?;
            rows.filter_map(Result::ok).collect()
        };

        let mut ordered: Vec<i64> = track_ids
            .iter()
            .copied()
            .filter(|id| existing.contains(id))
            .collect();
        for id in existing.drain(..) {
            if !ordered.contains(&id) {
                ordered.push(id);
            }
        }

        for (position, track_id) in ordered.iter().enumerate() {
            tx.execute(
                "UPDATE playlist_tracks SET position = ?1
                 WHERE playlist_id = ?2 AND track_id = ?3",
                params![position as i64, playlist_id, track_id],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn list_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration_ms, t.track_number,
                    t.added_at, CASE WHEN t.peaks_json IS NOT NULL THEN 1 ELSE 0 END
             FROM tracks t
             JOIN playlist_tracks pt ON pt.track_id = t.id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position",
        )?;
        let rows = stmt.query_map(params![playlist_id], map_track_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn create_taglist(&self, name: &str, tag_key: &str) -> Result<i64, DbError> {
        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO taglists (name, tag_key, created_at) VALUES (?1, ?2, ?3)",
            params![name, tag_key, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_taglist(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM taglists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_taglists(&self) -> Result<Vec<Taglist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, tag_key, created_at FROM taglists ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Taglist {
                id: row.get(0)?,
                name: row.get(1)?,
                tag_key: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_taglist(&self, id: i64) -> Result<Option<Taglist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, tag_key, created_at FROM taglists WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Taglist {
                id: row.get(0)?,
                name: row.get(1)?,
                tag_key: row.get(2)?,
                created_at: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn import_taglist_titles(
        &self,
        taglist_id: i64,
        mappings: &std::collections::HashMap<String, String>,
    ) -> Result<u32, DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM taglist_value_titles WHERE taglist_id = ?1",
            params![taglist_id],
        )?;
        for (tag_value, display_title) in mappings {
            tx.execute(
                "INSERT INTO taglist_value_titles (taglist_id, tag_value, display_title)
                 VALUES (?1, ?2, ?3)",
                params![taglist_id, tag_value, display_title],
            )?;
        }
        tx.commit()?;
        Ok(mappings.len() as u32)
    }

    pub fn set_taglist_value_title(
        &self,
        taglist_id: i64,
        tag_value: &str,
        display_title: Option<&str>,
    ) -> Result<(), DbError> {
        match display_title.map(str::trim).filter(|s| !s.is_empty()) {
            Some(title) => {
                self.conn.execute(
                    "INSERT INTO taglist_value_titles (taglist_id, tag_value, display_title)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(taglist_id, tag_value) DO UPDATE SET
                       display_title = excluded.display_title",
                    params![taglist_id, tag_value, title],
                )?;
            }
            None => {
                self.conn.execute(
                    "DELETE FROM taglist_value_titles WHERE taglist_id = ?1 AND tag_value = ?2",
                    params![taglist_id, tag_value],
                )?;
            }
        }
        Ok(())
    }

    fn get_taglist_titles(
        &self,
        taglist_id: i64,
    ) -> Result<std::collections::HashMap<String, String>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT tag_value, display_title FROM taglist_value_titles WHERE taglist_id = ?1",
        )?;
        let rows = stmt.query_map(params![taglist_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn list_taglist_values(
        &self,
        tag_key: &str,
        taglist_id: i64,
    ) -> Result<Vec<TaglistValue>, DbError> {
        let titles = self.get_taglist_titles(taglist_id)?;
        let mut values = Vec::new();

        let mut stmt = self.conn.prepare(
            "SELECT tag_value, COUNT(DISTINCT track_id)
             FROM track_tags
             WHERE tag_key = ?1
             GROUP BY tag_value
             ORDER BY tag_value COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![tag_key], |row| {
            let value: String = row.get(0)?;
            Ok(TaglistValue {
                value: Some(value.clone()),
                track_count: row.get(1)?,
                display_title: titles.get(&value).cloned(),
            })
        })?;
        values.extend(rows.filter_map(Result::ok));

        let no_tag_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tracks t
             WHERE NOT EXISTS (
               SELECT 1 FROM track_tags tt
               WHERE tt.track_id = t.id AND tt.tag_key = ?1
             )",
            params![tag_key],
            |row| row.get(0),
        )?;
        values.push(TaglistValue {
            value: None,
            track_count: no_tag_count,
            display_title: None,
        });

        Ok(values)
    }

    pub fn list_taglist_tracks(
        &self,
        taglist_id: i64,
        tag_key: &str,
        value: Option<&str>,
    ) -> Result<Vec<Track>, DbError> {
        let tag_value_key = value.unwrap_or("");
        if let Some(tag_value) = value {
            let mut stmt = self.conn.prepare(
                "SELECT DISTINCT t.id, t.path, t.title, t.artist, t.album, t.duration_ms,
                        t.track_number, t.added_at,
                        CASE WHEN t.peaks_json IS NOT NULL THEN 1 ELSE 0 END
                 FROM tracks t
                 JOIN track_tags tt ON tt.track_id = t.id
                 LEFT JOIN taglist_track_order o
                   ON o.taglist_id = ?1 AND o.tag_value = ?2 AND o.track_id = t.id
                 WHERE tt.tag_key = ?3 AND tt.tag_value = ?4
                 ORDER BY CASE WHEN o.position IS NULL THEN 1 ELSE 0 END,
                          o.position,
                          t.artist COLLATE NOCASE, t.album COLLATE NOCASE,
                          t.track_number, t.title",
            )?;
            let rows = stmt.query_map(
                params![taglist_id, tag_value_key, tag_key, tag_value],
                map_track_row,
            )?;
            Ok(rows.filter_map(Result::ok).collect())
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration_ms, t.track_number,
                        t.added_at, CASE WHEN t.peaks_json IS NOT NULL THEN 1 ELSE 0 END
                 FROM tracks t
                 LEFT JOIN taglist_track_order o
                   ON o.taglist_id = ?1 AND o.tag_value = ?2 AND o.track_id = t.id
                 WHERE NOT EXISTS (
                   SELECT 1 FROM track_tags tt
                   WHERE tt.track_id = t.id AND tt.tag_key = ?3
                 )
                 ORDER BY CASE WHEN o.position IS NULL THEN 1 ELSE 0 END,
                          o.position,
                          t.artist COLLATE NOCASE, t.album COLLATE NOCASE,
                          t.track_number, t.title",
            )?;
            let rows = stmt.query_map(
                params![taglist_id, tag_value_key, tag_key],
                map_track_row,
            )?;
            Ok(rows.filter_map(Result::ok).collect())
        }
    }

    pub fn reorder_taglist_tracks(
        &self,
        taglist_id: i64,
        value: Option<&str>,
        track_ids: &[i64],
    ) -> Result<(), DbError> {
        let tag_value_key = value.unwrap_or("");
        let taglist = self
            .get_taglist(taglist_id)?
            .ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
        let tag_key = taglist.tag_key;

        let current = self.list_taglist_tracks(taglist_id, &tag_key, value)?;
        let current_ids: Vec<i64> = current.iter().map(|t| t.id).collect();

        let mut ordered: Vec<i64> = track_ids
            .iter()
            .copied()
            .filter(|id| current_ids.contains(id))
            .collect();
        for id in &current_ids {
            if !ordered.contains(id) {
                ordered.push(*id);
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM taglist_track_order WHERE taglist_id = ?1 AND tag_value = ?2",
            params![taglist_id, tag_value_key],
        )?;
        for (position, track_id) in ordered.iter().enumerate() {
            tx.execute(
                "INSERT INTO taglist_track_order (taglist_id, tag_value, track_id, position)
                 VALUES (?1, ?2, ?3, ?4)",
                params![taglist_id, tag_value_key, track_id, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn map_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        duration_ms: row.get(5)?,
        track_number: row.get(6)?,
        added_at: row.get(7)?,
        has_peaks: row.get::<_, i32>(8)? != 0,
    })
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        Database::open(std::path::Path::new(":memory:")).expect("in-memory db")
    }

    fn insert_track(db: &Database, title: &str) -> i64 {
        let (track_id, _) = db
            .upsert_track(
                &format!("/music/{title}.mp3"),
                title,
                "Artist",
                "Album",
                1000,
                None,
            )
            .expect("insert track");
        track_id
    }

    #[test]
    fn taglist_values_sorted_with_no_tag_last() {
        let db = test_db();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");
        let track_c = insert_track(&db, "C");

        db.replace_track_tags(
            track_a,
            &[("Composer".to_string(), "Mozart".to_string())],
        )
        .unwrap();
        db.replace_track_tags(
            track_b,
            &[("Composer".to_string(), "Bach".to_string())],
        )
        .unwrap();
        db.replace_track_tags(track_c, &[]).unwrap();

        let values = db.list_taglist_values("Composer", 1).unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(values[0].value.as_deref(), Some("Bach"));
        assert_eq!(values[0].track_count, 1);
        assert_eq!(values[1].value.as_deref(), Some("Mozart"));
        assert_eq!(values[2].value, None);
        assert_eq!(values[2].track_count, 1);
    }

    #[test]
    fn taglist_tracks_filters_by_value_and_no_tag() {
        let db = test_db();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");

        db.replace_track_tags(
            track_a,
            &[("Genre".to_string(), "Classical".to_string())],
        )
        .unwrap();
        db.replace_track_tags(track_b, &[]).unwrap();

        let classical = db
            .list_taglist_tracks(1, "Genre", Some("Classical"))
            .unwrap();
        assert_eq!(classical.len(), 1);
        assert_eq!(classical[0].id, track_a);

        let no_tag = db.list_taglist_tracks(1, "Genre", None).unwrap();
        assert_eq!(no_tag.len(), 1);
        assert_eq!(no_tag[0].id, track_b);
    }

    #[test]
    fn multi_value_tag_appears_in_each_sublists() {
        let db = test_db();
        let track_id = insert_track(&db, "Multi");

        db.replace_track_tags(
            track_id,
            &[
                ("Genre".to_string(), "Rock".to_string()),
                ("Genre".to_string(), "Pop".to_string()),
            ],
        )
        .unwrap();

        let rock = db.list_taglist_tracks(1, "Genre", Some("Rock")).unwrap();
        let pop = db.list_taglist_tracks(1, "Genre", Some("Pop")).unwrap();
        assert_eq!(rock.len(), 1);
        assert_eq!(pop.len(), 1);
        assert_eq!(rock[0].id, track_id);
    }

    #[test]
    fn taglist_values_include_imported_display_titles() {
        let db = test_db();
        let taglist_id = db.create_taglist("Events", "Comment").unwrap();
        let track_id = insert_track(&db, "Event Track");
        db.replace_track_tags(
            track_id,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();

        let mut mappings = std::collections::HashMap::new();
        mappings.insert(
            "01".to_string(),
            "Showcase: Pre-Preliminary".to_string(),
        );
        db.import_taglist_titles(taglist_id, &mappings).unwrap();

        let values = db.list_taglist_values("Comment", taglist_id).unwrap();
        assert_eq!(values[0].value.as_deref(), Some("01"));
        assert_eq!(
            values[0].display_title.as_deref(),
            Some("Showcase: Pre-Preliminary")
        );
    }

    #[test]
    fn set_taglist_value_title_upserts_updates_and_clears() {
        let db = test_db();
        let taglist_id = db.create_taglist("Events", "Comment").unwrap();
        let track_id = insert_track(&db, "Event Track");
        db.replace_track_tags(
            track_id,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();

        db.set_taglist_value_title(taglist_id, "01", Some("First Session"))
            .unwrap();
        let values = db.list_taglist_values("Comment", taglist_id).unwrap();
        assert_eq!(
            values[0].display_title.as_deref(),
            Some("First Session")
        );

        db.set_taglist_value_title(taglist_id, "01", Some("Updated Session"))
            .unwrap();
        let values = db.list_taglist_values("Comment", taglist_id).unwrap();
        assert_eq!(
            values[0].display_title.as_deref(),
            Some("Updated Session")
        );

        db.set_taglist_value_title(taglist_id, "01", None).unwrap();
        let values = db.list_taglist_values("Comment", taglist_id).unwrap();
        assert!(values[0].display_title.is_none());

        db.set_taglist_value_title(taglist_id, "01", Some("   ")).unwrap();
        let values = db.list_taglist_values("Comment", taglist_id).unwrap();
        assert!(values[0].display_title.is_none());
    }

    #[test]
    fn reorder_playlist_tracks_updates_position() {
        let db = test_db();
        let playlist_id = db.create_playlist("Test").unwrap();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");
        let track_c = insert_track(&db, "C");
        db.add_track_to_playlist(playlist_id, track_a).unwrap();
        db.add_track_to_playlist(playlist_id, track_b).unwrap();
        db.add_track_to_playlist(playlist_id, track_c).unwrap();

        db.reorder_playlist_tracks(playlist_id, &[track_c, track_a, track_b])
            .unwrap();

        let tracks = db.list_playlist_tracks(playlist_id).unwrap();
        assert_eq!(
            tracks.iter().map(|t| t.id).collect::<Vec<_>>(),
            vec![track_c, track_a, track_b]
        );
    }

    #[test]
    fn taglist_custom_order_overrides_metadata_sort() {
        let db = test_db();
        let taglist_id = db.create_taglist("Events", "Comment").unwrap();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");
        db.replace_track_tags(
            track_a,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();
        db.replace_track_tags(
            track_b,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();

        db.reorder_taglist_tracks(taglist_id, Some("01"), &[track_b, track_a])
            .unwrap();

        let tracks = db
            .list_taglist_tracks(taglist_id, "Comment", Some("01"))
            .unwrap();
        assert_eq!(tracks[0].id, track_b);
        assert_eq!(tracks[1].id, track_a);
    }
}
