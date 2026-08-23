use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const SETTINGS_KEY: &str = "application";
pub const DEFAULT_APPLICATION_ID: &str = "none";

const VALID_APPLICATION_IDS: &[&str] = &["none", "usfs_ems"];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApplicationId {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "usfs_ems")]
    UsFigureSkatingEms,
}

impl ApplicationId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::UsFigureSkatingEms => "usfs_ems",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationSettings {
    pub application_id: String,
}

impl Default for ApplicationSettings {
    fn default() -> Self {
        Self {
            application_id: DEFAULT_APPLICATION_ID.to_string(),
        }
    }
}

pub fn is_valid_application_id(application_id: &str) -> bool {
    VALID_APPLICATION_IDS.contains(&application_id)
}

pub fn normalize_application_id(application_id: &str) -> ApplicationId {
    match application_id.trim() {
        "usfs_ems" => ApplicationId::UsFigureSkatingEms,
        _ => ApplicationId::None,
    }
}

pub fn get_application(db: &Database) -> Result<ApplicationId, String> {
    let stored = db
        .get_app_setting(SETTINGS_KEY)
        .map_err(|e| e.to_string())?;
    let Some(json) = stored else {
        return Ok(ApplicationId::None);
    };

    if let Ok(settings) = serde_json::from_str::<ApplicationSettings>(&json) {
        return Ok(normalize_application_id(&settings.application_id));
    }

    Ok(ApplicationId::None)
}

pub fn get_application_settings(db: &Database) -> Result<ApplicationSettings, String> {
    Ok(ApplicationSettings {
        application_id: get_application(db)?.as_str().to_string(),
    })
}

pub fn set_application(
    db: &Database,
    settings: ApplicationSettings,
) -> Result<ApplicationSettings, String> {
    let application_id = normalize_application_id(&settings.application_id);
    if !is_valid_application_id(application_id.as_str()) {
        return Err(format!(
            "Unknown application id: {}",
            settings.application_id
        ));
    }

    let normalized = ApplicationSettings {
        application_id: application_id.as_str().to_string(),
    };
    let json = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    db.set_app_setting(SETTINGS_KEY, &json)
        .map_err(|e| e.to_string())?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_application_settings() {
        let db = Database::open(std::path::Path::new(":memory:")).expect("db");
        set_application(
            &db,
            ApplicationSettings {
                application_id: "usfs_ems".to_string(),
            },
        )
        .expect("save");
        let loaded = get_application(&db).expect("load");
        assert_eq!(loaded, ApplicationId::UsFigureSkatingEms);
    }

    #[test]
    fn invalid_application_falls_back_to_none() {
        assert_eq!(
            normalize_application_id("unknown"),
            ApplicationId::None
        );
    }
}
