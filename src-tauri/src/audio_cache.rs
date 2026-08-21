use std::collections::{HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
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

struct JobFinished {
    track_id: i64,
    generation: u64,
}

struct JobQueue {
    items: VecDeque<(i64, String)>,
    shutdown: bool,
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
            run_coordinator(app, db, player, rx, generation_for_thread);
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

pub fn cache_thread_count_from(cores: usize) -> usize {
    let cores = cores.max(1);
    (cores / 2).clamp(1, cores.saturating_sub(1).max(1))
}

fn cache_thread_count() -> usize {
    let cores = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    cache_thread_count_from(cores)
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

fn run_coordinator(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    player: Arc<AudioPlayer>,
    cmd_rx: Receiver<CacheCommand>,
    generation: Arc<AtomicU64>,
) {
    let queue = Arc::new(Mutex::new(JobQueue {
        items: VecDeque::new(),
        shutdown: false,
    }));
    let condvar = Arc::new(Condvar::new());
    let in_flight = Arc::new(Mutex::new(HashSet::new()));
    let (done_tx, done_rx) = mpsc::channel();

    for _ in 0..cache_thread_count() {
        let queue = Arc::clone(&queue);
        let condvar = Arc::clone(&condvar);
        let in_flight = Arc::clone(&in_flight);
        let db = Arc::clone(&db);
        let player = Arc::clone(&player);
        let app = app.clone();
        let generation = Arc::clone(&generation);
        let done_tx = done_tx.clone();
        thread::spawn(move || {
            run_decode_worker(queue, condvar, in_flight, db, player, app, generation, done_tx);
        });
    }
    drop(done_tx);

    let mut done = 0u32;
    let mut total = 0u32;

    loop {
        let busy = is_busy(&queue, &in_flight);
        let command = if busy {
            match cmd_rx.recv_timeout(Duration::from_millis(50)) {
                Ok(command) => Some(command),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match cmd_rx.recv() {
                Ok(command) => Some(command),
                Err(_) => break,
            }
        };

        drain_finished(
            &done_rx,
            &queue,
            &in_flight,
            &generation,
            &app,
            &mut done,
            &mut total,
        );

        match command {
            Some(CacheCommand::Kick) => {
                apply_kick(&db, &queue, &in_flight, &condvar, &mut done, &mut total);
                emit_progress(
                    &app,
                    done,
                    total,
                    total == 0 && !is_busy(&queue, &in_flight),
                );
            }
            Some(CacheCommand::Prioritize(track_id)) => {
                if apply_prioritize(&db, &queue, &in_flight, &condvar, track_id, &mut done, &mut total)
                {
                    emit_progress(&app, done, total.max(1), false);
                }
            }
            Some(CacheCommand::Reset) => {
                apply_reset(&queue, &condvar);
                done = 0;
                total = 0;
                emit_progress(&app, 0, 0, true);
            }
            None => {}
        }
    }

    let mut queue = queue.lock();
    queue.shutdown = true;
    queue.items.clear();
    condvar.notify_all();
}

fn is_busy(queue: &Mutex<JobQueue>, in_flight: &Mutex<HashSet<i64>>) -> bool {
    let queue = queue.lock();
    let in_flight = in_flight.lock();
    !queue.items.is_empty() || !in_flight.is_empty()
}

fn drain_finished(
    done_rx: &Receiver<JobFinished>,
    queue: &Mutex<JobQueue>,
    in_flight: &Mutex<HashSet<i64>>,
    generation: &AtomicU64,
    app: &AppHandle,
    done: &mut u32,
    total: &mut u32,
) {
    loop {
        match done_rx.try_recv() {
            Ok(finished) => handle_finished(
                finished, queue, in_flight, generation, app, done, total,
            ),
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => break,
        }
    }
}

fn handle_finished(
    finished: JobFinished,
    queue: &Mutex<JobQueue>,
    in_flight: &Mutex<HashSet<i64>>,
    generation: &AtomicU64,
    app: &AppHandle,
    done: &mut u32,
    total: &mut u32,
) {
    let (queue_empty, inf_empty) = {
        let queue = queue.lock();
        let mut in_flight = in_flight.lock();
        in_flight.remove(&finished.track_id);
        (queue.items.is_empty(), in_flight.is_empty())
    };

    if finished.generation != generation.load(Ordering::SeqCst) {
        return;
    }
    if *total == 0 {
        return;
    }

    *done = done.saturating_add(1);
    let finished_all = queue_empty && inf_empty;
    emit_progress(app, *done, (*total).max(*done), finished_all);
    if finished_all {
        *done = 0;
        *total = 0;
    }
}

fn apply_kick(
    db: &Mutex<Database>,
    queue: &Mutex<JobQueue>,
    in_flight: &Mutex<HashSet<i64>>,
    condvar: &Condvar,
    done: &mut u32,
    total: &mut u32,
) {
    let mut items = load_uncached(db);
    let mut queue = queue.lock();
    let in_flight = in_flight.lock();
    let in_flight_needed = items
        .iter()
        .filter(|(id, _)| in_flight.contains(id))
        .count() as u32;
    items.retain(|(id, _)| !in_flight.contains(id));
    queue.items = items;
    *done = 0;
    *total = queue.items.len() as u32 + in_flight_needed;
    condvar.notify_all();
}

fn apply_prioritize(
    db: &Mutex<Database>,
    queue: &Mutex<JobQueue>,
    in_flight: &Mutex<HashSet<i64>>,
    condvar: &Condvar,
    track_id: i64,
    done: &mut u32,
    total: &mut u32,
) -> bool {
    let Some(item) = load_track_if_uncached(db, track_id) else {
        return false;
    };

    let mut queue = queue.lock();
    let in_flight = in_flight.lock();
    if in_flight.contains(&track_id) {
        return false;
    }

    let already_queued = queue.items.iter().any(|(id, _)| *id == track_id);
    queue.items.retain(|(id, _)| *id != track_id);
    if !already_queued {
        if *total == 0 {
            *done = 0;
            *total = 1;
        } else {
            *total = total.saturating_add(1);
        }
    }
    queue.items.push_front(item);
    condvar.notify_one();
    true
}

fn apply_reset(queue: &Mutex<JobQueue>, condvar: &Condvar) {
    let mut queue = queue.lock();
    queue.items.clear();
    condvar.notify_all();
}

fn run_decode_worker(
    queue: Arc<Mutex<JobQueue>>,
    condvar: Arc<Condvar>,
    in_flight: Arc<Mutex<HashSet<i64>>>,
    db: Arc<Mutex<Database>>,
    player: Arc<AudioPlayer>,
    app: AppHandle,
    generation: Arc<AtomicU64>,
    done_tx: Sender<JobFinished>,
) {
    loop {
        let (track_id, path, gen) = {
            let mut queue = queue.lock();
            while queue.items.is_empty() && !queue.shutdown {
                condvar.wait(&mut queue);
            }
            if queue.shutdown && queue.items.is_empty() {
                return;
            }
            let Some((track_id, path)) = queue.items.pop_front() else {
                continue;
            };
            let gen = generation.load(Ordering::SeqCst);
            in_flight.lock().insert(track_id);
            (track_id, path, gen)
        };

        cache_one_track(&app, &db, &player, &generation, gen, track_id, &path);
        let _ = done_tx.send(JobFinished {
            track_id,
            generation: gen,
        });
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
    fn cache_thread_count_uses_half_the_cores() {
        assert_eq!(cache_thread_count_from(1), 1);
        assert_eq!(cache_thread_count_from(2), 1);
        assert_eq!(cache_thread_count_from(3), 1);
        assert_eq!(cache_thread_count_from(4), 2);
        assert_eq!(cache_thread_count_from(8), 4);
        assert_eq!(cache_thread_count_from(16), 8);
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
