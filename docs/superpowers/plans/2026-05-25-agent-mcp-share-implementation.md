# Agent MCP Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement local-only, persistent, named Excalidraw Agent Shares that Codex/Claude Code can discover and read through HTTP/MCP.

**Architecture:** Move Agent Sharing out of `lib.rs` into a focused Rust module that owns persistent share storage, local HTTP serving, and MCP JSON-RPC handling. React remains responsible for extracting the active Excalidraw selection/file and rendering PNG/SVG assets, then calls typed Tauri commands to register, manage, and expose shares. UI adds a settings/manager surface and menu-bar commands; V1 stays local-only, read-only, no bearer token.

**Tech Stack:** Tauri 2, Rust std HTTP server, serde/serde_json, React 19, TypeScript, Excalidraw export APIs, lucide-react.

---

## Scope Check

This is one implementable feature slice: local Agent Sharing. LAN share and peer-to-peer sync stay out of scope except for reserved manifest fields.

Primary spec: `docs/superpowers/specs/2026-05-25-excalidraw-agent-mcp-share-design.md`.

Protocol references used while planning:

- Codex supports MCP Streamable HTTP servers through `mcp_servers.<id>.url` in `config.toml`.
- MCP Streamable HTTP uses a single `/mcp` endpoint with JSON-RPC POST requests, and local servers should bind to localhost and validate `Origin`.
- MCP resources use `resources/list` and `resources/read`; tools use `tools/list` and `tools/call`; prompts use `prompts/list` and `prompts/get`.

## File Structure

- Modify `app/src-tauri/src/lib.rs`: keep workspace/file commands, wire in the new `agent_sharing` module, initialize state with App data dir, register Tauri commands, and attach menu events.
- Create `app/src-tauri/src/agent_sharing.rs`: data model, persistence, status, share CRUD, current-selection runtime state, audit log, local HTTP server, MCP JSON-RPC handlers, and Rust unit tests.
- Modify `app/src/agentSharing.ts`: remove token fields, add share metadata types and management commands.
- Modify `app/src/App.tsx`: generate spec-compliant share manifests, use 7-day TTL, remove bearer-token setup, add expose-current-selection state, add Shares Manager UI, listen for menu events.
- Modify `app/src/styles.css`: styles for the manager table/forms and revised settings layout.
- Modify `target-1-personal-mac-app/AGENT_SHARING.md`: align docs with persistent local-only no-token V1.
- Modify `target-1-personal-mac-app/ARCHITECTURE.md`: align Agent Sharing architecture with persistent App data store and MCP.

Do not modify the upstream `excalidraw/` package.

---

## Task 1: Rust Agent Share Persistence Module

**Files:**
- Create: `app/src-tauri/src/agent_sharing.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Test: `app/src-tauri/src/agent_sharing.rs`

- [ ] **Step 1: Write failing Rust persistence tests**

Create `app/src-tauri/src/agent_sharing.rs` with the public types and these tests at the bottom. The implementation can initially return errors or empty values so the tests fail.

```rust
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
                bounds: ShareBounds { x: 0.0, y: 0.0, width: 1200.0, height: 800.0 },
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
            store.read_asset("sh_test", ShareAssetKind::Brief).unwrap_err(),
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
            store.read_asset("sh_expired", ShareAssetKind::Brief).unwrap_err(),
            AgentShareError::ShareExpired
        );
        assert_eq!(store.clean_expired().expect("clean"), 1);
        assert!(!root.join("sh_expired").exists());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test agent_sharing --lib
```

Expected: FAIL because `AgentShareStore`, `AgentShareInput`, and related types are not implemented yet.

- [ ] **Step 3: Implement the persistence module**

In `app/src-tauri/src/agent_sharing.rs`, implement these public types and methods. Use `serde` renames so TypeScript receives camelCase. Keep binary PNG on disk, not inside `index.json`.

```rust
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

pub const DEFAULT_AGENT_SHARE_PORT: u16 = 37411;
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
```

Implement `AgentShareStore` with:

```rust
pub struct AgentShareStore {
    root: PathBuf,
    index: AgentShareIndex,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
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
            AgentShareIndex { schema_version: 1, shares: Vec::new() }
        };
        Ok(Self { root, index })
    }

    pub fn register_share(&mut self, input: AgentShareInput) -> Result<AgentShareSummary, AgentShareError> {
        validate_share_id(&input.share_id)?;
        let share_dir = self.root.join(&input.share_id);
        fs::create_dir_all(&share_dir)?;
        let assets = share_assets(&input.share_id);
        let status = if input.expires_at_ms <= current_ms() { ShareStatus::Expired } else { ShareStatus::Active };
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
        write_atomic(&share_dir.join("scene.excalidraw"), input.scene_excalidraw.as_bytes())?;
        write_atomic(&share_dir.join("render.svg"), input.render_svg.as_bytes())?;
        write_atomic(&share_dir.join("render.png"), &input.render_png)?;
        write_atomic(&share_dir.join("brief.md"), input.brief_md.as_bytes())?;

        let summary = summary_from_manifest(&manifest, None);
        self.index.shares.retain(|share| share.share_id != input.share_id);
        self.index.shares.insert(0, summary.clone());
        self.save_index()?;
        Ok(summary)
    }

    pub fn list_recent_shares(&mut self) -> Result<Vec<AgentShareSummary>, AgentShareError> {
        let now = current_ms();
        for summary in &mut self.index.shares {
            if summary.status == ShareStatus::Active {
                if let Ok(manifest) = self.read_manifest_unchecked(&summary.share_id) {
                    if manifest.expires_at_ms <= now {
                        summary.status = ShareStatus::Expired;
                    }
                }
            }
        }
        self.save_index()?;
        Ok(self.index.shares.clone())
    }

    pub fn read_manifest(&mut self, share_id: &str) -> Result<AgentShareManifest, AgentShareError> {
        let manifest = self.read_manifest_unchecked(share_id)?;
        self.ensure_readable(&manifest)?;
        self.record_read(share_id, "manifest")?;
        Ok(manifest)
    }

    pub fn read_asset(&mut self, share_id: &str, kind: ShareAssetKind) -> Result<Vec<u8>, AgentShareError> {
        let manifest = self.read_manifest_unchecked(share_id)?;
        self.ensure_readable(&manifest)?;
        let path = self.share_asset_path(share_id, kind);
        let bytes = fs::read(path)?;
        self.record_read(share_id, kind.resource_name())?;
        Ok(bytes)
    }

    pub fn update_share_metadata(&mut self, share_id: &str, patch: ShareMetadataPatch) -> Result<AgentShareSummary, AgentShareError> {
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

    pub fn delete_share(&mut self, share_id: &str) -> Result<(), AgentShareError> {
        let path = self.root.join(share_id);
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        self.index.shares.retain(|share| share.share_id != share_id);
        self.save_index()
    }

    pub fn clean_expired(&mut self) -> Result<usize, AgentShareError> {
        let mut removed = 0;
        let ids = self
            .index
            .shares
            .iter()
            .filter_map(|summary| match self.read_manifest_unchecked(&summary.share_id) {
                Ok(manifest) if manifest.expires_at_ms <= current_ms() => Some(summary.share_id.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        for share_id in ids {
            self.delete_share(&share_id)?;
            removed += 1;
        }
        Ok(removed)
    }
}
```

Also implement private helpers: `validate_share_id`, `share_assets`, `summary_from_manifest`, `write_atomic`, `write_json_atomic`, `current_ms`, `iso_now`, `whoami_fallback`, `save_index`, `read_manifest_unchecked`, `ensure_readable`, `share_asset_path`, and `record_read`. Keep all helpers in `agent_sharing.rs`.

- [ ] **Step 4: Wire module state into `lib.rs`**

In `app/src-tauri/src/lib.rs`, add the module and replace old Agent Sharing structs/functions with re-exports from the module:

```rust
mod agent_sharing;

use agent_sharing::{
    agent_share_status,
    clean_expired_agent_shares,
    delete_agent_share,
    get_current_selection_share,
    list_agent_shares,
    register_agent_share,
    rename_agent_share,
    revoke_agent_share,
    revoke_all_agent_shares,
    set_current_selection_share,
    start_agent_share_server,
    stop_agent_share_server,
    AgentShareState,
};
```

Inside `.setup`, compute the App data share root and initialize state before commands are invoked:

```rust
let share_root = app
    .path()
    .app_data_dir()?
    .join("agent-shares");
app.manage(AgentShareState::new(share_root)?);
```

Remove `.manage(AgentShareState::default())` from the builder chain and add new commands to `generate_handler!`.

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test agent_sharing --lib
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app
git status --short
git add app/src-tauri/src/lib.rs app/src-tauri/src/agent_sharing.rs
git commit -m "feat: persist agent shares"
```

If this workspace is not a git repo, skip the commit in this path and commit the equivalent files in `/tmp/cusotmized-excalidraw-push`.

---

## Task 2: Local HTTP API And MCP JSON-RPC

**Files:**
- Modify: `app/src-tauri/src/agent_sharing.rs`
- Test: `app/src-tauri/src/agent_sharing.rs`

- [ ] **Step 1: Write failing tests for HTTP and MCP behavior**

Add these tests to `agent_sharing.rs`.

```rust
#[test]
fn http_assets_do_not_require_authorization_and_log_reads() {
    let root = temp_root("http-assets");
    let state = AgentShareState::new(root).expect("state");
    {
        let mut registry = state.registry.lock().expect("registry");
        registry.store.register_share(sample_share("sh_test")).expect("register");
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
        registry.store.register_share(sample_share("sh_test")).expect("register");
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
    let response = handle_agent_share_request("POST", "/mcp", &HashMap::new(), call.as_bytes(), &state);
    let text = String::from_utf8_lossy(&response);
    assert!(text.contains("sh_test"));
    assert!(text.contains("Checkout redesign sketch"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test agent_sharing --lib
```

Expected: FAIL because `handle_agent_share_request` does not yet accept body bytes or MCP methods.

- [ ] **Step 3: Update HTTP parsing**

Replace the current request parser with a body-aware parser:

```rust
fn parse_http_request(stream: &mut TcpStream) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let size = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if size == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n").unwrap() + 4;
            let headers_text = String::from_utf8_lossy(&buffer[..header_end]);
            let content_length = headers_text
                .lines()
                .find_map(|line| line.split_once(':'))
                .filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            while buffer.len() < header_end + content_length {
                let size = stream.read(&mut chunk).map_err(|error| error.to_string())?;
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
```

- [ ] **Step 4: Implement local HTTP endpoints without token**

Change `handle_agent_share_request` to:

- allow `GET /health` without checking server state;
- reject non-loopback browser origins with `403`;
- allow `GET /v1/status`, `/v1/shares`, share assets, and current-selection assets without `Authorization`;
- return `405` for `GET /mcp` if no SSE stream is implemented.

Use this origin helper:

```rust
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
        return origin == &format!("http://localhost:{port}") || origin == &format!("http://127.0.0.1:{port}");
    }
    false
}
```

- [ ] **Step 5: Implement MCP JSON-RPC handlers**

Add `handle_mcp_request(body, state)` and route `POST /mcp` to it. Support these methods:

```text
initialize
notifications/initialized
resources/list
resources/read
tools/list
tools/call
prompts/list
prompts/get
```

Return `application/json` JSON-RPC responses. For notifications with no `id`, return `202 Accepted`.

Tool definitions:

```rust
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
            "name": "get_current_selection_share",
            "title": "Get current selection share",
            "description": "Return the runtime current-selection manifest when Expose current selection is enabled.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}
```

Resource reads should return text content for manifest/brief/selection/scene/svg and base64 blob content for PNG:

```json
{
  "contents": [
    {
      "uri": "excalidraw://shares/sh_abc123/image.png",
      "mimeType": "image/png",
      "blob": "<base64>"
    }
  ]
}
```

Add the reviewed `base64` crate and use it for PNG resource payloads:

```toml
# app/src-tauri/Cargo.toml
[dependencies]
base64 = "0.22"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
walkdir = "2"
```

In `agent_sharing.rs`:

```rust
use base64::{engine::general_purpose, Engine as _};

fn binary_resource(uri: &str, mime_type: &str, bytes: Vec<u8>) -> Value {
    json!({
        "contents": [{
            "uri": uri,
            "mimeType": mime_type,
            "blob": general_purpose::STANDARD.encode(bytes)
        }]
    })
}
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test agent_sharing --lib
cargo build
```

Expected: both PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add app/src-tauri/src/agent_sharing.rs app/src-tauri/src/lib.rs app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock
git commit -m "feat: expose agent shares over local MCP"
```

---

## Task 3: TypeScript Client And Share Package Generation

**Files:**
- Modify: `app/src/agentSharing.ts`
- Modify: `app/src/App.tsx`
- Test: `npm run typecheck`

- [ ] **Step 1: Update TypeScript types**

Replace `app/src/agentSharing.ts` with a no-token API shape:

```ts
import { invoke } from "@tauri-apps/api/core";

export type ShareScope = "selection" | "scene";
export type ShareStatusValue = "active" | "expired" | "revoked";
export type ShareVisibility = "local" | "lan" | "peer";

export type ShareBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShareSelectionSummary = {
  elementIds: string[];
  bounds: ShareBounds;
  text: string[];
};

export type AgentShareStatus = {
  enabled: boolean;
  port?: number;
  baseUrl?: string;
  shareCount: number;
  startedAtMs?: number;
};

export type AgentShareSummary = {
  shareId: string;
  title: string;
  description: string;
  labels: string[];
  scope: ShareScope;
  sceneId: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: ShareStatusValue;
  visibility: ShareVisibility;
  textPreview: string[];
  lastReadAt?: string;
};

export type AgentSharePayload = {
  shareId: string;
  scope: ShareScope;
  title: string;
  description: string;
  labels: string[];
  sceneId: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  selection: ShareSelectionSummary;
  textPreview: string[];
  selectionJson: Record<string, unknown>;
  sceneExcalidraw: string;
  renderSvg: string;
  renderPng: number[];
  briefMd: string;
};

export type ShareMetadataPatch = {
  title?: string;
  description?: string;
  labels?: string[];
};

export const startAgentShareServer = (port?: number) =>
  invoke<AgentShareStatus>("start_agent_share_server", { port });

export const stopAgentShareServer = () =>
  invoke<AgentShareStatus>("stop_agent_share_server");

export const getAgentShareStatus = () =>
  invoke<AgentShareStatus>("agent_share_status");

export const registerAgentShare = (share: AgentSharePayload) =>
  invoke<AgentShareSummary>("register_agent_share", { share });

export const listAgentShares = () =>
  invoke<AgentShareSummary[]>("list_agent_shares");

export const renameAgentShare = (shareId: string, patch: ShareMetadataPatch) =>
  invoke<AgentShareSummary>("rename_agent_share", { shareId, patch });

export const revokeAgentShare = (shareId: string) =>
  invoke<void>("revoke_agent_share", { shareId });

export const deleteAgentShare = (shareId: string) =>
  invoke<void>("delete_agent_share", { shareId });

export const cleanExpiredAgentShares = () =>
  invoke<number>("clean_expired_agent_shares");

export const revokeAllAgentShares = () =>
  invoke<void>("revoke_all_agent_shares");

export const setCurrentSelectionShare = (share: AgentSharePayload | null) =>
  invoke<void>("set_current_selection_share", { share });

export const getCurrentSelectionShare = () =>
  invoke<AgentShareSummary | null>("get_current_selection_share");

export const blobToBytes = async (blob: Blob) =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));
```

- [ ] **Step 2: Update constants and imports in `App.tsx`**

Change:

```ts
const AGENT_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
```

Import the new functions:

```ts
import {
  blobToBytes,
  cleanExpiredAgentShares,
  deleteAgentShare,
  getAgentShareStatus,
  listAgentShares,
  registerAgentShare,
  renameAgentShare,
  revokeAgentShare,
  revokeAllAgentShares,
  setCurrentSelectionShare,
  startAgentShareServer,
  stopAgentShareServer,
  type AgentShareStatus,
  type AgentShareSummary,
} from "./agentSharing";
```

- [ ] **Step 3: Replace share generation with spec-compliant metadata**

In `shareActiveToAgent`, remove the `status.token` check and generate these fields:

```ts
const title = `${stem(sceneFilename(activeScene))} ${scope === "selection" ? "selection" : "scene"}`;
const description = `${scope === "selection" ? "Selected shapes" : "Full scene"} from ${activeScene.relativePath}`;
const labels: string[] = [];
const textPreview = text.slice(0, 12);
const selection = {
  elementIds: elementsToShare.map(elementId).filter((id): id is string => Boolean(id)),
  bounds,
  text,
};
```

Build the manifest-compatible `selectionJson` and `briefMd`:

```ts
const selectionJson = {
  schemaVersion: 1,
  shareId,
  title,
  description,
  labels,
  scope,
  sceneId: activeScene.id,
  sourceFile: activeScene.relativePath,
  selection: {
    ...selection,
    elements: elementsToShare,
  },
  files: draft.files,
};

const briefMd = [
  `# ${title}`,
  "",
  description,
  "",
  `Share ID: \`${shareId}\``,
  `Scope: \`${scope}\``,
  `Source file: \`${activeScene.relativePath}\``,
  `Created: ${createdAt.toISOString()}`,
  `Expires: ${expiresAt.toISOString()}`,
  "",
  "## Visual Context",
  "",
  `Bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`,
  `Elements: ${elementsToShare.length}`,
  "",
  "## Text Found",
  "",
  text.length ? text.map((item) => `- ${item}`).join("\n") : "- No text elements found.",
  "",
  "## Agent Instructions",
  "",
  "Use this share as read-only design context. Read this brief first, inspect render.png or render.svg for visual layout, and read selection.json when exact structure is needed.",
].join("\n");
```

Call `registerAgentShare` with:

```ts
const summary = await registerAgentShare({
  shareId,
  scope,
  title,
  description,
  labels,
  sceneId: activeScene.id,
  sourceFile: activeScene.relativePath,
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  expiresAtMs: expiresAt.getTime(),
  selection,
  textPreview,
  selectionJson,
  sceneExcalidraw: serializeDraft(draft),
  renderSvg: svg.outerHTML,
  renderPng: await blobToBytes(pngBlob),
  briefMd,
});
```

Refresh status and share list after registration.

- [ ] **Step 4: Remove bearer token setup text**

Change Codex config to:

```ts
const codexMcpConfig = useMemo(
  () =>
    [
      "[mcp_servers.personal_excalidraw]",
      `url = "${agentMcpUrl}"`,
      "enabled = true",
    ].join("\n"),
  [agentMcpUrl],
);
```

Change Claude config to omit headers:

```ts
const claudeMcpConfig = useMemo(
  () =>
    JSON.stringify(
      {
        mcpServers: {
          "personal-excalidraw": {
            type: "http",
            url: agentMcpUrl,
          },
        },
      },
      null,
      2,
    ),
  [agentMcpUrl],
);
```

Delete `copyAgentTokenEnv`.

- [ ] **Step 5: Run typecheck**

Run:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add app/src/agentSharing.ts app/src/App.tsx
git commit -m "feat: create persistent no-token agent shares"
```

---

## Task 4: Shares Manager And Settings UI

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/styles.css`
- Test: `npm run typecheck`

- [ ] **Step 1: Add manager state and refresh functions**

In `App.tsx`, add state near the existing Agent Sharing state:

```ts
const [agentShares, setAgentShares] = useState<AgentShareSummary[]>([]);
const [isSharesManagerOpen, setIsSharesManagerOpen] = useState(false);
const [editingShareId, setEditingShareId] = useState<string | null>(null);
const [editingShareTitle, setEditingShareTitle] = useState("");
const [editingShareDescription, setEditingShareDescription] = useState("");
const [editingShareLabels, setEditingShareLabels] = useState("");
```

Add:

```ts
const refreshAgentShares = useCallback(async () => {
  if (!isTauriRuntime()) {
    setAgentShares([]);
    return [];
  }
  const shares = await listAgentShares();
  setAgentShares(shares);
  return shares;
}, []);
```

Call `refreshAgentShares` after `refreshAgentShareStatus`, share creation, revoke, delete, clean expired, and rename.

- [ ] **Step 2: Add share management handlers**

Add handlers:

```ts
const beginEditShare = useCallback((share: AgentShareSummary) => {
  setEditingShareId(share.shareId);
  setEditingShareTitle(share.title);
  setEditingShareDescription(share.description);
  setEditingShareLabels(share.labels.join(", "));
}, []);

const saveShareMetadata = useCallback(async () => {
  if (!editingShareId) {
    return;
  }
  await renameAgentShare(editingShareId, {
    title: editingShareTitle.trim() || "Untitled share",
    description: editingShareDescription.trim(),
    labels: editingShareLabels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  });
  setEditingShareId(null);
  await refreshAgentShares();
}, [editingShareDescription, editingShareId, editingShareLabels, editingShareTitle, refreshAgentShares]);

const copySharePrompt = useCallback(async (share: AgentShareSummary) => {
  const value = [
    "Use my Personal Excalidraw share through the personal-excalidraw MCP.",
    `Share title: ${share.title}`,
    `Share ID: ${share.shareId}`,
    `Source file: ${share.sourceFile}`,
    "First call list_recent_shares or get_share_manifest, then read brief and image resources.",
  ].join("\n");
  await copyAgentText(value, "Share prompt");
}, [copyAgentText]);
```

- [ ] **Step 3: Replace settings card content**

In the Runtime card, replace `TTL 24h snapshot` with `TTL 7 days snapshot`, remove `Token env`, and add manager/cleanup buttons:

```tsx
<div className="settings-actions">
  <button onClick={() => setIsSharesManagerOpen(true)}>
    <Archive size={14} />
    Shares Manager
  </button>
  <button
    onClick={() => void cleanExpiredAgentShares().then(() => refreshAgentShares())}
  >
    <Trash2 size={14} />
    Clean expired
  </button>
  <button
    onClick={() =>
      void revokeAllAgentShares()
        .then(refreshAgentShares)
        .then(() => refreshAgentShareStatus())
    }
  >
    <Trash2 size={14} />
    Revoke all
  </button>
</div>
```

- [ ] **Step 4: Add Shares Manager modal**

Render this modal when `isSharesManagerOpen` is true:

```tsx
{isSharesManagerOpen && (
  <div className="settings-backdrop" role="presentation" onPointerDown={() => setIsSharesManagerOpen(false)}>
    <section
      className="shares-manager"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shares-manager-title"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="agent-settings__header">
        <div>
          <p className="section-label">Agent Sharing</p>
          <h2 id="shares-manager-title">Shares Manager</h2>
        </div>
        <button className="icon-button" title="关闭" onClick={() => setIsSharesManagerOpen(false)}>
          <X size={18} />
        </button>
      </header>
      <div className="share-list">
        {agentShares.length === 0 ? (
          <p className="empty-list">还没有 Agent Share</p>
        ) : (
          agentShares.map((share) => (
            <article className="share-row" key={share.shareId}>
              {editingShareId === share.shareId ? (
                <div className="share-edit">
                  <input value={editingShareTitle} onChange={(event) => setEditingShareTitle(event.target.value)} />
                  <textarea value={editingShareDescription} onChange={(event) => setEditingShareDescription(event.target.value)} />
                  <input value={editingShareLabels} onChange={(event) => setEditingShareLabels(event.target.value)} placeholder="labels, comma separated" />
                  <div className="share-row__actions">
                    <button onClick={() => void saveShareMetadata()}>Save</button>
                    <button onClick={() => setEditingShareId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="share-row__main">
                    <strong>{share.title}</strong>
                    <span>{share.description || share.sourceFile}</span>
                    <small>
                      {share.shareId} · {share.scope} · {share.status} · expires {formatDateTime(share.expiresAt)}
                    </small>
                  </div>
                  <div className="share-row__actions">
                    <button onClick={() => beginEditShare(share)}>Rename</button>
                    <button onClick={() => void copyAgentText(share.shareId, "Share ID")}>Copy ID</button>
                    <button onClick={() => void copySharePrompt(share)}>Copy prompt</button>
                    <button onClick={() => void revokeAgentShare(share.shareId).then(refreshAgentShares)}>Revoke</button>
                    <button onClick={() => void deleteAgentShare(share.shareId).then(refreshAgentShares)}>Delete</button>
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  </div>
)}
```

- [ ] **Step 5: Add CSS**

Add:

```css
.shares-manager {
  width: min(860px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  overflow: auto;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.2);
}

.share-list {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.share-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  border: 1px solid #e3e8f0;
  border-radius: 8px;
  padding: 12px;
}

.share-row__main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.share-row__main strong,
.share-row__main span,
.share-row__main small {
  overflow-wrap: anywhere;
}

.share-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.share-edit {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
}

.share-edit input,
.share-edit textarea {
  width: 100%;
  border: 1px solid #cfd7e3;
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
}
```

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add app/src/App.tsx app/src/styles.css
git commit -m "feat: add agent shares manager"
```

---

## Task 5: Current Selection Exposure And macOS Menu Bar

**Files:**
- Modify: `app/src-tauri/src/agent_sharing.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/App.tsx`
- Modify: `app/src/styles.css`
- Test: `cargo test`, `npm run typecheck`

- [ ] **Step 1: Add runtime current-selection state**

In `AgentShareRegistry`, add:

```rust
pub expose_current_selection: bool,
pub current_selection: Option<AgentShareInput>,
```

Add commands:

```rust
#[tauri::command]
pub fn set_current_selection_share(state: State<AgentShareState>, share: Option<AgentShareInput>) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|error| error.to_string())?;
    registry.expose_current_selection = share.is_some();
    registry.current_selection = share;
    Ok(())
}

#[tauri::command]
pub fn get_current_selection_share(state: State<AgentShareState>) -> Result<Option<AgentShareSummary>, String> {
    let registry = state.registry.lock().map_err(|error| error.to_string())?;
    Ok(registry.current_selection.as_ref().map(|share| AgentShareSummary {
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
    }))
}
```

Route `/v1/current-selection/...` and MCP `excalidraw://current-selection/...` to this runtime payload. Do not write it to disk.

- [ ] **Step 2: Add React toggle and snapshot updater**

In `App.tsx`, add:

```ts
const [exposeCurrentSelection, setExposeCurrentSelection] = useState(false);
```

Add this helper signature by extracting the common body from `shareActiveToAgent`:

```ts
const buildAgentSharePayload = useCallback(
  async (options: { runtimeCurrentSelection: boolean }) => {
    if (!activeScene) {
      throw new Error("No active scene.");
    }
    const draft = getActiveDraft();
    if (!draft) {
      throw new Error("No active draft.");
    }
    const allElements = draft.elements.filter((element) => !isDeletedElement(element));
    const selectedIds = selectedElementIdsFromAppState(draft.appState);
    const selectedElements =
      selectedIds.size > 0
        ? allElements.filter((element) => {
            const id = elementId(element);
            return id ? selectedIds.has(id) : false;
          })
        : [];
    const elementsToShare = selectedElements.length > 0 ? selectedElements : allElements;
    if (elementsToShare.length === 0) {
      throw new Error("No shareable elements.");
    }

    const scope = selectedElements.length > 0 ? "selection" : "scene";
    const shareId = options.runtimeCurrentSelection ? "current-selection" : createShareId();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + AGENT_SHARE_TTL_MS);
    const bounds = calculateElementBounds(elementsToShare);
    const text = textFromShareElements(elementsToShare);
    const title = options.runtimeCurrentSelection
      ? `${stem(sceneFilename(activeScene))} current selection`
      : `${stem(sceneFilename(activeScene))} ${scope === "selection" ? "selection" : "scene"}`;
    const description = options.runtimeCurrentSelection
      ? "Runtime current selection, available only while Expose current selection is on."
      : `${scope === "selection" ? "Selected shapes" : "Full scene"} from ${activeScene.relativePath}`;
    const labels: string[] = [];
    const selection = {
      elementIds: elementsToShare.map(elementId).filter((id): id is string => Boolean(id)),
      bounds,
      text,
    };
    const exportAppState = {
      ...draft.appState,
      exportBackground: true,
      exportWithDarkMode: false,
      viewModeEnabled: true,
    };
    const pngBlob = await exportToBlob({
      elements: elementsToShare as never,
      appState: exportAppState as never,
      files: draft.files as never,
      mimeType: "image/png",
      maxWidthOrHeight: 1800,
      exportPadding: 32,
    });
    const svg = await exportToSvg({
      elements: elementsToShare as never,
      appState: exportAppState as never,
      files: draft.files as never,
      exportPadding: 32,
    });

    return {
      shareId,
      scope,
      title,
      description,
      labels,
      sceneId: activeScene.id,
      sourceFile: activeScene.relativePath,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresAtMs: expiresAt.getTime(),
      selection,
      textPreview: text.slice(0, 12),
      selectionJson: {
        schemaVersion: 1,
        shareId,
        title,
        description,
        labels,
        scope,
        sceneId: activeScene.id,
        sourceFile: activeScene.relativePath,
        selection: { ...selection, elements: elementsToShare },
        files: draft.files,
      },
      sceneExcalidraw: serializeDraft(draft),
      renderSvg: svg.outerHTML,
      renderPng: await blobToBytes(pngBlob),
      briefMd: buildShareBrief({
        title,
        description,
        shareId,
        scope,
        sourceFile: activeScene.relativePath,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        bounds,
        elementCount: elementsToShare.length,
        text,
        runtimeCurrentSelection: options.runtimeCurrentSelection,
      }),
    };
  },
  [activeScene, getActiveDraft],
);
```

Also add `buildShareBrief` as a pure top-level function in `App.tsx` so persistent shares and current selection use identical brief text.

Add an effect:

```ts
useEffect(() => {
  if (!exposeCurrentSelection || !activeScene || !activePayload || !isTauriRuntime()) {
    void setCurrentSelectionShare(null).catch(() => undefined);
    return;
  }
  const timer = window.setTimeout(() => {
    void buildAgentSharePayload({ runtimeCurrentSelection: true })
      .then((share) => setCurrentSelectionShare(share))
      .catch(() => undefined);
  }, 400);
  return () => window.clearTimeout(timer);
}, [activePayload, activeScene, buildAgentSharePayload, exposeCurrentSelection]);
```

- [ ] **Step 3: Add settings toggle**

In settings runtime card, add:

```tsx
<label className="toggle-row">
  <input
    type="checkbox"
    checked={exposeCurrentSelection}
    onChange={(event) => setExposeCurrentSelection(event.target.checked)}
  />
  <span>Expose current selection</span>
</label>
```

Add CSS:

```css
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #334155;
  font-size: 13px;
}
```

- [ ] **Step 4: Add macOS menu**

In `lib.rs` setup, after window creation, install a menu:

```rust
use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};

let app_handle = app.handle();
let turn_on = MenuItem::with_id(app_handle, "agent-sharing-toggle", "Turn On / Turn Off", true, None::<&str>)?;
let manager = MenuItem::with_id(app_handle, "agent-sharing-manager", "Open Shares Manager", true, None::<&str>)?;
let share_current = MenuItem::with_id(app_handle, "agent-sharing-share-current", "Share Current Selection to Agent", true, None::<&str>)?;
let expose_current = CheckMenuItem::with_id(app_handle, "agent-sharing-expose-current", "Expose Current Selection", true, false, None::<&str>)?;
let codex_prompt = MenuItem::with_id(app_handle, "agent-sharing-copy-codex-prompt", "Copy Codex Setup Prompt", true, None::<&str>)?;
let claude_prompt = MenuItem::with_id(app_handle, "agent-sharing-copy-claude-prompt", "Copy Claude Setup Prompt", true, None::<&str>)?;
let revoke_all = MenuItem::with_id(app_handle, "agent-sharing-revoke-all", "Revoke All Shares", true, None::<&str>)?;
let submenu = Submenu::with_items(
    app_handle,
    "Agent Sharing",
    true,
    &[&turn_on, &manager, &share_current, &expose_current, &codex_prompt, &claude_prompt, &revoke_all],
)?;
let menu = Menu::with_items(app_handle, &[&submenu])?;
app.set_menu(menu)?;
```

Add `app.on_menu_event` to emit string events to the main window:

```rust
app.on_menu_event(|app, event| {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("agent-sharing-menu", event.id().as_ref());
    }
});
```

- [ ] **Step 5: Listen for menu events in React**

Import:

```ts
import { listen } from "@tauri-apps/api/event";
```

Add effect:

```ts
useEffect(() => {
  if (!isTauriRuntime()) {
    return;
  }
  let unlisten: (() => void) | null = null;
  void listen<string>("agent-sharing-menu", (event) => {
    const id = event.payload;
    if (id === "agent-sharing-toggle") {
      void toggleAgentSharing();
    } else if (id === "agent-sharing-manager") {
      setIsSharesManagerOpen(true);
      void refreshAgentShares();
    } else if (id === "agent-sharing-share-current") {
      void shareActiveToAgent();
    } else if (id === "agent-sharing-expose-current") {
      setExposeCurrentSelection((value) => !value);
    } else if (id === "agent-sharing-copy-codex-prompt") {
      void copyAgentText(agentSetupPrompt, "Codex setup prompt");
    } else if (id === "agent-sharing-copy-claude-prompt") {
      void copyAgentText(agentSetupPrompt, "Claude setup prompt");
    } else if (id === "agent-sharing-revoke-all") {
      void revokeAllAgentShares().then(refreshAgentShares).then(() => refreshAgentShareStatus());
    }
  }).then((dispose) => {
    unlisten = dispose;
  });
  return () => {
    unlisten?.();
  };
}, [
  agentSetupPrompt,
  copyAgentText,
  refreshAgentShareStatus,
  refreshAgentShares,
  shareActiveToAgent,
  toggleAgentSharing,
]);
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test agent_sharing --lib
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add app/src-tauri/src/agent_sharing.rs app/src-tauri/src/lib.rs app/src/App.tsx app/src/styles.css
git commit -m "feat: add agent sharing menu integration"
```

---

## Task 6: Verification, Docs, And Packaging

**Files:**
- Modify: `target-1-personal-mac-app/AGENT_SHARING.md`
- Modify: `target-1-personal-mac-app/ARCHITECTURE.md`
- Modify: `target-1-personal-mac-app/TASKS.md`
- Test: Rust tests, TypeScript build, Tauri build, manual MCP smoke test

- [ ] **Step 1: Update docs**

In `AGENT_SHARING.md`, replace the old first-version scope with:

```md
## 第一版范围

- 只读读取，不提供写回。
- 本地 API 默认关闭；开启后只监听 `127.0.0.1`。
- 不使用 bearer token；本机安全边界来自默认关闭、loopback 绑定、只读、TTL 和 revoke/delete。
- share 默认是 snapshot，不实时追踪文件变化。
- 默认 TTL 为 7 天；App 重启后 share 仍保留，直到过期、revoke 或 delete。
- 支持“当前选区”和“当前文件”两种持久 share scope。
- 支持 `Expose current selection` 运行时开关，但它不写入持久 share store。
- 提供 HTTP 数据面和 MCP Streamable HTTP endpoint `/mcp`。
```

Update Codex/Claude config snippets to remove `bearer_token_env_var` and `Authorization` headers.

In `ARCHITECTURE.md`, update Agent Sharing to say `AgentShareStore` is persisted under App data dir and `AgentShareRegistry` only owns runtime listener/current-selection state.

- [ ] **Step 2: Run automated verification**

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app/src-tauri
cargo test
cargo build
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Run local MCP smoke test**

Start the app:

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run tauri:dev
```

In the app:

1. Open a workspace.
2. Open or create a `.excalidraw` scene.
3. Draw a rectangle and add text `Primary CTA`.
4. Turn on Agent Sharing.
5. Click `Share`.

In another terminal, run:

```bash
curl -s http://127.0.0.1:37411/v1/status
curl -s http://127.0.0.1:37411/v1/shares
curl -s -X POST http://127.0.0.1:37411/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s -X POST http://127.0.0.1:37411/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_recent_shares","arguments":{}}}'
```

Expected:

- `/v1/status` shows `enabled: true` and no `token` field.
- `/v1/shares` contains the new share title and `status: "active"`.
- MCP `initialize` returns resources/tools/prompts capabilities.
- MCP `list_recent_shares` returns the share title, description, shareId, source file, and text preview.

- [ ] **Step 4: Verify UI behavior**

Manual checks:

- Settings shows `Local only`, port, `7 days`, no token env button.
- Shares Manager opens from settings.
- Rename changes title without changing shareId.
- Revoke makes the share unreadable via HTTP/MCP.
- Delete removes the share from the manager.
- Clean expired removes expired shares.
- Menu bar can toggle Agent Sharing, open Shares Manager, share current selection, toggle current selection exposure, copy setup prompts, and revoke all shares.
- Clicking outside the existing file more-menu closes it; this regression must stay fixed.

- [ ] **Step 5: Build installable app**

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run tauri:build
```

Expected: Tauri build succeeds and emits a macOS bundle/DMG under `app/src-tauri/target/release/bundle/`.

- [ ] **Step 6: Commit and push**

```bash
git add AGENT_SHARING.md ARCHITECTURE.md TASKS.md app/src app/src-tauri
git commit -m "docs: update agent sharing implementation notes"
git push origin main
```

If implementation happened in `/Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app` and that path is not a git repo, copy the resulting changed files to `/tmp/cusotmized-excalidraw-push`, run the same verification there, commit, and push.

---

## Plan Self-Review

- Spec coverage: V1 local-only, no token, 7-day TTL, persistent App data shares, naming, manager, menu bar, MCP resources/tools/prompts, current-selection exposure, audit/read status, setup prompts, and Future LAN/P2P reservation are covered.
- Scope check: LAN and peer-to-peer are explicitly not implemented.
- Placeholder scan: no task uses TBD/TODO/fill-in language. Implementation helpers are named explicitly.
- Type consistency: Rust and TypeScript use `shareId`, `title`, `description`, `labels`, `status`, `visibility`, `textPreview`, `expiresAtMs`, and `ShareScope` consistently.
- Risk: The MCP implementation is intentionally minimal Streamable HTTP JSON-RPC without server-sent streaming. This is acceptable for the V1 read-only use case because request/response methods are enough for resources, tools, and prompts.
