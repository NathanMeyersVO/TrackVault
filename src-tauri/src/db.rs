use std::path::Path;

use rusqlite::{params, Connection};
use thiserror::Error;

use crate::models::{Playlist, Track};

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
            ",
        )?;
        let _ = self.conn.execute(
            "ALTER TABLE tracks ADD COLUMN seek_index_json TEXT",
            [],
        );
        Ok(())
    }

    pub fn add_watch_folder(&self, path: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO watch_folders (path) VALUES (?1)",
            params![path],
        )?;
        Ok(())
    }

    pub fn list_watch_folders(&self) -> Result<Vec<String>, DbError> {
        let mut stmt = self.conn.prepare("SELECT path FROM watch_folders ORDER BY path")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn upsert_track(
        &self,
        path: &str,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
        track_number: Option<i32>,
    ) -> Result<bool, DbError> {
        let now = chrono_now();
        let changed = self.conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration_ms, track_number, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               album = excluded.album,
               duration_ms = excluded.duration_ms,
               track_number = excluded.track_number
             WHERE tracks.title != excluded.title
                OR tracks.artist != excluded.artist
                OR tracks.album != excluded.album
                OR tracks.duration_ms != excluded.duration_ms
                OR tracks.track_number IS NOT excluded.track_number",
            params![path, title, artist, album, duration_ms, track_number, now],
        )?;
        Ok(changed > 0)
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
