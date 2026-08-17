use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{AppHandle, Emitter};

use crate::models::PlaybackState;

enum PlayerCommand {
    Play {
        track_id: i64,
        path: PathBuf,
        duration_ms: u64,
        start_ms: u64,
    },
    Pause,
    Resume,
    Stop,
    Seek {
        position_ms: u64,
    },
}

struct PlayerRuntime {
    _stream: OutputStream,
    sink: Option<Sink>,
    track_id: Option<i64>,
    path: Option<PathBuf>,
    duration_ms: u64,
    position_ms: u64,
    play_start: Option<Instant>,
    play_start_offset_ms: u64,
    is_playing: bool,
}

impl PlayerRuntime {
    fn new() -> Result<(Self, rodio::OutputStreamHandle), String> {
        let (stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Audio output error: {e}"))?;
        Ok((
            Self {
                _stream: stream,
                sink: None,
                track_id: None,
                path: None,
                duration_ms: 0,
                position_ms: 0,
                play_start: None,
                play_start_offset_ms: 0,
                is_playing: false,
            },
            stream_handle,
        ))
    }

    fn current_position_ms(&self) -> u64 {
        if self.is_playing {
            if let Some(start) = self.play_start {
                let elapsed = start.elapsed().as_millis() as u64;
                return (self.play_start_offset_ms + elapsed).min(self.duration_ms);
            }
        }
        self.position_ms.min(self.duration_ms)
    }

    fn state(&self) -> PlaybackState {
        PlaybackState {
            track_id: self.track_id,
            position_ms: self.current_position_ms(),
            duration_ms: self.duration_ms,
            is_playing: self.is_playing,
        }
    }

    fn play_at(
        &mut self,
        stream_handle: &rodio::OutputStreamHandle,
        track_id: i64,
        path: PathBuf,
        duration_ms: u64,
        start_ms: u64,
    ) -> Result<(), String> {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let sink = Sink::try_new(stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {e}"))?;

        let file = File::open(&path).map_err(|e| e.to_string())?;
        let source = Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
        let skip = Duration::from_millis(start_ms.min(duration_ms));
        let source = source.skip_duration(skip);

        sink.append(source);
        sink.play();

        self.sink = Some(sink);
        self.track_id = Some(track_id);
        self.path = Some(path);
        self.duration_ms = duration_ms;
        self.position_ms = start_ms;
        self.play_start_offset_ms = start_ms;
        self.play_start = Some(Instant::now());
        self.is_playing = true;
        Ok(())
    }

    fn pause(&mut self) {
        if let Some(sink) = self.sink.as_ref() {
            sink.pause();
        }
        self.position_ms = self.current_position_ms();
        self.play_start = None;
        self.is_playing = false;
    }

    fn resume(&mut self, stream_handle: &rodio::OutputStreamHandle) -> Result<(), String> {
        let track_id = self.track_id.ok_or("Nothing to resume")?;
        let path = self.path.clone().ok_or("Nothing to resume")?;
        let duration = self.duration_ms;
        let position = self.position_ms;
        self.play_at(stream_handle, track_id, path, duration, position)
    }

    fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.sink = None;
        self.is_playing = false;
        self.play_start = None;
        self.position_ms = 0;
        self.play_start_offset_ms = 0;
    }

    fn seek(
        &mut self,
        stream_handle: &rodio::OutputStreamHandle,
        position_ms: u64,
    ) -> Result<(), String> {
        let track_id = self.track_id.ok_or("No track loaded")?;
        let path = self.path.clone().ok_or("No track loaded")?;
        let duration_ms = self.duration_ms;
        let was_playing = self.is_playing;
        let target = position_ms.min(duration_ms);

        self.play_at(stream_handle, track_id, path, duration_ms, target)?;
        if !was_playing {
            self.pause();
        }
        Ok(())
    }
}

pub struct AudioPlayer {
    tx: Sender<PlayerCommand>,
    shared_state: Arc<Mutex<PlaybackState>>,
    _thread: JoinHandle<()>,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>();
        let shared_state = Arc::new(Mutex::new(PlaybackState {
            track_id: None,
            position_ms: 0,
            duration_ms: 0,
            is_playing: false,
        }));
        let state_for_thread = Arc::clone(&shared_state);

        let thread = thread::spawn(move || {
            let Ok((mut runtime, stream_handle)) = PlayerRuntime::new() else {
                return;
            };

            loop {
                match cmd_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(cmd) => {
                        let result = match cmd {
                            PlayerCommand::Play {
                                track_id,
                                path,
                                duration_ms,
                                start_ms,
                            } => runtime.play_at(
                                &stream_handle,
                                track_id,
                                path,
                                duration_ms,
                                start_ms,
                            ),
                            PlayerCommand::Pause => {
                                runtime.pause();
                                Ok(())
                            }
                            PlayerCommand::Resume => runtime.resume(&stream_handle),
                            PlayerCommand::Stop => {
                                runtime.stop();
                                Ok(())
                            }
                            PlayerCommand::Seek { position_ms } => {
                                runtime.seek(&stream_handle, position_ms)
                            }
                        };

                        if result.is_ok() {
                            *state_for_thread.lock() = runtime.state();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if runtime.track_id.is_some() {
                            *state_for_thread.lock() = runtime.state();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(Self {
            tx: cmd_tx,
            shared_state,
            _thread: thread,
        })
    }

    pub fn start_position_emitter(self: &Arc<Self>, app: AppHandle) {
        let player = Arc::clone(self);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(100));
            let state = player.state();
            if state.track_id.is_some() {
                let _ = app.emit("playback-position", &state);
            }
        });
    }

    pub fn play(
        &self,
        track_id: i64,
        path: &std::path::Path,
        duration_ms: u64,
        start_ms: u64,
    ) -> Result<(), String> {
        self.tx
            .send(PlayerCommand::Play {
                track_id,
                path: path.to_path_buf(),
                duration_ms,
                start_ms,
            })
            .map_err(|e| e.to_string())?;
        self.wait_for_state(track_id)
    }

    pub fn pause(&self) {
        let _ = self.tx.send(PlayerCommand::Pause);
    }

    pub fn resume(&self) -> Result<(), String> {
        self.tx
            .send(PlayerCommand::Resume)
            .map_err(|e| e.to_string())?;
        for _ in 0..100 {
            thread::sleep(Duration::from_millis(10));
            if self.state().is_playing {
                return Ok(());
            }
        }
        Ok(())
    }

    pub fn stop(&self) {
        let _ = self.tx.send(PlayerCommand::Stop);
        let _ = self.wait_for_position(0);
    }

    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        self.tx
            .send(PlayerCommand::Seek { position_ms })
            .map_err(|e| e.to_string())?;
        self.wait_for_position(position_ms)
    }

    pub fn state(&self) -> PlaybackState {
        self.shared_state.lock().clone()
    }

    fn wait_for_position(&self, position_ms: u64) -> Result<(), String> {
        for _ in 0..3000 {
            thread::sleep(Duration::from_millis(10));
            let state = self.state();
            let target = position_ms.min(state.duration_ms);
            if state.position_ms.abs_diff(target) <= 50 {
                return Ok(());
            }
        }
        // Seek command was already sent; decode may still be in progress on the
        // audio thread. Return Ok so IPC does not spuriously fail on slow seeks.
        Ok(())
    }

    fn wait_for_state(&self, track_id: i64) -> Result<(), String> {
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(10));
            let state = self.state();
            if state.track_id == Some(track_id) {
                return Ok(());
            }
        }
        Ok(())
    }
}
