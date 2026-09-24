use std::net::SocketAddr;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
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
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;

use crate::db::Database;
use crate::replace_track;
use crate::replace_upload_log::{self, ReplaceUploadLog};
use crate::scanner::is_audio_file;

const SESSION_TTL_SECS: u64 = 30 * 60;
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
    pub public_upload_url: Option<String>,
    pub http_port: u16,
    pub expires_at_ms: i64,
    pub log_file_path: String,
}

enum ServerStartMsg {
    Ready { http_port: u16 },
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

    fn signal_ready(&self, http_port: u16) {
        if let Some(tx) = self.sender.lock().take() {
            let _ = tx.send(ServerStartMsg::Ready { http_port });
        }
    }

    fn signal_failed(&self, message: String) {
        if let Some(tx) = self.sender.lock().take() {
            let _ = tx.send(ServerStartMsg::Failed { message });
        }
    }
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

#[derive(Debug, Clone)]
enum UploadPageContext {
    Replace {
        title: String,
        artist: String,
        album: String,
        file_name: String,
        duration_ms: i64,
    },
    Library {
        folder_label: String,
        folder_path: String,
    },
    Collection {
        name: String,
    },
}

struct SessionRecord {
    kind: SessionKind,
    page_context: UploadPageContext,
    token: String,
    upload_url: String,
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
    relay_process: Mutex<Option<crate::upload_relay::UploadRelayProcess>>,
    start_handshake: Mutex<()>,
    startup_in_progress: AtomicBool,
    session_generation: AtomicU64,
    log: Mutex<Option<Arc<ReplaceUploadLog>>>,
}

impl ReplaceRemoteUploadManager {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            server_thread: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            relay_process: Mutex::new(None),
            start_handshake: Mutex::new(()),
            startup_in_progress: AtomicBool::new(false),
            session_generation: AtomicU64::new(0),
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
        let generation_at_start = self.session_generation.load(Ordering::SeqCst);

        let track_id = kind.track_id().unwrap_or(-1);

        let tunnel_config = {
            let db_guard = db.lock();
            crate::phone_upload_settings::load_tunnel_config(&db_guard, app_data_dir)?
        };
        let tunnel_config = tunnel_config.ok_or_else(|| {
            "Phone upload is not configured. Open View → Phone upload setup.".to_string()
        })?;

        let token = random_token();
        let expires_at_ms = now_ms() + (SESSION_TTL_SECS as i64 * 1000);
        self.log_event(
            app_data_dir,
            &session_log_id,
            "INFO",
            "start",
            &format!(
                "mode={} track_id={track_id} relay_origin={} debug={} token_prefix={}",
                kind.mode_str(),
                tunnel_config.public_origin,
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
        let local_port = tunnel_config.local_port;
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

                    if let Err(error) = runtime.block_on(run_server_tunnel_only(
                        local_port,
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

        let http_port = match ready_rx.recv_timeout(SERVER_START_TIMEOUT) {
            Ok(ServerStartMsg::Ready { http_port }) => {
                self.log_event(
                    app_data_dir,
                    &session_log_id,
                    "INFO",
                    "ready",
                    &format!(
                        "http_port={http_port} elapsed_ms={}",
                        start_instant.elapsed().as_millis()
                    ),
                );
                http_port
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

        let public_url =
            crate::phone_upload_settings::public_upload_url(&tunnel_config.public_origin, &token);
        let upload_url = public_url.clone();

        let cloudflared = crate::upload_relay::resolve_cloudflared_path()?;
        self.log_event(
            app_data_dir,
            &session_log_id,
            "INFO",
            "relay_start",
            &format!("cloudflared=\"{cloudflared}\""),
        );
        let relay = crate::upload_relay::UploadRelayProcess::start_named_tunnel(
            &cloudflared,
            &tunnel_config.tunnel_token,
        )?;
        *self.relay_process.lock() = Some(relay);
        self.log_event(
            app_data_dir,
            &session_log_id,
            "INFO",
            "relay_ready",
            &format!("origin={}", tunnel_config.public_origin),
        );

        let page_context = {
            let db_guard = db.lock();
            resolve_upload_page_context(&db_guard, &kind)?
        };

        {
            let mut session = self.session.lock();
            *session = Some(SessionRecord {
                kind,
                page_context,
                token,
                upload_url: upload_url.clone(),
                expires_at_ms,
                phase: SessionPhase::Waiting,
                source_path: None,
                received_paths: Vec::new(),
                error: None,
                temp_dir,
            });
        }

        if self.session_generation.load(Ordering::SeqCst) != generation_at_start {
            self.log_event(
                app_data_dir,
                &session_log_id,
                "WARN",
                "start_aborted",
                "session cancelled during startup",
            );
            self.rollback_partial_start();
            drop(handshake);
            return Err(
                "Upload session was cancelled during startup. Close and open Upload from phone again."
                    .to_string(),
            );
        }

        drop(handshake);

        Ok(ReplaceRemoteUploadStartInfo {
            upload_url,
            public_upload_url: Some(public_url),
            http_port,
            expires_at_ms,
            log_file_path,
        })
    }

    pub fn stop(&self, app_data_dir: &Path) {
        self.stop_with_reason(app_data_dir, StopReason::UserClose, None);
    }

    fn rollback_partial_start(&self) {
        if let Some(mut relay) = self.relay_process.lock().take() {
            relay.stop();
        }
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

    fn stop_with_reason(
        &self,
        app_data_dir: &Path,
        reason: StopReason,
        session_log_id: Option<&str>,
    ) {
        self.session_generation.fetch_add(1, Ordering::SeqCst);

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

        if let Some(mut relay) = self.relay_process.lock().take() {
            relay.stop();
        }

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

    pub fn is_session_active(&self) -> bool {
        self.session.lock().is_some()
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

async fn bind_upload_listener_localhost_strict(
    port: u16,
) -> Result<(TcpListener, bool), std::io::Error> {
    TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map(|listener| (listener, true))
}

async fn run_server_tunnel_only(
    local_port: u16,
    db: Arc<Mutex<Database>>,
    app: AppHandle,
    session: Arc<Mutex<Option<SessionRecord>>>,
    token: String,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
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

    let (http_listener, http_stable) =
        match bind_upload_listener_localhost_strict(local_port).await {
            Ok(pair) => pair,
            Err(error) => {
                return fail(crate::phone_upload_settings::port_bind_error(local_port, &error));
            }
        };

    let http_port = match http_listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(error) => {
            return fail(format!("Failed to read HTTP upload server port: {error}"));
        }
    };
    log_line(
        "bind_ok",
        "INFO",
        &format!("http_port={http_port} localhost_only=true stable={http_stable}"),
    );

    ready.signal_ready(http_port);

    let ctx = Arc::new(ServerContext {
        db,
        app,
        session: Arc::clone(&session),
        expected_token: token,
        log: Some(log),
        session_log_id,
    });

    let http_router = Router::new()
        .route("/s/:token", get(upload_page_http).post(receive_upload))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .with_state(ctx);

    let http_service = http_router.into_make_service_with_connect_info::<SocketAddr>();
    let result = axum::serve(http_listener, http_service)
        .with_graceful_shutdown(async move {
            wait_for_shutdown(&mut shutdown_rx).await;
        })
        .await
        .map_err(|e| format!("HTTP upload server stopped: {e}"));

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
        match session.as_ref() {
            Some(record) => match &record.page_context {
                UploadPageContext::Replace { .. } => render_replace_upload_page(&record.page_context),
                UploadPageContext::Library { .. } | UploadPageContext::Collection { .. } => {
                    let allow_multiple = matches!(
                        record.kind,
                        SessionKind::LibraryImport | SessionKind::CollectionImport { .. }
                    );
                    render_import_upload_page(&record.page_context, allow_multiple)
                }
            },
            None => render_replace_upload_page(&UploadPageContext::Replace {
                title: "Library track".to_string(),
                artist: String::new(),
                album: String::new(),
                file_name: String::new(),
                duration_ms: 0,
            }),
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

    if matches!(
        session_kind,
        SessionKind::LibraryImport | SessionKind::CollectionImport { .. }
    ) {
        return finish_import_upload(&ctx, &session_kind, &temp_dir, uploads).await;
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

        last_response = if let SessionKind::Replace { track_id } = &session_kind {
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

            let success_detail = {
                let session = ctx.session.lock();
                match session.as_ref().map(|r| &r.page_context) {
                    Some(UploadPageContext::Replace { title, .. }) => format!(
                        "You can close this page and confirm replacing “{}” in TrackVault.",
                        html_escape(title)
                    ),
                    _ => "You can close this page and confirm the replacement in TrackVault."
                        .to_string(),
                }
            };

            html_message(StatusCode::OK, "Upload received", &success_detail)
        } else {
            let _ = std::fs::remove_file(&temp_path);
            html_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Upload failed",
                "Unexpected upload session type.",
            )
        };
    }

    last_response
}

async fn finish_import_upload(
    ctx: &Arc<ServerContext>,
    session_kind: &SessionKind,
    temp_dir: &Path,
    uploads: Vec<(String, Vec<u8>)>,
) -> Response {
    let mut saved_paths: Vec<PathBuf> = Vec::new();

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

        let temp_path = unique_temp_path(temp_dir, &safe_name);
        if let Err(error) = std::fs::write(&temp_path, &data) {
            for path in &saved_paths {
                let _ = std::fs::remove_file(path);
            }
            return html_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Save failed",
                &format!("Could not save upload: {error}"),
            );
        }

        if !is_audio_file(&temp_path) {
            let _ = std::fs::remove_file(&temp_path);
            for path in &saved_paths {
                let _ = std::fs::remove_file(path);
            }
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

        saved_paths.push(temp_path);
    }

    let (mode, collection_id, all_paths) = {
        let mut session = ctx.session.lock();
        let Some(record) = session.as_mut() else {
            for path in &saved_paths {
                let _ = std::fs::remove_file(path);
            }
            return html_message(
                StatusCode::GONE,
                "Upload session ended",
                "Return to TrackVault and start upload again.",
            );
        };
        record.received_paths.extend(saved_paths);
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
            "import_batch_received",
            &format!("files={} total={}", session_kind.mode_str(), all_paths.len()),
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
        "TrackVault is adding these files—you can close this page.",
    )
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

fn resolve_upload_page_context(
    db: &Database,
    kind: &SessionKind,
) -> Result<UploadPageContext, String> {
    match kind {
        SessionKind::Replace { track_id } => {
            let track = db
                .get_track(*track_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Track not found".to_string())?;
            let file_name = Path::new(&track.path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("track")
                .to_string();
            Ok(UploadPageContext::Replace {
                title: track.title,
                artist: track.artist,
                album: track.album,
                file_name,
                duration_ms: track.duration_ms,
            })
        }
        SessionKind::LibraryImport => {
            let folder_path = db
                .get_library_folder()
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "No library folder configured".to_string())?;
            let folder_label = Path::new(&folder_path)
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|label| !label.is_empty())
                .unwrap_or("Library")
                .to_string();
            Ok(UploadPageContext::Library {
                folder_label,
                folder_path,
            })
        }
        SessionKind::CollectionImport { collection_id } => {
            let collection = db
                .get_collection(*collection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Collection not found".to_string())?;
            Ok(UploadPageContext::Collection {
                name: collection.name,
            })
        }
    }
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn format_duration_ms(ms: i64) -> String {
    let total_secs = (ms.max(0) / 1000) as u64;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    format!("{mins}:{secs:02}")
}

const UPLOAD_PAGE_STYLES: &str = r#"
    body { font-family: system-ui, sans-serif; margin: 1.5rem; line-height: 1.5; max-width: 28rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    .context { background: #f4f4f5; border-radius: 0.375rem; padding: 0.75rem 1rem; margin: 1rem 0; }
    .context-title { font-weight: 600; color: #111; margin: 0 0 0.25rem; font-size: 1rem; }
    .context-meta { font-size: 0.875rem; color: #555; margin: 0; word-break: break-all; }
    input[type=file] { width: 100%; margin: 1rem 0; }
    button { font: inherit; padding: 0.6rem 1rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; }
    .note { font-size: 0.875rem; margin-top: 1rem; }
"#;

fn render_replace_upload_page(ctx: &UploadPageContext) -> String {
    let UploadPageContext::Replace {
        title,
        artist,
        album,
        file_name,
        duration_ms,
    } = ctx
    else {
        return render_replace_upload_page(&UploadPageContext::Replace {
            title: "Library track".to_string(),
            artist: String::new(),
            album: String::new(),
            file_name: String::new(),
            duration_ms: 0,
        });
    };

    let mut meta_parts: Vec<String> = Vec::new();
    if !artist.trim().is_empty() {
        meta_parts.push(html_escape(artist.trim()));
    }
    if !album.trim().is_empty() {
        meta_parts.push(html_escape(album.trim()));
    }
    if *duration_ms > 0 {
        meta_parts.push(format!(
            "{}",
            html_escape(&format_duration_ms(*duration_ms))
        ));
    }
    let meta_line = if meta_parts.is_empty() {
        String::new()
    } else {
        format!(r#"<p class="context-meta">{}</p>"#, meta_parts.join(" · "))
    };

    let file_line = if file_name.is_empty() {
        String::new()
    } else {
        format!(
            r#"<p class="context-meta">Current file: {}</p>"#,
            html_escape(file_name)
        )
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TrackVault — Replace file</title>
  <style>{UPLOAD_PAGE_STYLES}</style>
</head>
<body>
  <h1>Upload replacement audio</h1>
  <p>Select one audio file to send to TrackVault (maximum 500 MB).</p>
  <div class="context">
    <p class="context-title">Replacing: {title}</p>
    {meta_line}
    {file_line}
  </div>
  <form method="post" enctype="multipart/form-data">
    <input type="file" name="file" accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.mp4,.aiff" required />
    <button type="submit">Upload</button>
  </form>
</body>
</html>"#,
        title = html_escape(title),
        meta_line = meta_line,
        file_line = file_line,
    )
}

fn render_import_upload_page(ctx: &UploadPageContext, allow_multiple: bool) -> String {
    let (page_title, context_heading, context_detail) = match ctx {
        UploadPageContext::Library {
            folder_label,
            folder_path,
        } => (
            "TrackVault — Upload to library",
            format!("Upload to library: {}", html_escape(folder_label)),
            format!("Folder: {}", html_escape(folder_path)),
        ),
        UploadPageContext::Collection { name } => (
            "TrackVault — Upload to collection",
            format!("Upload to collection: {}", html_escape(name)),
            String::new(),
        ),
        UploadPageContext::Replace { .. } => (
            "TrackVault — Upload tracks",
            "Upload to TrackVault".to_string(),
            String::new(),
        ),
    };

    let instructions = if allow_multiple {
        "Select one or more audio files (maximum 500 MB each). TrackVault will import them automatically."
    } else {
        "Select one audio file to send to TrackVault (maximum 500 MB)."
    };

    let multiple_attr = if allow_multiple { " multiple" } else { "" };
    let detail_block = if context_detail.is_empty() {
        String::new()
    } else {
        format!(r#"<p class="context-meta">{context_detail}</p>"#)
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{page_title}</title>
  <style>{UPLOAD_PAGE_STYLES}</style>
</head>
<body>
  <h1>Upload audio to TrackVault</h1>
  <p>{instructions}</p>
  <div class="context">
    <p class="context-title">{context_heading}</p>
    {detail_block}
  </div>
  <form method="post" enctype="multipart/form-data">
    <input type="file" name="file" accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.mp4,.aiff"{multiple_attr} required />
    <button type="submit">Upload</button>
  </form>
</body>
</html>"#,
        instructions = html_escape(instructions),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escape_neutralizes_markup() {
        let escaped = html_escape("<script>alert(\"x\")</script>");
        assert!(!escaped.contains('<'));
        assert!(escaped.contains("&lt;script&gt;"));
    }

    #[test]
    fn replace_page_escapes_track_title() {
        let html = render_replace_upload_page(&UploadPageContext::Replace {
            title: "Song <b>Title</b>".to_string(),
            artist: "Artist".to_string(),
            album: String::new(),
            file_name: "track.mp3".to_string(),
            duration_ms: 125_000,
        });
        assert!(html.contains("Song &lt;b&gt;Title&lt;/b&gt;"));
        assert!(!html.contains("<b>Title</b>"));
        assert!(html.contains("Current file: track.mp3"));
        assert!(html.contains("2:05"));
    }

    #[test]
    fn import_page_shows_collection_name() {
        let html = render_import_upload_page(
            &UploadPageContext::Collection {
                name: "Demo & Mixes".to_string(),
            },
            true,
        );
        assert!(html.contains("Demo &amp; Mixes"));
        assert!(html.contains("multiple"));
    }
}
