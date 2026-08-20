use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use parking_lot::Mutex as ParkingMutex;
use rodio::{OutputStream, Sink};
use tauri::{AppHandle, Emitter};

use crate::models::PlaybackState;
use crate::playback::{open_track_session, TrackSession};
use crate::seek_index::SeekKeyframe;

enum PlayerCommand {
    Play {
        track_id: i64,
        path: PathBuf,
        duration_ms: u64,
        start_ms: u64,
        seek_index: Vec<SeekKeyframe>,
        autoplay: bool,
    },
    Pause,
    Resume,
    Stop,
    Interrupt,
    Seek {
        position_ms: u64,
    },
    SetVolume {
        volume: f32,
    },
}

struct PlayerRuntime {
    _stream: OutputStream,
    sink: Option<Sink>,
    session: Option<Arc<Mutex<TrackSession>>>,
    track_id: Option<i64>,
    path: Option<PathBuf>,
    duration_ms: u64,
    seek_index: Vec<SeekKeyframe>,
    position_ms: u64,
    is_playing: bool,
    volume: f32,
}

impl PlayerRuntime {
    fn new() -> Result<(Self, rodio::OutputStreamHandle), String> {
        let (stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Audio output error: {e}"))?;
        Ok((
            Self {
                _stream: stream,
                sink: None,
                session: None,
                track_id: None,
                path: None,
                duration_ms: 0,
                seek_index: Vec::new(),
                position_ms: 0,
                is_playing: false,
                volume: 1.0,
            },
            stream_handle,
        ))
    }

    fn current_position_ms(&self) -> u64 {
        if self.is_playing {
            if let Some(session) = &self.session {
                if let Ok(locked) = session.lock() {
                    return locked.position_ms().min(self.duration_ms);
                }
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
        seek_index: Vec<SeekKeyframe>,
        autoplay: bool,
    ) -> Result<(), String> {
        self.interrupt();

        let start = start_ms.min(duration_ms);
        let (session, source) =
            open_track_session(&path, duration_ms, seek_index.clone(), start)?;

        let sink = Sink::try_new(stream_handle)
            .map_err(|e| format!("Failed to create audio sink: {e}"))?;
        sink.set_volume(self.volume);
        sink.append(source);

        if autoplay {
            sink.play();
            self.is_playing = true;
        } else {
            sink.pause();
            self.is_playing = false;
            self.position_ms = start;
        }

        self.sink = Some(sink);
        self.session = Some(session);
        self.track_id = Some(track_id);
        self.path = Some(path);
        self.duration_ms = duration_ms;
        self.seek_index = seek_index;
        Ok(())
    }

    fn pause(&mut self) {
        if let Some(sink) = self.sink.as_ref() {
            sink.pause();
        }
        self.position_ms = self.current_position_ms();
        self.is_playing = false;
    }

    fn interrupt(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.sink = None;
        self.session = None;
        self.is_playing = false;
    }

    fn maybe_pause_at_end(&mut self) {
        if !self.is_playing {
            return;
        }

        let pos = self.current_position_ms();
        let near_end = pos.saturating_add(50) >= self.duration_ms;

        let sink_empty = self.sink.as_ref().map(|sink| sink.empty()).unwrap_or(true);
        let session_eof = self
            .session
            .as_ref()
            .and_then(|session| session.lock().ok())
            .map(|session| session.is_eof())
            .unwrap_or(false);

        if near_end && (sink_empty || session_eof) {
            if let Some(sink) = self.sink.as_ref() {
                sink.pause();
            }
            self.position_ms = self.duration_ms;
            self.is_playing = false;
        }
    }

    fn sync_state(&mut self) -> PlaybackState {
        self.maybe_pause_at_end();
        self.state()
    }

    fn resume(&mut self, stream_handle: &rodio::OutputStreamHandle) -> Result<(), String> {
        let track_id = self.track_id.ok_or("Nothing to resume")?;
        let path = self.path.clone().ok_or("Nothing to resume")?;
        let duration = self.duration_ms;
        let position = self.position_ms;
        let seek_index = self.seek_index.clone();
        self.play_at(
            stream_handle,
            track_id,
            path,
            duration,
            position,
            seek_index,
            true,
        )
    }

    fn stop(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.sink = None;
        self.session = None;
        self.is_playing = false;
        self.position_ms = 0;
        self.seek_index.clear();
    }

    fn seek(
        &mut self,
        stream_handle: &rodio::OutputStreamHandle,
        position_ms: u64,
    ) -> Result<(), String> {
        let path = self.path.clone().ok_or("No track loaded")?;
        let duration_ms = self.duration_ms;
        let track_id = self.track_id.ok_or("No track loaded")?;
        let was_playing = self.is_playing;
        let target = position_ms.min(duration_ms);
        let seek_index = self.seek_index.clone();

        self.play_at(
            stream_handle,
            track_id,
            path,
            duration_ms,
            target,
            seek_index,
            was_playing,
        )
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        if let Some(sink) = self.sink.as_ref() {
            sink.set_volume(self.volume);
        }
    }
}

pub struct AudioPlayer {
    tx: Sender<PlayerCommand>,
    shared_state: Arc<ParkingMutex<PlaybackState>>,
    volume: Arc<ParkingMutex<f32>>,
    _thread: JoinHandle<()>,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>();
        let shared_state = Arc::new(ParkingMutex::new(PlaybackState {
            track_id: None,
            position_ms: 0,
            duration_ms: 0,
            is_playing: false,
        }));
        let volume = Arc::new(ParkingMutex::new(1.0_f32));
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
                                seek_index,
                                autoplay,
                            } => runtime.play_at(
                                &stream_handle,
                                track_id,
                                path,
                                duration_ms,
                                start_ms,
                                seek_index,
                                autoplay,
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
                            PlayerCommand::Interrupt => {
                                runtime.interrupt();
                                Ok(())
                            }
                            PlayerCommand::Seek { position_ms } => {
                                runtime.seek(&stream_handle, position_ms)
                            }
                            PlayerCommand::SetVolume { volume } => {
                                runtime.set_volume(volume);
                                Ok(())
                            }
                        };

                        if result.is_ok() {
                            *state_for_thread.lock() = runtime.sync_state();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if runtime.track_id.is_some() {
                            *state_for_thread.lock() = runtime.sync_state();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(Self {
            tx: cmd_tx,
            shared_state,
            volume,
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

    pub fn interrupt(&self) {
        let _ = self.tx.send(PlayerCommand::Interrupt);
        for _ in 0..20 {
            thread::sleep(Duration::from_millis(10));
            if !self.state().is_playing {
                return;
            }
        }
    }

    pub fn play(
        &self,
        track_id: i64,
        path: &std::path::Path,
        duration_ms: u64,
        start_ms: u64,
        seek_index: Vec<SeekKeyframe>,
        autoplay: bool,
    ) -> Result<(), String> {
        self.tx
            .send(PlayerCommand::Play {
                track_id,
                path: path.to_path_buf(),
                duration_ms,
                start_ms,
                seek_index,
                autoplay,
            })
            .map_err(|e| e.to_string())?;
        self.wait_for_state(track_id, autoplay)
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

    pub fn get_volume(&self) -> f32 {
        *self.volume.lock()
    }

    pub fn set_volume(&self, volume: f32) -> f32 {
        let clamped = volume.clamp(0.0, 1.0);
        *self.volume.lock() = clamped;
        let _ = self.tx.send(PlayerCommand::SetVolume { volume: clamped });
        clamped
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
        Ok(())
    }

    fn wait_for_state(&self, track_id: i64, autoplay: bool) -> Result<(), String> {
        for _ in 0..50 {
            thread::sleep(Duration::from_millis(100));
            let state = self.state();
            if state.track_id != Some(track_id) {
                continue;
            }
            if !autoplay || state.is_playing {
                return Ok(());
            }
        }
        Ok(())
    }
}
