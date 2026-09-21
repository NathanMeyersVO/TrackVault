use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

const SESSION_TTL: Duration = Duration::from_secs(3600);

pub struct StagingSession {
    pub id: String,
    pub staging_root: PathBuf,
    pub target_project_id: Option<String>,
    pub created: Instant,
}

pub struct DeliverySessionStore {
    sessions_dir: PathBuf,
    sessions: Mutex<HashMap<String, StagingSession>>,
}

impl DeliverySessionStore {
    pub fn new(app_data: &Path) -> Self {
        let sessions_dir = app_data.join("delivery_sessions");
        std::fs::create_dir_all(&sessions_dir).ok();
        Self {
            sessions_dir,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn sessions_dir(&self) -> &Path {
        &self.sessions_dir
    }

    pub fn insert(&self, session: StagingSession) {
        self.sessions.lock().insert(session.id.clone(), session);
        self.purge_expired();
    }

    pub fn get(&self, id: &str) -> Option<StagingSession> {
        self.purge_expired();
        self.sessions.lock().get(id).cloned()
    }

    pub fn remove(&self, id: &str) {
        let mut guard = self.sessions.lock();
        if let Some(session) = guard.remove(id) {
            let _ = std::fs::remove_dir_all(self.sessions_dir.join(&session.id));
        }
    }

    fn purge_expired(&self) {
        let mut guard = self.sessions.lock();
        let expired: Vec<String> = guard
            .iter()
            .filter(|(_, s)| s.created.elapsed() > SESSION_TTL)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(session) = guard.remove(&id) {
                let _ = std::fs::remove_dir_all(self.sessions_dir.join(&session.id));
            }
        }
    }
}

impl Clone for StagingSession {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            staging_root: self.staging_root.clone(),
            target_project_id: self.target_project_id.clone(),
            created: self.created,
        }
    }
}
