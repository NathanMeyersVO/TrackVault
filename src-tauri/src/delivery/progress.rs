use tauri::{AppHandle, Emitter};

use crate::models::{DeliveryProgress, DeliveryProgressPhase};

#[derive(Clone)]
pub struct DeliveryProgressCtx {
    app: Option<AppHandle>,
}

impl DeliveryProgressCtx {
    pub fn none() -> Self {
        Self { app: None }
    }

    pub fn from_app(app: &AppHandle) -> Self {
        Self {
            app: Some(app.clone()),
        }
    }

    pub fn emit(
        &self,
        phase: DeliveryProgressPhase,
        done: u32,
        total: u32,
        finished: bool,
        current: Option<String>,
    ) {
        if let Some(app) = &self.app {
            let _ = app.emit(
                "delivery-progress",
                DeliveryProgress {
                    phase,
                    done,
                    total,
                    finished,
                    current,
                },
            );
        }
    }

    pub fn finish(&self) {
        self.emit(DeliveryProgressPhase::Staging, 0, 0, true, None);
    }
}

pub fn short_path_label(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}
