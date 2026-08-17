use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::models::WaveformPeaks;

const PEAK_COUNT: usize = 1500;

pub fn probe_duration_ms(path: &Path) -> Option<i64> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = Hint::new();
    let format = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;
    let track = format.format.default_track()?;
    let tb = track.codec_params.time_base?;
    let n_frames = track.codec_params.n_frames?;
    let time = tb.calc_time(n_frames);
    Some((time.seconds as i64) * 1000 + (time.frac * 1000.0) as i64)
}

pub fn generate_peaks(path: &Path) -> Result<WaveformPeaks, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = Hint::new();
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;

    let track = format
        .format
        .default_track()
        .ok_or("No default audio track")?
        .clone();
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;

    let mut samples: Vec<f32> = Vec::new();
    let mut sample_rate = 44_100u32;

    loop {
        let packet = match format.format.next_packet() {
            Ok(packet) => packet,
            Err(Error::ResetRequired) => continue,
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                sample_rate = audio_buf.spec().rate;
                let channel_count = audio_buf.spec().channels.count();

                let mut sample_buf =
                    SampleBuffer::<f32>::new(audio_buf.capacity() as u64, *audio_buf.spec());
                sample_buf.copy_interleaved_ref(audio_buf);

                for frame in sample_buf.samples().chunks(channel_count) {
                    let peak = frame.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                    samples.push(peak);
                }
            }
            Err(Error::DecodeError(_)) => continue,
            Err(Error::IoError(_)) => break,
            Err(_) => break,
        }
    }

    if samples.is_empty() {
        return Err("Could not decode audio for waveform".into());
    }

    let duration_ms = ((samples.len() as u64 * 1000) / sample_rate as u64) as i64;
    let peaks = downsample_peaks(&samples, PEAK_COUNT);

    Ok(WaveformPeaks {
        peaks,
        duration_ms,
    })
}

fn downsample_peaks(samples: &[f32], target: usize) -> Vec<f32> {
    if samples.len() <= target {
        return samples.to_vec();
    }

    let bucket_size = samples.len() / target;
    let mut peaks = Vec::with_capacity(target);

    for i in 0..target {
        let start = i * bucket_size;
        let end = if i == target - 1 {
            samples.len()
        } else {
            (i + 1) * bucket_size
        };
        let max = samples[start..end]
            .iter()
            .copied()
            .fold(0.0f32, f32::max);
        peaks.push(max);
    }

    peaks
}
