import { invoke } from "@tauri-apps/api/core";
import type {
  NativeWorkspaceHandle,
  WorkspaceFile,
  WorkspaceHandle,
  WorkspaceTreeEntry,
} from "../types";
import { basename, dirname, joinPath, normalizePath, splitPath } from "./path";

export const META_DIR = ".personal-excalidraw";
export const SCENES_DIR = "scenes";
export const THUMBNAILS_DIR = `${META_DIR}/thumbnails`;
export const SNAPSHOTS_DIR = `${META_DIR}/snapshots`;
export const AUTOSAVE_DIR = `${META_DIR}/autosave`;
export const TRASH_DIR = `${META_DIR}/trash`;
export const INDEX_PATH = `${META_DIR}/index.json`;
export const WORKSPACE_PATH = `${META_DIR}/workspace.json`;

type NativeFileEntry = {
  relativePath: string;
  name: string;
  text: string;
  sizeBytes: number;
  modifiedMs: number;
};

type NativeTreeEntry = {
  kind: "directory" | "file";
  relativePath: string;
  name: string;
  sizeBytes?: number;
  modifiedMs?: number;
};

type SaveFileFilter = {
  name: string;
  extensions: string[];
};

export const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export const isNativeHandle = (
  handle: WorkspaceHandle,
): handle is NativeWorkspaceHandle =>
  (handle as NativeWorkspaceHandle).kind === "native";

const nativeFile = (entry: NativeFileEntry): WorkspaceFile => ({
  name: entry.name,
  size: entry.sizeBytes,
  lastModified: entry.modifiedMs,
  text: async () => entry.text,
});

const blobToBytes = async (blob: Blob) =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));

const bytesToBlob = (bytes: number[], type = "application/octet-stream") =>
  new Blob([new Uint8Array(bytes)], { type });

export const pickNativeWorkspace = async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose Personal Excalidraw workspace",
  });
  if (typeof selected !== "string") {
    return null;
  }

  const name = selected.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";
  return {
        kind: "native",
    path: selected,
    name,
  } satisfies NativeWorkspaceHandle;
};

export const pickNativeExcalidrawFiles = async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: true,
    title: "Import Excalidraw files",
    filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
  });
  if (!selected) {
    return [];
  }
  const paths = Array.isArray(selected) ? selected : [selected];
  return invoke<Array<{ name: string; text: string }>>(
    "read_absolute_text_files",
    { paths },
  );
};

export const pickNativeSaveFile = async (
  defaultPath: string,
  filters: SaveFileFilter[],
) => {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath,
    filters,
  });
};

export const fileSystemSupport = () => {
  if (isTauriRuntime()) {
    return { supported: true };
  }

  if (!window.showDirectoryPicker) {
    return {
      supported: false,
      reason: "当前浏览器不支持目录授权。请用 Chrome 或 Edge 打开本应用。",
    };
  }

  return { supported: true };
};

export const ensurePermission = async (
  handle: WorkspaceHandle,
  mode: FileSystemPermissionMode = "readwrite",
) => {
  if (isNativeHandle(handle)) {
    return true;
  }

  const descriptor = { mode };
  if ((await handle.queryPermission(descriptor)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(descriptor)) === "granted";
};

export const getDirectoryHandleByPath = async (
  root: WorkspaceHandle,
  path: string,
  create = false,
) => {
  if (isNativeHandle(root)) {
    if (create) {
      await invoke("ensure_directory", {
        rootPath: root.path,
        relativePath: path,
      });
    }
    return root;
  }

  let current = root;
  for (const part of splitPath(path)) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
};

export const ensureDirectory = async (
  root: WorkspaceHandle,
  path: string,
) => getDirectoryHandleByPath(root, path, true);

export const getFileHandleByPath = async (
  root: WorkspaceHandle,
  path: string,
  create = false,
) => {
  if (isNativeHandle(root)) {
    throw new Error(`Native workspace does not expose file handles: ${path}`);
  }

  const dir = dirname(path);
  const file = basename(path);
  const parent = (dir
    ? await getDirectoryHandleByPath(root, dir, create)
    : root) as FileSystemDirectoryHandle;
  return parent.getFileHandle(file, { create });
};

export const readTextFile = async (
  root: WorkspaceHandle,
  path: string,
) => {
  if (isNativeHandle(root)) {
    return invoke<string>("read_text_file", {
      rootPath: root.path,
      relativePath: path,
    });
  }

  const handle = await getFileHandleByPath(root, path);
  const file = await handle.getFile();
  return file.text();
};

export const readFile = async (
  root: WorkspaceHandle,
  path: string,
) => {
  if (isNativeHandle(root)) {
    const bytes = await invoke<number[]>("read_binary_file", {
      rootPath: root.path,
      relativePath: path,
    });
    return bytesToBlob(bytes);
  }

  const handle = await getFileHandleByPath(root, path);
  return handle.getFile();
};

export const writeTextFile = async (
  root: WorkspaceHandle,
  path: string,
  content: string,
) => {
  if (isNativeHandle(root)) {
    await invoke("write_text_file", {
      rootPath: root.path,
      relativePath: path,
      content,
    });
    return;
  }

  const handle = await getFileHandleByPath(root, path, true);
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(content);
  await writable.close();
};

export const writeBlobFile = async (
  root: WorkspaceHandle,
  path: string,
  blob: Blob,
) => {
  if (isNativeHandle(root)) {
    await invoke("write_binary_file", {
      rootPath: root.path,
      relativePath: path,
      bytes: await blobToBytes(blob),
    });
    return;
  }

  const handle = await getFileHandleByPath(root, path, true);
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(blob);
  await writable.close();
};

export const writeAbsoluteTextFile = async (path: string, content: string) => {
  await invoke("write_absolute_text_file", { path, content });
};

export const writeAbsoluteBlobFile = async (path: string, blob: Blob) => {
  await invoke("write_absolute_binary_file", {
    path,
    bytes: await blobToBytes(blob),
  });
};

export const removeEntryByPath = async (
  root: WorkspaceHandle,
  path: string,
  recursive = false,
) => {
  if (isNativeHandle(root)) {
    await invoke("remove_entry", {
      rootPath: root.path,
      relativePath: path,
      recursive,
    });
    return;
  }

  const dir = dirname(path);
  const file = basename(path);
  const parent = (dir
    ? await getDirectoryHandleByPath(root, dir)
    : root) as FileSystemDirectoryHandle;
  await parent.removeEntry(file, { recursive });
};

export type WalkedFile = {
  relativePath: string;
  file: WorkspaceFile;
};

export const walkFiles = async (
  root: WorkspaceHandle,
  shouldInclude: (relativePath: string) => boolean,
) => {
  if (isNativeHandle(root)) {
    const entries = await invoke<NativeFileEntry[]>("walk_excalidraw_files", {
      rootPath: root.path,
    });
    return entries
      .filter((entry) => shouldInclude(entry.relativePath))
      .map((entry) => ({
        relativePath: normalizePath(entry.relativePath),
        file: nativeFile(entry),
      }));
  }

  const files: WalkedFile[] = [];

  const walk = async (dir: FileSystemDirectoryHandle, prefix = "") => {
    for await (const [name, handle] of dir.entries()) {
      if (name === META_DIR) {
        continue;
      }

      const relativePath = joinPath(prefix, name);
      if (handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, relativePath);
      } else if (shouldInclude(relativePath)) {
        files.push({
          relativePath: normalizePath(relativePath),
          file: await (handle as FileSystemFileHandle).getFile(),
        });
      }
    }
  };

  await walk(root);
  return files;
};

export const listWorkspaceEntries = async (
  root: WorkspaceHandle,
): Promise<WorkspaceTreeEntry[]> => {
  if (isNativeHandle(root)) {
    const entries = await invoke<NativeTreeEntry[]>("list_workspace_entries", {
      rootPath: root.path,
    });
    return entries.map((entry) => ({
      ...entry,
      relativePath: normalizePath(entry.relativePath),
    }));
  }

  const entries: WorkspaceTreeEntry[] = [];

  const walk = async (dir: FileSystemDirectoryHandle, prefix = "") => {
    for await (const [name, handle] of dir.entries()) {
      if (name === META_DIR) {
        continue;
      }

      const relativePath = joinPath(prefix, name);
      if (handle.kind === "directory") {
        entries.push({
          kind: "directory",
          relativePath,
          name,
        });
        await walk(handle as FileSystemDirectoryHandle, relativePath);
      } else if (/\.excalidraw$/i.test(name)) {
        const file = await (handle as FileSystemFileHandle).getFile();
        entries.push({
          kind: "file",
          relativePath,
          name,
          sizeBytes: file.size,
          modifiedMs: file.lastModified,
        });
      }
    }
  };

  await walk(root);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const safeReadJson = async <T>(
  root: WorkspaceHandle,
  path: string,
): Promise<T | null> => {
  try {
    return JSON.parse(await readTextFile(root, path)) as T;
  } catch {
    return null;
  }
};

export const pathExists = async (
  root: WorkspaceHandle,
  path: string,
) => {
  try {
    await getFileHandleByPath(root, path);
    return true;
  } catch {
    return false;
  }
};
