export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type SortMode = "updated" | "opened" | "title";

export type ScenePayload = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type NativeWorkspaceHandle = {
  kind: "native";
  path: string;
  name: string;
};

export type WorkspaceHandle = FileSystemDirectoryHandle | NativeWorkspaceHandle;

export type WorkspaceFile = {
  name: string;
  size: number;
  lastModified: number;
  text(): Promise<string>;
};

export type WorkspaceTreeEntry = {
  kind: "directory" | "file";
  relativePath: string;
  name: string;
  sizeBytes?: number;
  modifiedMs?: number;
};

export type SceneMetadata = {
  id: string;
  title: string;
  relativePath: string;
  folderPath: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  openedAt?: string;
  sizeBytes: number;
  hash: string;
  text: string;
  thumbnailRelativePath?: string;
  snapshotCount: number;
};

export type WorkspaceIndex = {
  version: 1;
  workspaceName: string;
  createdAt: string;
  updatedAt: string;
  scenes: SceneMetadata[];
  folders: string[];
  templates: SceneMetadata[];
};

export type WorkspaceSession = {
  handle: WorkspaceHandle;
  name: string;
  index: WorkspaceIndex;
};

export type DraftState = {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type BrowserFileSystemSupport = {
  supported: boolean;
  reason?: string;
};
