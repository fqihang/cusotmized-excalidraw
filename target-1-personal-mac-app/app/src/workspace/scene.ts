import type {
  DraftState,
  SceneMetadata,
  ScenePayload,
  WorkspaceFile,
  WorkspaceHandle,
  WorkspaceIndex,
  WorkspaceSession,
} from "../types";
import {
  AUTOSAVE_DIR,
  ensureDirectory,
  INDEX_PATH,
  readFile,
  readTextFile,
  removeEntryByPath,
  safeReadJson,
  SCENES_DIR,
  SNAPSHOTS_DIR,
  THUMBNAILS_DIR,
  TRASH_DIR,
  walkFiles,
  WORKSPACE_PATH,
  writeBlobFile,
  writeTextFile,
} from "./fs";
import {
  basename,
  dirname,
  ensureExcalidrawFilename,
  joinPath,
  normalizePath,
  stem,
  uniqueFilename,
} from "./path";

const SOURCE = "personal-excalidraw";
const INDEX_VERSION = 1;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export const emptyScene = (name = "Untitled"): ScenePayload => ({
  type: "excalidraw",
  version: 2,
  source: SOURCE,
  elements: [],
  appState: {
    name,
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
});

export const extractTextFromElements = (elements: readonly unknown[]) => {
  const tokens: string[] = [];

  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const record = element as Record<string, unknown>;
    for (const key of ["text", "originalText", "rawText"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        tokens.push(value.trim());
      }
    }
  }

  return Array.from(new Set(tokens)).join("\n");
};

export const hashString = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const asScenePayload = (value: unknown, fallbackTitle: string): ScenePayload => {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : emptyScene(fallbackTitle);
  const appState =
    record.appState && typeof record.appState === "object"
      ? (record.appState as Record<string, unknown>)
      : {};

  return {
    type: "excalidraw",
    version: typeof record.version === "number" ? record.version : 2,
    source: typeof record.source === "string" ? record.source : SOURCE,
    elements: Array.isArray(record.elements) ? record.elements : [],
    appState: {
      name:
        typeof appState.name === "string" && appState.name.trim()
          ? appState.name
          : fallbackTitle,
      viewBackgroundColor:
        typeof appState.viewBackgroundColor === "string"
          ? appState.viewBackgroundColor
          : "#ffffff",
      ...appState,
    },
    files:
      record.files && typeof record.files === "object"
        ? (record.files as Record<string, unknown>)
        : {},
  };
};

const titleFromPayload = (payload: ScenePayload, relativePath: string) => {
  const appName = payload.appState.name;
  if (typeof appName === "string" && appName.trim()) {
    return appName.trim();
  }
  return stem(basename(relativePath));
};

const metadataFromFile = async (
  relativePath: string,
  file: WorkspaceFile,
  previous?: SceneMetadata,
) => {
  const raw = await file.text();
  const payload = asScenePayload(JSON.parse(raw), stem(basename(relativePath)));
  const title = titleFromPayload(payload, relativePath);
  const hash = await hashString(raw);
  const now = new Date().toISOString();
  const id = previous?.id ?? crypto.randomUUID();

  return {
    id,
    title,
    relativePath,
    folderPath: dirname(relativePath) || SCENES_DIR,
    tags: previous?.tags ?? [],
    favorite: previous?.favorite ?? false,
    archived: false,
    createdAt: previous?.createdAt ?? now,
    updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
    openedAt: previous?.openedAt,
    sizeBytes: file.size,
    hash,
    text: extractTextFromElements(payload.elements),
    thumbnailRelativePath:
      previous?.thumbnailRelativePath ?? joinPath(THUMBNAILS_DIR, `${id}.png`),
    snapshotCount: previous?.snapshotCount ?? 0,
  } satisfies SceneMetadata;
};

const defaultIndex = (workspaceName: string): WorkspaceIndex => {
  const now = new Date().toISOString();
  return {
    version: INDEX_VERSION,
    workspaceName,
    createdAt: now,
    updatedAt: now,
    scenes: [],
    folders: [SCENES_DIR],
    templates: [],
  };
};

const normalizeIndex = (
  value: WorkspaceIndex | null,
  workspaceName: string,
): WorkspaceIndex => {
  if (!value || value.version !== INDEX_VERSION) {
    return defaultIndex(workspaceName);
  }

  return {
    ...defaultIndex(workspaceName),
    ...value,
    workspaceName: value.workspaceName || workspaceName,
    scenes: Array.isArray(value.scenes) ? value.scenes : [],
    folders: Array.isArray(value.folders) ? value.folders : [SCENES_DIR],
    templates: Array.isArray(value.templates) ? value.templates : [],
  };
};

export const writeIndex = async (session: WorkspaceSession) => {
  session.index.updatedAt = new Date().toISOString();
  await writeTextFile(session.handle, INDEX_PATH, JSON.stringify(session.index, null, 2));
};

export const initializeWorkspace = async (
  handle: WorkspaceHandle,
): Promise<WorkspaceSession> => {
  await ensureDirectory(handle, SCENES_DIR);
  await ensureDirectory(handle, THUMBNAILS_DIR);
  await ensureDirectory(handle, SNAPSHOTS_DIR);
  await ensureDirectory(handle, AUTOSAVE_DIR);
  await ensureDirectory(handle, TRASH_DIR);

  const workspaceJson = await safeReadJson<{ name?: string; createdAt?: string }>(
    handle,
    WORKSPACE_PATH,
  );
  const workspaceName = workspaceJson?.name || handle.name || "Workspace";
  const loadedIndex = await safeReadJson<WorkspaceIndex>(handle, INDEX_PATH);
  const session: WorkspaceSession = {
    handle,
    name: workspaceName,
    index: normalizeIndex(loadedIndex, workspaceName),
  };

  await writeTextFile(
    handle,
    WORKSPACE_PATH,
    JSON.stringify(
      {
        version: 1,
        name: workspaceName,
        createdAt: workspaceJson?.createdAt ?? session.index.createdAt,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  await rescanWorkspace(session);
  return session;
};

export const rescanWorkspace = async (session: WorkspaceSession) => {
  const previousByPath = new Map(
    session.index.scenes.map((scene) => [scene.relativePath, scene]),
  );
  const found = await walkFiles(session.handle, (relativePath) =>
    /\.excalidraw$/i.test(relativePath),
  );

  const scenes: SceneMetadata[] = [];
  for (const item of found) {
    try {
      scenes.push(
        await metadataFromFile(
          item.relativePath,
          item.file,
          previousByPath.get(item.relativePath),
        ),
      );
    } catch {
      const previous = previousByPath.get(item.relativePath);
      if (previous) {
        scenes.push(previous);
      }
    }
  }

  const folders = new Set<string>([SCENES_DIR]);
  for (const scene of scenes) {
    if (scene.folderPath) {
      folders.add(scene.folderPath);
    }
  }

  const nextScenes = scenes.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const nextFolders = [...folders].sort((a, b) => a.localeCompare(b));
  const changed =
    JSON.stringify(session.index.scenes) !== JSON.stringify(nextScenes) ||
    JSON.stringify(session.index.folders) !== JSON.stringify(nextFolders);

  session.index.scenes = nextScenes;
  session.index.folders = nextFolders;
  if (changed) {
    await writeIndex(session);
  }
  return changed;
};

export const readScene = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
) => {
  const raw = await readTextFile(session.handle, scene.relativePath);
  const payload = asScenePayload(JSON.parse(raw), scene.title);
  scene.openedAt = new Date().toISOString();
  await writeIndex(session);
  return payload;
};

export const createScene = async (
  session: WorkspaceSession,
  folderPath: string,
  title = "Untitled",
) => {
  const normalizedFolder = normalizePath(folderPath || SCENES_DIR) || SCENES_DIR;
  await ensureDirectory(session.handle, normalizedFolder);
  const used = new Set(session.index.scenes.map((scene) => scene.relativePath));
  const filename = uniqueFilename(title, used, normalizedFolder);
  const relativePath = joinPath(normalizedFolder, filename);
  const payload = emptyScene(stem(filename));
  const raw = JSON.stringify(payload, null, 2);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const metadata: SceneMetadata = {
    id,
    title: stem(filename),
    relativePath,
    folderPath: normalizedFolder,
    tags: [],
    favorite: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    sizeBytes: new Blob([raw]).size,
    hash: await hashString(raw),
    text: "",
    thumbnailRelativePath: joinPath(THUMBNAILS_DIR, `${id}.png`),
    snapshotCount: 0,
  };

  await writeTextFile(session.handle, relativePath, raw);
  session.index.scenes = [metadata, ...session.index.scenes];
  if (!session.index.folders.includes(normalizedFolder)) {
    session.index.folders.push(normalizedFolder);
    session.index.folders.sort();
  }
  await writeIndex(session);
  return { metadata, payload };
};

export const saveScene = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
  raw: string,
  draft: DraftState,
) => {
  const previousHash = scene.hash;
  const nextHash = await hashString(raw);
  const now = new Date().toISOString();

  await maybeWriteSnapshot(session, scene, previousHash);
  await writeTextFile(session.handle, scene.relativePath, raw);

  scene.hash = nextHash;
  scene.updatedAt = now;
  scene.sizeBytes = new Blob([raw]).size;
  scene.text = extractTextFromElements(draft.elements);
  const appName = draft.appState?.name;
  if (typeof appName === "string" && appName.trim()) {
    scene.title = appName.trim();
  }
  await writeIndex(session);
};

export const writeAutosaveDraft = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
  raw: string,
) => {
  await writeTextFile(
    session.handle,
    joinPath(AUTOSAVE_DIR, `${scene.id}.draft.excalidraw`),
    raw,
  );
};

const maybeWriteSnapshot = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
  previousHash: string,
) => {
  if (!previousHash || scene.hash !== previousHash) {
    return;
  }

  const lastSnapshotAt =
    scene.snapshotCount > 0
      ? new Date(scene.updatedAt).getTime()
      : Number.NEGATIVE_INFINITY;
  if (Date.now() - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) {
    return;
  }

  try {
    const file = await readFile(session.handle, scene.relativePath);
    const snapshotPath = joinPath(
      SNAPSHOTS_DIR,
      scene.id,
      `${new Date().toISOString().replace(/[:.]/g, "-")}.excalidraw`,
    );
    await writeBlobFile(session.handle, snapshotPath, file);
    scene.snapshotCount += 1;
  } catch {
    // Snapshot failures should never block the primary save path.
  }
};

export const renameScene = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
  nextTitle: string,
) => {
  const filename = ensureExcalidrawFilename(nextTitle);
  const used = new Set(
    session.index.scenes
      .filter((item) => item.id !== scene.id)
      .map((item) => item.relativePath),
  );
  const nextName = uniqueFilename(filename, used, scene.folderPath);
  const nextPath = joinPath(scene.folderPath, nextName);
  const payload = JSON.parse(await readTextFile(session.handle, scene.relativePath));
  payload.appState = {
    ...(payload.appState ?? {}),
    name: stem(nextName),
  };

  await writeTextFile(session.handle, nextPath, JSON.stringify(payload, null, 2));
  await removeEntryByPath(session.handle, scene.relativePath);
  scene.relativePath = nextPath;
  scene.title = stem(nextName);
  scene.updatedAt = new Date().toISOString();
  session.index.scenes = session.index.scenes.map((item) =>
    item.id === scene.id ? scene : item,
  );
  await writeIndex(session);
  return scene;
};

export const duplicateScene = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
) => {
  const raw = await readTextFile(session.handle, scene.relativePath);
  const used = new Set(session.index.scenes.map((item) => item.relativePath));
  const filename = uniqueFilename(`${scene.title} Copy`, used, scene.folderPath);
  const nextPath = joinPath(scene.folderPath, filename);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await writeTextFile(session.handle, nextPath, raw);
  const metadata: SceneMetadata = {
    ...scene,
    id,
    title: stem(filename),
    relativePath: nextPath,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    thumbnailRelativePath: joinPath(THUMBNAILS_DIR, `${id}.png`),
    snapshotCount: 0,
  };
  session.index.scenes = [metadata, ...session.index.scenes];
  await writeIndex(session);
  return metadata;
};

export const moveSceneToTrash = async (
  session: WorkspaceSession,
  scene: SceneMetadata,
  updateIndex = true,
) => {
  const raw = await readTextFile(session.handle, scene.relativePath);
  const trashName = `${scene.id}-${basename(scene.relativePath)}`;
  await writeTextFile(session.handle, joinPath(TRASH_DIR, trashName), raw);
  await removeEntryByPath(session.handle, scene.relativePath);

  if (updateIndex) {
    session.index.scenes = session.index.scenes.filter(
      (item) => item.id !== scene.id,
    );
    await writeIndex(session);
  }
};

export const updateSceneMetadata = async (
  session: WorkspaceSession,
  sceneId: string,
  patch: Partial<Pick<SceneMetadata, "tags" | "favorite">>,
) => {
  const scene = session.index.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return null;
  }
  Object.assign(scene, patch);
  await writeIndex(session);
  return scene;
};
