use tauri::{AppHandle, Emitter};

use crate::models::{ArchiveExportKind, ArchiveExportProgress};

#[derive(Clone)]
pub struct ArchiveExportProgressCtx {
    app: Option<AppHandle>,
    kind: ArchiveExportKind,
    label: String,
    last_total: u32,
}

impl ArchiveExportProgressCtx {
    pub fn none() -> Self {
        Self {
            app: None,
            kind: ArchiveExportKind::Project,
            label: String::new(),
            last_total: 0,
        }
    }

    pub fn from_app(app: &AppHandle, kind: ArchiveExportKind, label: String) -> Self {
        Self {
            app: Some(app.clone()),
            kind,
            label,
            last_total: 0,
        }
    }

    pub fn is_live(&self) -> bool {
        self.app.is_some()
    }

    pub fn emit(&mut self, done: u32, total: u32, finished: bool, current: Option<String>) {
        self.last_total = total;
        if let Some(app) = &self.app {
            let _ = app.emit(
                "archive-export-progress",
                ArchiveExportProgress {
                    kind: self.kind,
                    label: self.label.clone(),
                    done,
                    total,
                    finished,
                    current,
                },
            );
        }
    }

    pub fn step(&mut self, done: u32, total: u32, current: &str) {
        self.emit(done, total, false, Some(current.to_string()));
    }

    pub fn finish(&mut self) {
        let total = self.last_total;
        self.emit(total, total, true, None);
    }
}
