use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use walkdir::WalkDir;

const META_DIR: &str = ".personal-excalidraw";
const AGENT_SHARE_DEFAULT_PORT: u16 = 37411;

#[derive(Serialize)]
struct NativeFileEntry {
    #[serde(rename = "relativePath")]
    relative_path: String,
    name: String,
    text: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    #[serde(rename = "modifiedMs")]
    modified_ms: u128,
}

#[derive(Serialize)]
struct PickedTextFile {
    name: String,
    text: String,
}

#[derive(Serialize)]
struct WorkspaceTreeEntry {
    kind: String,
    #[serde(rename = "relativePath")]
    relative_path: String,
    name: String,
    #[serde(rename = "sizeBytes", skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(rename = "modifiedMs", skip_serializing_if = "Option::is_none")]
    modified_ms: Option<u128>,
}

#[derive(Clone, Deserialize, Serialize)]
struct AgentShare {
    #[serde(rename = "shareId")]
    share_id: String,
    scope: String,
    title: String,
    #[serde(rename = "sceneId")]
    scene_id: String,
    #[serde(rename = "sourceFile")]
    source_file: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
    #[serde(rename = "expiresAtMs")]
    expires_at_ms: u128,
    manifest: serde_json::Value,
    #[serde(rename = "selectionJson")]
    selection_json: serde_json::Value,
    #[serde(rename = "sceneExcalidraw")]
    scene_excalidraw: String,
    #[serde(rename = "renderSvg")]
    render_svg: String,
    #[serde(rename = "renderPng")]
    render_png: Vec<u8>,
    #[serde(rename = "briefMd")]
    brief_md: String,
}

#[derive(Serialize)]
struct AgentShareSummary {
    #[serde(rename = "shareId")]
    share_id: String,
    scope: String,
    title: String,
    #[serde(rename = "sceneId")]
    scene_id: String,
    #[serde(rename = "sourceFile")]
    source_file: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
}

#[derive(Serialize)]
struct AgentShareStatus {
    enabled: bool,
    port: Option<u16>,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    token: Option<String>,
    #[serde(rename = "shareCount")]
    share_count: usize,
    #[serde(rename = "startedAtMs")]
    started_at_ms: Option<u128>,
}

struct AgentShareServer {
    port: u16,
    token: String,
    started_at_ms: u128,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct AgentShareRegistry {
    server: Option<AgentShareServer>,
    shares: HashMap<String, AgentShare>,
    audit: Vec<String>,
}

#[derive(Clone, Default)]
struct AgentShareState {
    registry: Arc<Mutex<AgentShareRegistry>>,
}

fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("absolute paths are not allowed inside a workspace".into());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir => return Err("parent traversal is not allowed".into()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("invalid workspace-relative path".into())
            }
        }
    }

    Ok(normalized)
}

fn workspace_path(root_path: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path);
    if !root.is_absolute() {
        return Err("workspace root must be an absolute path".into());
    }

    Ok(root.join(normalize_relative_path(relative_path)?))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    ensure_parent(path)?;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let tmp_path = path.with_file_name(format!(".{}.{}.tmp", filename, millis));
    fs::write(&tmp_path, bytes).map_err(|error| error.to_string())?;
    fs::rename(&tmp_path, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn modified_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn current_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_err()
    {
        let fallback = format!("{}-{}", current_ms(), std::process::id());
        for (index, byte) in fallback.as_bytes().iter().enumerate() {
            bytes[index % bytes.len()] ^= *byte;
        }
    }

    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn agent_share_status_from_registry(registry: &AgentShareRegistry) -> AgentShareStatus {
    let share_count = registry
        .shares
        .values()
        .filter(|share| !share_expired(share))
        .count();

    if let Some(server) = &registry.server {
        AgentShareStatus {
            enabled: true,
            port: Some(server.port),
            base_url: Some(format!("http://127.0.0.1:{}", server.port)),
            token: Some(server.token.clone()),
            share_count,
            started_at_ms: Some(server.started_at_ms),
        }
    } else {
        AgentShareStatus {
            enabled: false,
            port: None,
            base_url: None,
            token: None,
            share_count,
            started_at_ms: None,
        }
    }
}

fn share_expired(share: &AgentShare) -> bool {
    share.expires_at_ms <= current_ms()
}

fn share_summary(share: &AgentShare) -> AgentShareSummary {
    AgentShareSummary {
        share_id: share.share_id.clone(),
        scope: share.scope.clone(),
        title: share.title.clone(),
        scene_id: share.scene_id.clone(),
        source_file: share.source_file.clone(),
        created_at: share.created_at.clone(),
        expires_at: share.expires_at.clone(),
    }
}

fn http_response(
    status: &str,
    content_type: &str,
    body: Vec<u8>,
    extra_headers: &[(&str, &str)],
) -> Vec<u8> {
    let mut headers = format!(
    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nConnection: close\r\n",
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

fn json_response(status: &str, body: serde_json::Value) -> Vec<u8> {
    http_response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec_pretty(&body).unwrap_or_else(|_| b"{}".to_vec()),
        &[],
    )
}

fn text_response(status: &str, content_type: &str, body: String) -> Vec<u8> {
    http_response(status, content_type, body.into_bytes(), &[])
}

fn parse_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>), String> {
    let mut buffer = [0u8; 8192];
    let size = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..size]);
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
    Ok((method, path, headers))
}

fn authorized(headers: &HashMap<String, String>, token: &str) -> bool {
    headers
        .get("authorization")
        .map(|value| value == &format!("Bearer {token}"))
        .unwrap_or(false)
}

fn handle_agent_share_request(
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    registry: &mut AgentShareRegistry,
) -> Vec<u8> {
    if method == "OPTIONS" {
        return http_response("204 No Content", "text/plain", Vec::new(), &[]);
    }

    if method != "GET" {
        return json_response(
            "405 Method Not Allowed",
            json!({ "error": "method_not_allowed" }),
        );
    }

    if path == "/health" {
        return json_response("200 OK", json!({ "ok": true }));
    }

    let token = match &registry.server {
        Some(server) => server.token.clone(),
        None => {
            return json_response(
                "503 Service Unavailable",
                json!({ "error": "agent_share_server_disabled" }),
            )
        }
    };

    if !authorized(headers, &token) {
        return json_response("401 Unauthorized", json!({ "error": "unauthorized" }));
    }

    registry.shares.retain(|_, share| !share_expired(share));

    if path == "/v1/status" {
        return json_response("200 OK", json!(agent_share_status_from_registry(registry)));
    }

    if path == "/v1/shares" {
        let summaries = registry
            .shares
            .values()
            .map(share_summary)
            .collect::<Vec<_>>();
        return json_response("200 OK", json!({ "shares": summaries }));
    }

    let trimmed = path.trim_start_matches('/');
    let parts = trimmed.split('/').collect::<Vec<_>>();
    if parts.len() == 4 && parts[0] == "v1" && parts[1] == "shares" {
        let share_id = parts[2];
        let asset = parts[3];
        let Some(share) = registry.shares.get(share_id) else {
            return json_response("404 Not Found", json!({ "error": "share_not_found" }));
        };

        registry
            .audit
            .push(format!("{} GET {}", current_ms(), path));
        return match asset {
            "manifest" => json_response("200 OK", share.manifest.clone()),
            "selection.json" => json_response("200 OK", share.selection_json.clone()),
            "scene.excalidraw" => text_response(
                "200 OK",
                "application/json; charset=utf-8",
                share.scene_excalidraw.clone(),
            ),
            "brief.md" => text_response(
                "200 OK",
                "text/markdown; charset=utf-8",
                share.brief_md.clone(),
            ),
            "render.svg" => text_response(
                "200 OK",
                "image/svg+xml; charset=utf-8",
                share.render_svg.clone(),
            ),
            "render.png" => http_response(
                "200 OK",
                "image/png",
                share.render_png.clone(),
                &[("Content-Disposition", "inline; filename=\"render.png\"")],
            ),
            _ => json_response("404 Not Found", json!({ "error": "asset_not_found" })),
        };
    }

    if path == "/mcp" {
        return json_response(
            "501 Not Implemented",
            json!({
              "error": "mcp_transport_not_implemented",
              "message": "The read-only HTTP share API is available now. MCP resources/tools/prompts are planned on top of this registry."
            }),
        );
    }

    json_response("404 Not Found", json!({ "error": "not_found" }))
}

fn serve_agent_shares(
    listener: TcpListener,
    registry: Arc<Mutex<AgentShareRegistry>>,
    stop: Arc<AtomicBool>,
) {
    let _ = listener.set_nonblocking(true);
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let response = match parse_http_request(&mut stream) {
                    Ok((method, path, headers)) => {
                        let mut registry = registry.lock().expect("agent share registry poisoned");
                        handle_agent_share_request(&method, &path, &headers, &mut registry)
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

fn relative_slash_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(segment) => segment.to_str().map(ToOwned::to_owned),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/"))
}

#[tauri::command]
fn ensure_directory(root_path: String, relative_path: String) -> Result<(), String> {
    let path = workspace_path(&root_path, &relative_path)?;
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_text_file(root_path: String, relative_path: String) -> Result<String, String> {
    let path = workspace_path(&root_path, &relative_path)?;
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_binary_file(root_path: String, relative_path: String) -> Result<Vec<u8>, String> {
    let path = workspace_path(&root_path, &relative_path)?;
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(
    root_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = workspace_path(&root_path, &relative_path)?;
    write_atomic(&path, content.as_bytes())
}

#[tauri::command]
fn write_binary_file(
    root_path: String,
    relative_path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let path = workspace_path(&root_path, &relative_path)?;
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn write_absolute_text_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("export path must be absolute".into());
    }
    write_atomic(&path, content.as_bytes())
}

#[tauri::command]
fn write_absolute_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("export path must be absolute".into());
    }
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn remove_entry(root_path: String, relative_path: String, recursive: bool) -> Result<(), String> {
    let path = workspace_path(&root_path, &relative_path)?;
    if path.is_dir() {
        if recursive {
            fs::remove_dir_all(path).map_err(|error| error.to_string())
        } else {
            fs::remove_dir(path).map_err(|error| error.to_string())
        }
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn walk_excalidraw_files(root_path: String) -> Result<Vec<NativeFileEntry>, String> {
    let root = PathBuf::from(&root_path);
    if !root.is_absolute() {
        return Err("workspace root must be an absolute path".into());
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != META_DIR)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("excalidraw") {
            continue;
        }

        let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        files.push(NativeFileEntry {
            relative_path: relative_slash_path(&root, path)?,
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled.excalidraw")
                .to_owned(),
            text,
            size_bytes: metadata.len(),
            modified_ms: modified_ms(path),
        });
    }

    Ok(files)
}

#[tauri::command]
fn list_workspace_entries(root_path: String) -> Result<Vec<WorkspaceTreeEntry>, String> {
    let root = PathBuf::from(&root_path);
    if !root.is_absolute() {
        return Err("workspace root must be an absolute path".into());
    }

    let mut entries = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != META_DIR)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative_path = relative_slash_path(&root, path)?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_owned();

        if path.is_dir() {
            entries.push(WorkspaceTreeEntry {
                kind: "directory".into(),
                relative_path,
                name,
                size_bytes: None,
                modified_ms: None,
            });
        } else if path.is_file()
            && path.extension().and_then(|ext| ext.to_str()) == Some("excalidraw")
        {
            let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
            entries.push(WorkspaceTreeEntry {
                kind: "file".into(),
                relative_path,
                name,
                size_bytes: Some(metadata.len()),
                modified_ms: Some(modified_ms(path)),
            });
        }
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

#[tauri::command]
fn read_absolute_text_files(paths: Vec<String>) -> Result<Vec<PickedTextFile>, String> {
    paths
        .into_iter()
        .map(|path| {
            let path = PathBuf::from(path);
            if path.extension().and_then(|ext| ext.to_str()) != Some("excalidraw") {
                return Err("only .excalidraw files can be imported".into());
            }
            Ok(PickedTextFile {
                name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Imported.excalidraw")
                    .to_owned(),
                text: fs::read_to_string(path).map_err(|error| error.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
fn agent_share_status(state: State<AgentShareState>) -> Result<AgentShareStatus, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.shares.retain(|_, share| !share_expired(share));
    Ok(agent_share_status_from_registry(&registry))
}

#[tauri::command]
fn start_agent_share_server(
    state: State<AgentShareState>,
    port: Option<u16>,
) -> Result<AgentShareStatus, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.shares.retain(|_, share| !share_expired(share));
    if registry.server.is_some() {
        return Ok(agent_share_status_from_registry(&registry));
    }

    let requested_port = port.unwrap_or(AGENT_SHARE_DEFAULT_PORT);
    let listener = TcpListener::bind(("127.0.0.1", requested_port))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|error| error.to_string())?;
    let actual_port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = random_token();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_registry = state.registry.clone();
    let handle = thread::spawn(move || serve_agent_shares(listener, thread_registry, thread_stop));

    registry.server = Some(AgentShareServer {
        port: actual_port,
        token,
        started_at_ms: current_ms(),
        stop,
        handle: Some(handle),
    });
    Ok(agent_share_status_from_registry(&registry))
}

#[tauri::command]
fn stop_agent_share_server(state: State<AgentShareState>) -> Result<AgentShareStatus, String> {
    let handle = {
        let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
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
    registry.shares.clear();
    registry.audit.clear();
    Ok(agent_share_status_from_registry(&registry))
}

#[tauri::command]
fn register_agent_share(
    state: State<AgentShareState>,
    share: AgentShare,
) -> Result<AgentShareStatus, String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    if registry.server.is_none() {
        return Err("Agent Sharing API is off. Turn it on before creating a share.".into());
    }
    registry.shares.retain(|_, share| !share_expired(share));
    registry.shares.insert(share.share_id.clone(), share);
    Ok(agent_share_status_from_registry(&registry))
}

pub fn run() {
    tauri::Builder::default()
        .manage(AgentShareState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let window = if let Some(window) = app.get_webview_window("main") {
                window
            } else {
                let window_config = app
                    .config()
                    .app
                    .windows
                    .first()
                    .expect("missing main window config")
                    .clone();
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?.build()?
            };
            window.show()?;
            window.set_focus()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_directory,
            read_text_file,
            read_binary_file,
            write_text_file,
            write_binary_file,
            write_absolute_text_file,
            write_absolute_binary_file,
            remove_entry,
            walk_excalidraw_files,
            list_workspace_entries,
            read_absolute_text_files,
            agent_share_status,
            start_agent_share_server,
            stop_agent_share_server,
            register_agent_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Personal Excalidraw");
}
