use std::collections::VecDeque;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::Source;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use crate::seek_index::{default_index, nearest_keyframe, SeekKeyframe};

const PCM_PREFILL_FRAMES: usize = 4096;

pub struct TrackSession {
    path: PathBuf,
    seek_index: Vec<SeekKeyframe>,
    duration_ms: u64,
    sample_rate: u32,
    channels: u16,
    track_id: u32,
    frame_cursor: u64,
    playback_frame: u64,
    samples_in_frame: u16,
    pcm_buffer: VecDeque<f32>,
    eof: bool,
    format: Option<Box<dyn FormatReader>>,
    decoder: Option<Box<dyn Decoder>>,
    codec_params: Option<symphonia::core::codecs::CodecParameters>,
}

impl TrackSession {
    pub fn open(
        path: PathBuf,
        duration_ms: u64,
        seek_index: Vec<SeekKeyframe>,
    ) -> Result<Self, String> {
        let index = if seek_index.is_empty() {
            default_index(duration_ms)
        } else {
            seek_index
        };

        Ok(Self {
            path,
            seek_index: index,
            duration_ms,
            sample_rate: 44_100,
            channels: 2,
            track_id: 0,
            frame_cursor: 0,
            playback_frame: 0,
            samples_in_frame: 0,
            pcm_buffer: VecDeque::new(),
            eof: false,
            format: None,
            decoder: None,
            codec_params: None,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn position_ms(&self) -> u64 {
        self.playback_frame
            .saturating_mul(1000)
            .checked_div(self.sample_rate as u64)
            .unwrap_or(0)
            .min(self.duration_ms)
    }

    pub fn seek_to(&mut self, target_ms: u64) -> Result<(), String> {
        let target_ms = target_ms.min(self.duration_ms);
        let target_frame = ms_to_frames(target_ms, self.sample_rate);
        let keyframe = nearest_keyframe(&self.seek_index, target_ms).clone();

        self.reopen()?;

        if keyframe.ts_ms > 0 {
            let seek_to = SeekTo::Time {
                time: ms_to_time(keyframe.ts_ms),
                track_id: Some(self.track_id),
            };
            let seek_ok = self
                .format
                .as_mut()
                .map(|format| format.seek(SeekMode::Accurate, seek_to).is_ok())
                .unwrap_or(false);
            if let Some(decoder) = self.decoder.as_mut() {
                decoder.reset();
            }
            if seek_ok {
                self.frame_cursor = keyframe.sample_index;
            } else {
                self.frame_cursor = 0;
                self.decode_until_frame(keyframe.sample_index, false)?;
            }
        } else {
            self.frame_cursor = 0;
        }

        self.decode_until_frame(target_frame, false)?;
        self.playback_frame = target_frame;
        self.samples_in_frame = 0;
        self.pcm_buffer.clear();
        self.prefill_buffer()?;
        Ok(())
    }

    pub fn next_pcm_sample(&mut self) -> Option<f32> {
        if self.pcm_buffer.is_empty() && !self.eof {
            if self.prefill_buffer().is_err() {
                return None;
            }
        }

        if let Some(sample) = self.pcm_buffer.pop_front() {
            self.samples_in_frame += 1;
            if self.samples_in_frame >= self.channels.max(1) {
                self.samples_in_frame = 0;
                self.playback_frame = self.playback_frame.saturating_add(1);
            }
            Some(sample)
        } else {
            None
        }
    }

    fn reopen(&mut self) -> Result<(), String> {
        let file = File::open(&self.path).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let hint = Hint::new();
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &symphonia::core::formats::FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;

        let track = probed
            .format
            .default_track()
            .ok_or("No default audio track")?
            .clone();

        self.track_id = track.id;
        self.sample_rate = track
            .codec_params
            .sample_rate
            .unwrap_or(self.sample_rate);
        self.channels = track
            .codec_params
            .channels
            .map(|c| c.count())
            .unwrap_or(self.channels as usize) as u16;

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| e.to_string())?;

        self.codec_params = Some(track.codec_params);
        self.format = Some(probed.format);
        self.decoder = Some(decoder);
        self.frame_cursor = 0;
        self.eof = false;
        Ok(())
    }

    fn prefill_buffer(&mut self) -> Result<(), String> {
        while self.buffered_frames() < PCM_PREFILL_FRAMES && !self.eof {
            self.decode_one_packet()?;
        }
        Ok(())
    }

    fn buffered_frames(&self) -> usize {
        self.pcm_buffer.len() / self.channels.max(1) as usize
    }

    fn decode_until_frame(&mut self, target_frame: u64, emit_pcm: bool) -> Result<(), String> {
        while self.frame_cursor < target_frame && !self.eof {
            self.decode_one_packet_with_target(target_frame, emit_pcm)?;
        }
        Ok(())
    }

    fn decode_one_packet(&mut self) -> Result<(), String> {
        self.decode_one_packet_with_target(u64::MAX, true)
    }

    fn decode_one_packet_with_target(
        &mut self,
        target_frame: u64,
        emit_pcm: bool,
    ) -> Result<(), String> {
        loop {
            let packet = match self
                .format
                .as_mut()
                .ok_or("Audio format not initialized")?
                .next_packet()
            {
                Ok(packet) => packet,
                Err(Error::ResetRequired) => {
                    if let Some(decoder) = self.decoder.as_mut() {
                        decoder.reset();
                    }
                    continue;
                }
                Err(Error::IoError(_)) | Err(_) => {
                    self.eof = true;
                    return Ok(());
                }
            };

            let decoder = self.decoder.as_mut().ok_or("Decoder not initialized")?;

            match decoder.decode(&packet) {
                Ok(audio_buf) => {
                    if packet.track_id() != self.track_id {
                        continue;
                    }

                    self.sample_rate = audio_buf.spec().rate;
                    self.channels = audio_buf.spec().channels.count() as u16;
                    let channel_count = self.channels as usize;

                    let mut sample_buf = SampleBuffer::<f32>::new(
                        audio_buf.capacity() as u64,
                        *audio_buf.spec(),
                    );
                    sample_buf.copy_interleaved_ref(audio_buf);

                    for frame in sample_buf.samples().chunks(channel_count) {
                        if self.frame_cursor >= target_frame {
                            return Ok(());
                        }

                        if emit_pcm {
                            for &sample in frame {
                                self.pcm_buffer.push_back(sample);
                            }
                        }

                        self.frame_cursor += 1;
                    }

                    return Ok(());
                }
                Err(Error::DecodeError(_)) => continue,
                Err(Error::IoError(_)) => {
                    self.eof = true;
                    return Ok(());
                }
                Err(_) => {
                    self.eof = true;
                    return Ok(());
                }
            }
        }
    }
}

pub struct SymphoniaSource {
    session: Arc<Mutex<TrackSession>>,
    sample_rate: u32,
    channels: u16,
}

impl SymphoniaSource {
    pub fn new(session: Arc<Mutex<TrackSession>>) -> Self {
        let (sample_rate, channels) = {
            let locked = session.lock().expect("session lock");
            (locked.sample_rate(), locked.channels())
        };
        Self {
            session,
            sample_rate,
            channels,
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let mut session = self.session.lock().ok()?;
        session.next_pcm_sample()
    }
}

impl Source for SymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

pub fn open_track_session(
    path: &Path,
    duration_ms: u64,
    seek_index: Vec<SeekKeyframe>,
    start_ms: u64,
) -> Result<(Arc<Mutex<TrackSession>>, SymphoniaSource), String> {
    let mut session = TrackSession::open(path.to_path_buf(), duration_ms, seek_index)?;
    session.seek_to(start_ms)?;
    let shared = Arc::new(Mutex::new(session));
    let source = SymphoniaSource::new(Arc::clone(&shared));
    Ok((shared, source))
}

fn ms_to_frames(ms: u64, sample_rate: u32) -> u64 {
    ms.saturating_mul(sample_rate as u64) / 1000
}

fn ms_to_time(ms: u64) -> Time {
    Time {
        seconds: ms / 1000,
        frac: (ms % 1000) as f64 / 1000.0,
    }
}
