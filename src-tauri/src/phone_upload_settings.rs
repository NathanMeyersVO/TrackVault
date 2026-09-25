use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::Database;

pub const PHONE_UPLOAD_SETTINGS_KEY: &str = "phone_upload";
const TUNNEL_TOKEN_FILE: &str = "phone_upload_tunnel.token";

/// Default local port; must match Cloudflare tunnel Service URL unless user changes both.
pub const DEFAULT_LOCAL_PORT: u16 = 38444;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneUploadSettings {
    pub enabled: bool,
    pub public_origin: String,
    #[serde(default = "default_local_port")]
    pub local_port: u16,
}

fn default_local_port() -> u16 {
    DEFAULT_LOCAL_PORT
}

impl Default for PhoneUploadSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            public_origin: String::new(),
            local_port: DEFAULT_LOCAL_PORT,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneUploadSettingsResponse {
    pub enabled: bool,
    pub public_origin: String,
    pub local_port: u16,
    pub has_tunnel_token: bool,
    pub ready: bool,
}

#[derive(Debug, Clone)]
pub struct PhoneUploadTunnelConfig {
    pub public_origin: String,
    pub tunnel_token: String,
    pub local_port: u16,
}

pub fn get_phone_upload_settings(
    db: &Database,
    app_data_dir: &Path,
) -> Result<PhoneUploadSettingsResponse, String> {
    let settings = load_settings_json(db)?;
    let has_tunnel_token = tunnel_token_path(app_data_dir).is_file();
    let origin_ok = normalize_public_origin(&settings.public_origin).is_ok();
    let ready = settings.enabled && origin_ok && has_tunnel_token;
    Ok(PhoneUploadSettingsResponse {
        enabled: settings.enabled,
        public_origin: settings.public_origin.clone(),
        local_port: settings.local_port,
        has_tunnel_token,
        ready,
    })
}

pub fn set_phone_upload_settings(
    db: &Database,
    app_data_dir: &Path,
    settings: PhoneUploadSettings,
    tunnel_token: Option<String>,
) -> Result<PhoneUploadSettingsResponse, String> {
    let local_port = normalize_local_port(settings.local_port)?;
    if settings.enabled {
        normalize_public_origin(&settings.public_origin)?;
    }
    let json = serde_json::to_string(&PhoneUploadSettings {
        enabled: settings.enabled,
        public_origin: settings.public_origin.trim().to_string(),
        local_port,
    })
    .map_err(|e| e.to_string())?;
    db.set_app_setting(PHONE_UPLOAD_SETTINGS_KEY, &json)
        .map_err(|e| e.to_string())?;

    if let Some(token) = tunnel_token {
        let token = token.trim();
        if token.is_empty() {
            remove_tunnel_token(app_data_dir)?;
        } else {
            write_tunnel_token(app_data_dir, token)?;
        }
    }

    get_phone_upload_settings(db, app_data_dir)
}

pub fn load_tunnel_config(
    db: &Database,
    app_data_dir: &Path,
) -> Result<Option<PhoneUploadTunnelConfig>, String> {
    let settings = load_settings_json(db)?;
    if !settings.enabled {
        return Ok(None);
    }
    let public_origin = normalize_public_origin(&settings.public_origin)?;
    let tunnel_token = read_tunnel_token(app_data_dir)?;
    Ok(Some(PhoneUploadTunnelConfig {
        public_origin,
        tunnel_token,
        local_port: normalize_local_port(settings.local_port)?,
    }))
}

pub fn normalize_local_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        return Err("Local port must be between 1024 and 65535.".to_string());
    }
    if port < 1024 {
        return Err("Local port must be 1024 or higher (use 38444 unless that port is in use).".to_string());
    }
    Ok(port)
}

pub fn probe_local_port(port: u16) -> Result<(), String> {
    let port = normalize_local_port(port)?;
    let addr = format!("127.0.0.1:{port}");
    std::net::TcpListener::bind(&addr).map_err(|error| port_bind_error(port, &error))?;
    Ok(())
}

pub fn port_bind_error(port: u16, error: &std::io::Error) -> String {
    format!(
        "Port {port} is not available on 127.0.0.1 ({error}). Free that port, or set a different local port in View → Phone upload setup and update your Cloudflare tunnel Service URL to http://localhost:NEWPORT."
    )
}

fn load_settings_json(db: &Database) -> Result<PhoneUploadSettings, String> {
    let stored = db
        .get_app_setting(PHONE_UPLOAD_SETTINGS_KEY)
        .map_err(|e| e.to_string())?;
    let Some(json) = stored else {
        return Ok(PhoneUploadSettings::default());
    };
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

pub fn normalize_public_origin(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Public origin URL is required (e.g. https://upload.example.com).".to_string());
    }
    let without_slash = trimmed.trim_end_matches('/');
    if !without_slash.starts_with("https://") {
        return Err("Public origin must start with https://.".to_string());
    }
    let rest = &without_slash[8..];
    if rest.is_empty() || rest.contains('/') {
        return Err("Public origin must be a hostname only (no path).".to_string());
    }
    Ok(without_slash.to_string())
}

fn tunnel_token_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(TUNNEL_TOKEN_FILE)
}

fn write_tunnel_token(app_data_dir: &Path, token: &str) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = tunnel_token_path(app_data_dir);
    std::fs::write(&path, token).map_err(|e| format!("Failed to save tunnel token: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&path, perms);
        }
    }
    Ok(())
}

pub fn read_tunnel_token(app_data_dir: &Path) -> Result<String, String> {
    let path = tunnel_token_path(app_data_dir);
    let token = std::fs::read_to_string(&path)
        .map_err(|_| "Tunnel token not configured. Add it in View → Phone upload setup.".to_string())?;
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Tunnel token is empty.".to_string());
    }
    Ok(token)
}

fn remove_tunnel_token(app_data_dir: &Path) -> Result<(), String> {
    let path = tunnel_token_path(app_data_dir);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn public_upload_url(origin: &str, session_token: &str) -> String {
    format!("{origin}/s/{session_token}")
}

/// Build tunnel config from setup form values (probe does not require `enabled`).
pub fn tunnel_config_for_probe(
    settings: &PhoneUploadSettings,
    app_data_dir: &Path,
    tunnel_token_override: Option<String>,
) -> Result<PhoneUploadTunnelConfig, String> {
    let public_origin = normalize_public_origin(&settings.public_origin)?;
    let local_port = normalize_local_port(settings.local_port)?;
    let tunnel_token = match tunnel_token_override {
        Some(token) => {
            let token = token.trim().to_string();
            if token.is_empty() {
                return Err(
                    "Tunnel token is required. Paste a token or save one before testing.".to_string(),
                );
            }
            token
        }
        None => read_tunnel_token(app_data_dir)?,
    };
    Ok(PhoneUploadTunnelConfig {
        public_origin,
        tunnel_token,
        local_port,
    })
}
