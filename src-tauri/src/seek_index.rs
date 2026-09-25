use serde::{Deserialize, Serialize};

pub const KEYFRAME_INTERVAL_MS: u64 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeekKeyframe {
    pub ts_ms: u64,
    pub sample_index: u64,
}

pub fn nearest_keyframe_index(index: &[SeekKeyframe], target_ms: u64) -> usize {
    if index.is_empty() {
        return 0;
    }

    let mut lo = 0usize;
    let mut hi = index.len();
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if index[mid].ts_ms <= target_ms {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    if index[lo].ts_ms > target_ms {
        0
    } else {
        lo
    }
}

pub fn nearest_keyframe<'a>(index: &'a [SeekKeyframe], target_ms: u64) -> &'a SeekKeyframe {
    &index[nearest_keyframe_index(index, target_ms)]
}

pub fn default_index(duration_ms: u64) -> Vec<SeekKeyframe> {
    if duration_ms == 0 {
        return vec![SeekKeyframe {
            ts_ms: 0,
            sample_index: 0,
        }];
    }

    let mut index = Vec::new();
    let mut ts_ms = 0u64;
    while ts_ms <= duration_ms {
        index.push(SeekKeyframe {
            ts_ms,
            sample_index: 0,
        });
        if ts_ms == duration_ms {
            break;
        }
        ts_ms = (ts_ms + KEYFRAME_INTERVAL_MS).min(duration_ms);
    }
    index
}

pub fn build_seek_index_from_frames(sample_rate: u32, frame_count: u64) -> Vec<SeekKeyframe> {
    if frame_count == 0 || sample_rate == 0 {
        return default_index(0);
    }

    let duration_ms = frame_count.saturating_mul(1000) / sample_rate as u64;
    let mut index = Vec::new();
    let mut next_ts_ms = 0u64;

    while next_ts_ms <= duration_ms {
        let sample_index = next_ts_ms.saturating_mul(sample_rate as u64) / 1000;
        index.push(SeekKeyframe {
            ts_ms: next_ts_ms.min(duration_ms),
            sample_index: sample_index.min(frame_count.saturating_sub(1)),
        });

        if next_ts_ms == duration_ms {
            break;
        }

        next_ts_ms = next_ts_ms.saturating_add(KEYFRAME_INTERVAL_MS);
        if next_ts_ms > duration_ms {
            next_ts_ms = duration_ms;
        }
    }

    index
}

pub fn parse_seek_index(json: &str) -> Option<Vec<SeekKeyframe>> {
    serde_json::from_str(json).ok()
}

pub fn serialize_seek_index(index: &[SeekKeyframe]) -> Result<String, String> {
    serde_json::to_string(index).map_err(|e| e.to_string())
}
