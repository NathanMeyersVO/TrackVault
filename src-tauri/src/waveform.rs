use std::fs::File;
use std::path::Path;

use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

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
