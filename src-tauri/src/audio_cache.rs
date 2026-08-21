use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::audio_scan::{scan_audio, AudioScanResult};
use crate::db::Database;
use crate::models::{AudioCacheProgress, AudioCacheTrackReady, WaveformPeaks};
use crate::player::AudioPlayer;
use crate::seek_index::{default_index, parse_seek_index, serialize_seek_index, SeekKeyframe};

enum CacheCommand {
    Kick,
    Prioritize(i64),
    Reset,
}

pub struct AudioCacheWorker {
    tx: Sender<CacheCommand>,
    generation: Arc<AtomicU64>,
}

impl AudioCacheWorker {
    pub fn start(
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        player: Arc<AudioPlayer>,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(0));
        let generation_for_thread = Arc::clone(&generation);

        thread::spawn(move || {
            run_worker(app, db, player, rx, generation_for_thread);
        });

        let worker = Self { tx, generation };
        worker.kick();
        worker
    }

    pub fn kick(&self) {
        let _ = self.tx.send(CacheCommand::Kick);
    }

    pub fn prioritize(&self, track_id: i64) {
        let _ = self.tx.send(CacheCommand::Prioritize(track_id));
    }

    pub fn reset(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let _ = self.tx.send(CacheCommand::Reset);
    }
}

pub fn cached_seek_index(
    db: &Database,
    track_id: i64,
    duration_ms: u64,
) -> Result<(Vec<SeekKeyframe>, bool), String> {
    let json = db.get_seek_index(track_id).map_err(|e| e.to_string())?;
    Ok(seek_index_from_cache(json.as_deref(), duration_ms))
}

pub fn seek_index_from_cache(
    json: Option<&str>,
    duration_ms: u64,
) -> (Vec<SeekKeyframe>, bool) {
    if let Some(json) = json {
        if let Some(index) = parse_seek_index(json) {
            if !index.is_empty() {
                return (index, false);
            }
        }
    }
    (default_index(duration_ms), true)
}

pub fn peaks_from_cache(json: Option<&str>, duration_ms: i64) -> WaveformPeaks {
    if let Some(json) = json {
        if let Ok(peaks) = serde_json::from_str::<Vec<f32>>(json) {
            if !peaks.is_empty() {
                return WaveformPeaks { peaks, duration_ms };
            }
        }
    }
    WaveformPeaks {
        peaks: Vec::new(),
        duration_ms,
    }
}

pub fn persist_audio_scan(
    db: &Database,
    track_id: i64,
    scan: &AudioScanResult,
) -> Result<(), String> {
    let peaks_json = serde_json::to_string(&scan.peaks.peaks).map_err(|e| e.to_string())?;
    let seek_index_json = serialize_seek_index(&scan.seek_index)?;
    db.set_peaks(track_id, &peaks_json)
        .map_err(|e| e.to_string())?;
    db.set_seek_index(track_id, &seek_index_json)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn run_worker(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    player: Arc<AudioPlayer>,
    rx: Receiver<CacheCommand>,
    generation: Arc<AtomicU64>,
) {
    let mut queue: VecDeque<(i64, String)> = VecDeque::new();
    let mut done = 0u32;
    let mut total = 0u32;

    loop {
        let command = if queue.is_empty() {
            match rx.recv() {
                Ok(command) => Some(command),
                Err(_) => break,
            }
        } else {
            match rx.try_recv() {
                Ok(command) => Some(command),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => break,
            }
        };

        match command {
            Some(CacheCommand::Kick) => {
                queue = load_uncached(&db);
                done = 0;
                total = queue.len() as u32;
                emit_progress(&app, done, total, queue.is_empty());
            }
            Some(CacheCommand::Prioritize(track_id)) => {
                if let Some(item) = load_track_if_uncached(&db, track_id) {
                    let already_queued = queue.iter().any(|(id, _)| *id == track_id);
                    queue.retain(|(id, _)| *id != track_id);
                    if !already_queued {
                        if total == 0 {
                            done = 0;
                            total = 1;
                        } else {
                            total = total.saturating_add(1);
                        }
                    }
                    queue.push_front(item);
                    emit_progress(&app, done, total.max(queue.len() as u32), false);
                }
            }
            Some(CacheCommand::Reset) => {
                queue.clear();
                done = 0;
                total = 0;
                emit_progress(&app, 0, 0, true);
            }
            None => {
                let Some((track_id, path)) = queue.pop_front() else {
                    continue;
                };
                let gen = generation.load(Ordering::SeqCst);
                cache_one_track(&app, &db, &player, &generation, gen, track_id, &path);
                if generation.load(Ordering::SeqCst) != gen {
                    continue;
                }
                done = done.saturating_add(1);
                emit_progress(&app, done, total.max(done), queue.is_empty());
            }
        }
    }
}

fn load_uncached(db: &Mutex<Database>) -> VecDeque<(i64, String)> {
    match db.lock().list_uncached_audio_tracks() {
        Ok(rows) => rows.into(),
        Err(error) => {
            eprintln!("Failed to list uncached audio tracks: {error}");
            VecDeque::new()
        }
    }
}

fn load_track_if_uncached(db: &Mutex<Database>, track_id: i64) -> Option<(i64, String)> {
    let db = db.lock();
    match db.audio_cache_incomplete(track_id) {
        Ok(true) => db
            .get_track_path(track_id)
            .ok()
            .flatten()
            .map(|path| (track_id, path)),
        Ok(false) => None,
        Err(error) => {
            eprintln!("Failed to check audio cache for track {track_id}: {error}");
            None
        }
    }
}

fn cache_one_track(
    app: &AppHandle,
    db: &Mutex<Database>,
    player: &AudioPlayer,
    generation: &AtomicU64,
    gen: u64,
    track_id: i64,
    path: &str,
) {
    let still_needed = match db.lock().audio_cache_incomplete(track_id) {
        Ok(needed) => needed,
        Err(error) => {
            eprintln!("Failed to check audio cache for track {track_id}: {error}");
            return;
        }
    };
    if !still_needed {
        return;
    }

    let scan = match scan_audio(Path::new(path)) {
        Ok(scan) => scan,
        Err(error) => {
            eprintln!("Failed to scan audio for {path}: {error}");
            return;
        }
    };

    if generation.load(Ordering::SeqCst) != gen {
        return;
    }

    {
        let db = db.lock();
        if db.audio_cache_incomplete(track_id).unwrap_or(true) {
            if let Err(error) = persist_audio_scan(&db, track_id, &scan) {
                eprintln!("Failed to persist audio cache for track {track_id}: {error}");
                return;
            }
        }
    }

    player.update_seek_index(track_id, scan.seek_index);
    let _ = app.emit(
        "audio-cache-track-ready",
        AudioCacheTrackReady { track_id },
    );
}

fn emit_progress(app: &AppHandle, done: u32, total: u32, finished: bool) {
    let _ = app.emit(
        "audio-cache-progress",
        AudioCacheProgress {
            done,
            total,
            finished,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::WaveformPeaks;
    use crate::seek_index::SeekKeyframe;

    fn test_db() -> Database {
        Database::open(Path::new(":memory:")).expect("in-memory db")
    }

    fn insert_track(db: &Database, title: &str) -> i64 {
        db.upsert_track(
            &format!("/music/{title}.mp3"),
            title,
            "Artist",
            "Album",
            1000,
            None,
        )
        .expect("insert track")
        .0
    }

    #[test]
    fn missing_cache_uses_default_index() {
        let (index, needs_build) = seek_index_from_cache(None, 10_000);
        assert!(needs_build);
        assert!(!index.is_empty());
        assert_eq!(index[0].ts_ms, 0);
    }

    #[test]
    fn empty_index_json_uses_default() {
        let (index, needs_build) = seek_index_from_cache(Some("[]"), 5_000);
        assert!(needs_build);
        assert!(!index.is_empty());
    }

    #[test]
    fn cached_index_is_used() {
        let stored = vec![
            SeekKeyframe {
                ts_ms: 0,
                sample_index: 0,
            },
            SeekKeyframe {
                ts_ms: 5_000,
                sample_index: 220_500,
            },
        ];
        let json = serialize_seek_index(&stored).unwrap();
        let (index, needs_build) = seek_index_from_cache(Some(&json), 10_000);
        assert!(!needs_build);
        assert_eq!(index.len(), 2);
        assert_eq!(index[1].sample_index, 220_500);
    }

    #[test]
    fn missing_peaks_returns_empty() {
        let peaks = peaks_from_cache(None, 1_234);
        assert!(peaks.peaks.is_empty());
        assert_eq!(peaks.duration_ms, 1_234);
    }

    #[test]
    fn cached_peaks_are_returned() {
        let peaks = peaks_from_cache(Some("[0.1,0.5,0.2]"), 9_000);
        assert_eq!(peaks.peaks, vec![0.1, 0.5, 0.2]);
        assert_eq!(peaks.duration_ms, 9_000);
    }

    #[test]
    fn persist_audio_scan_writes_peaks_and_seek_index() {
        let db = test_db();
        let track_id = insert_track(&db, "Cached");
        let scan = AudioScanResult {
            peaks: WaveformPeaks {
                peaks: vec![0.2, 0.8],
                duration_ms: 1000,
            },
            seek_index: vec![
                SeekKeyframe {
                    ts_ms: 0,
                    sample_index: 0,
                },
                SeekKeyframe {
                    ts_ms: 1000,
                    sample_index: 44_100,
                },
            ],
        };

        persist_audio_scan(&db, track_id, &scan).unwrap();
        assert!(db.get_peaks(track_id).unwrap().is_some());
        assert!(db.get_seek_index(track_id).unwrap().is_some());
        assert!(!db.audio_cache_incomplete(track_id).unwrap());
        assert!(db.list_uncached_audio_tracks().unwrap().is_empty());
    }
}
