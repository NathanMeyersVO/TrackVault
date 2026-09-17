use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const SETTINGS_KEY: &str = "demo_privacy";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DemoPrivacySettings {
    pub sensitive_tag_keys: Vec<String>,
    #[serde(default)]
    pub blur_filenames: bool,
}

impl Default for DemoPrivacySettings {
    fn default() -> Self {
        Self {
            sensitive_tag_keys: Vec::new(),
            blur_filenames: false,
        }
    }
}

fn normalize_keys(keys: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() || !seen.insert(trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

pub fn get_demo_privacy(db: &Database) -> Result<DemoPrivacySettings, String> {
    let stored = db
        .get_app_setting(SETTINGS_KEY)
        .map_err(|e| e.to_string())?;
    let Some(json) = stored else {
        return Ok(DemoPrivacySettings::default());
    };

    if let Ok(settings) = serde_json::from_str::<DemoPrivacySettings>(&json) {
        return Ok(DemoPrivacySettings {
            sensitive_tag_keys: normalize_keys(&settings.sensitive_tag_keys),
            blur_filenames: settings.blur_filenames,
        });
    }

    Ok(DemoPrivacySettings::default())
}

pub fn set_demo_privacy(
    db: &Database,
    settings: DemoPrivacySettings,
) -> Result<DemoPrivacySettings, String> {
    let normalized = DemoPrivacySettings {
        sensitive_tag_keys: normalize_keys(&settings.sensitive_tag_keys),
        blur_filenames: settings.blur_filenames,
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
    fn round_trip_demo_privacy_settings() {
        let db = Database::open(std::path::Path::new(":memory:")).expect("db");
        set_demo_privacy(
            &db,
            DemoPrivacySettings {
                sensitive_tag_keys: vec!["Comment".to_string(), "Comment".to_string()],
                blur_filenames: true,
            },
        )
        .expect("save");
        let loaded = get_demo_privacy(&db).expect("load");
        assert_eq!(loaded.sensitive_tag_keys, vec!["Comment".to_string()]);
        assert!(loaded.blur_filenames);
    }
}
