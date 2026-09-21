use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn log_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs").join("replace-remote-upload.log")
}

pub struct ReplaceUploadLog {
    path: PathBuf,
    file: Mutex<std::fs::File>,
}

impl ReplaceUploadLog {
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        let path = log_file_path(app_data_dir);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create log directory: {e}"))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("Failed to open upload log: {e}"))?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    pub fn path_string(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    pub fn event(&self, session: &str, level: &str, phase: &str, detail: &str) {
        let timestamp = format_timestamp();
        let line = format!(
            "{timestamp} {level} session={session} phase={phase} {detail}\n"
        );
        match self.file.lock() {
            Ok(mut file) => {
                if file.write_all(line.as_bytes()).is_err() {
                    eprint_log_line(&line);
                    return;
                }
                let _ = file.flush();
            }
            Err(_) => eprint_log_line(&line),
        }
    }
}

fn eprint_log_line(line: &str) {
    eprint!("replace-remote-upload.log (write failed): {line}");
}

fn format_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let secs = millis / 1000;
    let ms = millis.rem_euclid(1000);
    let days = secs / 86_400;
    let day_secs = secs.rem_euclid(86_400);
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{ms:03}Z"
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

pub fn short_session_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 4];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn token_prefix(token: &str) -> String {
    token.chars().take(8).collect()
}
