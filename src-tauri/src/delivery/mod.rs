mod apply;
mod diff;
mod session;
mod staging;

pub use apply::{apply_delivery, ApplyDeliveryResult, ApplyMode};
pub use diff::{
    append_full_replace_removals, build_preview, map_selected_change_ids, DeliveryPreview,
};
pub use session::{DeliverySessionStore, StagingSession};
pub use staging::{
    browse_delivery_folder_at, default_delivery_browse_root, stage_delivery_sources,
    DeliveryFolderBrowseResult,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryChangeKind {
    AudioAdd,
    AudioUpdate,
    AudioReplace,
    AudioMove,
    AudioRemove,
    ScheduleEventAdd,
    ScheduleEventUpdate,
    ScheduleEventRemove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryChange {
    pub change_id: String,
    pub kind: DeliveryChangeKind,
    pub summary: String,
    #[serde(default)]
    pub details: String,
    pub default_selected: bool,
}
