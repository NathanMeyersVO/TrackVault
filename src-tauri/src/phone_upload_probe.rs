use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Router,
};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, watch};
use uuid::Uuid;

use crate::phone_upload_settings::{port_bind_error, PhoneUploadTunnelConfig, public_upload_url};
use crate::upload_relay::{resolve_cloudflared_path, UploadRelayProcess};

pub const PROBE_BODY: &str = "trackvault-phone-upload-probe";

const LOCAL_HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const PUBLIC_HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const EDGE_SETTLE: Duration = Duration::from_secs(2);

#[derive(Clone)]
struct ProbeState {
    expected_token: String,
}

async fn probe_handler(
    Path(token): Path<String>,
    State(state): State<ProbeState>,
) -> impl IntoResponse {
    if token == state.expected_token {
        (StatusCode::OK, PROBE_BODY)
    } else {
        (StatusCode::NOT_FOUND, "")
    }
}

pub fn run_path_probe(config: PhoneUploadTunnelConfig) -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("Failed to start probe runtime: {e}"))?;

    runtime.block_on(run_path_probe_async(config))
}

async fn run_path_probe_async(config: PhoneUploadTunnelConfig) -> Result<String, String> {
    let probe_token = Uuid::new_v4().to_string();
    let local_port = config.local_port;

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let (ready_tx, ready_rx) = oneshot::channel();

    let probe_state = ProbeState {
        expected_token: probe_token.clone(),
    };
    let mut shutdown_for_server = shutdown_rx.clone();
    let server_task = tokio::spawn(async move {
        let listener = match TcpListener::bind(format!("127.0.0.1:{local_port}")).await {
            Ok(listener) => listener,
            Err(error) => {
                let _ = ready_tx.send(Err(port_bind_error(local_port, &error)));
                return;
            }
        };
        if ready_tx.send(Ok(())).is_err() {
            return;
        }

        let router = Router::new()
            .route("/s/:token", get(probe_handler))
            .with_state(probe_state);

        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                wait_for_shutdown(&mut shutdown_for_server).await;
            })
            .await;
    });

    let shutdown_guard = ProbeShutdown {
        shutdown_tx: Some(shutdown_tx),
        relay: None,
        server_task: Some(server_task),
    };

    ready_rx
        .await
        .map_err(|_| "Probe server stopped before it was ready.".to_string())?
        .map_err(|message| message)?;

    let local_url = format!("http://127.0.0.1:{local_port}/s/{probe_token}");
    http_get_contains(&local_url, PROBE_BODY, LOCAL_HTTP_TIMEOUT).map_err(|error| {
        format!(
            "Local listener check failed ({error}). Confirm port {local_port} is free and matches your Cloudflare Service URL."
        )
    })?;

    let cloudflared = resolve_cloudflared_path()?;
    let relay = UploadRelayProcess::start_named_tunnel(&cloudflared, &config.tunnel_token)?;

    let mut guard = shutdown_guard;
    guard.relay = Some(relay);

    tokio::time::sleep(EDGE_SETTLE).await;

    let public_url = public_upload_url(&config.public_origin, &probe_token);
    match http_get_contains(&public_url, PROBE_BODY, PUBLIC_HTTP_TIMEOUT) {
        Ok(()) => guard.finish_success(),
        Err(error) => {
            let hint = public_probe_hint(&error);
            guard.finish()?;
            Err(format!(
                "Public URL check failed for {public_url}: {error}.{hint}"
            ))
        }
    }
}

fn public_probe_hint(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("502") || lower.contains("503") || lower.contains("bad gateway") {
        " Check that the Cloudflare tunnel Service URL is http://localhost:YOUR_LOCAL_PORT (same port as in this setup)."
            .to_string()
    } else if lower.contains("timeout") || lower.contains("connection") || lower.contains("dns") {
        " Check that Public origin matches the tunnel hostname in Cloudflare and that this PC can reach the internet."
            .to_string()
    } else if lower.contains("404") {
        " The tunnel connected but the path did not reach IceTrackVault — verify hostname and Service URL.".to_string()
    } else {
        String::new()
    }
}

fn http_get_contains(url: &str, needle: &str, timeout: Duration) -> Result<(), String> {
    let url = url.to_string();
    let needle = needle.to_string();
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(timeout)
            .timeout_read(timeout)
            .build();
        let response = agent
            .get(&url)
            .call()
            .map_err(|e| e.to_string())?;
        if response.status() / 100 != 2 {
            return Err(format!("HTTP {}", response.status()));
        }
        let body = response
            .into_string()
            .map_err(|e| format!("Failed to read response body: {e}"))?;
        if body.contains(&needle) {
            Ok(())
        } else {
            Err("Response did not contain the expected probe marker.".to_string())
        }
    })
    .join()
    .map_err(|_| "HTTP probe thread panicked.".to_string())?
}

async fn wait_for_shutdown(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            break;
        }
        if rx.changed().await.is_err() {
            break;
        }
    }
}

struct ProbeShutdown {
    shutdown_tx: Option<watch::Sender<bool>>,
    relay: Option<UploadRelayProcess>,
    server_task: Option<tokio::task::JoinHandle<()>>,
}

impl ProbeShutdown {
    fn finish_success(mut self) -> Result<String, String> {
        self.finish()?;
        Ok(
            "Tunnel path OK: localhost listener, cloudflared connection, and public HTTPS URL all responded correctly."
                .to_string(),
        )
    }

    fn finish(&mut self) -> Result<(), String> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(mut relay) = self.relay.take() {
            relay.stop();
        }
        if let Some(task) = self.server_task.take() {
            // Best-effort wait; probe is user-initiated and short-lived.
            let _ = task.abort();
        }
        Ok(())
    }
}

impl Drop for ProbeShutdown {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}
