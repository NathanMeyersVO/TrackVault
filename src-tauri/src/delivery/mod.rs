mod apply;
mod diff;
mod session;
mod staging;

pub use apply::{apply_delivery, ApplyDeliveryResult, ApplyMode};
pub use diff::{append_full_replace_removals, build_preview, DeliveryPreview};
pub use session::{DeliverySessionStore, StagingSession};
pub use staging::stage_delivery_sources;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
