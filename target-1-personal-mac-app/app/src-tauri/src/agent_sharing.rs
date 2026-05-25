use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const DEFAULT_AGENT_SHARE_PORT: u16 = 37411;
#[cfg(test)]
pub const DEFAULT_SHARE_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShareScope {
    Selection,
    Scene,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShareStatus {
    Active,
    Expired,
    Revoked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShareVisibility {
    Local,
    Lan,
    Peer,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSelectionSummary {
    pub element_ids: Vec<String>,
    pub bounds: ShareBounds,
    pub text: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAssets {
    pub manifest: String,
    pub brief: String,
    pub selection_json: String,
    pub excalidraw: String,
    pub png: String,
    pub svg: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentShareManifest {
    pub schema_version: u32,
    pub share_id: String,
    pub title: String,
    pub description: String,
    pub labels: Vec<String>,
    pub scope: ShareScope,
    pub scene_id: String,
    pub source_file: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub expires_at_ms: u128,
    pub status: ShareStatus,
    pub visibility: ShareVisibility,
    pub origin_device_id: String,
    pub owner_name: String,
    pub sync_mode: String,
    pub permissions: Vec<String>,
    pub selection: ShareSelectionSummary,
    pub text_preview: Vec<String>,
    pub assets: ShareAssets,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentShareSummary {
    pub share_id: String,
    pub title: String,
    pub description: String,
    pub labels: Vec<String>,
    pub scope: ShareScope,
    pub scene_id: String,
    pub source_file: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub status: ShareStatus,
    pub visibility: ShareVisibility,
    pub text_preview: Vec<String>,
    pub last_read_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareMetadataPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub labels: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentShareInput {
    pub share_id: String,
    pub scope: ShareScope,
    pub title: String,
    pub description: String,
    pub labels: Vec<String>,
    pub scene_id: String,
    pub source_file: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub expires_at_ms: u128,
    pub selection: ShareSelectionSummary,
    pub text_preview: Vec<String>,
    pub selection_json: Value,
    pub scene_excalidraw: String,
    pub render_svg: String,
    pub render_png: Vec<u8>,
    pub brief_md: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShareAssetKind {
    Manifest,
    Brief,
    SelectionJson,
    SceneExcalidraw,
    RenderPng,
    RenderSvg,
}

impl ShareAssetKind {
    fn from_path_segment(segment: &str) -> Option<Self> {
        match segment {
            "manifest" => Some(Self::Manifest),
            "brief.md" => Some(Self::Brief),
            "selection.json" => Some(Self::SelectionJson),
            "scene.excalidraw" => Some(Self::SceneExcalidraw),
            "render.png" => Some(Self::RenderPng),
            "render.svg" => Some(Self::RenderSvg),
            _ => None,
        }
    }

    fn filename(self) -> &'static str {
        match self {
            Self::Manifest => "manifest.json",
            Self::Brief => "brief.md",
            Self::SelectionJson => "selection.json",
            Self::SceneExcalidraw => "scene.excalidraw",
            Self::RenderPng => "render.png",
            Self::RenderSvg => "render.svg",
        }
    }

    fn resource_name(self) -> &'static str {
        match self {
            Self::Manifest => "manifest",
            Self::Brief => "brief.md",
            Self::SelectionJson => "selection.json",
            Self::SceneExcalidraw => "scene.excalidraw",
            Self::RenderPng => "render.png",
            Self::RenderSvg => "render.svg",
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Manifest | Self::SelectionJson | Self::SceneExcalidraw => {
                "application/json; charset=utf-8"
            }
            Self::Brief => "text/markdown; charset=utf-8",
            Self::RenderPng => "image/png",
            Self::RenderSvg => "image/svg+xml; charset=utf-8",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentShareError {
    NotFound,
    ShareExpired,
    ShareRevoked,
    Io(String),
    Json(String),
    InvalidInput(String),
}

impl std::fmt::Display for AgentShareError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for AgentShareError {}

impl From<std::io::Error> for AgentShareError {
    fn from(error: std::io::Error) -> Self {
        AgentShareError::Io(error.to_string())
    }
}

impl From<serde_json::Error> for AgentShareError {
    fn from(error: serde_json::Error) -> Self {
        AgentShareError::Json(error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentShareStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub share_count: usize,
    pub started_at_ms: Option<u128>,
    pub expose_current_selection: bool,
}

struct AgentShareServer {
    port: u16,
    started_at_ms: u128,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct AgentShareState {
    registry: Arc<Mutex<AgentShareRegistry>>,
}

impl AgentShareState {
    pub fn new(root: PathBuf) -> Result<Self, AgentShareError> {
        Ok(Self {
            registry: Arc::new(Mutex::new(AgentShareRegistry {
                store: AgentShareStore::new(root)?,
                server: None,
                expose_current_selection: false,
                current_selection: None,
            })),
        })
    }
}

struct AgentShareRegistry {
    store: AgentShareStore,
    server: Option<AgentShareServer>,
    expose_current_selection: bool,
    current_selection: Option<AgentShareInput>,
}

pub struct AgentShareStore {
    root: PathBuf,
    index: AgentShareIndex,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentShareIndex {
    schema_version: u32,
    shares: Vec<AgentShareSummary>,
}

impl AgentShareStore {
    pub fn new(root: PathBuf) -> Result<Self, AgentShareError> {
        fs::create_dir_all(&root)?;
        let index_path = root.join("index.json");
        let index = if index_path.exists() {
            serde_json::from_slice(&fs::read(index_path)?)?
        } else {
            AgentShareIndex {
                schema_version: 1,
                shares: Vec::new(),
            }
        };
        Ok(Self { root, index })
    }

    pub fn register_share(
        &mut self,
        input: AgentShareInput,
    ) -> Result<AgentShareSummary, AgentShareError> {
        validate_share_id(&input.share_id)?;
        let share_dir = self.root.join(&input.share_id);
        fs::create_dir_all(&share_dir)?;
        let assets = share_assets(&input.share_id);
        let status = if input.expires_at_ms <= current_ms() {
            ShareStatus::Expired
        } else {
            ShareStatus::Active
        };
        let manifest = AgentShareManifest {
            schema_version: 1,
            share_id: input.share_id.clone(),
            title: input.title.clone(),
            description: input.description.clone(),
            labels: input.labels.clone(),
            scope: input.scope.clone(),
            scene_id: input.scene_id.clone(),
            source_file: input.source_file.clone(),
            created_at: input.created_at.clone(),
            updated_at: input.updated_at.clone(),
            expires_at: input.expires_at.clone(),
            expires_at_ms: input.expires_at_ms,
            status: status.clone(),
            visibility: ShareVisibility::Local,
            origin_device_id: "local".to_owned(),
            owner_name: whoami_fallback(),
            sync_mode: "snapshot".to_owned(),
            permissions: vec!["read".to_owned()],
            selection: input.selection.clone(),
            text_preview: input.text_preview.clone(),
            assets,
        };
        write_json_atomic(&share_dir.join("manifest.json"), &manifest)?;
        write_json_atomic(&share_dir.join("selection.json"), &input.selection_json)?;
        write_atomic(
            &share_dir.join("scene.excalidraw"),
            input.scene_excalidraw.as_bytes(),
        )?;
        write_atomic(&share_dir.join("render.svg"), input.render_svg.as_bytes())?;
        write_atomic(&share_dir.join("render.png"), &input.render_png)?;
        write_atomic(&share_dir.join("brief.md"), input.brief_md.as_bytes())?;

        let summary = summary_from_manifest(&manifest, None);
        self.index
            .shares
            .retain(|share| share.share_id != input.share_id);
        self.index.shares.insert(0, summary.clone());
        self.save_index()?;
        Ok(summary)
    }

    pub fn list_recent_shares(&mut self) -> Result<Vec<AgentShareSummary>, AgentShareError> {
        let now = current_ms();
        let mut changed = false;
        for index in 0..self.index.shares.len() {
            if self.index.shares[index].status != ShareStatus::Active {
                continue;
            }
            let share_id = self.index.shares[index].share_id.clone();
            if let Ok(mut manifest) = self.read_manifest_unchecked(&share_id) {
                if manifest.expires_at_ms <= now {
                    manifest.status = ShareStatus::Expired;
                    self.index.shares[index].status = ShareStatus::Expired;
                    let _ = write_json_atomic(
                        &self.root.join(&share_id).join("manifest.json"),
                        &manifest,
                    );
                    changed = true;
                }
            }
        }
        if changed {
            self.save_index()?;
        }
        Ok(self.index.shares.clone())
    }

    pub fn read_manifest(
        &mut self,
        share_id: &str,
    ) -> Result<AgentShareManifest, AgentShareError> {
        let manifest = self.read_manifest_unchecked(share_id)?;
        self.ensure_readable(&manifest)?;
        self.record_read(share_id, "manifest")?;
        Ok(manifest)
    }

    pub fn read_asset(
        &mut self,
        share_id: &str,
        kind: ShareAssetKind,
    ) -> Result<Vec<u8>, AgentShareError> {
        let manifest = self.read_manifest_unchecked(share_id)?;
        self.ensure_readable(&manifest)?;
        let path = self.share_asset_path(share_id, kind);
        let bytes = fs::read(path)?;
        self.record_read(share_id, kind.resource_name())?;
        Ok(bytes)
    }

    pub fn update_share_metadata(
        &mut self,
        share_id: &str,
        patch: ShareMetadataPatch,
    ) -> Result<AgentShareSummary, AgentShareError> {
        let mut manifest = self.read_manifest_unchecked(share_id)?;
        if let Some(title) = patch.title {
            manifest.title = title;
        }
        if let Some(description) = patch.description {
            manifest.description = description;
        }
        if let Some(labels) = patch.labels {
            manifest.labels = labels;
        }
        manifest.updated_at = iso_now();
        write_json_atomic(&self.root.join(share_id).join("manifest.json"), &manifest)?;
        let last_read_at = self
            .index
            .shares
            .iter()
            .find(|share| share.share_id == share_id)
            .and_then(|share| share.last_read_at.clone());
        let summary = summary_from_manifest(&manifest, last_read_at);
        self.index.shares.retain(|share| share.share_id != share_id);
        self.index.shares.insert(0, summary.clone());
        self.save_index()?;
        Ok(summary)
    }

    pub fn revoke_share(&mut self, share_id: &str) -> Result<(), AgentShareError> {
        let mut manifest = self.read_manifest_unchecked(share_id)?;
        manifest.status = ShareStatus::Revoked;
        write_json_atomic(&self.root.join(share_id).join("manifest.json"), &manifest)?;
        for summary in &mut self.index.shares {
            if summary.share_id == share_id {
                summary.status = ShareStatus::Revoked;
            }
        }
        self.save_index()
    }

    pub fn revoke_all(&mut self) -> Result<(), AgentShareError> {
        let share_ids = self
            .index
            .shares
            .iter()
            .map(|share| share.share_id.clone())
            .collect::<Vec<_>>();
        for share_id in share_ids {
            self.revoke_share(&share_id)?;
        }
        Ok(())
    }

    pub fn delete_share(&mut self, share_id: &str) -> Result<(), AgentShareError> {
        let path = self.root.join(share_id);
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        self.index.shares.retain(|share| share.share_id != share_id);
        self.save_index()
    }

    pub fn clean_expired(&mut self) -> Result<usize, AgentShareError> {
        let ids = self
            .index
            .shares
            .iter()
            .filter_map(|summary| match self.read_manifest_unchecked(&summary.share_id) {
                Ok(manifest) if manifest.expires_at_ms <= current_ms() => {
                    Some(summary.share_id.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        let removed = ids.len();
        for share_id in ids {
            self.delete_share(&share_id)?;
        }
        Ok(removed)
    }

    fn save_index(&mut self) -> Result<(), AgentShareError> {
        self.index.schema_version = 1;
        write_json_atomic(&self.root.join("index.json"), &self.index)
    }

    fn read_manifest_unchecked(
        &self,
        share_id: &str,
    ) -> Result<AgentShareManifest, AgentShareError> {
        validate_share_id(share_id)?;
        let path = self.root.join(share_id).join("manifest.json");
        if !path.exists() {
            return Err(AgentShareError::NotFound);
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    fn ensure_readable(&self, manifest: &AgentShareManifest) -> Result<(), AgentShareError> {
        if manifest.status == ShareStatus::Revoked {
            return Err(AgentShareError::ShareRevoked);
        }
        if manifest.expires_at_ms <= current_ms() || manifest.status == ShareStatus::Expired {
            return Err(AgentShareError::ShareExpired);
        }
        Ok(())
    }

    fn share_asset_path(&self, share_id: &str, kind: ShareAssetKind) -> PathBuf {
        self.root.join(share_id).join(kind.filename())
    }

    fn record_read(&mut self, share_id: &str, resource: &str) -> Result<(), AgentShareError> {
        let read_at = iso_now();
        for summary in &mut self.index.shares {
            if summary.share_id == share_id {
                summary.last_read_at = Some(read_at.clone());
            }
        }
        self.save_index()?;
        let line = format!("{read_at}\t{share_id}\t{resource}\tlocal\t127.0.0.1\tok\n");
        append_atomic(&self.root.join("audit.log"), line.as_bytes())?;
        Ok(())
    }
}

#[tauri::command]
pub fn agent_share_status(state: State<AgentShareState>) -> Result<AgentShareStatus, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    Ok(agent_share_status_from_registry(&mut registry))
}

#[tauri::command]
pub fn start_agent_share_server(
    state: State<AgentShareState>,
    port: Option<u16>,
) -> Result<AgentShareStatus, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    if registry.server.is_some() {
        return Ok(agent_share_status_from_registry(&mut registry));
    }

    let requested_port = port.unwrap_or(DEFAULT_AGENT_SHARE_PORT);
    let listener = TcpListener::bind(("127.0.0.1", requested_port))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|error| error.to_string())?;
    let actual_port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_state = state.inner().clone();
    let handle = thread::spawn(move || serve_agent_shares(listener, thread_state, thread_stop));

    registry.server = Some(AgentShareServer {
        port: actual_port,
        started_at_ms: current_ms(),
        stop,
        handle: Some(handle),
    });
    Ok(agent_share_status_from_registry(&mut registry))
}

#[tauri::command]
pub fn stop_agent_share_server(state: State<AgentShareState>) -> Result<AgentShareStatus, String> {
    let handle = {
        let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
        registry.expose_current_selection = false;
        registry.current_selection = None;
        if let Some(mut server) = registry.server.take() {
            server.stop.store(true, Ordering::SeqCst);
            server.handle.take()
        } else {
            None
        }
    };

    if let Some(handle) = handle {
        let _ = handle.join();
    }

    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    Ok(agent_share_status_from_registry(&mut registry))
}

#[tauri::command]
pub fn register_agent_share(
    state: State<AgentShareState>,
    share: AgentShareInput,
) -> Result<AgentShareSummary, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .register_share(share)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_agent_shares(state: State<AgentShareState>) -> Result<Vec<AgentShareSummary>, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .list_recent_shares()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_agent_share(
    state: State<AgentShareState>,
    share_id: String,
    patch: ShareMetadataPatch,
) -> Result<AgentShareSummary, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .update_share_metadata(&share_id, patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn revoke_agent_share(state: State<AgentShareState>, share_id: String) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .revoke_share(&share_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_agent_share(state: State<AgentShareState>, share_id: String) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .delete_share(&share_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clean_expired_agent_shares(state: State<AgentShareState>) -> Result<usize, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry
        .store
        .clean_expired()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn revoke_all_agent_shares(state: State<AgentShareState>) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.store.revoke_all().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_current_selection_share(
    state: State<AgentShareState>,
    share: Option<AgentShareInput>,
) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.expose_current_selection = share.is_some();
    registry.current_selection = share;
    Ok(())
}

#[tauri::command]
pub fn get_current_selection_share(
    state: State<AgentShareState>,
) -> Result<Option<AgentShareSummary>, String> {
    let registry = state.registry.lock().map_err(|error| error.to_string())?;
    Ok(registry
        .current_selection
        .as_ref()
        .map(current_selection_summary))
}

fn agent_share_status_from_registry(registry: &mut AgentShareRegistry) -> AgentShareStatus {
    let share_count = registry
        .store
        .list_recent_shares()
        .map(|shares| {
            shares
                .into_iter()
                .filter(|share| share.status == ShareStatus::Active)
                .count()
        })
        .unwrap_or(0);

    if let Some(server) = &registry.server {
        AgentShareStatus {
            enabled: true,
            port: Some(server.port),
            base_url: Some(format!("http://127.0.0.1:{}", server.port)),
            share_count,
            started_at_ms: Some(server.started_at_ms),
            expose_current_selection: registry.expose_current_selection,
        }
    } else {
        AgentShareStatus {
            enabled: false,
            port: None,
            base_url: None,
            share_count,
            started_at_ms: None,
            expose_current_selection: false,
        }
    }
}

fn serve_agent_shares(listener: TcpListener, state: AgentShareState, stop: Arc<AtomicBool>) {
    let _ = listener.set_nonblocking(true);
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let response = match parse_http_request(&mut stream) {
                    Ok((method, path, headers, body)) => {
                        handle_agent_share_request(&method, &path, &headers, &body, &state)
                    }
                    Err(error) => json_response("400 Bad Request", json!({ "error": error })),
                };
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

fn parse_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let size = stream
            .read(&mut chunk)
            .map_err(|error| error.to_string())?;
        if size == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            let header_end = buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .unwrap()
                + 4;
            let headers_text = String::from_utf8_lossy(&buffer[..header_end]);
            let content_length = headers_text
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            while buffer.len() < header_end + content_length {
                let size = stream
                    .read(&mut chunk)
                    .map_err(|error| error.to_string())?;
                if size == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..size]);
            }
            break;
        }
    }

    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "missing HTTP headers".to_owned())?
        + 4;
    let request = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = request.lines();
    let first_line = lines.next().ok_or_else(|| "empty request".to_owned())?;
    let mut first_parts = first_line.split_whitespace();
    let method = first_parts.next().unwrap_or("").to_owned();
    let path = first_parts.next().unwrap_or("").to_owned();
    let mut headers = HashMap::new();
    for line in lines {
        if line.trim().is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    Ok((method, path, headers, buffer[header_end..].to_vec()))
}

pub(crate) fn handle_agent_share_request(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    state: &AgentShareState,
) -> Vec<u8> {
    if method == "OPTIONS" {
        return http_response("204 No Content", "text/plain", Vec::new(), &[]);
    }

    if path == "/health" && method == "GET" {
        return json_response("200 OK", json!({ "ok": true }));
    }

    let port = state
        .registry
        .lock()
        .ok()
        .and_then(|registry| registry.server.as_ref().map(|server| server.port));
    if !origin_allowed(headers, port) {
        return json_response("403 Forbidden", json!({ "error": "origin_forbidden" }));
    }

    if path == "/mcp" && method == "POST" {
        return handle_mcp_request(body, state);
    }

    if path == "/mcp" && method == "GET" {
        return json_response(
            "405 Method Not Allowed",
            json!({ "error": "sse_not_implemented", "message": "Use Streamable HTTP JSON-RPC POST requests." }),
        );
    }

    if method != "GET" {
        return json_response(
            "405 Method Not Allowed",
            json!({ "error": "method_not_allowed" }),
        );
    }

    if path == "/v1/status" {
        let Ok(mut registry) = state.registry.lock() else {
            return json_response("500 Internal Server Error", json!({ "error": "state_lock_failed" }));
        };
        return json_response("200 OK", json!(agent_share_status_from_registry(&mut registry)));
    }

    if path == "/v1/shares" {
        let Ok(mut registry) = state.registry.lock() else {
            return json_response("500 Internal Server Error", json!({ "error": "state_lock_failed" }));
        };
        return match registry.store.list_recent_shares() {
            Ok(shares) => json_response("200 OK", json!({ "shares": shares })),
            Err(error) => share_error_response(error),
        };
    }

    let trimmed = path.trim_start_matches('/');
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts.len() == 4 && parts[0] == "v1" && parts[1] == "shares" {
        let Some(kind) = ShareAssetKind::from_path_segment(parts[3]) else {
            return json_response("404 Not Found", json!({ "error": "asset_not_found" }));
        };
        return http_share_asset(state, parts[2], kind);
    }

    if parts.len() == 3 && parts[0] == "v1" && parts[1] == "current-selection" {
        let Some(kind) = ShareAssetKind::from_path_segment(parts[2]) else {
            return json_response("404 Not Found", json!({ "error": "asset_not_found" }));
        };
        return http_current_selection_asset(state, kind);
    }

    json_response("404 Not Found", json!({ "error": "not_found" }))
}

fn handle_mcp_request(body: &[u8], state: &AgentShareState) -> Vec<u8> {
    let request: Value = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(error) => {
            return json_response(
                "400 Bad Request",
                json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": error.to_string() } }),
            )
        }
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if request.get("id").is_none() {
        return http_response("202 Accepted", "application/json; charset=utf-8", Vec::new(), &[]);
    }
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {
                "resources": {},
                "tools": {},
                "prompts": {}
            },
            "serverInfo": {
                "name": "personal-excalidraw",
                "version": "0.1.0"
            }
        })),
        "resources/list" => mcp_resources_list(state),
        "resources/read" => {
            match request
                .pointer("/params/uri")
                .and_then(Value::as_str)
            {
                Some(uri) => mcp_read_resource(state, uri),
                None => Err(mcp_error(-32602, "resources/read requires params.uri")),
            }
        }
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => {
            match request
                .pointer("/params/name")
                .and_then(Value::as_str)
            {
                Some(name) => {
                    let arguments = request
                        .pointer("/params/arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    mcp_call_tool(state, name, arguments)
                }
                None => Err(mcp_error(-32602, "tools/call requires params.name")),
            }
        }
        "prompts/list" => Ok(json!({ "prompts": mcp_prompts() })),
        "prompts/get" => {
            match request
                .pointer("/params/name")
                .and_then(Value::as_str)
            {
                Some(name) => mcp_get_prompt(name),
                None => Err(mcp_error(-32602, "prompts/get requires params.name")),
            }
        }
        _ => Err(mcp_error(-32601, "method not found")),
    };

    match result {
        Ok(result) => json_response("200 OK", json!({ "jsonrpc": "2.0", "id": id, "result": result })),
        Err(error) => json_response("200 OK", json!({ "jsonrpc": "2.0", "id": id, "error": error })),
    }
}

fn mcp_resources_list(state: &AgentShareState) -> Result<Value, Value> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| mcp_error(-32000, "state lock failed"))?;
    let shares = registry
        .store
        .list_recent_shares()
        .map_err(|error| mcp_error(-32000, &error.to_string()))?;
    let mut resources = Vec::new();
    for share in shares {
        resources.extend(mcp_resources_for_share(&share.share_id, &share.title));
    }
    if registry.expose_current_selection && registry.current_selection.is_some() {
        resources.extend([
            resource("excalidraw://current-selection/manifest", "Current selection manifest", "application/json"),
            resource("excalidraw://current-selection/brief", "Current selection brief", "text/markdown"),
            resource("excalidraw://current-selection/image.png", "Current selection PNG", "image/png"),
        ]);
    }
    Ok(json!({ "resources": resources }))
}

fn mcp_read_resource(state: &AgentShareState, uri: &str) -> Result<Value, Value> {
    if let Some((share_id, kind)) = parse_share_resource_uri(uri) {
        let mut registry = state
            .registry
            .lock()
            .map_err(|_| mcp_error(-32000, "state lock failed"))?;
        return match kind {
            ShareAssetKind::Manifest => registry
                .store
                .read_manifest(&share_id)
                .map(|manifest| text_resource(uri, "application/json", pretty_json(&manifest)))
                .map_err(|error| mcp_error(-32000, &error.to_string())),
            ShareAssetKind::RenderPng => registry
                .store
                .read_asset(&share_id, kind)
                .map(|bytes| binary_resource(uri, "image/png", bytes))
                .map_err(|error| mcp_error(-32000, &error.to_string())),
            _ => registry
                .store
                .read_asset(&share_id, kind)
                .map(|bytes| {
                    text_resource(
                        uri,
                        kind.mime_type(),
                        String::from_utf8_lossy(&bytes).into_owned(),
                    )
                })
                .map_err(|error| mcp_error(-32000, &error.to_string())),
        };
    }

    if let Some(kind) = parse_current_selection_resource_uri(uri) {
        let registry = state
            .registry
            .lock()
            .map_err(|_| mcp_error(-32000, "state lock failed"))?;
        let share = registry
            .current_selection
            .as_ref()
            .filter(|_| registry.expose_current_selection)
            .ok_or_else(|| mcp_error(-32000, "current selection is not exposed"))?;
        return Ok(current_selection_resource(uri, share, kind));
    }

    Err(mcp_error(-32602, "unknown resource uri"))
}

fn mcp_call_tool(state: &AgentShareState, name: &str, arguments: Value) -> Result<Value, Value> {
    match name {
        "explain_api_status" => {
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let status = agent_share_status_from_registry(&mut registry);
            Ok(tool_text(pretty_json(&status)))
        }
        "list_recent_shares" => {
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let shares = registry
                .store
                .list_recent_shares()
                .map_err(|error| mcp_error(-32000, &error.to_string()))?;
            Ok(tool_text(pretty_json(&json!({ "shares": shares }))))
        }
        "get_share_manifest" => {
            let share_id = arguments
                .get("shareId")
                .and_then(Value::as_str)
                .ok_or_else(|| mcp_error(-32602, "shareId is required"))?;
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let manifest = registry
                .store
                .read_manifest(share_id)
                .map_err(|error| mcp_error(-32000, &error.to_string()))?;
            Ok(tool_text(pretty_json(&manifest)))
        }
        "get_share_brief" => {
            let share_id = arguments
                .get("shareId")
                .and_then(Value::as_str)
                .ok_or_else(|| mcp_error(-32602, "shareId is required"))?;
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let brief = registry
                .store
                .read_asset(share_id, ShareAssetKind::Brief)
                .map_err(|error| mcp_error(-32000, &error.to_string()))?;
            Ok(tool_text(String::from_utf8_lossy(&brief).into_owned()))
        }
        "render_share" => {
            let share_id = arguments
                .get("shareId")
                .and_then(Value::as_str)
                .ok_or_else(|| mcp_error(-32602, "shareId is required"))?;
            let format = arguments
                .get("format")
                .and_then(Value::as_str)
                .unwrap_or("png");
            let uri = match format {
                "svg" => format!("excalidraw://shares/{share_id}/image.svg"),
                _ => format!("excalidraw://shares/{share_id}/image.png"),
            };
            Ok(tool_text(uri))
        }
        "search_scenes" => {
            let query = arguments
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_lowercase();
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let shares = registry
                .store
                .list_recent_shares()
                .map_err(|error| mcp_error(-32000, &error.to_string()))?;
            let matches: Vec<_> = shares
                .into_iter()
                .filter(|share| {
                    if query.is_empty() {
                        return true;
                    }
                    let haystack = format!(
                        "{} {} {} {} {}",
                        share.title,
                        share.description,
                        share.source_file,
                        share.labels.join(" "),
                        share.text_preview.join(" ")
                    )
                    .to_lowercase();
                    haystack.contains(&query)
                })
                .collect();
            Ok(tool_text(pretty_json(&json!({ "shares": matches }))))
        }
        "get_current_selection_share" => {
            let registry = state
                .registry
                .lock()
                .map_err(|_| mcp_error(-32000, "state lock failed"))?;
            let summary = registry
                .current_selection
                .as_ref()
                .filter(|_| registry.expose_current_selection)
                .map(current_selection_summary);
            Ok(tool_text(pretty_json(&summary)))
        }
        _ => Err(mcp_error(-32602, "unknown tool")),
    }
}

fn mcp_tools() -> Value {
    json!([
        {
            "name": "explain_api_status",
            "title": "Explain Agent Sharing status",
            "description": "Return whether the local Personal Excalidraw Agent Sharing service is on, where it is listening, and what the user should do if it is unavailable.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_recent_shares",
            "title": "List recent Excalidraw shares",
            "description": "List active, expired, and revoked shares with title, description, labels, source file, text preview, and status so the agent can choose the right share.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "get_share_manifest",
            "title": "Get share manifest",
            "description": "Read a share manifest by shareId.",
            "inputSchema": {
                "type": "object",
                "properties": { "shareId": { "type": "string" } },
                "required": ["shareId"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_share_brief",
            "title": "Get share brief",
            "description": "Read brief.md for a share by shareId.",
            "inputSchema": {
                "type": "object",
                "properties": { "shareId": { "type": "string" } },
                "required": ["shareId"],
                "additionalProperties": false
            }
        },
        {
            "name": "render_share",
            "title": "Get rendered share image resource",
            "description": "Return the MCP resource URI for the rendered PNG or SVG for a share.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "shareId": { "type": "string" },
                    "format": { "type": "string", "enum": ["png", "svg"] }
                },
                "required": ["shareId"],
                "additionalProperties": false
            }
        },
        {
            "name": "search_scenes",
            "title": "Search shared scenes",
            "description": "Search recent shares by title, description, labels, source file, and text preview. This helps choose a named share when the user did not provide a shareId.",
            "inputSchema": {
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "additionalProperties": false
            }
        },
        {
            "name": "get_current_selection_share",
            "title": "Get current selection share",
            "description": "Return the runtime current-selection manifest when Expose current selection is enabled.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

fn mcp_prompts() -> Value {
    json!([
        prompt_item("implement-ui-from-sketch", "Implement UI from a shared Excalidraw sketch"),
        prompt_item("explain-architecture-sketch", "Explain an architecture sketch"),
        prompt_item("turn-sketch-into-ticket", "Turn a sketch into an implementation ticket"),
        prompt_item("review-flow-from-sketch", "Review a flow from a sketch"),
        prompt_item("generate-acceptance-criteria-from-sketch", "Generate acceptance criteria from a sketch")
    ])
}

fn mcp_get_prompt(name: &str) -> Result<Value, Value> {
    let text = match name {
        "implement-ui-from-sketch" => "Use personal-excalidraw. First call list_recent_shares, choose the matching share, read brief and image, then read selection.json only when exact structure is needed. Infer layout, components, states, and interactions before coding.",
        "explain-architecture-sketch" => "Use personal-excalidraw. Read brief and image first, then explain the architecture, data flow, boundaries, assumptions, and open questions.",
        "turn-sketch-into-ticket" => "Use personal-excalidraw. Read the sketch and produce a scoped ticket with context, requirements, acceptance criteria, and risks.",
        "review-flow-from-sketch" => "Use personal-excalidraw. Review the shared flow for missing states, edge cases, confusing paths, and implementation risks.",
        "generate-acceptance-criteria-from-sketch" => "Use personal-excalidraw. Convert the sketch into Given/When/Then acceptance criteria, including visual states and interaction behavior.",
        _ => return Err(mcp_error(-32602, "unknown prompt")),
    };
    Ok(json!({
        "description": text,
        "messages": [{
            "role": "user",
            "content": { "type": "text", "text": text }
        }]
    }))
}

fn http_share_asset(state: &AgentShareState, share_id: &str, kind: ShareAssetKind) -> Vec<u8> {
    let Ok(mut registry) = state.registry.lock() else {
        return json_response("500 Internal Server Error", json!({ "error": "state_lock_failed" }));
    };
    if kind == ShareAssetKind::Manifest {
        return match registry.store.read_manifest(share_id) {
            Ok(manifest) => json_response("200 OK", json!(manifest)),
            Err(error) => share_error_response(error),
        };
    }
    match registry.store.read_asset(share_id, kind) {
        Ok(bytes) => http_response(
            "200 OK",
            kind.mime_type(),
            bytes,
            if kind == ShareAssetKind::RenderPng {
                &[("Content-Disposition", "inline; filename=\"render.png\"")]
            } else {
                &[]
            },
        ),
        Err(error) => share_error_response(error),
    }
}

fn http_current_selection_asset(state: &AgentShareState, kind: ShareAssetKind) -> Vec<u8> {
    let Ok(registry) = state.registry.lock() else {
        return json_response("500 Internal Server Error", json!({ "error": "state_lock_failed" }));
    };
    let Some(share) = registry
        .current_selection
        .as_ref()
        .filter(|_| registry.expose_current_selection)
    else {
        return json_response("404 Not Found", json!({ "error": "current_selection_not_exposed" }));
    };
    let bytes = match current_selection_bytes(share, kind) {
        Some(bytes) => bytes,
        None => return json_response("404 Not Found", json!({ "error": "asset_not_found" })),
    };
    http_response("200 OK", kind.mime_type(), bytes, &[])
}

fn current_selection_resource(uri: &str, share: &AgentShareInput, kind: ShareAssetKind) -> Value {
    match kind {
        ShareAssetKind::RenderPng => binary_resource(uri, "image/png", share.render_png.clone()),
        ShareAssetKind::Manifest => text_resource(
            uri,
            "application/json",
            pretty_json(&manifest_from_input(share, share_assets("current-selection"))),
        ),
        ShareAssetKind::SelectionJson => {
            text_resource(uri, "application/json", pretty_json(&share.selection_json))
        }
        ShareAssetKind::Brief => text_resource(uri, "text/markdown", share.brief_md.clone()),
        ShareAssetKind::SceneExcalidraw => {
            text_resource(uri, "application/json", share.scene_excalidraw.clone())
        }
        ShareAssetKind::RenderSvg => text_resource(uri, "image/svg+xml", share.render_svg.clone()),
    }
}

fn current_selection_bytes(share: &AgentShareInput, kind: ShareAssetKind) -> Option<Vec<u8>> {
    match kind {
        ShareAssetKind::Manifest => serde_json::to_vec_pretty(&manifest_from_input(
            share,
            share_assets("current-selection"),
        ))
        .ok(),
        ShareAssetKind::Brief => Some(share.brief_md.clone().into_bytes()),
        ShareAssetKind::SelectionJson => serde_json::to_vec_pretty(&share.selection_json).ok(),
        ShareAssetKind::SceneExcalidraw => Some(share.scene_excalidraw.clone().into_bytes()),
        ShareAssetKind::RenderPng => Some(share.render_png.clone()),
        ShareAssetKind::RenderSvg => Some(share.render_svg.clone().into_bytes()),
    }
}

fn current_selection_summary(share: &AgentShareInput) -> AgentShareSummary {
    AgentShareSummary {
        share_id: share.share_id.clone(),
        title: share.title.clone(),
        description: share.description.clone(),
        labels: share.labels.clone(),
        scope: share.scope.clone(),
        scene_id: share.scene_id.clone(),
        source_file: share.source_file.clone(),
        created_at: share.created_at.clone(),
        updated_at: share.updated_at.clone(),
        expires_at: share.expires_at.clone(),
        status: ShareStatus::Active,
        visibility: ShareVisibility::Local,
        text_preview: share.text_preview.clone(),
        last_read_at: None,
    }
}

fn manifest_from_input(share: &AgentShareInput, assets: ShareAssets) -> AgentShareManifest {
    AgentShareManifest {
        schema_version: 1,
        share_id: share.share_id.clone(),
        title: share.title.clone(),
        description: share.description.clone(),
        labels: share.labels.clone(),
        scope: share.scope.clone(),
        scene_id: share.scene_id.clone(),
        source_file: share.source_file.clone(),
        created_at: share.created_at.clone(),
        updated_at: share.updated_at.clone(),
        expires_at: share.expires_at.clone(),
        expires_at_ms: share.expires_at_ms,
        status: ShareStatus::Active,
        visibility: ShareVisibility::Local,
        origin_device_id: "local".to_owned(),
        owner_name: whoami_fallback(),
        sync_mode: "snapshot".to_owned(),
        permissions: vec!["read".to_owned()],
        selection: share.selection.clone(),
        text_preview: share.text_preview.clone(),
        assets,
    }
}

fn http_response(
    status: &str,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: &[(&str, &str)],
) -> Vec<u8> {
    let mut headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, Mcp-Session-Id\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n",
        body.len()
    );
    for (key, value) in extra_headers {
        headers.push_str(key);
        headers.push_str(": ");
        headers.push_str(value);
        headers.push_str("\r\n");
    }
    headers.push_str("\r\n");

    let mut response = headers.into_bytes();
    response.extend(body);
    response
}

fn json_response(status: &str, body: Value) -> Vec<u8> {
    http_response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec_pretty(&body).unwrap_or_else(|_| b"{}".to_vec()),
        &[],
    )
}

fn share_error_response(error: AgentShareError) -> Vec<u8> {
    match error {
        AgentShareError::NotFound => {
            json_response("404 Not Found", json!({ "error": "share_not_found" }))
        }
        AgentShareError::ShareExpired => {
            json_response("410 Gone", json!({ "error": "share_expired" }))
        }
        AgentShareError::ShareRevoked => {
            json_response("410 Gone", json!({ "error": "share_revoked" }))
        }
        AgentShareError::InvalidInput(message) => {
            json_response("400 Bad Request", json!({ "error": "invalid_input", "message": message }))
        }
        AgentShareError::Io(message) | AgentShareError::Json(message) => {
            json_response("500 Internal Server Error", json!({ "error": "share_store_error", "message": message }))
        }
    }
}

fn text_resource(uri: &str, mime_type: &str, text: String) -> Value {
    json!({
        "contents": [{
            "uri": uri,
            "mimeType": mime_type,
            "text": text
        }]
    })
}

fn binary_resource(uri: &str, mime_type: &str, bytes: Vec<u8>) -> Value {
    json!({
        "contents": [{
            "uri": uri,
            "mimeType": mime_type,
            "blob": general_purpose::STANDARD.encode(bytes)
        }]
    })
}

fn tool_text(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn mcp_error(code: i64, message: &str) -> Value {
    json!({ "code": code, "message": message })
}

fn resource(uri: &str, name: &str, mime_type: &str) -> Value {
    json!({ "uri": uri, "name": name, "mimeType": mime_type })
}

fn prompt_item(name: &str, description: &str) -> Value {
    json!({ "name": name, "description": description })
}

fn mcp_resources_for_share(share_id: &str, title: &str) -> Vec<Value> {
    vec![
        resource(
            &format!("excalidraw://shares/{share_id}/manifest"),
            &format!("{title} manifest"),
            "application/json",
        ),
        resource(
            &format!("excalidraw://shares/{share_id}/brief"),
            &format!("{title} brief"),
            "text/markdown",
        ),
        resource(
            &format!("excalidraw://shares/{share_id}/selection"),
            &format!("{title} selection JSON"),
            "application/json",
        ),
        resource(
            &format!("excalidraw://shares/{share_id}/image.png"),
            &format!("{title} PNG"),
            "image/png",
        ),
        resource(
            &format!("excalidraw://shares/{share_id}/image.svg"),
            &format!("{title} SVG"),
            "image/svg+xml",
        ),
        resource(
            &format!("excalidraw://shares/{share_id}/scene.excalidraw"),
            &format!("{title} Excalidraw scene"),
            "application/json",
        ),
    ]
}

fn parse_share_resource_uri(uri: &str) -> Option<(String, ShareAssetKind)> {
    let prefix = "excalidraw://shares/";
    let rest = uri.strip_prefix(prefix)?;
    let (share_id, resource) = rest.split_once('/')?;
    let kind = match resource {
        "manifest" => ShareAssetKind::Manifest,
        "brief" => ShareAssetKind::Brief,
        "selection" => ShareAssetKind::SelectionJson,
        "image.png" => ShareAssetKind::RenderPng,
        "image.svg" => ShareAssetKind::RenderSvg,
        "scene.excalidraw" => ShareAssetKind::SceneExcalidraw,
        _ => return None,
    };
    Some((share_id.to_owned(), kind))
}

fn parse_current_selection_resource_uri(uri: &str) -> Option<ShareAssetKind> {
    let resource = uri.strip_prefix("excalidraw://current-selection/")?;
    match resource {
        "manifest" => Some(ShareAssetKind::Manifest),
        "brief" => Some(ShareAssetKind::Brief),
        "selection" => Some(ShareAssetKind::SelectionJson),
        "image.png" => Some(ShareAssetKind::RenderPng),
        "image.svg" => Some(ShareAssetKind::RenderSvg),
        "scene.excalidraw" => Some(ShareAssetKind::SceneExcalidraw),
        _ => None,
    }
}

fn origin_allowed(headers: &HashMap<String, String>, port: Option<u16>) -> bool {
    let Some(origin) = headers.get("origin") else {
        return true;
    };
    if origin == "null" || origin.starts_with("tauri://") {
        return true;
    }
    if origin == "http://localhost" || origin == "http://127.0.0.1" {
        return true;
    }
    if let Some(port) = port {
        return origin == &format!("http://localhost:{port}")
            || origin == &format!("http://127.0.0.1:{port}");
    }
    false
}

fn share_assets(share_id: &str) -> ShareAssets {
    let base_path = if share_id == "current-selection" {
        "/v1/current-selection".to_owned()
    } else {
        format!("/v1/shares/{share_id}")
    };
    ShareAssets {
        manifest: format!("{base_path}/manifest"),
        brief: format!("{base_path}/brief.md"),
        selection_json: format!("{base_path}/selection.json"),
        excalidraw: format!("{base_path}/scene.excalidraw"),
        png: format!("{base_path}/render.png"),
        svg: format!("{base_path}/render.svg"),
    }
}

fn summary_from_manifest(
    manifest: &AgentShareManifest,
    last_read_at: Option<String>,
) -> AgentShareSummary {
    AgentShareSummary {
        share_id: manifest.share_id.clone(),
        title: manifest.title.clone(),
        description: manifest.description.clone(),
        labels: manifest.labels.clone(),
        scope: manifest.scope.clone(),
        scene_id: manifest.scene_id.clone(),
        source_file: manifest.source_file.clone(),
        created_at: manifest.created_at.clone(),
        updated_at: manifest.updated_at.clone(),
        expires_at: manifest.expires_at.clone(),
        status: manifest.status.clone(),
        visibility: manifest.visibility.clone(),
        text_preview: manifest.text_preview.clone(),
        last_read_at,
    }
}

fn validate_share_id(share_id: &str) -> Result<(), AgentShareError> {
    if share_id.is_empty()
        || !share_id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '-')
    {
        return Err(AgentShareError::InvalidInput(
            "shareId must contain only ASCII letters, numbers, _ or -".to_owned(),
        ));
    }
    Ok(())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), AgentShareError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AgentShareError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension(format!("tmp.{}", current_ms()));
    fs::write(&tmp_path, bytes)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

fn append_atomic(path: &Path, bytes: &[u8]) -> Result<(), AgentShareError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

pub fn current_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn iso_now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| format!("{}", current_ms()))
}

fn whoami_fallback() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "local".to_owned())
}

fn pretty_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{fs, path::PathBuf};

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "personal-excalidraw-agent-share-test-{}-{}",
            name,
            current_ms()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn sample_share(id: &str) -> AgentShareInput {
        AgentShareInput {
            share_id: id.to_owned(),
            scope: ShareScope::Selection,
            title: "Checkout redesign sketch".to_owned(),
            description: "Error and loading states".to_owned(),
            labels: vec!["checkout".to_owned(), "ui".to_owned()],
            scene_id: "scene-1".to_owned(),
            source_file: "scenes/checkout.excalidraw".to_owned(),
            created_at: "2026-05-25T10:00:00.000Z".to_owned(),
            updated_at: "2026-05-25T10:00:00.000Z".to_owned(),
            expires_at: "2026-06-01T10:00:00.000Z".to_owned(),
            expires_at_ms: current_ms() + DEFAULT_SHARE_TTL_MS as u128,
            selection: ShareSelectionSummary {
                element_ids: vec!["el-1".to_owned()],
                bounds: ShareBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 1200.0,
                    height: 800.0,
                },
                text: vec!["Primary CTA".to_owned()],
            },
            text_preview: vec!["Primary CTA".to_owned()],
            selection_json: json!({ "shareId": id, "selection": { "elementIds": ["el-1"] } }),
            scene_excalidraw: "{\"type\":\"excalidraw\"}".to_owned(),
            render_svg: "<svg></svg>".to_owned(),
            render_png: vec![137, 80, 78, 71],
            brief_md: "# Checkout redesign sketch\n".to_owned(),
        }
    }

    #[test]
    fn persisted_share_round_trips_and_rename_preserves_id() {
        let root = temp_root("round-trip");
        let mut store = AgentShareStore::new(root.clone()).expect("store");
        store.register_share(sample_share("sh_test")).expect("register");

        let summaries = store.list_recent_shares().expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].share_id, "sh_test");
        assert_eq!(summaries[0].title, "Checkout redesign sketch");
        assert_eq!(summaries[0].status, ShareStatus::Active);

        store
            .update_share_metadata(
                "sh_test",
                ShareMetadataPatch {
                    title: Some("Renamed checkout sketch".to_owned()),
                    description: Some("New description".to_owned()),
                    labels: Some(vec!["renamed".to_owned()]),
                },
            )
            .expect("rename");

        let manifest = store.read_manifest("sh_test").expect("manifest");
        assert_eq!(manifest.share_id, "sh_test");
        assert_eq!(manifest.title, "Renamed checkout sketch");
        assert!(root.join("sh_test").join("manifest.json").exists());
    }

    #[test]
    fn revoke_and_delete_change_readability_and_files() {
        let root = temp_root("revoke-delete");
        let mut store = AgentShareStore::new(root.clone()).expect("store");
        store.register_share(sample_share("sh_test")).expect("register");

        store.revoke_share("sh_test").expect("revoke");
        assert_eq!(
            store
                .read_asset("sh_test", ShareAssetKind::Brief)
                .unwrap_err(),
            AgentShareError::ShareRevoked
        );

        store.delete_share("sh_test").expect("delete");
        assert!(!root.join("sh_test").exists());
        assert!(store.list_recent_shares().expect("list").is_empty());
    }

    #[test]
    fn expired_share_is_not_readable_but_can_be_cleaned() {
        let root = temp_root("expired");
        let mut store = AgentShareStore::new(root.clone()).expect("store");
        let mut share = sample_share("sh_expired");
        share.expires_at_ms = current_ms().saturating_sub(1);
        share.expires_at = "2026-05-24T10:00:00.000Z".to_owned();
        store.register_share(share).expect("register");

        assert_eq!(
            store
                .read_asset("sh_expired", ShareAssetKind::Brief)
                .unwrap_err(),
            AgentShareError::ShareExpired
        );
        assert_eq!(store.clean_expired().expect("clean"), 1);
        assert!(!root.join("sh_expired").exists());
    }

    #[test]
    fn http_assets_do_not_require_authorization_and_log_reads() {
        let root = temp_root("http-assets");
        let state = AgentShareState::new(root).expect("state");
        {
            let mut registry = state.registry.lock().expect("registry");
            registry
                .store
                .register_share(sample_share("sh_test"))
                .expect("register");
        }

        let response = handle_agent_share_request(
            "GET",
            "/v1/shares/sh_test/brief.md",
            &HashMap::new(),
            &[],
            &state,
        );
        let text = String::from_utf8_lossy(&response);
        assert!(text.starts_with("HTTP/1.1 200 OK"));
        assert!(text.contains("# Checkout redesign sketch"));
    }

    #[test]
    fn mcp_initialize_and_list_recent_shares_tool_work() {
        let root = temp_root("mcp");
        let state = AgentShareState::new(root).expect("state");
        {
            let mut registry = state.registry.lock().expect("registry");
            registry
                .store
                .register_share(sample_share("sh_test"))
                .expect("register");
        }

        let initialize = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0.0.0" }
            }
        })
        .to_string();
        let response = handle_agent_share_request(
            "POST",
            "/mcp",
            &HashMap::new(),
            initialize.as_bytes(),
            &state,
        );
        let text = String::from_utf8_lossy(&response);
        assert!(text.contains("\"protocolVersion\""));
        assert!(text.contains("\"resources\""));
        assert!(text.contains("\"tools\""));
        assert!(text.contains("\"prompts\""));

        let call = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": "list_recent_shares", "arguments": {} }
        })
        .to_string();
        let response =
            handle_agent_share_request("POST", "/mcp", &HashMap::new(), call.as_bytes(), &state);
        let text = String::from_utf8_lossy(&response);
        assert!(text.contains("sh_test"));
        assert!(text.contains("Checkout redesign sketch"));
    }
}
