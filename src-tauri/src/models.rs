use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub track_number: Option<i32>,
    pub added_at: i64,
    pub has_peaks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub track_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub track_count: i64,
    pub playback_mode: String,
    pub continuous_volume: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionPlaybackState {
    pub track_id: Option<i64>,
    pub position_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Taglist {
    pub id: i64,
    pub name: String,
    pub tag_key: String,
    pub entry_tag_key: String,
    pub value_singular_name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaglistSwapTarget {
    pub partition_value: Option<String>,
    pub partition_display_title: Option<String>,
    pub track_id: i64,
    pub track_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaglistValue {
    pub value: Option<String>,
    pub track_count: i64,
    pub display_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackState {
    pub track_id: Option<i64>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub is_playing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformPeaks {
    pub peaks: Vec<f32>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: u32,
    pub added: u32,
    pub removed: u32,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResult {
    pub uploaded: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioCacheProgress {
    pub done: u32,
    pub total: u32,
    pub finished: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryProgressPhase {
    Scanning,
    Staging,
    Analyzing,
    Applying,
    ScanningLibrary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryProgress {
    pub phase: DeliveryProgressPhase,
    pub done: u32,
    pub total: u32,
    pub finished: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioCacheTrackReady {
    pub track_id: i64,
}
