use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);
const LOG_TAIL_MAX_LINES: usize = 40;

pub struct UploadRelayProcess {
    child: Child,
}

enum RelayStartMsg {
    Ready { detail: String },
    Failed { message: String },
}

impl UploadRelayProcess {
    pub fn start_named_tunnel(cloudflared: &str, tunnel_token: &str) -> Result<Self, String> {
        let mut command = Command::new(cloudflared);
        command
            .args(["tunnel", "run", "--token", tunnel_token])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start cloudflared ({cloudflared}): {e}"))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "cloudflared stderr unavailable".to_string())?;
        let stdout = child.stdout.take();

        let (ready_tx, ready_rx) = mpsc::channel();
        let log_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let ready_sent = Arc::new(AtomicBool::new(false));

        spawn_log_reader(
            stderr,
            "stderr",
            true,
            Arc::clone(&log_tail),
            Arc::clone(&ready_sent),
            ready_tx.clone(),
        );

        if let Some(out) = stdout {
            spawn_log_reader(
                out,
                "stdout",
                false,
                Arc::clone(&log_tail),
                Arc::clone(&ready_sent),
                ready_tx,
            );
        }

        match ready_rx.recv_timeout(CONNECT_TIMEOUT) {
            Ok(RelayStartMsg::Ready { .. }) => Ok(Self { child }),
            Ok(RelayStartMsg::Failed { message }) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(message)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(append_log_tail(
                    format!(
                        "Timed out waiting for Cloudflare tunnel to connect ({}s). \
                         If there is no “Registered tunnel connection” below, check token, outbound network, and firewall.",
                        CONNECT_TIMEOUT.as_secs()
                    ),
                    &log_tail,
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(append_log_tail(
                    "cloudflared exited before the tunnel connected. Check your tunnel token and that the Cloudflare Service URL matches your local port in Phone upload setup.".to_string(),
                    &log_tail,
                ))
            }
        }
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for UploadRelayProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_log_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    stream: &'static str,
    fail_on_eof: bool,
    log_tail: Arc<Mutex<Vec<String>>>,
    ready_sent: Arc<AtomicBool>,
    ready_tx: mpsc::Sender<RelayStartMsg>,
) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            push_log_line(&log_tail, stream, &line);

            if ready_sent.load(Ordering::SeqCst) {
                continue;
            }

            if let Some(err) = classify_cloudflared_line(&line) {
                if signal_once(&ready_sent, &ready_tx, RelayStartMsg::Failed {
                    message: append_log_tail(err, &log_tail),
                }) {
                    return;
                }
            }

            if cloudflared_line_indicates_ready(&line) {
                if signal_once(
                    &ready_sent,
                    &ready_tx,
                    RelayStartMsg::Ready { detail: line },
                ) {
                    return;
                }
            }
        }

        if fail_on_eof && !ready_sent.load(Ordering::SeqCst) {
            let _ = signal_once(
                &ready_sent,
                &ready_tx,
                RelayStartMsg::Failed {
                    message: append_log_tail(
                        format!("cloudflared {stream} closed before the tunnel connected."),
                        &log_tail,
                    ),
                },
            );
        }
    });
}

fn signal_once(
    ready_sent: &AtomicBool,
    ready_tx: &mpsc::Sender<RelayStartMsg>,
    msg: RelayStartMsg,
) -> bool {
    if ready_sent
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let _ = ready_tx.send(msg);
        true
    } else {
        false
    }
}

fn push_log_line(log_tail: &Arc<Mutex<Vec<String>>>, stream: &str, line: &str) {
    let mut guard = log_tail.lock().expect("log tail lock");
    guard.push(format!("[{stream}] {line}"));
    if guard.len() > LOG_TAIL_MAX_LINES {
        let drop = guard.len() - LOG_TAIL_MAX_LINES;
        guard.drain(0..drop);
    }
}

fn cloudflared_line_indicates_ready(line: &str) -> bool {
    line.to_lowercase().contains("registered tunnel connection")
}

fn classify_cloudflared_line(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    if lower.contains("err") && lower.contains("token") {
        return Some(line.to_string());
    }
    if lower.contains("unable to register") {
        return Some(line.to_string());
    }
    if lower.contains("authentication failed") || lower.contains("invalid tunnel secret") {
        return Some(line.to_string());
    }
    None
}

fn append_log_tail(message: String, log_tail: &Arc<Mutex<Vec<String>>>) -> String {
    let guard = log_tail.lock().expect("log tail lock");
    if guard.is_empty() {
        return message;
    }
    format!(
        "{message}\n\nRecent cloudflared output:\n{}",
        guard.join("\n")
    )
}

pub fn resolve_cloudflared_path() -> Result<String, String> {
    if let Ok(path) = which_cloudflared() {
        return Ok(path);
    }
    Err(
        "cloudflared not found on PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/."
            .to_string(),
    )
}

fn which_cloudflared() -> Result<String, std::io::Error> {
    let name = if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "cloudflared not found",
    ))
}

pub fn probe_cloudflared() -> Result<String, String> {
    let path = resolve_cloudflared_path()?;
    let output = Command::new(&path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run cloudflared: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(format!(
        "{} — {}",
        path,
        String::from_utf8_lossy(&output.stdout).trim()
    ))
}

#[allow(dead_code)]
pub fn cloudflared_config_may_block_quick_tunnel() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let config = home.join(".cloudflared").join("config.yaml");
    if config.is_file() {
        Some(config)
    } else {
        None
    }
}
