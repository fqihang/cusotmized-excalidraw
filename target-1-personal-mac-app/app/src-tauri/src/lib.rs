mod agent_sharing;

use agent_sharing::{
    agent_share_status, clean_expired_agent_shares, delete_agent_share,
    get_current_selection_share, list_agent_shares, register_agent_share, rename_agent_share,
    revoke_agent_share, revoke_all_agent_shares, set_current_selection_share,
    start_agent_share_server, stop_agent_share_server, AgentShareState,
};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use walkdir::WalkDir;

const META_DIR: &str = ".personal-excalidraw";

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let share_root = app.path().app_data_dir()?.join("agent-shares");
            let agent_share_state = AgentShareState::new(share_root)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(agent_share_state);
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
            list_agent_shares,
            rename_agent_share,
            revoke_agent_share,
            delete_agent_share,
            clean_expired_agent_shares,
            revoke_all_agent_shares,
            set_current_selection_share,
            get_current_selection_share,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Personal Excalidraw");
}
