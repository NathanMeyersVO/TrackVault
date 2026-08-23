use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection};
use thiserror::Error;

use crate::models::{Collection, CollectionPlaybackState, Playlist, Taglist, TaglistValue, Track};

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

            CREATE TABLE IF NOT EXISTS taglist_value_order (
                taglist_id INTEGER NOT NULL,
                tag_value TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (taglist_id, tag_value),
                FOREIGN KEY (taglist_id) REFERENCES taglists(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_taglist_value_order_position
                ON taglist_value_order(taglist_id, position);

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value_json TEXT NOT NULL
            );
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
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS collection_tracks (
                collection_id INTEGER NOT NULL,
                track_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (collection_id, track_id),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_collection_tracks_position
                ON collection_tracks(collection_id, position);

            CREATE TABLE IF NOT EXISTS collection_order (
                collection_id INTEGER PRIMARY KEY,
                position INTEGER NOT NULL,
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_collection_order_position
                ON collection_order(position);
            ",
        )?;
        let _ = self.conn.execute(
            "ALTER TABLE tracks ADD COLUMN collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE",
            [],
        );
        self.bootstrap_collection_order()?;
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS playlist_order (
                playlist_id INTEGER PRIMARY KEY,
                position INTEGER NOT NULL,
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_order_position
                ON playlist_order(position);
            ",
        )?;
        self.bootstrap_playlist_order()?;
        self.migrate_single_library_folder()?;
        let _ = self.conn.execute(
            "ALTER TABLE collections ADD COLUMN playback_mode TEXT NOT NULL DEFAULT 'discrete'",
            [],
        );
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS collection_playback_state (
                collection_id INTEGER PRIMARY KEY,
                track_id INTEGER,
                position_ms INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
            );
            ",
        )?;
        let _ = self.conn.execute(
            "ALTER TABLE collections ADD COLUMN continuous_volume REAL NOT NULL DEFAULT 0.5",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE taglists ADD COLUMN value_singular_name TEXT NOT NULL DEFAULT ''",
            [],
        );
        Ok(())
    }

    fn map_collection_row(row: &rusqlite::Row<'_>) -> Result<Collection, rusqlite::Error> {
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            track_count: row.get(3)?,
            playback_mode: row.get(4)?,
            continuous_volume: row.get(5)?,
        })
    }

    fn bootstrap_collection_order(&self) -> Result<(), DbError> {
        let order_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM collection_order",
            [],
            |row| row.get(0),
        )?;
        if order_count > 0 {
            return Ok(());
        }

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM collections ORDER BY name COLLATE NOCASE")?;
        let ids: Vec<i64> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        for (position, collection_id) in ids.iter().enumerate() {
            self.conn.execute(
                "INSERT INTO collection_order (collection_id, position) VALUES (?1, ?2)",
                params![collection_id, position as i64],
            )?;
        }
        Ok(())
    }

    fn bootstrap_playlist_order(&self) -> Result<(), DbError> {
        let order_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM playlist_order",
            [],
            |row| row.get(0),
        )?;
        if order_count > 0 {
            return Ok(());
        }

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM playlists ORDER BY name COLLATE NOCASE")?;
        let ids: Vec<i64> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        for (position, playlist_id) in ids.iter().enumerate() {
            self.conn.execute(
                "INSERT INTO playlist_order (playlist_id, position) VALUES (?1, ?2)",
                params![playlist_id, position as i64],
            )?;
        }
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

    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value_json FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn set_app_setting(&self, key: &str, value_json: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![key, value_json],
        )?;
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
        self.upsert_track_with_collection(
            path, title, artist, album, duration_ms, track_number, None,
        )
    }

    pub fn upsert_collection_track(
        &self,
        collection_id: i64,
        path: &str,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
        track_number: Option<i32>,
    ) -> Result<(i64, bool), DbError> {
        let (track_id, is_new) = self.upsert_track_with_collection(
            path, title, artist, album, duration_ms, track_number, Some(collection_id),
        )?;
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM collection_tracks WHERE collection_id = ?1",
            params![collection_id],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT OR IGNORE INTO collection_tracks (collection_id, track_id, position)
             VALUES (?1, ?2, ?3)",
            params![collection_id, track_id, position],
        )?;
        Ok((track_id, is_new))
    }

    fn upsert_track_with_collection(
        &self,
        path: &str,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
        track_number: Option<i32>,
        collection_id: Option<i64>,
    ) -> Result<(i64, bool), DbError> {
        let exists: bool = self.conn.query_row(
            "SELECT 1 FROM tracks WHERE path = ?1",
            params![path],
            |_| Ok(()),
        ).is_ok();

        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration_ms, track_number, added_at, collection_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration_ms = excluded.duration_ms,
               track_number = excluded.track_number,
               collection_id = excluded.collection_id,
               peaks_json = CASE
                 WHEN tracks.duration_ms != excluded.duration_ms THEN NULL
                 ELSE tracks.peaks_json
               END,
               seek_index_json = CASE
                 WHEN tracks.duration_ms != excluded.duration_ms THEN NULL
                 ELSE tracks.seek_index_json
               END",
            params![
                path, title, artist, album, duration_ms, track_number, now, collection_id
            ],
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
        let mut stmt = self.conn.prepare("SELECT path FROM tracks WHERE collection_id IS NULL")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn list_library_track_paths(&self) -> Result<Vec<String>, DbError> {
        self.list_track_paths()
    }

    pub fn delete_tracks_by_paths(&self, paths: &[String]) -> Result<u32, DbError> {
        self.delete_library_tracks_by_paths(paths)
    }

    pub fn delete_library_tracks_by_paths(&self, paths: &[String]) -> Result<u32, DbError> {
        if paths.is_empty() {
            return Ok(0);
        }

        let mut stmt = self
            .conn
            .prepare("DELETE FROM tracks WHERE path = ?1 AND collection_id IS NULL")?;
        let mut removed = 0u32;
        for path in paths {
            removed += stmt.execute(params![path])? as u32;
        }
        Ok(removed)
    }

    pub fn delete_track(&self, track_id: i64) -> Result<String, DbError> {
        let path = self
            .get_track_path(track_id)?
            .ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
        self.conn
            .execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
        Ok(path)
    }

    pub fn list_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, title, artist, album, duration_ms, track_number, added_at,
                    CASE WHEN peaks_json IS NOT NULL THEN 1 ELSE 0 END
             FROM tracks
             WHERE collection_id IS NULL
             ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number, title",
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

    pub fn get_track_id_by_path(&self, path: &str) -> Result<Option<i64>, DbError> {
        let mut stmt = self.conn.prepare("SELECT id FROM tracks WHERE path = ?1")?;
        let mut rows = stmt.query(params![path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_track_collection_id(&self, track_id: i64) -> Result<Option<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT collection_id FROM tracks WHERE id = ?1")?;
        let mut rows = stmt.query(params![track_id])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn get_track_collection_id_by_path(&self, path: &str) -> Result<Option<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT collection_id FROM tracks WHERE path = ?1")?;
        let mut rows = stmt.query(params![path])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn is_library_track(&self, track_id: i64) -> Result<bool, DbError> {
        Ok(self.get_track_collection_id(track_id)?.is_none())
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

    pub fn list_uncached_audio_tracks(&self) -> Result<Vec<(i64, String)>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path FROM tracks
             WHERE seek_index_json IS NULL OR peaks_json IS NULL
             ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn audio_cache_incomplete(&self, id: i64) -> Result<bool, DbError> {
        let peaks = self.get_peaks(id)?;
        let seek = self.get_seek_index(id)?;
        Ok(peaks.is_none() || seek.is_none())
    }

    pub fn clear_user_config(&self) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM playlist_tracks", [])?;
        tx.execute("DELETE FROM playlists", [])?;
        tx.execute("DELETE FROM taglist_track_order", [])?;
        tx.execute("DELETE FROM taglist_value_titles", [])?;
        tx.execute("DELETE FROM taglist_value_order", [])?;
        tx.execute("DELETE FROM taglists", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn close_library_state(&self) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM playlist_tracks", [])?;
        tx.execute("DELETE FROM playlists", [])?;
        tx.execute("DELETE FROM taglist_track_order", [])?;
        tx.execute("DELETE FROM taglist_value_titles", [])?;
        tx.execute("DELETE FROM taglist_value_order", [])?;
        tx.execute("DELETE FROM taglists", [])?;
        tx.execute("DELETE FROM track_tags WHERE track_id IN (SELECT id FROM tracks WHERE collection_id IS NULL)", [])?;
        tx.execute("DELETE FROM tracks WHERE collection_id IS NULL", [])?;
        tx.execute("DELETE FROM watch_folders", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn create_collection(&self, name: &str) -> Result<i64, DbError> {
        let now = chrono_now();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO collections (name, created_at) VALUES (?1, ?2)",
            params![name, now],
        )?;
        let collection_id = tx.last_insert_rowid();
        let position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM collection_order",
            [],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO collection_order (collection_id, position) VALUES (?1, ?2)",
            params![collection_id, position],
        )?;
        tx.commit()?;
        Ok(collection_id)
    }

    pub fn delete_collection(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM collections WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_collection_order_ids(&self) -> Result<Vec<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT collection_id FROM collection_order ORDER BY position")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn default_collection_order_ids(&self) -> Result<Vec<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM collections ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn reorder_collections(&self, collection_ids: &[i64]) -> Result<(), DbError> {
        let all = self.default_collection_order_ids()?;
        let all_set: std::collections::HashSet<i64> = all.iter().copied().collect();

        let mut ordered: Vec<i64> = collection_ids
            .iter()
            .copied()
            .filter(|id| all_set.contains(id))
            .collect();
        for id in all {
            if !ordered.contains(&id) {
                ordered.push(id);
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM collection_order", [])?;
        for (position, collection_id) in ordered.iter().enumerate() {
            tx.execute(
                "INSERT INTO collection_order (collection_id, position) VALUES (?1, ?2)",
                params![collection_id, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_collections(&self) -> Result<Vec<Collection>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.name, c.created_at,
                    (SELECT COUNT(*) FROM collection_tracks ct WHERE ct.collection_id = c.id),
                    c.playback_mode,
                    c.continuous_volume
             FROM collections c",
        )?;
        let rows = stmt.query_map([], Self::map_collection_row)?;
        let mut by_id: HashMap<i64, Collection> = HashMap::new();
        for row in rows.filter_map(Result::ok) {
            by_id.insert(row.id, row);
        }

        let stored_order = self.list_collection_order_ids()?;
        let default_order = self.default_collection_order_ids()?;
        let ordered_ids = merge_collection_order(&stored_order, &default_order);

        Ok(ordered_ids
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .collect())
    }

    pub fn get_collection(&self, id: i64) -> Result<Option<Collection>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.name, c.created_at,
                    (SELECT COUNT(*) FROM collection_tracks ct WHERE ct.collection_id = c.id),
                    c.playback_mode,
                    c.continuous_volume
             FROM collections c WHERE c.id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Self::map_collection_row(&row)?))
        } else {
            Ok(None)
        }
    }

    pub fn collection_name_exists(&self, name: &str) -> Result<bool, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM collections WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn collection_name_taken_by_other(&self, id: i64, name: &str) -> Result<bool, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM collections WHERE name = ?1 COLLATE NOCASE AND id != ?2",
            params![name, id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn rename_collection(&self, id: i64, name: &str) -> Result<(), DbError> {
        let changed = self.conn.execute(
            "UPDATE collections SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        if changed == 0 {
            return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        Ok(())
    }

    pub fn set_collection_playback_mode(&self, id: i64, mode: &str) -> Result<(), DbError> {
        let normalized = normalize_collection_playback_mode(mode);
        let changed = self.conn.execute(
            "UPDATE collections SET playback_mode = ?1 WHERE id = ?2",
            params![normalized, id],
        )?;
        if changed == 0 {
            return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        Ok(())
    }

    pub fn set_collection_continuous_volume(&self, id: i64, volume: f64) -> Result<(), DbError> {
        let clamped = clamp_continuous_volume(volume);
        let changed = self.conn.execute(
            "UPDATE collections SET continuous_volume = ?1 WHERE id = ?2",
            params![clamped, id],
        )?;
        if changed == 0 {
            return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        Ok(())
    }

    pub fn get_collection_playback_state(
        &self,
        collection_id: i64,
    ) -> Result<CollectionPlaybackState, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT track_id, position_ms FROM collection_playback_state WHERE collection_id = ?1",
        )?;
        let mut rows = stmt.query(params![collection_id])?;
        if let Some(row) = rows.next()? {
            return Ok(CollectionPlaybackState {
                track_id: row.get(0)?,
                position_ms: row.get(1)?,
            });
        }

        Ok(CollectionPlaybackState {
            track_id: None,
            position_ms: 0,
        })
    }

    pub fn save_collection_playback_state(
        &self,
        collection_id: i64,
        track_id: Option<i64>,
        position_ms: i64,
    ) -> Result<(), DbError> {
        if let Some(track_id) = track_id {
            let belongs: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM collection_tracks WHERE collection_id = ?1 AND track_id = ?2",
                params![collection_id, track_id],
                |row| row.get(0),
            )?;
            if belongs == 0 {
                return self.clear_collection_playback_state(collection_id);
            }
        }

        self.conn.execute(
            "INSERT INTO collection_playback_state (collection_id, track_id, position_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(collection_id) DO UPDATE SET
               track_id = excluded.track_id,
               position_ms = excluded.position_ms",
            params![collection_id, track_id, position_ms.max(0)],
        )?;
        Ok(())
    }

    pub fn clear_collection_playback_state(&self, collection_id: i64) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM collection_playback_state WHERE collection_id = ?1",
            params![collection_id],
        )?;
        Ok(())
    }

    pub fn unique_collection_name(&self, base: &str) -> Result<String, DbError> {
        if !self.collection_name_exists(base)? {
            return Ok(base.to_string());
        }
        for index in 2..10_000 {
            let candidate = format!("{base} ({index})");
            if !self.collection_name_exists(&candidate)? {
                return Ok(candidate);
            }
        }
        Ok(format!("{base} ({})", chrono_now()))
    }

    pub fn list_collection_tracks(&self, collection_id: i64) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration_ms, t.track_number,
                    t.added_at, CASE WHEN t.peaks_json IS NOT NULL THEN 1 ELSE 0 END
             FROM tracks t
             JOIN collection_tracks ct ON ct.track_id = t.id
             WHERE ct.collection_id = ?1
             ORDER BY ct.position",
        )?;
        let rows = stmt.query_map(params![collection_id], map_track_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn reorder_collection_tracks(
        &self,
        collection_id: i64,
        track_ids: &[i64],
    ) -> Result<(), DbError> {
        let tx = self.conn.unchecked_transaction()?;

        let mut existing: Vec<i64> = {
            let mut stmt = tx.prepare(
                "SELECT track_id FROM collection_tracks
                 WHERE collection_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![collection_id], |row| row.get(0))?;
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
                "UPDATE collection_tracks SET position = ?1
                 WHERE collection_id = ?2 AND track_id = ?3",
                params![position as i64, collection_id, track_id],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn list_taglist_value_titles(
        &self,
        taglist_id: i64,
    ) -> Result<HashMap<String, String>, DbError> {
        self.get_taglist_titles(taglist_id)
    }

    pub fn list_taglist_track_order(
        &self,
        taglist_id: i64,
    ) -> Result<Vec<(String, i64, i64)>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT tag_value, track_id, position
             FROM taglist_track_order
             WHERE taglist_id = ?1
             ORDER BY tag_value COLLATE NOCASE, position",
        )?;
        let rows = stmt.query_map(params![taglist_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn create_playlist(&self, name: &str) -> Result<i64, DbError> {
        let now = chrono_now();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO playlists (name, created_at) VALUES (?1, ?2)",
            params![name, now],
        )?;
        let playlist_id = tx.last_insert_rowid();
        let position: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_order",
            [],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO playlist_order (playlist_id, position) VALUES (?1, ?2)",
            params![playlist_id, position],
        )?;
        tx.commit()?;
        Ok(playlist_id)
    }

    pub fn delete_playlist(&self, id: i64) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_playlist_order_ids(&self) -> Result<Vec<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT playlist_id FROM playlist_order ORDER BY position")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn default_playlist_order_ids(&self) -> Result<Vec<i64>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM playlists ORDER BY name COLLATE NOCASE")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn reorder_playlists(&self, playlist_ids: &[i64]) -> Result<(), DbError> {
        let all = self.default_playlist_order_ids()?;
        let all_set: std::collections::HashSet<i64> = all.iter().copied().collect();

        let mut ordered: Vec<i64> = playlist_ids
            .iter()
            .copied()
            .filter(|id| all_set.contains(id))
            .collect();
        for id in all {
            if !ordered.contains(&id) {
                ordered.push(id);
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM playlist_order", [])?;
        for (position, playlist_id) in ordered.iter().enumerate() {
            tx.execute(
                "INSERT INTO playlist_order (playlist_id, position) VALUES (?1, ?2)",
                params![playlist_id, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn rename_playlist(&self, id: i64, name: &str) -> Result<(), DbError> {
        let changed = self.conn.execute(
            "UPDATE playlists SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        if changed == 0 {
            return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
        }
        Ok(())
    }

    pub fn list_playlists(&self) -> Result<Vec<Playlist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, p.created_at,
                    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id)
             FROM playlists p",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                track_count: row.get(3)?,
            })
        })?;
        let mut by_id: HashMap<i64, Playlist> = HashMap::new();
        for row in rows.filter_map(Result::ok) {
            by_id.insert(row.id, row);
        }

        let stored_order = self.list_playlist_order_ids()?;
        let default_order = self.default_playlist_order_ids()?;
        let ordered_ids = merge_collection_order(&stored_order, &default_order);

        Ok(ordered_ids
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .collect())
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

    pub fn create_taglist(
        &self,
        name: &str,
        tag_key: &str,
        value_singular_name: &str,
    ) -> Result<i64, DbError> {
        let now = chrono_now();
        self.conn.execute(
            "INSERT INTO taglists (name, tag_key, value_singular_name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![name, tag_key, value_singular_name, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_taglist(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM taglists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn has_taglist_named(&self, name: &str) -> Result<bool, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM taglists WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn list_taglists(&self) -> Result<Vec<Taglist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, tag_key, value_singular_name, created_at FROM taglists ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Taglist {
                id: row.get(0)?,
                name: row.get(1)?,
                tag_key: row.get(2)?,
                value_singular_name: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_taglist(&self, id: i64) -> Result<Option<Taglist>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, tag_key, value_singular_name, created_at FROM taglists WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Taglist {
                id: row.get(0)?,
                name: row.get(1)?,
                tag_key: row.get(2)?,
                value_singular_name: row.get(3)?,
                created_at: row.get(4)?,
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

    pub fn list_taglist_value_order(&self, taglist_id: i64) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT tag_value FROM taglist_value_order
             WHERE taglist_id = ?1
             ORDER BY position",
        )?;
        let rows = stmt.query_map(params![taglist_id], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn reorder_taglist_values(
        &self,
        taglist_id: i64,
        tag_values: &[String],
    ) -> Result<(), DbError> {
        let taglist = self
            .get_taglist(taglist_id)?
            .ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
        let tag_key = taglist.tag_key;

        let current: Vec<String> = self
            .conn
            .prepare(
                "SELECT DISTINCT tag_value FROM track_tags WHERE tag_key = ?1
                 ORDER BY tag_value COLLATE NOCASE",
            )?
            .query_map(params![tag_key], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        let mut ordered: Vec<String> = tag_values
            .iter()
            .filter(|value| current.contains(value))
            .cloned()
            .collect();
        for value in &current {
            if !ordered.contains(value) {
                ordered.push(value.clone());
            }
        }

        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM taglist_value_order WHERE taglist_id = ?1",
            params![taglist_id],
        )?;
        for (position, tag_value) in ordered.iter().enumerate() {
            tx.execute(
                "INSERT INTO taglist_value_order (taglist_id, tag_value, position)
                 VALUES (?1, ?2, ?3)",
                params![taglist_id, tag_value, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_taglist_values(
        &self,
        tag_key: &str,
        taglist_id: i64,
    ) -> Result<Vec<TaglistValue>, DbError> {
        let titles = self.get_taglist_titles(taglist_id)?;
        let mut counts: HashMap<String, i64> = HashMap::new();

        let mut stmt = self.conn.prepare(
            "SELECT tt.tag_value, COUNT(DISTINCT tt.track_id)
             FROM track_tags tt
             JOIN tracks t ON t.id = tt.track_id
             WHERE tt.tag_key = ?1 AND t.collection_id IS NULL
             GROUP BY tt.tag_value",
        )?;
        let rows = stmt.query_map(params![tag_key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows.filter_map(Result::ok) {
            counts.insert(row.0, row.1);
        }

        let stored_order = self.list_taglist_value_order(taglist_id)?;
        let all_values: Vec<String> = counts.keys().cloned().collect();
        let ordered_values = merge_taglist_value_order(&stored_order, &all_values);
        let mut values: Vec<TaglistValue> = ordered_values
            .into_iter()
            .map(|value| TaglistValue {
                track_count: counts.get(&value).copied().unwrap_or(0),
                display_title: titles.get(&value).cloned(),
                value: Some(value),
            })
            .collect();

        let no_tag_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tracks t
             WHERE t.collection_id IS NULL
               AND NOT EXISTS (
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
                   AND t.collection_id IS NULL
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
                 WHERE t.collection_id IS NULL
                   AND NOT EXISTS (
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

    pub fn get_track_tag_values(
        &self,
        track_id: i64,
        tag_key: &str,
    ) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT tag_value FROM track_tags
             WHERE track_id = ?1 AND tag_key = ?2
             ORDER BY tag_value COLLATE NOCASE",
        )?;
        let rows = stmt.query_map(params![track_id, tag_key], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn track_in_taglist_sublist(
        &self,
        tag_key: &str,
        tag_value: &str,
        track_id: i64,
    ) -> Result<bool, DbError> {
        if tag_value.is_empty() {
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM track_tags WHERE track_id = ?1 AND tag_key = ?2",
                params![track_id, tag_key],
                |row| row.get(0),
            )?;
            Ok(count == 0)
        } else {
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM track_tags
                 WHERE track_id = ?1 AND tag_key = ?2 AND tag_value = ?3",
                params![track_id, tag_key, tag_value],
                |row| row.get(0),
            )?;
            Ok(count > 0)
        }
    }

    fn taglist_sublist_has_custom_order(
        &self,
        taglist_id: i64,
        tag_value: &str,
    ) -> Result<bool, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM taglist_track_order
             WHERE taglist_id = ?1 AND tag_value = ?2",
            params![taglist_id, tag_value],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    fn track_has_order_in_sublist(
        &self,
        taglist_id: i64,
        tag_value: &str,
        track_id: i64,
    ) -> Result<bool, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM taglist_track_order
             WHERE taglist_id = ?1 AND tag_value = ?2 AND track_id = ?3",
            params![taglist_id, tag_value, track_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    fn max_order_position(
        &self,
        taglist_id: i64,
        tag_value: &str,
    ) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(position), -1) FROM taglist_track_order
             WHERE taglist_id = ?1 AND tag_value = ?2",
            params![taglist_id, tag_value],
            |row| row.get(0),
        )?)
    }

    fn append_track_to_taglist_order(
        &self,
        taglist_id: i64,
        tag_value: &str,
        track_id: i64,
    ) -> Result<(), DbError> {
        let position = self.max_order_position(taglist_id, tag_value)? + 1;
        self.conn.execute(
            "INSERT INTO taglist_track_order (taglist_id, tag_value, track_id, position)
             VALUES (?1, ?2, ?3, ?4)",
            params![taglist_id, tag_value, track_id, position],
        )?;
        Ok(())
    }

    pub fn sync_taglist_order_for_track_key(
        &self,
        track_id: i64,
        taglist_id: i64,
        tag_key: &str,
    ) -> Result<(), DbError> {
        if !self.is_library_track(track_id)? {
            return Ok(());
        }
        let current_values = self.get_track_tag_values(track_id, tag_key)?;

        let mut stmt = self.conn.prepare(
            "SELECT tag_value FROM taglist_track_order
             WHERE track_id = ?1 AND taglist_id = ?2",
        )?;
        let ordered_values: Vec<String> = stmt
            .query_map(params![track_id, taglist_id], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        for ordered_value in ordered_values {
            let still_belongs = if ordered_value.is_empty() {
                current_values.is_empty()
            } else {
                current_values.iter().any(|value| value == &ordered_value)
            };

            if !still_belongs {
                self.conn.execute(
                    "DELETE FROM taglist_track_order
                     WHERE track_id = ?1 AND taglist_id = ?2 AND tag_value = ?3",
                    params![track_id, taglist_id, ordered_value],
                )?;
            }
        }

        let sublists_to_integrate: Vec<String> = if current_values.is_empty() {
            vec![String::new()]
        } else {
            current_values
        };

        for tag_value in sublists_to_integrate {
            if !self.taglist_sublist_has_custom_order(taglist_id, &tag_value)? {
                continue;
            }
            if self.track_has_order_in_sublist(taglist_id, &tag_value, track_id)? {
                continue;
            }
            self.append_track_to_taglist_order(taglist_id, &tag_value, track_id)?;
        }

        Ok(())
    }

    pub fn sync_taglist_order_for_track(&self, track_id: i64) -> Result<(), DbError> {
        for taglist in self.list_taglists()? {
            self.sync_taglist_order_for_track_key(track_id, taglist.id, &taglist.tag_key)?;
        }
        Ok(())
    }
}

pub fn normalize_collection_playback_mode(mode: &str) -> &'static str {
    match mode.trim() {
        "continuous" => "continuous",
        _ => "discrete",
    }
}

pub fn clamp_continuous_volume(volume: f64) -> f64 {
    volume.clamp(0.0, 1.0)
}

pub fn default_continuous_volume() -> f64 {
    0.5
}

fn merge_collection_order(stored: &[i64], all_ids: &[i64]) -> Vec<i64> {
    let all_set: std::collections::HashSet<i64> = all_ids.iter().copied().collect();
    let mut result: Vec<i64> = stored
        .iter()
        .copied()
        .filter(|id| all_set.contains(id))
        .collect();

    for id in all_ids {
        if !result.contains(id) {
            result.push(*id);
        }
    }

    result
}

fn merge_taglist_value_order(stored: &[String], all_values: &[String]) -> Vec<String> {
    let all_set: std::collections::HashSet<&str> =
        all_values.iter().map(String::as_str).collect();
    let mut result: Vec<String> = stored
        .iter()
        .filter(|value| all_set.contains(value.as_str()))
        .cloned()
        .collect();

    let mut default_sorted = all_values.to_vec();
    default_sorted.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    for new_val in default_sorted {
        if result.iter().any(|existing| existing == &new_val) {
            continue;
        }
        let new_lower = new_val.to_lowercase();
        let mut last_before: Option<usize> = None;
        for (index, existing) in result.iter().enumerate() {
            if existing.to_lowercase() < new_lower {
                last_before = Some(index);
            }
        }
        let insert_at = last_before.map(|index| index + 1).unwrap_or(0);
        result.insert(insert_at, new_val);
    }

    result
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
    fn rename_playlist_updates_name() {
        let db = test_db();
        let playlist_id = db.create_playlist("Old Name").unwrap();
        db.rename_playlist(playlist_id, "New Name").unwrap();
        let playlists = db.list_playlists().unwrap();
        assert_eq!(playlists[0].name, "New Name");
    }

    #[test]
    fn rename_collection_rejects_duplicate_name() {
        let db = test_db();
        let first = db.create_collection("Alpha").unwrap();
        let _second = db.create_collection("Beta").unwrap();
        assert!(db.collection_name_taken_by_other(first, "Beta").unwrap());
    }

    #[test]
    fn reorder_playlists_updates_sidebar_order() {
        let db = test_db();
        let alpha = db.create_playlist("Alpha").unwrap();
        let beta = db.create_playlist("Beta").unwrap();
        let gamma = db.create_playlist("Gamma").unwrap();

        assert_eq!(
            db.list_playlists()
                .unwrap()
                .into_iter()
                .map(|playlist| playlist.id)
                .collect::<Vec<_>>(),
            vec![alpha, beta, gamma]
        );

        db.reorder_playlists(&[gamma, alpha, beta]).unwrap();

        assert_eq!(
            db.list_playlists()
                .unwrap()
                .into_iter()
                .map(|playlist| playlist.name)
                .collect::<Vec<_>>(),
            vec!["Gamma", "Alpha", "Beta"]
        );
    }

    #[test]
    fn reorder_collections_updates_sidebar_order() {
        let db = test_db();
        let alpha = db.create_collection("Alpha").unwrap();
        let beta = db.create_collection("Beta").unwrap();
        let gamma = db.create_collection("Gamma").unwrap();

        assert_eq!(
            db.list_collections().unwrap().into_iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![alpha, beta, gamma]
        );

        db.reorder_collections(&[gamma, alpha, beta]).unwrap();

        assert_eq!(
            db.list_collections().unwrap().into_iter().map(|c| c.name).collect::<Vec<_>>(),
            vec!["Gamma", "Alpha", "Beta"]
        );
    }

    #[test]
    fn merge_taglist_value_order_inserts_new_values_alphabetically() {
        let merged = merge_taglist_value_order(
            &["Mozart".to_string(), "Bach".to_string()],
            &[
                "Mozart".to_string(),
                "Bach".to_string(),
                "Beethoven".to_string(),
            ],
        );
        assert_eq!(
            merged,
            vec!["Mozart", "Bach", "Beethoven"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn taglist_values_custom_order_persisted_with_no_tag_last() {
        let db = test_db();
        let taglist_id = db.create_taglist("Composers", "Composer", "").unwrap();
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

        db.reorder_taglist_values(taglist_id, &["Mozart".to_string(), "Bach".to_string()])
            .unwrap();

        let values = db.list_taglist_values("Composer", taglist_id).unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(values[0].value.as_deref(), Some("Mozart"));
        assert_eq!(values[1].value.as_deref(), Some("Bach"));
        assert_eq!(values[2].value, None);
    }

    #[test]
    fn new_taglist_value_inserts_at_default_position() {
        let db = test_db();
        let taglist_id = db.create_taglist("Composers", "Composer", "").unwrap();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");

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
        db.reorder_taglist_values(taglist_id, &["Mozart".to_string(), "Bach".to_string()])
            .unwrap();

        let track_c = insert_track(&db, "C");
        db.replace_track_tags(
            track_c,
            &[("Composer".to_string(), "Beethoven".to_string())],
        )
        .unwrap();

        let values = db.list_taglist_values("Composer", taglist_id).unwrap();
        assert_eq!(values.len(), 4);
        assert_eq!(values[0].value.as_deref(), Some("Mozart"));
        assert_eq!(values[1].value.as_deref(), Some("Bach"));
        assert_eq!(values[2].value.as_deref(), Some("Beethoven"));
        assert_eq!(values[3].value, None);
        assert_eq!(values[3].track_count, 0);
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
    fn taglists_exclude_collection_tracks() {
        let db = test_db();
        let library_untagged = insert_track(&db, "LibraryUntagged");
        let library_rock = insert_track(&db, "LibraryRock");
        db.replace_track_tags(
            library_rock,
            &[("Genre".to_string(), "Rock".to_string())],
        )
        .unwrap();

        let collection_id = db.create_collection("Pack").unwrap();
        let (collection_untagged, _) = db
            .upsert_collection_track(
                collection_id,
                "/collections/untagged.mp3",
                "CollectionUntagged",
                "Artist",
                "Album",
                1000,
                None,
            )
            .unwrap();
        db.replace_track_tags(collection_untagged, &[]).unwrap();
        let (collection_rock, _) = db
            .upsert_collection_track(
                collection_id,
                "/collections/rock.mp3",
                "CollectionRock",
                "Artist",
                "Album",
                1000,
                None,
            )
            .unwrap();
        db.replace_track_tags(
            collection_rock,
            &[("Genre".to_string(), "Rock".to_string())],
        )
        .unwrap();

        let values = db.list_taglist_values("Genre", 1).unwrap();
        let rock = values
            .iter()
            .find(|value| value.value.as_deref() == Some("Rock"))
            .unwrap();
        let no_tag = values.iter().find(|value| value.value.is_none()).unwrap();
        assert_eq!(rock.track_count, 1);
        assert_eq!(no_tag.track_count, 1);

        let rock_tracks = db
            .list_taglist_tracks(1, "Genre", Some("Rock"))
            .unwrap();
        assert_eq!(rock_tracks.len(), 1);
        assert_eq!(rock_tracks[0].id, library_rock);

        let no_tag_tracks = db.list_taglist_tracks(1, "Genre", None).unwrap();
        assert_eq!(no_tag_tracks.len(), 1);
        assert_eq!(no_tag_tracks[0].id, library_untagged);
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
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
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
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
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
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
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

    #[test]
    fn tag_change_moves_track_out_of_reordered_old_sublist_only() {
        let db = test_db();
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");
        db.replace_track_tags(
            track_a,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();
        db.replace_track_tags(
            track_b,
            &[("Comment".to_string(), "02".to_string())],
        )
        .unwrap();

        db.reorder_taglist_tracks(taglist_id, Some("01"), &[track_a])
            .unwrap();

        db.replace_track_tags(
            track_a,
            &[("Comment".to_string(), "02".to_string())],
        )
        .unwrap();
        db.sync_taglist_order_for_track(track_a).unwrap();

        let old_sublist = db
            .list_taglist_tracks(taglist_id, "Comment", Some("01"))
            .unwrap();
        assert!(old_sublist.is_empty());

        let new_sublist = db
            .list_taglist_tracks(taglist_id, "Comment", Some("02"))
            .unwrap();
        assert_eq!(new_sublist.len(), 2);
        assert!(new_sublist.iter().any(|track| track.id == track_a));

        let stale_order: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM taglist_track_order
                 WHERE taglist_id = ?1 AND tag_value = '01' AND track_id = ?2",
                params![taglist_id, track_a],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale_order, 0);
    }

    #[test]
    fn tag_change_moves_track_between_two_reordered_sublists() {
        let db = test_db();
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
        let track_a = insert_track(&db, "A");
        let track_b = insert_track(&db, "B");
        db.replace_track_tags(
            track_a,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();
        db.replace_track_tags(
            track_b,
            &[("Comment".to_string(), "02".to_string())],
        )
        .unwrap();

        db.reorder_taglist_tracks(taglist_id, Some("01"), &[track_a])
            .unwrap();
        db.reorder_taglist_tracks(taglist_id, Some("02"), &[track_b])
            .unwrap();

        db.replace_track_tags(
            track_a,
            &[("Comment".to_string(), "02".to_string())],
        )
        .unwrap();
        db.sync_taglist_order_for_track(track_a).unwrap();

        let old_sublist = db
            .list_taglist_tracks(taglist_id, "Comment", Some("01"))
            .unwrap();
        assert!(old_sublist.is_empty());

        let new_sublist = db
            .list_taglist_tracks(taglist_id, "Comment", Some("02"))
            .unwrap();
        assert_eq!(new_sublist.len(), 2);
        assert_eq!(new_sublist[0].id, track_b);
        assert_eq!(new_sublist[1].id, track_a);

        let position: i64 = db
            .conn
            .query_row(
                "SELECT position FROM taglist_track_order
                 WHERE taglist_id = ?1 AND tag_value = '02' AND track_id = ?2",
                params![taglist_id, track_a],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(position, 1);
    }

    #[test]
    fn delete_track_cascades_playlist_and_taglist_order() {
        let db = test_db();
        let playlist_id = db.create_playlist("Set").unwrap();
        let taglist_id = db.create_taglist("Events", "Comment", "").unwrap();
        let track_id = insert_track(&db, "Delete Me");
        db.replace_track_tags(
            track_id,
            &[("Comment".to_string(), "01".to_string())],
        )
        .unwrap();
        db.add_track_to_playlist(playlist_id, track_id).unwrap();
        db.reorder_taglist_tracks(taglist_id, Some("01"), &[track_id])
            .unwrap();

        db.delete_track(track_id).unwrap();
        assert_eq!(db.get_track_path(track_id).unwrap(), None);

        let playlist_tracks = db.list_playlist_tracks(playlist_id).unwrap();
        assert!(playlist_tracks.is_empty());

        let order_count: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM taglist_track_order WHERE track_id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(order_count, 0);
    }

    #[test]
    fn uncached_audio_tracks_lists_missing_peaks_or_seek_index() {
        let db = test_db();
        let complete = insert_track(&db, "Complete");
        let missing_seek = insert_track(&db, "MissingSeek");
        let missing_both = insert_track(&db, "MissingBoth");

        db.set_peaks(complete, "[0.1]").unwrap();
        db.set_seek_index(complete, "[{\"ts_ms\":0,\"sample_index\":0}]")
            .unwrap();
        db.set_peaks(missing_seek, "[0.1]").unwrap();

        let ids: Vec<i64> = db
            .list_uncached_audio_tracks()
            .unwrap()
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert!(!ids.contains(&complete));
        assert!(ids.contains(&missing_seek));
        assert!(ids.contains(&missing_both));
    }

    #[test]
    fn duration_change_clears_audio_cache() {
        let db = test_db();
        let track_id = insert_track(&db, "A");
        db.set_peaks(track_id, "[0.1]").unwrap();
        db.set_seek_index(track_id, "[{\"ts_ms\":0,\"sample_index\":0}]")
            .unwrap();

        db.upsert_track("/music/A.mp3", "A", "Artist", "Album", 2000, None)
            .unwrap();

        assert!(db.get_peaks(track_id).unwrap().is_none());
        assert!(db.get_seek_index(track_id).unwrap().is_none());
        assert!(db.audio_cache_incomplete(track_id).unwrap());
    }
}
