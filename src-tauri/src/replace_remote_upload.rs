use std::net::{Ipv4Addr, SocketAddr};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Once};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{
        connect_info::ConnectInfo, DefaultBodyLimit, Multipart, Path as AxumPath,
        State as AxumState,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use axum_server::tls_rustls::RustlsConfig;
use parking_lot::Mutex;
use rcgen::{CertificateParams, DnType, KeyPair, SanType};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

use crate::db::Database;
use crate::replace_track;
use crate::replace_upload_log::{self, ReplaceUploadLog};
use crate::scanner::is_audio_file;

const SESSION_TTL_SECS: u64 = 30 * 60;
const STABLE_HTTPS_PORT: u16 = 38443;
const STABLE_HTTP_PORT: u16 = 38444;
const MAX_UPLOAD_BYTES: usize = 500 * 1024 * 1024;
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
enum StopReason {
    NewSession,
    UserClose,
    StartupFailed,
    StartupTimeout,
    StartupDisconnected,
}

impl StopReason {
    fn as_str(self) -> &'static str {
        match self {
            StopReason::NewSession => "new_session",
            StopReason::UserClose => "user_close",
            StopReason::StartupFailed => "startup_failed",
            StopReason::StartupTimeout => "startup_timeout",
            StopReason::StartupDisconnected => "startup_disconnected",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRemoteUploadStartInfo {
    pub upload_url: String,
    pub lan_ip: String,
    pub port: u16,
    pub http_port: u16,
    pub expires_at_ms: i64,
    pub alternate_urls: Vec<String>,
    pub localhost_test_url: String,
    pub log_file_path: String,
    pub server_exe_path: String,
    pub firewall_rule_ok: bool,
    pub using_stable_ports: bool,
}

enum ServerStartMsg {
    Ready {
        https_port: u16,
        http_port: u16,
    },
    Failed { message: String },
}

struct ReadyNotifier {
    sender: Arc<Mutex<Option<mpsc::Sender<ServerStartMsg>>>>,
}

impl ReadyNotifier {
    fn new(tx: mpsc::Sender<ServerStartMsg>) -> Self {
        Self {
            sender: Arc::new(Mutex::new(Some(tx))),
        }
    }

    fn clone_handle(&self) -> Self {
        Self {
            sender: Arc::clone(&self.sender),
        }
    }

    fn signal_ready(&self, https_port: u16, http_port: u16) {
        if let Some(tx) = self.sender.lock().take() {
            let _ = tx.send(ServerStartMsg::Ready {
                https_port,
                http_port,
            });
        }
    }

    fn signal_failed(&self, message: String) {
        if let Some(tx) = self.sender.lock().take() {
            let _ = tx.send(ServerStartMsg::Failed { message });
        }
    }
}

static RUSTLS_CRYPTO_PROVIDER: Once = Once::new();

fn ensure_rustls_crypto_provider() {
    RUSTLS_CRYPTO_PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRemoteUploadStatus {
    pub active: bool,
    pub status: String,
    pub mode: String,
    pub source_path: Option<String>,
    pub source_paths: Vec<String>,
    pub error: Option<String>,
    pub track_id: Option<i64>,
    pub collection_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionPhase {
    Waiting,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
enum SessionKind {
    Replace { track_id: i64 },
    LibraryImport,
    CollectionImport { collection_id: i64 },
}

impl SessionKind {
    fn mode_str(&self) -> &'static str {
        match self {
            SessionKind::Replace { .. } => "replace",
            SessionKind::LibraryImport => "library",
            SessionKind::CollectionImport { .. } => "collection",
        }
    }

    fn track_id(&self) -> Option<i64> {
        match self {
            SessionKind::Replace { track_id } => Some(*track_id),
            _ => None,
        }
    }

    fn collection_id(&self) -> Option<i64> {
        match self {
            SessionKind::CollectionImport { collection_id } => Some(*collection_id),
            _ => None,
        }
    }
}

struct SessionRecord {
    kind: SessionKind,
    token: String,
    upload_url: String,
    lan_ip: String,
    port: u16,
    expires_at_ms: i64,
    phase: SessionPhase,
    source_path: Option<PathBuf>,
    received_paths: Vec<PathBuf>,
    error: Option<String>,
    temp_dir: PathBuf,
}

struct ServerContext {
    db: Arc<Mutex<Database>>,
    app: AppHandle,
    session: Arc<Mutex<Option<SessionRecord>>>,
    expected_token: String,
    log: Option<Arc<ReplaceUploadLog>>,
    session_log_id: String,
}

pub struct ReplaceRemoteUploadManager {
    session: Arc<Mutex<Option<SessionRecord>>>,
    server_thread: Mutex<Option<JoinHandle<()>>>,
    shutdown_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    start_handshake: Mutex<()>,
    startup_in_progress: AtomicBool,
    log: Mutex<Option<Arc<ReplaceUploadLog>>>,
}

impl ReplaceRemoteUploadManager {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            server_thread: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            start_handshake: Mutex::new(()),
            startup_in_progress: AtomicBool::new(false),
            log: Mutex::new(None),
        }
    }

    pub fn log_file_path(app_data_dir: &Path) -> String {
        replace_upload_log::log_file_path(app_data_dir)
            .to_string_lossy()
            .into_owned()
    }

    pub fn logs_dir_path(app_data_dir: &Path) -> PathBuf {
        replace_upload_log::log_file_path(app_data_dir)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| app_data_dir.join("logs"))
    }

    fn init_log(&self, app_data_dir: &Path) -> Result<Arc<ReplaceUploadLog>, String> {
        let mut guard = self.log.lock();
        if guard.is_none() {
            *guard = Some(Arc::new(ReplaceUploadLog::open(app_data_dir)?));
        }
        Ok(guard.as_ref().unwrap().clone())
    }

    fn log_event(
        &self,
        app_data_dir: &Path,
        session: &str,
        level: &str,
        phase: &str,
        detail: &str,
    ) {
        if let Ok(log) = self.init_log(app_data_dir) {
            log.event(session, level, phase, detail);
        }
    }

    pub fn log_elevated_firewall_setup(
        &self,
        app_data_dir: &Path,
        success: bool,
        verified: bool,
        network_summary: &str,
        detail: &str,
    ) {
        self.log_event(
            app_data_dir,
            "elevated",
            if success { "INFO" } else { "WARN" },
            "firewall_setup_elevated",
            &format!(
                "success={success} verified={verified} networks=\"{network_summary}\" detail=\"{detail}\""
            ),
        );
    }

    pub fn start(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        app_data_dir: &Path,
        track_id: i64,
    ) -> Result<ReplaceRemoteUploadStartInfo, String> {
        if !db.lock().is_library_track(track_id).map_err(|e| e.to_string())? {
            return Err("Only library tracks can be replaced".to_string());
        }
        self.start_with_kind(
            app,
            db,
            app_data_dir,
            SessionKind::Replace { track_id },
        )
    }

    pub fn start_library_import(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        app_data_dir: &Path,
    ) -> Result<ReplaceRemoteUploadStartInfo, String> {
        {
            let db_guard = db.lock();
            if db_guard
                .get_library_folder()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err("No library folder configured".to_string());
            }
        }
        self.start_with_kind(app, db, app_data_dir, SessionKind::LibraryImport)
    }

    pub fn start_collection_import(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        app_data_dir: &Path,
        collection_id: i64,
    ) -> Result<ReplaceRemoteUploadStartInfo, String> {
        {
            let db_guard = db.lock();
            if db_guard
                .get_collection(collection_id)
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err("Collection not found".to_string());
            }
        }
        self.start_with_kind(
            app,
            db,
            app_data_dir,
            SessionKind::CollectionImport { collection_id },
        )
    }

    fn start_with_kind(
        &self,
        app: AppHandle,
        db: Arc<Mutex<Database>>,
        app_data_dir: &Path,
        kind: SessionKind,
    ) -> Result<ReplaceRemoteUploadStartInfo, String> {
        let handshake = self
            .start_handshake
            .try_lock()
            .ok_or_else(|| {
                "Upload server is already starting. Wait a moment and try again.".to_string()
            })?;

        self.startup_in_progress.store(true, Ordering::SeqCst);
        struct StartupFlagGuard<'a> {
            flag: &'a AtomicBool,
        }
        impl Drop for StartupFlagGuard<'_> {
            fn drop(&mut self) {
                self.flag.store(false, Ordering::SeqCst);
            }
        }
        let _startup_guard = StartupFlagGuard {
            flag: &self.startup_in_progress,
        };

        let log_file_path = Self::log_file_path(app_data_dir);
        self.init_log(app_data_dir)?;
        let session_log_id = replace_upload_log::short_session_id();
        let start_instant = Instant::now();

        self.stop_with_reason(app_data_dir, StopReason::NewSession, None);

        let track_id = kind.track_id().unwrap_or(-1);

        let lan_addresses = enumerate_private_lan_addresses()?;
        let primary_ip = pick_primary_ipv4(&lan_addresses);
        let lan_ips: Vec<Ipv4Addr> = {
            let mut ips: Vec<Ipv4Addr> = lan_addresses.iter().map(|a| a.ip).collect();
            ips.sort_unstable();
            ips.dedup();
            ips
        };

        let server_exe_path = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let token = random_token();
        let expires_at_ms = now_ms() + (SESSION_TTL_SECS as i64 * 1000);
        let lan_ips_str = lan_ips
            .iter()
            .map(Ipv4Addr::to_string)
            .collect::<Vec<_>>()
            .join(",");

        self.log_event(
            app_data_dir,
            &session_log_id,
            "INFO",
            "start",
            &format!(
                "mode={} track_id={track_id} primary_ip={primary_ip} lan_ips={lan_ips_str} debug={} listening_exe=\"{server_exe_path}\" token_prefix={}",
                kind.mode_str(),
                cfg!(debug_assertions),
                replace_upload_log::token_prefix(&token)
            ),
        );

        let temp_dir = app_data_dir.join("replace-remote-upload").join(&token);
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create upload directory: {e}"))?;

        let (ready_tx, ready_rx) = mpsc::channel();
        let ready_notifier = ReadyNotifier::new(ready_tx);
        let ready_for_thread = ready_notifier.clone_handle();
        let ready_for_panic = ready_notifier.clone_handle();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        *self.shutdown_tx.lock() = Some(shutdown_tx);

        let session_arc = Arc::clone(&self.session);
        let db_arc = Arc::clone(&db);
        let app_clone = app.clone();
        let token_for_server = token.clone();
        let cert_ips = lan_ips.clone();
        let session_for_fail = Arc::clone(&self.session);
        let log_for_thread = self.init_log(app_data_dir)?;
        let session_log_for_thread = session_log_id.clone();
        let log_for_panic = Arc::clone(&log_for_thread);
        let session_log_for_panic = session_log_for_thread.clone();

        self.log_event(
            app_data_dir,
            &session_log_id,
            "INFO",
            "thread_spawn",
            "spawning server thread",
        );

        let handle = thread::Builder::new()
            .name("replace-remote-upload".into())
            .spawn(move || {
                let thread_result = catch_unwind(AssertUnwindSafe(|| {
                    let runtime = match tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .build()
                    {
                        Ok(runtime) => runtime,
                        Err(error) => {
                            let message = error.to_string();
                            log_for_thread.event(
                                &session_log_for_thread,
                                "ERROR",
                                "runtime_err",
                                &format!("err=\"{message}\""),
                            );
                            ready_for_thread.signal_failed(message.clone());
                            set_session_failed(&session_for_fail, message);
                            return;
                        }
                    };

                    if let Err(error) = runtime.block_on(run_server(
                        cert_ips,
                        db_arc,
                        app_clone,
                        session_arc,
                        token_for_server,
                        shutdown_rx,
                        ready_for_thread,
                        log_for_thread,
                        session_log_for_thread,
                    )) {
                        ready_for_panic.signal_failed(error.clone());
                        set_session_failed(&session_for_fail, error);
                    }
                }));

                if let Err(panic_payload) = thread_result {
                    let message = user_facing_panic_message(panic_message(panic_payload));
                    ready_for_panic.signal_failed(message.clone());
                    log_for_panic.event(
                        &session_log_for_panic,
                        "ERROR",
                        "thread_panic",
                        &format!("err=\"{message}\""),
                    );
                }
            })
            .map_err(|e| format!("Failed to start upload server: {e}"))?;

        *self.server_thread.lock() = Some(handle);

        let (https_port, http_port) = match ready_rx.recv_timeout(SERVER_START_TIMEOUT) {
            Ok(ServerStartMsg::Ready {
                https_port,
                http_port,
            }) => {
                self.log_event(
                    app_data_dir,
                    &session_log_id,
                    "INFO",
                    "ready",
                    &format!(
                        "https_port={https_port} http_port={http_port} elapsed_ms={}",
                        start_instant.elapsed().as_millis()
                    ),
                );
                (https_port, http_port)
            }
            Ok(ServerStartMsg::Failed { message }) => {
                self.log_event(
                    app_data_dir,
                    &session_log_id,
                    "ERROR",
                    "failed",
                    &format!("err=\"{message}\""),
                );
                self.stop_with_reason(app_data_dir, StopReason::StartupFailed, Some(&session_log_id));
                return Err(message);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.log_event(
                    app_data_dir,
                    &session_log_id,
                    "ERROR",
                    "startup_timeout",
                    &format!("timeout_secs={}", SERVER_START_TIMEOUT.as_secs()),
                );
                self.stop_with_reason(app_data_dir, StopReason::StartupTimeout, Some(&session_log_id));
                return Err("Upload server did not start in time.".to_string());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.log_event(
                    app_data_dir,
                    &session_log_id,
                    "ERROR",
                    "ready_channel_disconnected",
                    "server thread exited before signaling ready",
                );
                self.stop_with_reason(
                    app_data_dir,
                    StopReason::StartupDisconnected,
                    Some(&session_log_id),
                );
                return Err(
                    "Upload server exited during startup. Try once more and avoid double-clicking Upload from phone. \
                     See the diagnostics log for details."
                        .to_string(),
                );
            }
        };

        let upload_url = upload_url_for_ip(primary_ip, https_port, &token, "https");
        let localhost_test_url =
            upload_url_for_ip(Ipv4Addr::LOCALHOST, https_port, &token, "https");
        let mut alternate_urls =
            vec![upload_url_for_ip(primary_ip, http_port, &token, "http")];
        for ip in &lan_ips {
            if *ip != primary_ip {
                alternate_urls.push(upload_url_for_ip(*ip, https_port, &token, "https"));
                alternate_urls.push(upload_url_for_ip(*ip, http_port, &token, "http"));
            }
        }

        {
            let mut session = self.session.lock();
            *session = Some(SessionRecord {
                kind,
                token,
                upload_url: upload_url.clone(),
                lan_ip: primary_ip.to_string(),
                port: https_port,
                expires_at_ms,
                phase: SessionPhase::Waiting,
                source_path: None,
                received_paths: Vec::new(),
                error: None,
                temp_dir,
            });
        }

        drop(handshake);

        let firewall_rule_ok = {
            #[cfg(windows)]
            {
                match try_add_windows_firewall_rules(&server_exe_path, https_port, http_port) {
                    Ok(()) => {
                        self.log_event(
                            app_data_dir,
                            &session_log_id,
                            "INFO",
                            "firewall_rule_ok",
                            &format!("https_port={https_port} http_port={http_port}"),
                        );
                        true
                    }
                    Err(error) => {
                        self.log_event(
                            app_data_dir,
                            &session_log_id,
                            "WARN",
                            "firewall_rule_failed",
                            &format!("err=\"{error}\""),
                        );
                        false
                    }
                }
            }
            #[cfg(not(windows))]
            {
                true
            }
        };

        Ok(ReplaceRemoteUploadStartInfo {
            upload_url,
            lan_ip: primary_ip.to_string(),
            port: https_port,
            http_port,
            expires_at_ms,
            alternate_urls,
            localhost_test_url,
            log_file_path,
            server_exe_path,
            firewall_rule_ok,
            using_stable_ports: https_port == STABLE_HTTPS_PORT && http_port == STABLE_HTTP_PORT,
        })
    }

    pub fn stop(&self, app_data_dir: &Path) {
        self.stop_with_reason(app_data_dir, StopReason::UserClose, None);
    }

    fn stop_with_reason(
        &self,
        app_data_dir: &Path,
        reason: StopReason,
        session_log_id: Option<&str>,
    ) {
        let session_id = session_log_id
            .map(str::to_string)
            .unwrap_or_else(|| "none".to_string());
        self.log_event(
            app_data_dir,
            &session_id,
            "WARN",
            "stop",
            &format!("reason={}", reason.as_str()),
        );

        if let Some(tx) = self.shutdown_tx.lock().take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.server_thread.lock().take() {
            let _ = handle.join();
        }
        if let Some(record) = self.session.lock().take() {
            let _ = std::fs::remove_dir_all(&record.temp_dir);
        }
    }

    pub fn status(&self) -> ReplaceRemoteUploadStatus {
        let session = self.session.lock();
        let Some(record) = session.as_ref() else {
            return ReplaceRemoteUploadStatus {
                active: false,
                status: "idle".to_string(),
                mode: "idle".to_string(),
                source_path: None,
                source_paths: Vec::new(),
                error: None,
                track_id: None,
                collection_id: None,
            };
        };

        let source_paths: Vec<String> = record
            .received_paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();

        if now_ms() > record.expires_at_ms && record.phase == SessionPhase::Waiting {
            return ReplaceRemoteUploadStatus {
                active: true,
                status: "expired".to_string(),
                mode: record.kind.mode_str().to_string(),
                source_path: None,
                source_paths,
                error: Some("Upload session expired.".to_string()),
                track_id: record.kind.track_id(),
                collection_id: record.kind.collection_id(),
            };
        }

        let status = match record.phase {
            SessionPhase::Waiting => "waiting",
            SessionPhase::Ready => "ready",
            SessionPhase::Failed => "failed",
        };

        ReplaceRemoteUploadStatus {
            active: true,
            status: status.to_string(),
            mode: record.kind.mode_str().to_string(),
            source_path: record
                .source_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            source_paths,
            error: record.error.clone(),
            track_id: record.kind.track_id(),
            collection_id: record.kind.collection_id(),
        }
    }
}

impl Drop for ReplaceRemoteUploadManager {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.lock().take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.server_thread.lock().take() {
            let _ = handle.join();
        }
    }
}

async fn bind_upload_listener(preferred_port: u16) -> Result<(TcpListener, bool), std::io::Error> {
    match TcpListener::bind(format!("0.0.0.0:{preferred_port}")).await {
        Ok(listener) => Ok((listener, true)),
        Err(_) => TcpListener::bind("0.0.0.0:0").await.map(|listener| (listener, false)),
    }
}

async fn run_server(
    cert_ips: Vec<Ipv4Addr>,
    db: Arc<Mutex<Database>>,
    app: AppHandle,
    session: Arc<Mutex<Option<SessionRecord>>>,
    token: String,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    ready: ReadyNotifier,
    log: Arc<ReplaceUploadLog>,
    session_log_id: String,
) -> Result<(), String> {
    let session_log = session_log_id.clone();
    let log_diag = Arc::clone(&log);
    let log_line = |phase: &str, level: &str, detail: &str| {
        log_diag.event(&session_log, level, phase, detail);
    };

    let fail = |message: String| -> Result<(), String> {
        log_line("failed", "ERROR", &format!("err=\"{message}\""));
        ready.signal_failed(message.clone());
        Err(message)
    };

    let (https_listener, https_stable) = match bind_upload_listener(STABLE_HTTPS_PORT).await {
        Ok(pair) => pair,
        Err(error) => {
            return fail(format!("Failed to bind HTTPS upload server: {error}"));
        }
    };

    let https_port = match https_listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(error) => {
            return fail(format!("Failed to read HTTPS upload server port: {error}"));
        }
    };

    let (http_listener, http_stable) = match bind_upload_listener(STABLE_HTTP_PORT).await {
        Ok(pair) => pair,
        Err(error) => {
            return fail(format!("Failed to bind HTTP upload server: {error}"));
        }
    };

    let http_port = match http_listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(error) => {
            return fail(format!("Failed to read HTTP upload server port: {error}"));
        }
    };
    let using_stable_ports = https_stable && http_stable;
    log_line(
        "bind_ok",
        "INFO",
        &format!(
            "https_port={https_port} http_port={http_port} stable={using_stable_ports}"
        ),
    );

    ensure_rustls_crypto_provider();
    log_line("tls_provider_ok", "INFO", "rustls ring crypto provider");

    let tls = match build_tls_config(&cert_ips, |phase, level, detail| {
        log_line(phase, level, detail);
    })
    .await
    {
        Ok(tls) => {
            log_line("tls_ok", "INFO", "tls configured");
            tls
        }
        Err(error) => {
            log_line("tls_err", "ERROR", &format!("err=\"{error}\""));
            return fail(error);
        }
    };

    let std_listener = match https_listener.into_std() {
        Ok(listener) => listener,
        Err(error) => {
            log_line(
                "listener_convert_err",
                "ERROR",
                &format!("err=\"Failed to configure HTTPS upload listener: {error}\""),
            );
            return fail(format!("Failed to configure HTTPS upload listener: {error}"));
        }
    };
    if let Err(error) = std_listener.set_nonblocking(true) {
        log_line(
            "listener_convert_err",
            "ERROR",
            &format!("err=\"Failed to configure HTTPS upload listener: {error}\""),
        );
        return fail(format!("Failed to configure HTTPS upload listener: {error}"));
    }

    ready.signal_ready(https_port, http_port);

    let ctx = Arc::new(ServerContext {
        db,
        app,
        session: Arc::clone(&session),
        expected_token: token,
        log: Some(log),
        session_log_id,
    });

    let https_router = Router::new()
        .route("/s/:token", get(upload_page_https).post(receive_upload))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(Arc::clone(&ctx));

    let http_router = Router::new()
        .route("/s/:token", get(upload_page_http).post(receive_upload))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(ctx);

    let handle = axum_server::Handle::new();
    let handle_for_shutdown = handle.clone();

    let https_service = https_router.into_make_service_with_connect_info::<SocketAddr>();
    let server_future = axum_server::from_tcp_rustls(std_listener, tls)
        .handle(handle_for_shutdown)
        .serve(https_service);

    let http_service = http_router.into_make_service_with_connect_info::<SocketAddr>();
    let mut http_shutdown_rx = shutdown_rx.clone();
    let http_server_future = axum::serve(http_listener, http_service).with_graceful_shutdown(
        async move {
            wait_for_shutdown(&mut http_shutdown_rx).await;
        },
    );

    let mut https_shutdown_rx = shutdown_rx;
    let https_future = async move {
        tokio::select! {
            result = server_future => result,
            _ = wait_for_shutdown(&mut https_shutdown_rx) => {
                handle.graceful_shutdown(Some(Duration::from_secs(2)));
                Ok(())
            }
        }
    };

    let result = tokio::select! {
        result = https_future => {
            result.map_err(|e| format!("HTTPS upload server stopped: {e}"))
        }
        result = http_server_future => {
            result.map_err(|e| format!("HTTP upload server stopped: {e}"))
        }
    };

    match &result {
        Ok(()) => log_line("server_exit", "INFO", "reason=normal"),
        Err(error) => log_line("server_exit", "ERROR", &format!("err=\"{error}\"")),
    }

    result
}

async fn wait_for_shutdown(rx: &mut tokio::sync::watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            break;
        }
        if rx.changed().await.is_err() {
            break;
        }
    }
}

async fn build_tls_config(
    ips: &[Ipv4Addr],
    log_step: impl Fn(&str, &str, &str),
) -> Result<RustlsConfig, String> {
    ensure_rustls_crypto_provider();

    let key_pair = KeyPair::generate().map_err(|e| format!("Failed to generate TLS key: {e}"))?;
    log_step("tls_keypair_ok", "INFO", "generated key pair");
    let mut params = CertificateParams::new(vec![]).map_err(|e| e.to_string())?;
    params.distinguished_name.push(DnType::CommonName, "TrackVault");

    let mut san_ips: Vec<Ipv4Addr> = ips.to_vec();
    if !san_ips.iter().any(|ip| *ip == Ipv4Addr::LOCALHOST) {
        san_ips.push(Ipv4Addr::LOCALHOST);
    }
    san_ips.sort_unstable();
    san_ips.dedup();

    for ip in san_ips {
        params
            .subject_alt_names
            .push(SanType::IpAddress(std::net::IpAddr::V4(ip)));
    }

    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to generate TLS certificate: {e}"))?;
    log_step("tls_cert_ok", "INFO", "generated self-signed certificate");

    let config = RustlsConfig::from_pem(cert.pem().into(), key_pair.serialize_pem().into())
        .await
        .map_err(|e| format!("Failed to configure TLS: {e}"))?;
    log_step("tls_rustls_config_ok", "INFO", "loaded rustls config");
    Ok(config)
}

fn upload_url_for_ip(ip: Ipv4Addr, port: u16, token: &str, scheme: &str) -> String {
    format!("{scheme}://{ip}:{port}/s/{token}")
}

#[derive(Debug, Clone)]
struct LanAddress {
    ip: Ipv4Addr,
    interface_name: String,
}

fn enumerate_private_lan_addresses() -> Result<Vec<LanAddress>, String> {
    let interfaces = if_addrs::get_if_addrs()
        .map_err(|e| format!("Could not list network interfaces: {e}"))?;

    let mut addresses: Vec<LanAddress> = interfaces
        .into_iter()
        .filter(|iface| !iface.is_loopback() && !is_virtual_interface(&iface.name))
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) if v4.ip.is_private() && !v4.ip.is_loopback() => {
                Some(LanAddress {
                    ip: v4.ip,
                    interface_name: iface.name,
                })
            }
            _ => None,
        })
        .collect();

    addresses.sort_by(|a, b| a.ip.cmp(&b.ip));
    addresses.dedup_by(|a, b| a.ip == b.ip);

    if addresses.is_empty() {
        return Err(
            "Could not find a private network address. Connect to Wi‑Fi and try again.".to_string(),
        );
    }

    Ok(addresses)
}

fn score_lan_address(addr: &LanAddress) -> i32 {
    interface_name_score(&addr.interface_name) + ipv4_lan_score(addr.ip)
}

fn interface_name_score(name: &str) -> i32 {
    let lower = name.to_lowercase();
    if lower.contains("wi-fi")
        || lower.contains("wifi")
        || lower.contains("wlan")
        || lower.contains("wireless")
    {
        return 100;
    }
    if lower.contains("ethernet") || lower.contains("eth") {
        return 80;
    }
    if lower.contains("tailscale")
        || lower.contains("wireguard")
        || lower.contains("zerotier")
        || lower.contains("hamachi")
    {
        return -80;
    }
    0
}

fn ipv4_lan_score(ip: Ipv4Addr) -> i32 {
    let octets = ip.octets();
    if octets[0] == 192 && octets[1] == 168 {
        30
    } else if octets[0] == 10 {
        20
    } else if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        10
    } else if octets[0] == 100 {
        -50
    } else {
        0
    }
}

fn pick_primary_ipv4(addresses: &[LanAddress]) -> Ipv4Addr {
    addresses
        .iter()
        .max_by_key(|addr| (score_lan_address(addr), addr.ip))
        .map(|addr| addr.ip)
        .expect("enumerate_private_lan_addresses ensures at least one address")
}

pub const WINDOWS_FIREWALL_RULE_NAME: &str = "TrackVault remote upload (session)";
pub const WINDOWS_FIREWALL_PORTS_RULE_NAME: &str = "TrackVault remote upload ports";
const WINDOWS_FIREWALL_PROFILES: &str = "private,public,domain";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUploadFirewallSetupResult {
    pub success: bool,
    pub verified: bool,
    pub message: String,
    pub network_profile_summary: Option<String>,
    pub ports_rule_verified: bool,
    pub program_rule_verified: bool,
    pub listening_exe_path: String,
    pub firewall_program_path: Option<String>,
    pub program_path_matches_listener: bool,
    pub session_exe_path_matches_listener: bool,
}

pub fn run_elevated_windows_firewall_setup(
    exe_path: &str,
    https_port: u16,
    http_port: u16,
) -> Result<RemoteUploadFirewallSetupResult, String> {
    #[cfg(windows)]
    {
        run_elevated_windows_firewall_setup_impl(exe_path, https_port, http_port)
    }
    #[cfg(not(windows))]
    {
        let _ = (exe_path, https_port, http_port);
        Err("Remote upload firewall setup is only supported on Windows.".to_string())
    }
}

#[cfg(windows)]
fn run_elevated_windows_firewall_setup_impl(
    exe_path: &str,
    https_port: u16,
    http_port: u16,
) -> Result<RemoteUploadFirewallSetupResult, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    if exe_path.is_empty() {
        return Err("missing executable path".to_string());
    }

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let temp_dir = std::env::temp_dir();
    let log_path = temp_dir.join("trackvault-firewall-setup.log");
    let script_path = temp_dir.join("trackvault-firewall-setup.ps1");

    let ports = format!("{https_port},{http_port}");
    let log_str = log_path.to_string_lossy().replace('\'', "''");
    let exe_ps = exe_path.replace('\'', "''");
    let rule_ps = WINDOWS_FIREWALL_RULE_NAME.replace('\'', "''");
    let ports_rule_ps = WINDOWS_FIREWALL_PORTS_RULE_NAME.replace('\'', "''");
    let profiles_ps = WINDOWS_FIREWALL_PROFILES.replace('\'', "''");

    let script_body = format!(
        r#"$ErrorActionPreference = 'Continue'
$log = '{log_str}'
$rule = '{rule_ps}'
$portsRule = '{ports_rule_ps}'
$exe = '{exe_ps}'
$ports = '{ports}'
$profiles = '{profiles_ps}'
"elevated_start" | Out-File -FilePath $log -Encoding ASCII
& netsh.exe advfirewall firewall delete rule name="$rule" 2>&1 | Add-Content -Path $log -Encoding ASCII
& netsh.exe advfirewall firewall delete rule name="$portsRule" 2>&1 | Add-Content -Path $log -Encoding ASCII
& netsh.exe advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$ports program="$exe" enable=yes profile=$profiles 2>&1 | Add-Content -Path $log -Encoding ASCII
if ($LASTEXITCODE -ne 0) {{ exit 1 }}
& netsh.exe advfirewall firewall add rule name="$portsRule" dir=in action=allow protocol=TCP localport=$ports enable=yes profile=$profiles 2>&1 | Add-Content -Path $log -Encoding ASCII
if ($LASTEXITCODE -ne 0) {{ exit 1 }}
try {{
  Get-NetConnectionProfile | ForEach-Object {{ "$($_.InterfaceAlias): $($_.NetworkCategory)" }} | Add-Content -Path $log -Encoding ASCII
}} catch {{
  "network_profile_unavailable" | Add-Content -Path $log -Encoding ASCII
}}
exit 0
"#
    );

    std::fs::write(&script_path, script_body)
        .map_err(|error| format!("Failed to write firewall setup script: {error}"))?;

    let script_for_ps = script_path.to_string_lossy().replace('\'', "''");
    let launcher = format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','{script_for_ps}'); if ($null -eq $p) {{ exit 2 }} else {{ exit $p.ExitCode }}"
    );

    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &launcher,
        ])
        .output()
        .map_err(|error| format!("Failed to run elevated firewall setup: {error}"))?;

    let _ = std::fs::remove_file(&script_path);

    let exit_code = output.status.code().unwrap_or(-1);
    let log_tail = std::fs::read_to_string(&log_path)
        .ok()
        .map(|text| {
            let trimmed = text.trim();
            if trimmed.len() > 800 {
                format!("...{}", &trimmed[trimmed.len().saturating_sub(800)..])
            } else {
                trimmed.to_string()
            }
        })
        .unwrap_or_default();

    let listening_exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let session_exe_path_matches_listener =
        paths_refer_to_same_exe(exe_path, &listening_exe_path);

    let verify_detail =
        verify_windows_firewall_rules(exe_path, https_port, http_port, Some(&log_path));
    let verify_ok = verify_detail.any_rule_ok();
    let network_profile_summary = detect_windows_network_profile_summary();

    let network_hint = network_profile_summary
        .as_ref()
        .map(|summary| format!(" Network: {summary}."))
        .unwrap_or_default();

    let path_hint = build_firewall_path_hint(
        &listening_exe_path,
        session_exe_path_matches_listener,
        &verify_detail,
    );

    let (success, message) = match exit_code {
        0 if verify_ok => (
            true,
            format!(
                "Firewall rules added (Private and Public profiles). The port rule \"{}\" is what allows your phone — it does not depend on the .exe path.{network_hint}{path_hint} Try the phone HTTP URL again; the diagnostics log should show client_connect when the phone reaches TrackVault.",
                WINDOWS_FIREWALL_PORTS_RULE_NAME
            ),
        ),
        0 => (
            true,
            format!(
                "Firewall setup completed (netsh reported Ok). Verification was inconclusive — try the phone URL anyway.{network_hint}{path_hint} Details: {log_tail}"
            ),
        ),
        2 => (
            false,
            "Administrator approval was cancelled or blocked.".to_string(),
        ),
        _ => (
            false,
            if log_tail.is_empty() {
                format!("Firewall setup failed (exit code {exit_code}).")
            } else {
                format!("Firewall setup failed (exit code {exit_code}): {log_tail}")
            },
        ),
    };

    Ok(RemoteUploadFirewallSetupResult {
        success,
        verified: verify_ok,
        message,
        network_profile_summary,
        ports_rule_verified: verify_detail.ports_rule_ok,
        program_rule_verified: verify_detail.program_rule_ok,
        listening_exe_path,
        firewall_program_path: verify_detail.program_path_in_rule.clone(),
        program_path_matches_listener: verify_detail.program_path_matches_listener,
        session_exe_path_matches_listener,
    })
}

#[derive(Debug, Clone)]
struct FirewallRuleVerifyResult {
    ports_rule_ok: bool,
    program_rule_ok: bool,
    program_path_in_rule: Option<String>,
    program_path_matches_listener: bool,
}

impl FirewallRuleVerifyResult {
    fn any_rule_ok(&self) -> bool {
        self.ports_rule_ok || self.program_rule_ok
    }

    #[cfg(not(windows))]
    fn empty() -> Self {
        Self {
            ports_rule_ok: false,
            program_rule_ok: false,
            program_path_in_rule: None,
            program_path_matches_listener: false,
        }
    }
}

fn build_firewall_path_hint(
    listening_exe_path: &str,
    session_exe_path_matches_listener: bool,
    verify: &FirewallRuleVerifyResult,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !session_exe_path_matches_listener {
        parts.push(format!(
            " Session was started under a different .exe path than the running process (now: {listening_exe_path}). Re-run Allow phone connections."
        ));
    }
    if verify.ports_rule_ok && !verify.program_rule_ok {
        parts.push(
            " Port-only firewall rule is active; a program-path mismatch would not block the phone."
                .to_string(),
        );
    }
    if let Some(rule_path) = &verify.program_path_in_rule {
        if !verify.program_path_matches_listener {
            parts.push(format!(
                " Firewall program rule points to \"{rule_path}\" but this process is \"{listening_exe_path}\"."
            ));
        }
    }
    parts.join("")
}

pub fn paths_refer_to_same_exe(left: &str, right: &str) -> bool {
    normalize_exe_path(left) == normalize_exe_path(right)
}

pub fn normalize_exe_path(path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        return String::new();
    }
    let path_buf = PathBuf::from(path);
    if path_buf.exists() {
        if let Ok(canonical) = std::fs::canonicalize(&path_buf) {
            return canonical.to_string_lossy().to_lowercase();
        }
    }
    path.replace('/', "\\").to_lowercase()
}

#[cfg(windows)]
fn detect_windows_network_profile_summary() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-Command",
            "Get-NetConnectionProfile | ForEach-Object { $_.InterfaceAlias + ':' + $_.NetworkCategory }",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(windows)]
fn firewall_rule_show_text(rule_name: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("netsh")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name=\"{rule_name}\""),
            "verbose",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(windows)]
fn rule_text_allows_ports(text: &str, https_port: u16, http_port: u16) -> bool {
    let lower = text.to_lowercase();
    lower.contains(&https_port.to_string()) && lower.contains(&http_port.to_string())
}

#[cfg(windows)]
fn rule_text_allows_program(text: &str, exe_path: &str, https_port: u16, http_port: u16) -> bool {
    if !rule_text_allows_ports(text, https_port, http_port) {
        return false;
    }
    let exe_name = std::path::Path::new(exe_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(exe_path)
        .to_lowercase();
    let lower = text.to_lowercase();
    lower.contains(&exe_name) || lower.contains(&exe_path.to_lowercase())
}

#[cfg(windows)]
fn extract_application_path_from_rule(text: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed
            .strip_prefix("Application Name:")
            .or_else(|| trimmed.strip_prefix("Program:"))
        else {
            continue;
        };
        let value = rest.trim();
        if !value.is_empty() && !value.eq_ignore_ascii_case("any") {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(windows)]
fn verify_windows_firewall_rules(
    listener_exe_path: &str,
    https_port: u16,
    http_port: u16,
    log_path: Option<&Path>,
) -> FirewallRuleVerifyResult {
    let ports_rule = firewall_rule_show_text(WINDOWS_FIREWALL_PORTS_RULE_NAME);
    let program_rule = firewall_rule_show_text(WINDOWS_FIREWALL_RULE_NAME);

    if let Some(path) = log_path {
        use std::io::Write;
        let mut combined = String::from("\nverify_show_rule\n");
        if let Some(text) = &ports_rule {
            combined.push_str("--- ports rule ---\n");
            combined.push_str(text);
            combined.push('\n');
        }
        if let Some(text) = &program_rule {
            combined.push_str("--- program rule ---\n");
            combined.push_str(text);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new().append(true).open(path) {
            let _ = file.write_all(combined.as_bytes());
        }
    }

    let ports_rule_ok = ports_rule
        .as_deref()
        .is_some_and(|text| rule_text_allows_ports(text, https_port, http_port));
    let program_rule_ok = program_rule.as_deref().is_some_and(|text| {
        rule_text_allows_program(text, listener_exe_path, https_port, http_port)
    });

    let program_path_in_rule = program_rule
        .as_deref()
        .and_then(extract_application_path_from_rule);
    let program_path_matches_listener = program_path_in_rule
        .as_deref()
        .is_some_and(|rule_path| paths_refer_to_same_exe(rule_path, listener_exe_path));

    FirewallRuleVerifyResult {
        ports_rule_ok,
        program_rule_ok,
        program_path_in_rule,
        program_path_matches_listener,
    }
}

#[cfg(windows)]
fn try_add_windows_firewall_rules(
    exe_path: &str,
    https_port: u16,
    http_port: u16,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    if exe_path.is_empty() {
        return Err("missing executable path".to_string());
    }

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let ports = format!("{https_port},{http_port}");
    let rule_name = WINDOWS_FIREWALL_RULE_NAME;
    let ports_rule_name = WINDOWS_FIREWALL_PORTS_RULE_NAME;

    let mut netsh = |args: &[&str]| -> Result<(), String> {
        let output = Command::new("netsh")
            .creation_flags(CREATE_NO_WINDOW)
            .args(args)
            .output()
            .map_err(|error| format!("failed to run netsh: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("exit code {}", output.status)
            };
            Err(detail)
        }
    };

    let _ = netsh(&[
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={rule_name}"),
    ]);
    let _ = netsh(&[
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={ports_rule_name}"),
    ]);

    netsh(&[
        "advfirewall",
        "firewall",
        "add",
        "rule",
        &format!("name={rule_name}"),
        "dir=in",
        "action=allow",
        "protocol=TCP",
        &format!("localport={ports}"),
        &format!("program={exe_path}"),
        "enable=yes",
        &format!("profile={WINDOWS_FIREWALL_PROFILES}"),
    ])?;

    netsh(&[
        "advfirewall",
        "firewall",
        "add",
        "rule",
        &format!("name={ports_rule_name}"),
        "dir=in",
        "action=allow",
        "protocol=TCP",
        &format!("localport={ports}"),
        "enable=yes",
        &format!("profile={WINDOWS_FIREWALL_PROFILES}"),
    ])
}

fn is_virtual_interface(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        "vethernet",
        "hyper-v",
        "wsl",
        "docker",
        "vmware",
        "virtualbox",
        "vbox",
        "tap",
        "tun",
        "vpn",
        "tailscale",
        "wireguard",
        "zerotier",
        "npcap",
        "loopback",
        "bluetooth",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn log_client_connect(ctx: &ServerContext, remote: SocketAddr, scheme: &str) {
    if let Some(log) = &ctx.log {
        log.event(
            &ctx.session_log_id,
            "INFO",
            "client_connect",
            &format!("remote={remote} scheme={scheme}"),
        );
    }
}

async fn upload_page_https(
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    AxumPath(token): AxumPath<String>,
    AxumState(ctx): AxumState<Arc<ServerContext>>,
) -> Response {
    log_client_connect(&ctx, remote, "https");
    upload_page_inner(token, ctx).await
}

async fn upload_page_http(
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    AxumPath(token): AxumPath<String>,
    AxumState(ctx): AxumState<Arc<ServerContext>>,
) -> Response {
    log_client_connect(&ctx, remote, "http");
    upload_page_inner(token, ctx).await
}

async fn upload_page_inner(token: String, ctx: Arc<ServerContext>) -> Response {
    if !token_matches(&ctx, &token) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let html = {
        let session = ctx.session.lock();
        match session.as_ref().map(|r| &r.kind) {
            Some(SessionKind::Replace { .. }) => UPLOAD_PAGE_REPLACE_HTML,
            Some(SessionKind::LibraryImport) | Some(SessionKind::CollectionImport { .. }) => {
                UPLOAD_PAGE_IMPORT_HTML
            }
            None => UPLOAD_PAGE_REPLACE_HTML,
        }
    };
    Html(html).into_response()
}

async fn receive_upload(
    AxumPath(token): AxumPath<String>,
    AxumState(ctx): AxumState<Arc<ServerContext>>,
    mut multipart: Multipart,
) -> Response {
    if !token_matches(&ctx, &token) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let (session_kind, temp_dir) = {
        let session = ctx.session.lock();
        let Some(record) = session.as_ref() else {
            return html_message(
                StatusCode::GONE,
                "Upload session ended",
                "Return to TrackVault and start upload again.",
            );
        };
        if matches!(record.kind, SessionKind::Replace { .. })
            && record.phase != SessionPhase::Waiting
        {
            return html_message(
                StatusCode::CONFLICT,
                "Upload already received",
                "This link can only be used once.",
            );
        }
        if record.phase == SessionPhase::Failed {
            return html_message(
                StatusCode::GONE,
                "Upload session failed",
                "Return to TrackVault and start upload again.",
            );
        }
        if now_ms() > record.expires_at_ms {
            return html_message(
                StatusCode::GONE,
                "Session expired",
                "Return to TrackVault and start upload again.",
            );
        }
        (record.kind.clone(), record.temp_dir.clone())
    };

    let allow_multiple = matches!(
        session_kind,
        SessionKind::LibraryImport | SessionKind::CollectionImport { .. }
    );
    let mut uploads: Vec<(String, Vec<u8>)> = Vec::new();

    loop {
        match multipart.next_field().await {
            Ok(Some(field)) => {
                if field.name() != Some("file") {
                    continue;
                }
                let Some(raw_name) = field
                    .file_name()
                    .filter(|name| !name.is_empty())
                    .map(|name| name.to_string())
                else {
                    continue;
                };
                match field.bytes().await {
                    Ok(data) => {
                        if data.is_empty() {
                            continue;
                        }
                        uploads.push((raw_name, data.to_vec()));
                        if !allow_multiple {
                            break;
                        }
                    }
                    Err(error) => {
                        let detail = user_facing_upload_read_error(&error);
                        if let Some(log) = &ctx.log {
                            log.event(
                                &ctx.session_log_id,
                                "ERROR",
                                "upload_parse_err",
                                &format!("err=\"{error}\""),
                            );
                        }
                        return html_message(StatusCode::BAD_REQUEST, "Upload failed", &detail);
                    }
                }
            }
            Ok(None) => break,
            Err(error) => {
                let detail = user_facing_upload_read_error(&error);
                if let Some(log) = &ctx.log {
                    log.event(
                        &ctx.session_log_id,
                        "ERROR",
                        "upload_parse_err",
                        &format!("err=\"{error}\""),
                    );
                }
                return html_message(StatusCode::BAD_REQUEST, "Upload failed", &detail);
            }
        }
    }

    if uploads.is_empty() {
        return html_message(
            StatusCode::BAD_REQUEST,
            "No file selected",
            "Choose an audio file and try again.",
        );
    }

    if matches!(session_kind, SessionKind::Replace { .. }) && uploads.len() > 1 {
        return html_message(
            StatusCode::BAD_REQUEST,
            "One file only",
            "Select a single audio file for replacement.",
        );
    }

    let mut last_response = html_message(
        StatusCode::BAD_REQUEST,
        "Upload failed",
        "No files were saved.",
    );

    for (raw_name, data) in uploads {
        let safe_name = sanitize_file_name(&raw_name);
        let byte_len = data.len();
        if let Some(log) = &ctx.log {
            log.event(
                &ctx.session_log_id,
                "INFO",
                "upload_received",
                &format!("file=\"{safe_name}\" bytes={byte_len}"),
            );
        }

        let temp_path = unique_temp_path(&temp_dir, &safe_name);
        if let Err(error) = std::fs::write(&temp_path, &data) {
            return html_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Save failed",
                &format!("Could not save upload: {error}"),
            );
        }

        last_response = match &session_kind {
        SessionKind::Replace { track_id } => {
            let validation_error = {
                let db = ctx.db.lock();
                replace_track::validate_replacement_source(&db, *track_id, &temp_path)
                    .err()
            };
            if let Some(message) = validation_error {
                let _ = std::fs::remove_file(&temp_path);
                if let Some(log) = &ctx.log {
                    log.event(
                        &ctx.session_log_id,
                        "WARN",
                        "upload_rejected",
                        &format!("err=\"{message}\""),
                    );
                }
                return html_message(StatusCode::BAD_REQUEST, "Invalid audio file", &message);
            }

            let source_path = temp_path.to_string_lossy().into_owned();
            {
                let mut session = ctx.session.lock();
                let Some(record) = session.as_mut() else {
                    let _ = std::fs::remove_file(&temp_path);
                    return html_message(
                        StatusCode::GONE,
                        "Upload session ended",
                        "Return to TrackVault and start upload again.",
                    );
                };
                record.phase = SessionPhase::Ready;
                record.source_path = Some(temp_path);
                record.error = None;
            }

            if let Some(log) = &ctx.log {
                log.event(
                    &ctx.session_log_id,
                    "INFO",
                    "upload_ready_emit",
                    &format!("track_id={track_id}"),
                );
            }

            let _ = ctx.app.emit(
                "replace-remote-upload-ready",
                serde_json::json!({
                    "trackId": track_id,
                    "sourcePath": source_path,
                }),
            );

            html_message(
                StatusCode::OK,
                "Upload received",
                "You can close this page and confirm the replacement in TrackVault.",
            )
        }
        SessionKind::LibraryImport | SessionKind::CollectionImport { .. } => {
            if !is_audio_file(&temp_path) {
                let _ = std::fs::remove_file(&temp_path);
                if let Some(log) = &ctx.log {
                    log.event(
                        &ctx.session_log_id,
                        "WARN",
                        "upload_rejected",
                        &format!("file=\"{safe_name}\" err=\"unsupported file type\""),
                    );
                }
                return html_message(
                    StatusCode::BAD_REQUEST,
                    "Invalid audio file",
                    "Choose a supported audio format (MP3, FLAC, WAV, and similar).",
                );
            }

            let (mode, collection_id, all_paths) = {
                let mut session = ctx.session.lock();
                let Some(record) = session.as_mut() else {
                    let _ = std::fs::remove_file(&temp_path);
                    return html_message(
                        StatusCode::GONE,
                        "Upload session ended",
                        "Return to TrackVault and start upload again.",
                    );
                };
                record.received_paths.push(temp_path);
                record.error = None;
                let paths: Vec<String> = record
                    .received_paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                (
                    record.kind.mode_str().to_string(),
                    record.kind.collection_id(),
                    paths,
                )
            };

            if let Some(log) = &ctx.log {
                log.event(
                    &ctx.session_log_id,
                    "INFO",
                    "import_file_received",
                    &format!("file=\"{safe_name}\" total={}", all_paths.len()),
                );
            }

            let _ = ctx.app.emit(
                "remote-import-upload-updated",
                serde_json::json!({
                    "mode": mode,
                    "collectionId": collection_id,
                    "sourcePaths": all_paths,
                }),
            );

            html_message(
                StatusCode::OK,
                "Upload received",
                "You can upload more files or return to TrackVault and tap Upload.",
            )
        }
        };
    }

    last_response
}

fn token_matches(ctx: &ServerContext, token: &str) -> bool {
    token == ctx.expected_token
}

fn user_facing_upload_read_error(error: &impl std::fmt::Display) -> String {
    let text = error.to_string();
    let lower = text.to_lowercase();
    if lower.contains("length limit")
        || lower.contains("too large")
        || lower.contains("multipart/form-data")
        || lower.contains("payload too large")
    {
        return format!(
            "File too large or upload interrupted (maximum {} MB).",
            MAX_UPLOAD_BYTES / (1024 * 1024)
        );
    }
    format!("Could not read upload: {text}")
}

fn html_message(status: StatusCode, title: &str, detail: &str) -> Response {
    let body = format!(
        r#"<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{title}</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }}
h1 {{ font-size: 1.25rem; }}
</style></head><body><h1>{title}</h1><p>{detail}</p></body></html>"#
    );
    (status, Html(body)).into_response()
}

fn set_session_failed(session: &Arc<Mutex<Option<SessionRecord>>>, message: String) {
    let mut guard = session.lock();
    if let Some(record) = guard.as_mut() {
        record.phase = SessionPhase::Failed;
        record.error = Some(message);
    }
}

fn user_facing_panic_message(raw: String) -> String {
    if raw.contains("CryptoProvider") || raw.contains("install_default") {
        return "TLS setup failed (crypto provider). Restart TrackVault and try again.".to_string();
    }
    if raw.len() > 240 {
        format!("{}…", &raw[..240])
    } else {
        raw
    }
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sanitize_file_name(name: &str) -> String {
    let path = Path::new(name);
    let base = path
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("upload.bin");
    let mut cleaned: String = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        cleaned = "upload.bin".to_string();
    }
    cleaned
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn unique_temp_path(temp_dir: &Path, file_name: &str) -> PathBuf {
    let mut destination = temp_dir.join(file_name);
    if !destination.exists() {
        return destination;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track");
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();

    for index in 1..10_000 {
        destination = temp_dir.join(format!("{stem} ({index}){extension}"));
        if !destination.exists() {
            return destination;
        }
    }

    temp_dir.join(format!("{stem}-dup{extension}"))
}

const UPLOAD_PAGE_REPLACE_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TrackVault — Replace file</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; line-height: 1.5; max-width: 28rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    input[type=file] { width: 100%; margin: 1rem 0; }
    button { font: inherit; padding: 0.6rem 1rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; }
    .note { font-size: 0.875rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Upload replacement audio</h1>
  <p>Select one audio file to send to TrackVault on this Wi‑Fi network (maximum 500 MB).</p>
  <form method="post" enctype="multipart/form-data">
    <input type="file" name="file" accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.mp4,.aiff" required />
    <button type="submit">Upload</button>
  </form>
  <p class="note">If your browser warned about the certificate, choose to proceed — this server is temporary and runs only on your local network.</p>
</body>
</html>"#;

#[cfg(test)]
mod lan_address_tests {
    use super::*;

    fn addr(ip: [u8; 4], interface_name: &str) -> LanAddress {
        LanAddress {
            ip: Ipv4Addr::from(ip),
            interface_name: interface_name.to_string(),
        }
    }

    #[test]
    fn pick_primary_prefers_wifi_over_ethernet() {
        let addresses = vec![
            addr([192, 168, 1, 10], "Ethernet"),
            addr([192, 168, 1, 20], "Wi-Fi"),
        ];
        assert_eq!(pick_primary_ipv4(&addresses), Ipv4Addr::from([192, 168, 1, 20]));
    }

    #[test]
    fn pick_primary_deprioritizes_tailscale_range() {
        let addresses = vec![
            addr([100, 64, 0, 2], "Tailscale"),
            addr([192, 168, 1, 5], "Wi-Fi"),
        ];
        assert_eq!(pick_primary_ipv4(&addresses), Ipv4Addr::from([192, 168, 1, 5]));
    }
}

const UPLOAD_PAGE_IMPORT_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TrackVault — Upload tracks</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; line-height: 1.5; max-width: 28rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    input[type=file] { width: 100%; margin: 1rem 0; }
    button { font: inherit; padding: 0.6rem 1rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; }
    .note { font-size: 0.875rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Upload audio to TrackVault</h1>
  <p>Select one or more audio files (maximum 500 MB each). You can submit again to add more files.</p>
  <form method="post" enctype="multipart/form-data">
    <input type="file" name="file" accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.mp4,.aiff" multiple required />
    <button type="submit">Upload</button>
  </form>
  <p class="note">If your browser warned about the certificate, choose to proceed — this server is temporary and runs only on your local network.</p>
</body>
</html>"#;
