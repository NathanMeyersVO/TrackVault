use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::models::{ProjectLoadPhase, ProjectLoadProgress};

#[derive(Clone)]
pub struct ProjectLoadProgressCtx {
    app: AppHandle,
    slot: Arc<Mutex<Option<ProjectLoadProgress>>>,
    project_name: Arc<Mutex<String>>,
}

impl ProjectLoadProgressCtx {
    pub fn new(
        app: AppHandle,
        slot: Arc<Mutex<Option<ProjectLoadProgress>>>,
        project_name: impl Into<String>,
    ) -> Self {
        let project_name = project_name.into();
        let ctx = Self {
            app,
            slot,
            project_name: Arc::new(Mutex::new(project_name.clone())),
        };
        ctx.emit(ProjectLoadPhase::Opening, 0, 0, false, None);
        ctx
    }

    pub fn set_project_name(&self, name: impl Into<String>) {
        *self.project_name.lock() = name.into();
    }

    pub fn emit(
        &self,
        phase: ProjectLoadPhase,
        done: u32,
        total: u32,
        finished: bool,
        current: Option<String>,
    ) {
        let progress = ProjectLoadProgress {
            phase,
            project_name: self.project_name.lock().clone(),
            done,
            total,
            finished,
            current,
        };
        *self.slot.lock() = Some(progress.clone());
        let _ = self.app.emit("project-load-progress", progress);
    }

    pub fn finish(&self) {
        self.emit(ProjectLoadPhase::Opening, 0, 0, true, None);
    }
}

pub struct ProjectLoadFinishGuard<'a> {
    ctx: &'a ProjectLoadProgressCtx,
}

impl<'a> ProjectLoadFinishGuard<'a> {
    pub fn new(ctx: &'a ProjectLoadProgressCtx) -> Self {
        Self { ctx }
    }
}

impl Drop for ProjectLoadFinishGuard<'_> {
    fn drop(&mut self) {
        self.ctx.finish();
    }
}

pub fn note_opening(slot: &Mutex<Option<ProjectLoadProgress>>, project_name: &str) {
    *slot.lock() = Some(ProjectLoadProgress {
        phase: ProjectLoadPhase::Opening,
        project_name: project_name.to_string(),
        done: 0,
        total: 0,
        finished: false,
        current: None,
    });
}
