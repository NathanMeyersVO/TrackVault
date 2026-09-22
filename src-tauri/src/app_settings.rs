use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const SETTINGS_KEY: &str = "appearance";
pub const LAST_DELIVERY_FOLDER_KEY: &str = "last_delivery_folder";
pub const DEFAULT_THEME_ID: &str = "trackvault";

const VALID_THEME_IDS: &[&str] = &[
    "trackvault",
    "charcoal",
    "midnight",
    "ocean",
    "forest",
    "ember",
    "rose",
    "violet",
    "slate",
    "copper",
    "high-contrast",
    "monokai",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThemeSettings {
    pub theme_id: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            theme_id: DEFAULT_THEME_ID.to_string(),
        }
    }
}

pub fn is_valid_theme_id(theme_id: &str) -> bool {
    VALID_THEME_IDS.contains(&theme_id)
}

pub fn normalize_theme_id(theme_id: &str) -> String {
    let trimmed = theme_id.trim();
    if is_valid_theme_id(trimmed) {
        trimmed.to_string()
    } else {
        DEFAULT_THEME_ID.to_string()
    }
}

pub fn get_theme(db: &Database) -> Result<ThemeSettings, String> {
    let stored = db
        .get_app_setting(SETTINGS_KEY)
        .map_err(|e| e.to_string())?;
    let Some(json) = stored else {
        return Ok(ThemeSettings::default());
    };

    if let Ok(theme) = serde_json::from_str::<ThemeSettings>(&json) {
        return Ok(ThemeSettings {
            theme_id: normalize_theme_id(&theme.theme_id),
        });
    }

    Ok(ThemeSettings::default())
}

pub fn get_last_delivery_folder(db: &Database) -> Option<PathBuf> {
    let json = db.get_app_setting(LAST_DELIVERY_FOLDER_KEY).ok()??;
    let path: String = serde_json::from_str(&json).ok()?;
    let path = PathBuf::from(path.trim());
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

pub fn set_last_delivery_folder(db: &Database, path: &Path) -> Result<(), String> {
    let json = serde_json::to_string(&path.to_string_lossy()).map_err(|e| e.to_string())?;
    db.set_app_setting(LAST_DELIVERY_FOLDER_KEY, &json)
        .map_err(|e| e.to_string())
}

pub fn set_theme(db: &Database, settings: ThemeSettings) -> Result<ThemeSettings, String> {
    let theme_id = normalize_theme_id(&settings.theme_id);
    if !is_valid_theme_id(&theme_id) {
        return Err(format!("Unknown theme id: {}", settings.theme_id));
    }

    let normalized = ThemeSettings { theme_id };
    let json = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
    db.set_app_setting(SETTINGS_KEY, &json)
        .map_err(|e| e.to_string())?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_theme_settings() {
        let db = Database::open(std::path::Path::new(":memory:")).expect("db");
        set_theme(
            &db,
            ThemeSettings {
                theme_id: "ocean".to_string(),
            },
        )
        .expect("save");
        let loaded = get_theme(&db).expect("load");
        assert_eq!(loaded.theme_id, "ocean");
    }

    #[test]
    fn invalid_theme_falls_back_to_default() {
        assert_eq!(normalize_theme_id("not-a-theme"), DEFAULT_THEME_ID);
    }

    #[test]
    fn legacy_hex_settings_fall_back_to_default() {
        let db = Database::open(std::path::Path::new(":memory:")).expect("db");
        db.set_app_setting(
            SETTINGS_KEY,
            "{\"background\":\"#111111\",\"accent\":\"#ff0000\"}",
        )
        .expect("seed legacy");
        let loaded = get_theme(&db).expect("load");
        assert_eq!(loaded.theme_id, DEFAULT_THEME_ID);
    }
}
