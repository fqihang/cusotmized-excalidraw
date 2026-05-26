import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Heart,
  Import,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Star,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type {
  DraftState,
  SaveStatus,
  SceneMetadata,
  ScenePayload,
  SortMode,
  WorkspaceHandle,
  WorkspaceSession,
  WorkspaceTreeEntry,
} from "./types";
import {
  ensureDirectory,
  ensurePermission,
  fileSystemSupport,
  isNativeHandle,
  isTauriRuntime,
  listWorkspaceEntries,
  pickNativeExcalidrawFiles,
  pickNativeSaveFile,
  pickNativeWorkspace,
  readFile,
  readTextFile,
  writeAbsoluteBlobFile,
  writeBlobFile,
  writeTextFile,
} from "./workspace/fs";
import {
  createScene,
  duplicateScene,
  initializeWorkspace,
  moveSceneToTrash,
  readScene,
  renameScene,
  rescanWorkspace,
  saveScene,
  updateSceneMetadata,
  writeAutosaveDraft,
  writeIndex,
} from "./workspace/scene";
import { filterScenes } from "./workspace/search";
import {
  basename,
  dirname,
  joinPath,
  normalizePath,
  safeSegment,
  stem,
  uniqueFilename,
} from "./workspace/path";
import {
  listRecentWorkspaces,
  rememberWorkspace,
  type RecentWorkspaceRecord,
} from "./storage/recentWorkspaces";
import {
  blobToBytes,
  cleanExpiredAgentShares,
  deleteAgentShare,
  getAgentShareStatus,
  listAgentShares,
  readAgentShareRenderPng,
  registerAgentShare,
  renameAgentShare,
  revokeAgentShare,
  revokeAllAgentShares,
  setCurrentSelectionShare,
  startAgentShareServer,
  stopAgentShareServer,
  type AgentSharePayload,
  type AgentShareSummary,
  type AgentShareStatus,
} from "./agentSharing";
import {
  AgentShareHandoffPanel,
  AgentShareMenu,
  isShareReadable,
  type HandoffPanelState,
} from "./AgentShareHandoff";
import {
  buildAgentHandoffPrompt,
  type AgentTarget,
} from "./agentSharingPrompts";
import { collectAgentShareElements } from "./agentShareSelection";

const AUTOSAVE_DELAY_MS = 900;
const SAVE_RECONCILE_INTERVAL_MS = 1200;
const EXTERNAL_RESCAN_INTERVAL_MS = 2500;
const EXTERNAL_RESCAN_MIN_GAP_MS = 1200;
const THUMBNAIL_SIZE = 420;
const AGENT_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_AGENT_SHARE_BASE_URL = "http://127.0.0.1:37411";

const formatDateTime = (value?: string) => {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const sceneFilename = (scene: SceneMetadata) => basename(scene.relativePath);

const buildShareBrief = (input: {
  title: string;
  description: string;
  shareId: string;
  scope: "selection" | "scene";
  sourceFile: string;
  createdAt: string;
  expiresAt: string;
  bounds: { x: number; y: number; width: number; height: number };
  elementCount: number;
  text: string[];
  runtimeCurrentSelection: boolean;
}) =>
  [
    `# ${input.title}`,
    "",
    input.description,
    "",
    `Share ID: \`${input.shareId}\``,
    `Scope: \`${input.scope}\``,
    `Source file: \`${input.sourceFile}\``,
    `Created: ${input.createdAt}`,
    input.runtimeCurrentSelection
      ? "Expires: when Expose current selection is turned off or the App exits"
      : `Expires: ${input.expiresAt}`,
    "",
    "## Visual Context",
    "",
    `Bounds: x=${input.bounds.x}, y=${input.bounds.y}, width=${input.bounds.width}, height=${input.bounds.height}`,
    `Elements: ${input.elementCount}`,
    "",
    "## Text Found",
    "",
    input.text.length
      ? input.text.map((item) => `- ${item}`).join("\n")
      : "- No text elements found.",
    "",
    "## Agent Instructions",
    "",
    "Use this share as read-only design context. Read this brief first, inspect render.png or render.svg for visual layout, and read selection.json when exact structure is needed.",
  ].join("\n");

const draftFromPayload = (payload: ScenePayload): DraftState => ({
  elements: payload.elements,
  appState: payload.appState,
  files: payload.files,
});

const serializeDraft = (draft: DraftState) =>
  serializeAsJSON(
    draft.elements as never,
    draft.appState as never,
    draft.files as never,
    "local",
  );

const isPathInsideDirectory = (path: string, directory: string) => {
  const normalizedDirectory = directory.replace(/\/+$/, "");
  return path === normalizedDirectory || path.startsWith(`${normalizedDirectory}/`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const createShareId = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sh_${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

const selectedElementIdsFromAppState = (appState: Record<string, unknown>) => {
  const selected = appState.selectedElementIds;
  if (Array.isArray(selected)) {
    return new Set(selected.filter((id): id is string => typeof id === "string"));
  }
  if (isRecord(selected)) {
    return new Set(
      Object.entries(selected)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([id]) => id),
    );
  }
  return new Set<string>();
};

const elementId = (element: unknown) => {
  if (!isRecord(element)) {
    return null;
  }
  return typeof element.id === "string" ? element.id : null;
};

const isDeletedElement = (element: unknown) =>
  isRecord(element) && Boolean(element.isDeleted);

const numericElementValue = (
  element: Record<string, unknown>,
  key: "x" | "y" | "width" | "height",
) => (typeof element[key] === "number" ? element[key] : 0);

const calculateElementBounds = (elements: readonly unknown[]) => {
  const boxes = elements.filter(isRecord).map((element) => {
    const x = numericElementValue(element, "x");
    const y = numericElementValue(element, "y");
    const width = numericElementValue(element, "width");
    const height = numericElementValue(element, "height");
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  });
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const textFromShareElements = (elements: readonly unknown[]) =>
  Array.from(
    new Set(
      elements
        .filter(isRecord)
        .flatMap((element) =>
          ["text", "originalText", "rawText"]
            .map((key) => element[key])
            .filter(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0,
            )
            .map((value) => value.trim()),
        ),
    ),
  );

const labelsFromInput = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  );

const shareStatusLabel = (status: AgentShareSummary["status"]) => {
  if (status === "active") {
    return "Active";
  }
  if (status === "expired") {
    return "Expired";
  }
  return "Revoked";
};

type FileTreeNode = {
  kind: "directory" | "file";
  name: string;
  relativePath: string;
  children: FileTreeNode[];
  scene?: SceneMetadata;
};

type PendingTreeCreate = {
  kind: "file" | "directory";
  parentPath: string;
  name: string;
};

type PendingSceneEdit = {
  kind: "rename" | "tags";
  sceneId: string;
  value: string;
};

type ActiveDocument = {
  sceneId: string;
  payload: ScenePayload;
};

const createTreeNode = (
  kind: FileTreeNode["kind"],
  name: string,
  relativePath: string,
): FileTreeNode => ({
  kind,
  name,
  relativePath,
  children: [],
});

const ensureDirectoryNode = (root: FileTreeNode, relativePath: string) => {
  if (!relativePath) {
    return root;
  }

  let current = root;
  const parts = relativePath.split("/").filter(Boolean);
  let path = "";
  for (const part of parts) {
    path = joinPath(path, part);
    let next = current.children.find(
      (child) => child.kind === "directory" && child.relativePath === path,
    );
    if (!next) {
      next = createTreeNode("directory", part, path);
      current.children.push(next);
    }
    current = next;
  }
  return current;
};

const sortTree = (node: FileTreeNode) => {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  node.children.forEach(sortTree);
  return node;
};

const filterTree = (node: FileTreeNode, query: string): FileTreeNode | null => {
  if (!query) {
    return node;
  }

  if (node.kind === "file") {
    const scene = node.scene;
    const searchable = [
      node.name,
      node.relativePath,
      scene?.title,
      scene?.text,
      ...(scene?.tags ?? []),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return searchable.includes(query) ? node : null;
  }

  const children = node.children
    .map((child) => filterTree(child, query))
    .filter((child): child is FileTreeNode => Boolean(child));
  if (children.length === 0) {
    return null;
  }
  return { ...node, children };
};

const buildFileTree = (
  entries: WorkspaceTreeEntry[],
  scenes: SceneMetadata[],
  query: string,
) => {
  const root = createTreeNode("directory", "workspace", "");
  for (const entry of entries) {
    if (entry.kind === "directory") {
      ensureDirectoryNode(root, entry.relativePath);
    }
  }

  for (const scene of scenes) {
    const parent = ensureDirectoryNode(root, dirname(scene.relativePath));
    if (
      !parent.children.some(
        (child) =>
          child.kind === "file" && child.relativePath === scene.relativePath,
      )
    ) {
      parent.children.push({
        kind: "file",
        name: basename(scene.relativePath),
        relativePath: scene.relativePath,
        children: [],
        scene,
      });
    }
  }

  return (
    filterTree(sortTree(root), query.trim().toLowerCase()) ??
    createTreeNode("directory", "workspace", "")
  );
};

const expandedFoldersFromEntries = (
  entries: WorkspaceTreeEntry[],
  scenes: SceneMetadata[],
) => {
  const expanded = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "directory") {
      expanded.add(entry.relativePath);
    }
  }
  for (const scene of scenes) {
    const parts = dirname(scene.relativePath).split("/").filter(Boolean);
    let path = "";
    for (const part of parts) {
      path = joinPath(path, part);
      expanded.add(path);
    }
  }
  return expanded;
};

const folderAncestors = (relativePath: string) => {
  const ancestors: string[] = [];
  let path = "";
  for (const part of normalizePath(relativePath).split("/").filter(Boolean)) {
    path = joinPath(path, part);
    ancestors.push(path);
  }
  return ancestors;
};

const safeFolderInput = (value: string) =>
  normalizePath(value)
    .split("/")
    .map(safeSegment)
    .filter(Boolean)
    .join("/");

export const App = () => {
  const support = useMemo(fileSystemSupport, []);
  const [recentWorkspaces, setRecentWorkspaces] = useState<
    RecentWorkspaceRecord[]
  >([]);
  const [workspace, setWorkspace] = useState<WorkspaceSession | null>(null);
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(
    null,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [workspaceEntries, setWorkspaceEntries] = useState<
    WorkspaceTreeEntry[]
  >([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingCreate, setPendingCreate] = useState<PendingTreeCreate | null>(
    null,
  );
  const [pendingSceneEdit, setPendingSceneEdit] =
    useState<PendingSceneEdit | null>(null);
  const [openMenuSceneId, setOpenMenuSceneId] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [agentShareStatus, setAgentShareStatus] =
    useState<AgentShareStatus | null>(null);
  const [agentShares, setAgentShares] = useState<AgentShareSummary[]>([]);
  const [sharePreviewUrls, setSharePreviewUrls] = useState<Record<string, string>>({});
  const [isSharingToAgent, setIsSharingToAgent] = useState(false);
  const [isAgentShareMenuOpen, setIsAgentShareMenuOpen] = useState(false);
  const [handoffPanel, setHandoffPanel] = useState<HandoffPanelState | null>(
    null,
  );
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [isSharesManagerOpen, setIsSharesManagerOpen] = useState(false);
  const [exposeCurrentSelection, setExposeCurrentSelection] = useState(false);
  const [currentSelectionRevision, setCurrentSelectionRevision] = useState(0);
  const [editingShareId, setEditingShareId] = useState<string | null>(null);
  const [editingShareTitle, setEditingShareTitle] = useState("");
  const [editingShareDescription, setEditingShareDescription] = useState("");
  const [editingShareLabels, setEditingShareLabels] = useState("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCreateInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSceneEditInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const skipNextChangeRef = useRef(false);
  const draftSceneIdRef = useRef<string | null>(null);
  const lastSavedRawRef = useRef<string | null>(null);
  const latestRawRef = useRef<string | null>(null);
  const lastLocalChangeAtRef = useRef<number | null>(null);
  const lastSuccessfulSaveAtRef = useRef<number | null>(null);
  const lastSaveErrorAtRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const saveInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const createCommitInFlightRef = useRef(false);
  const suppressPendingCreateBlurRef = useRef(false);
  const sceneLoadRequestRef = useRef(0);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  const thumbnailUrlsRef = useRef<Record<string, string>>({});
  const externalRescanInFlightRef = useRef(false);
  const lastExternalRescanAtRef = useRef(0);

  const scenes = workspace?.index.scenes ?? [];
  const activeSceneId = activeDocument?.sceneId ?? null;
  const activePayload = activeDocument?.payload ?? null;
  const activeScene =
    scenes.find((scene) => scene.id === activeSceneId) ?? null;
  const fileTree = useMemo(
    () => buildFileTree(workspaceEntries, scenes, query),
    [query, scenes, workspaceEntries],
  );
  const filteredScenes = useMemo(
    () =>
      filterScenes(scenes, {
        query,
        folderPath: selectedFolder,
        tag: selectedTag,
        favoritesOnly,
        sortMode,
      }),
    [favoritesOnly, query, scenes, selectedFolder, selectedTag, sortMode],
  );
  const recentAgentShares = useMemo(
    () =>
      [...agentShares]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .slice(0, 5),
    [agentShares],
  );

  const setWorkspaceVersion = useCallback((next: WorkspaceSession) => {
    setWorkspace({
      ...next,
      index: {
        ...next.index,
        scenes: [...next.index.scenes],
        folders: [...next.index.folders],
        templates: [...next.index.templates],
      },
    });
  }, []);

  const markPayloadAsSaved = useCallback((payload: ScenePayload | null) => {
    const raw = payload ? serializeDraft(draftFromPayload(payload)) : null;
    lastSavedRawRef.current = raw;
    latestRawRef.current = raw;
    const now = Date.now();
    lastLocalChangeAtRef.current = null;
    lastSaveErrorAtRef.current = null;
    lastSuccessfulSaveAtRef.current = raw ? now : null;
  }, []);

  const expandFolderPath = useCallback((relativePath: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      for (const ancestor of folderAncestors(relativePath)) {
        next.add(ancestor);
      }
      return next;
    });
  }, []);

  const refreshWorkspaceEntries = useCallback(async (session: WorkspaceSession) => {
    const entries = await listWorkspaceEntries(session.handle);
    setWorkspaceEntries(entries);
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      for (const path of expandedFoldersFromEntries(entries, session.index.scenes)) {
        next.add(path);
      }
      return next;
    });
  }, []);

  const refreshWorkspaceFromDisk = useCallback(
    async (options: { visibleError?: boolean; throttle?: boolean } = {}) => {
      if (!workspace || externalRescanInFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (
        options.throttle !== false &&
        now - lastExternalRescanAtRef.current < EXTERNAL_RESCAN_MIN_GAP_MS
      ) {
        return;
      }

      lastExternalRescanAtRef.current = now;
      externalRescanInFlightRef.current = true;
      try {
        const changed = await rescanWorkspace(workspace);
        if (changed) {
          setWorkspaceVersion(workspace);
        }
      } catch (cause) {
        if (options.visibleError) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        externalRescanInFlightRef.current = false;
      }

      void refreshWorkspaceEntries(workspace).catch((cause) => {
        if (options.visibleError) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    },
    [refreshWorkspaceEntries, setWorkspaceVersion, workspace],
  );

  const loadRecent = useCallback(async () => {
    try {
      setRecentWorkspaces(await listRecentWorkspaces());
    } catch {
      setRecentWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const refreshAgentShareStatus = useCallback(async () => {
    if (!isTauriRuntime()) {
      setAgentShareStatus(null);
      return null;
    }
    const status = await getAgentShareStatus();
    setAgentShareStatus(status);
    return status;
  }, []);

  const refreshAgentShares = useCallback(async () => {
    if (!isTauriRuntime()) {
      setAgentShares([]);
      return [];
    }
    const shares = await listAgentShares();
    setAgentShares(shares);
    return shares;
  }, []);

  useEffect(() => {
    void refreshAgentShareStatus().catch(() => {
      setAgentShareStatus(null);
    });
    void refreshAgentShares().catch(() => {
      setAgentShares([]);
    });
  }, [refreshAgentShareStatus, refreshAgentShares]);

  useEffect(() => {
    if (!isTauriRuntime() || agentShares.length === 0) {
      setSharePreviewUrls({});
      return;
    }

    let disposed = false;
    const createdUrls: string[] = [];

    void (async () => {
      const previews = await Promise.all(
        agentShares.map(async (share) => {
          if (!isShareReadable(share)) {
            return null;
          }
          try {
            const bytes = await readAgentShareRenderPng(share.shareId);
            const url = URL.createObjectURL(
              new Blob([new Uint8Array(bytes)], { type: "image/png" }),
            );
            createdUrls.push(url);
            return [share.shareId, url] as const;
          } catch {
            return null;
          }
        }),
      );

      if (disposed) {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      const previewEntries = previews.filter(
        (preview): preview is readonly [string, string] => preview !== null,
      );
      setSharePreviewUrls(Object.fromEntries(previewEntries));
    })();

    return () => {
      disposed = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [agentShares]);

  const toggleAgentSharing = useCallback(async () => {
    if (!isTauriRuntime()) {
      setError("Agent Sharing 目前只在 Mac App 中可用。");
      return null;
    }
    try {
      const status = agentShareStatus?.enabled
        ? await stopAgentShareServer()
        : await startAgentShareServer();
      setAgentShareStatus(status);
      if (!status.enabled) {
        setExposeCurrentSelection(false);
      }
      setError(
        status.enabled
          ? `Agent Sharing 已开启：${status.baseUrl}`
          : "Agent Sharing 已关闭，本地 MCP/API 已停止监听。",
      );
      return status;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [agentShareStatus?.enabled]);

  const copyAgentText = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setError(`${label} 已复制。`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);

  useEffect(() => {
    if (!openMenuSceneId) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".tree-row-menu")) {
        return;
      }
      setOpenMenuSceneId(null);
    };

    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuSceneId(null);
      }
    };
    const closeOnWindowBlur = () => {
      setOpenMenuSceneId(null);
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKeyDown);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [openMenuSceneId]);

  useEffect(() => {
    if (!isAgentShareMenuOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(".agent-share-menu-shell")
      ) {
        return;
      }
      setIsAgentShareMenuOpen(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAgentShareMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [isAgentShareMenuOpen]);

  useEffect(() => {
    if (!workspace) {
      return;
    }

    const refreshOnFocus = () => {
      void refreshWorkspaceFromDisk({ visibleError: true });
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshWorkspaceFromDisk({ visibleError: true });
      }
    };
    const intervalId = window.setInterval(() => {
      void refreshWorkspaceFromDisk();
    }, EXTERNAL_RESCAN_INTERVAL_MS);

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [refreshWorkspaceFromDisk, workspace]);

  useEffect(() => {
    if (!pendingCreate) {
      return;
    }
    window.requestAnimationFrame(() => {
      pendingCreateInputRef.current?.focus();
      pendingCreateInputRef.current?.select();
    });
  }, [pendingCreate]);

  useEffect(() => {
    if (!pendingSceneEdit) {
      return;
    }
    window.requestAnimationFrame(() => {
      pendingSceneEditInputRef.current?.focus();
      pendingSceneEditInputRef.current?.select();
    });
  }, [pendingSceneEdit]);

  const openWorkspaceHandle = useCallback(
    async (handle: WorkspaceHandle) => {
      setIsBooting(true);
      setError(null);
      try {
        if (!(await ensurePermission(handle))) {
          throw new Error("没有获得目录读写权限。");
        }
        const session = await initializeWorkspace(handle);
        let initialScene = session.index.scenes[0] ?? null;
        let initialPayload: ScenePayload | null = null;
        if (!initialScene) {
          const created = await createScene(session, "scenes", "Untitled");
          initialScene = created.metadata;
          initialPayload = created.payload;
        }
        const nextPayload =
          initialScene ? initialPayload ?? (await readScene(session, initialScene)) : null;

        sceneLoadRequestRef.current += 1;
        draftRef.current = null;
        draftSceneIdRef.current = null;
        markPayloadAsSaved(nextPayload);
        setSaveStatus("idle");
        setWorkspaceVersion(session);
        setSelectedFolder(initialScene?.folderPath ?? "");
        setSelectedTag("");
        if (initialScene && nextPayload) {
          skipNextChangeRef.current = true;
          setActiveDocument({ sceneId: initialScene.id, payload: nextPayload });
        } else {
          setActiveDocument(null);
        }
        await refreshWorkspaceEntries(session);
        await rememberWorkspace(handle, session.name);
        await loadRecent();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsBooting(false);
      }
    },
    [loadRecent, markPayloadAsSaved, refreshWorkspaceEntries, setWorkspaceVersion],
  );

  const pickWorkspace = useCallback(async () => {
    if (isTauriRuntime()) {
      const handle = await pickNativeWorkspace();
      if (handle) {
        await openWorkspaceHandle(handle);
      }
      return;
    }

    if (!window.showDirectoryPicker) {
      setError(support.reason ?? "当前浏览器不支持目录授权。");
      return;
    }
    const handle = await window.showDirectoryPicker({
      id: "personal-excalidraw-workspace",
      mode: "readwrite",
    });
    await openWorkspaceHandle(handle);
  }, [openWorkspaceHandle, support.reason]);

  const openScene = useCallback(
    async (scene: SceneMetadata) => {
      if (!workspace) {
        return;
      }
      const requestId = sceneLoadRequestRef.current + 1;
      sceneLoadRequestRef.current = requestId;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (saveStatus === "dirty") {
        await saveNowRef.current();
      }
      setError(null);
      setSaveStatus("idle");
      setActiveDocument(null);
      draftRef.current = null;
      draftSceneIdRef.current = null;
      const payload = await readScene(workspace, scene);
      if (sceneLoadRequestRef.current !== requestId) {
        return;
      }
      skipNextChangeRef.current = true;
      markPayloadAsSaved(payload);
      setSelectedFolder(scene.folderPath);
      setActiveDocument({ sceneId: scene.id, payload });
      setWorkspaceVersion(workspace);
    },
    [markPayloadAsSaved, saveStatus, setWorkspaceVersion, workspace],
  );

  const refreshThumbnails = useCallback(
    async (session: WorkspaceSession, nextScenes = session.index.scenes) => {
      const nextUrls: Record<string, string> = {};
      for (const scene of nextScenes.slice(0, 80)) {
        if (!scene.thumbnailRelativePath) {
          continue;
        }
        try {
          const file = await readFile(session.handle, scene.thumbnailRelativePath);
          nextUrls[scene.id] = URL.createObjectURL(file);
        } catch {
          // Thumbnails are opportunistic. Missing files fall back to placeholders.
        }
      }

      setThumbnailUrls((previous) => {
        Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
        thumbnailUrlsRef.current = nextUrls;
        return nextUrls;
      });
    },
    [],
  );

  const getActiveDraft = useCallback((): DraftState | null => {
    if (!activePayload || !activeSceneId) {
      return null;
    }
    if (draftRef.current && draftSceneIdRef.current === activeSceneId) {
      return draftRef.current;
    }
    return draftFromPayload(activePayload);
  }, [activePayload, activeSceneId]);

  useEffect(() => {
    if (workspace) {
      void refreshThumbnails(workspace);
    }
  }, [refreshThumbnails, workspace]);

  const generateThumbnail = useCallback(
    async (scene: SceneMetadata, draft: DraftState) => {
      if (!workspace || !scene.thumbnailRelativePath) {
        return;
      }
      const elements = draft.elements.filter(
        (element) =>
          !(
            element &&
            typeof element === "object" &&
            (element as { isDeleted?: boolean }).isDeleted
          ),
      );
      if (elements.length === 0) {
        return;
      }

      try {
        const blob = await exportToBlob({
          elements: elements as never,
          appState: {
            ...draft.appState,
            exportBackground: true,
            exportWithDarkMode: false,
            viewModeEnabled: true,
          },
          files: draft.files as never,
          mimeType: "image/png",
          maxWidthOrHeight: THUMBNAIL_SIZE,
          exportPadding: 18,
        });
        await writeBlobFile(workspace.handle, scene.thumbnailRelativePath, blob);
        const file = await readFile(workspace.handle, scene.thumbnailRelativePath);
        const url = URL.createObjectURL(file);
        setThumbnailUrls((previous) => {
          if (previous[scene.id]) {
            URL.revokeObjectURL(previous[scene.id]);
          }
          const next = { ...previous, [scene.id]: url };
          thumbnailUrlsRef.current = next;
          return next;
        });
      } catch {
        // Keep save reliable even when a particular scene cannot render.
      }
    },
    [refreshThumbnails, workspace],
  );

  const saveNow = useCallback(async () => {
    if (saveInFlightPromiseRef.current) {
      try {
        await saveInFlightPromiseRef.current;
      } catch {
        // The owning save call has already surfaced the error state.
      }
    }

    if (
      latestRawRef.current &&
      lastSavedRawRef.current &&
      latestRawRef.current === lastSavedRawRef.current
    ) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setSaveStatus((previous) =>
        previous === "dirty" || previous === "saving" || previous === "error"
          ? "saved"
          : previous,
      );
    }

    const draft = getActiveDraft();
    if (!workspace || !activeScene || !draft) {
      return;
    }
    const scene = activeScene;
    const raw = latestRawRef.current ?? serializeDraft(draft);
    latestRawRef.current = raw;
    if (lastSavedRawRef.current === raw) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setSaveStatus((previous) =>
        previous === "dirty" || previous === "saving" || previous === "error"
          ? "saved"
          : previous,
      );
      return;
    }

    const rawToSave = raw;
    const draftToSave = draft;
    saveInFlightRef.current = true;
    const savePromise = (async () => {
      setSaveStatus("saving");
      setError(null);
      await saveScene(workspace, scene, rawToSave, draftToSave);
      await generateThumbnail(scene, draftToSave);
      setWorkspaceVersion(workspace);
      lastSavedRawRef.current = rawToSave;
      lastSuccessfulSaveAtRef.current = Date.now();
      lastSaveErrorAtRef.current = null;
      if (latestRawRef.current === rawToSave && draftSceneIdRef.current === scene.id) {
        setSaveStatus("saved");
      } else if (draftSceneIdRef.current === scene.id) {
        setSaveStatus("dirty");
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = window.setTimeout(() => {
          void saveNowRef.current();
        }, AUTOSAVE_DELAY_MS);
      }
    })();

    saveInFlightPromiseRef.current = savePromise;

    try {
      await savePromise;
    } catch (cause) {
      try {
        await writeAutosaveDraft(workspace, scene, rawToSave);
      } catch {
        // The visible save error below is the actionable one.
      }
      lastSaveErrorAtRef.current = Date.now();
      setSaveStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveInFlightRef.current = false;
      if (saveInFlightPromiseRef.current === savePromise) {
        saveInFlightPromiseRef.current = null;
      }
    }
  }, [
    activeScene,
    generateThumbnail,
    getActiveDraft,
    setWorkspaceVersion,
    workspace,
  ]);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  useEffect(() => {
    if (saveStatus !== "dirty") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (saveInFlightRef.current || saveInFlightPromiseRef.current) {
        return;
      }

      const latestRaw = latestRawRef.current;
      const savedRaw = lastSavedRawRef.current;
      if (latestRaw && savedRaw && latestRaw === savedRaw) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        setSaveStatus("saved");
        return;
      }

      if (!autosaveTimerRef.current) {
        scheduleAutosave();
      }
    }, SAVE_RECONCILE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [saveStatus, scheduleAutosave]);

  const handleCanvasChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      if (!activeScene) {
        return;
      }
      const draft = { elements, appState, files };
      const raw = serializeDraft(draft);
      draftRef.current = draft;
      draftSceneIdRef.current = activeScene.id;
      latestRawRef.current = raw;
      if (skipNextChangeRef.current) {
        skipNextChangeRef.current = false;
        lastSavedRawRef.current = raw;
        return;
      }
      if (lastSavedRawRef.current === raw) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        if (!saveInFlightRef.current) {
          setSaveStatus((previous) =>
            previous === "dirty" || previous === "error" ? "saved" : previous,
          );
        }
        return;
      }
      lastLocalChangeAtRef.current = Date.now();
      setSaveStatus("dirty");
      if (exposeCurrentSelection) {
        setCurrentSelectionRevision((revision) => revision + 1);
      }
      scheduleAutosave();
    },
    [activeScene, exposeCurrentSelection, scheduleAutosave],
  );

  const createNewScene = useCallback(() => {
    if (!workspace) {
      return;
    }
    const targetFolder = selectedFolder || activeScene?.folderPath || "scenes";
    const used = new Set(workspace.index.scenes.map((scene) => scene.relativePath));
    setError(null);
    setQuery("");
    setSelectedFolder(targetFolder);
    expandFolderPath(targetFolder);
    setPendingCreate({
      kind: "file",
      parentPath: targetFolder,
      name: uniqueFilename("Untitled", used, targetFolder),
    });
  }, [activeScene?.folderPath, expandFolderPath, selectedFolder, workspace]);

  const createFolder = useCallback(() => {
    if (!workspace) {
      return;
    }
    const parentPath = selectedFolder || activeScene?.folderPath || "scenes";
    const existingFolders = new Set([
      ...workspace.index.folders,
      ...workspaceEntries
        .filter((entry) => entry.kind === "directory")
        .map((entry) => entry.relativePath),
    ]);
    let name = "New Folder";
    let i = 2;
    while (existingFolders.has(joinPath(parentPath, name))) {
      name = `New Folder ${i}`;
      i += 1;
    }
    setError(null);
    setQuery("");
    setSelectedFolder(parentPath);
    expandFolderPath(parentPath);
    setPendingCreate({
      kind: "directory",
      parentPath,
      name,
    });
  }, [
    activeScene?.folderPath,
    expandFolderPath,
    selectedFolder,
    workspace,
    workspaceEntries,
  ]);

  const cancelPendingCreate = useCallback(() => {
    suppressPendingCreateBlurRef.current = true;
    setPendingCreate(null);
    window.setTimeout(() => {
      suppressPendingCreateBlurRef.current = false;
    }, 0);
  }, []);

  const commitPendingCreate = useCallback(async () => {
    if (!workspace || !pendingCreate || createCommitInFlightRef.current) {
      return;
    }

    const draft = pendingCreate;
    const rawName = draft.name.trim();
    createCommitInFlightRef.current = true;
    setPendingCreate(null);
    if (!rawName) {
      createCommitInFlightRef.current = false;
      return;
    }

    setError(null);
    try {
      if (draft.kind === "file") {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        if (saveStatus === "dirty") {
          await saveNowRef.current();
        }
        const { metadata, payload } = await createScene(
          workspace,
          draft.parentPath,
          rawName,
        );
        setWorkspaceVersion(workspace);
        await refreshWorkspaceEntries(workspace);
        sceneLoadRequestRef.current += 1;
        skipNextChangeRef.current = true;
        draftRef.current = null;
        draftSceneIdRef.current = null;
        markPayloadAsSaved(payload);
        setSaveStatus("idle");
        setSelectedFolder(metadata.folderPath);
        setActiveDocument({ sceneId: metadata.id, payload });
        expandFolderPath(metadata.folderPath);
        return;
      }

      const folderInput = safeFolderInput(rawName);
      if (!folderInput) {
        return;
      }
      const relativePath = joinPath(draft.parentPath, folderInput);
      await ensureDirectory(workspace.handle, relativePath);
      if (!workspace.index.folders.includes(relativePath)) {
        workspace.index.folders.push(relativePath);
        workspace.index.folders.sort();
        await writeIndex(workspace);
      }
      setSelectedFolder(relativePath);
      setWorkspaceVersion(workspace);
      await refreshWorkspaceEntries(workspace);
      expandFolderPath(relativePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      createCommitInFlightRef.current = false;
    }
  }, [
    expandFolderPath,
    markPayloadAsSaved,
    pendingCreate,
    refreshWorkspaceEntries,
    saveStatus,
    setWorkspaceVersion,
    workspace,
  ]);

  const importFiles = useCallback(
    async (files: Array<{ name: string; text(): Promise<string> }>) => {
      if (!workspace || files.length === 0) {
        return;
      }
      const folder = selectedFolder || "scenes";
      await ensureDirectory(workspace.handle, folder);
      const used = new Set(workspace.index.scenes.map((scene) => scene.relativePath));

      for (const file of files) {
        const raw = await file.text();
        JSON.parse(raw);
        const filename = uniqueFilename(file.name, used, folder);
        const relativePath = joinPath(folder, filename);
        used.add(relativePath);
        await writeTextFile(workspace.handle, relativePath, raw);
      }
      await rescanWorkspace(workspace);
      setWorkspaceVersion(workspace);
      await refreshWorkspaceEntries(workspace);
    },
    [refreshWorkspaceEntries, selectedFolder, setWorkspaceVersion, workspace],
  );

  const pickFilesToImport = useCallback(async () => {
    if (isTauriRuntime()) {
      const files = await pickNativeExcalidrawFiles();
      await importFiles(files.map((file) => ({
        name: file.name,
        text: async () => file.text,
      })));
      return;
    }

    if (window.showOpenFilePicker) {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "Excalidraw files",
            accept: { "application/json": [".excalidraw"] },
          },
        ],
      });
      await importFiles(await Promise.all(handles.map((handle) => handle.getFile())));
      return;
    }
    fileInputRef.current?.click();
  }, [importFiles]);

  const rescan = useCallback(async () => {
    if (!workspace) {
      return;
    }
    await rescanWorkspace(workspace);
    setWorkspaceVersion(workspace);
    await refreshWorkspaceEntries(workspace);
  }, [refreshWorkspaceEntries, setWorkspaceVersion, workspace]);

  const renameActive = useCallback(() => {
    if (!workspace || !activeScene) {
      return;
    }
    setPendingSceneEdit({
      kind: "rename",
      sceneId: activeScene.id,
      value: sceneFilename(activeScene),
    });
  }, [activeScene, workspace]);

  const cancelPendingSceneEdit = useCallback(() => {
    setPendingSceneEdit(null);
  }, []);

  const commitPendingSceneEdit = useCallback(async () => {
    if (!workspace || !pendingSceneEdit) {
      return;
    }
    const scene = workspace.index.scenes.find(
      (item) => item.id === pendingSceneEdit.sceneId,
    );
    if (!scene) {
      setPendingSceneEdit(null);
      return;
    }

    const value = pendingSceneEdit.value.trim();
    setPendingSceneEdit(null);
    if (!value && pendingSceneEdit.kind === "rename") {
      return;
    }

    setError(null);
    try {
      if (pendingSceneEdit.kind === "rename") {
        if (saveStatus === "dirty") {
          await saveNowRef.current();
        }
        const renamed = await renameScene(workspace, scene, value);
        const payload =
          renamed.id === activeSceneId ? await readScene(workspace, renamed) : null;
        if (payload) {
          sceneLoadRequestRef.current += 1;
          draftRef.current = null;
          draftSceneIdRef.current = null;
          skipNextChangeRef.current = true;
          markPayloadAsSaved(payload);
          setSaveStatus("idle");
          setActiveDocument({ sceneId: renamed.id, payload });
        }
        setWorkspaceVersion(workspace);
        await refreshWorkspaceEntries(workspace);
        setError(`已重命名为 ${sceneFilename(renamed)}`);
        return;
      }

      const nextTags = Array.from(
        new Set(
          value
            .split(/[,\s]+/)
            .map((tag) => tag.trim().replace(/\s+/g, "-"))
            .filter(Boolean),
        ),
      );
      await updateSceneMetadata(workspace, scene.id, { tags: nextTags });
      setWorkspaceVersion(workspace);
      setError(nextTags.length ? `已更新标签：${nextTags.join(", ")}` : "已清空标签");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [
    activeSceneId,
    markPayloadAsSaved,
    pendingSceneEdit,
    refreshWorkspaceEntries,
    saveStatus,
    setWorkspaceVersion,
    workspace,
  ]);

  const duplicateActive = useCallback(async () => {
    if (!workspace || !activeScene) {
      return;
    }
    const next = await duplicateScene(workspace, activeScene);
    setWorkspaceVersion(workspace);
    await refreshWorkspaceEntries(workspace);
    await openScene(next);
    setError(`已复制为 ${sceneFilename(next)}`);
  }, [activeScene, openScene, refreshWorkspaceEntries, setWorkspaceVersion, workspace]);

  const trashActive = useCallback(async () => {
    if (!workspace || !activeScene) {
      return;
    }
    const trashedName = sceneFilename(activeScene);
    await moveSceneToTrash(workspace, activeScene);
    const next = workspace.index.scenes[0] ?? null;
    setWorkspaceVersion(workspace);
    await refreshWorkspaceEntries(workspace);
    if (next) {
      await openScene(next);
    } else {
      sceneLoadRequestRef.current += 1;
      draftRef.current = null;
      draftSceneIdRef.current = null;
      markPayloadAsSaved(null);
      setSaveStatus("idle");
      setActiveDocument(null);
    }
    setError(`已移动到本地回收区：${trashedName}`);
  }, [
    activeScene,
    markPayloadAsSaved,
    openScene,
    refreshWorkspaceEntries,
    setWorkspaceVersion,
    workspace,
  ]);

  const toggleFavorite = useCallback(async () => {
    if (!workspace || !activeScene) {
      return;
    }
    await updateSceneMetadata(workspace, activeScene.id, {
      favorite: !activeScene.favorite,
    });
    setWorkspaceVersion(workspace);
    setError(activeScene.favorite ? "已取消收藏" : "已收藏");
  }, [activeScene, setWorkspaceVersion, workspace]);

  const editTags = useCallback(() => {
    if (!workspace || !activeScene) {
      return;
    }
    setPendingSceneEdit({
      kind: "tags",
      sceneId: activeScene.id,
      value: activeScene.tags.join(", "),
    });
  }, [activeScene, workspace]);

  const saveExportBlob = useCallback(
    async (
      blob: Blob,
      filename: string,
      filters: Array<{ name: string; extensions: string[] }>,
    ) => {
      if (isTauriRuntime()) {
        let defaultPath = filename;
        if (workspace && activeScene && isNativeHandle(workspace.handle)) {
          const targetRelativePath = joinPath(
            dirname(activeScene.relativePath),
            filename,
          );
          defaultPath = `${workspace.handle.path}/${targetRelativePath}`;
        }
        const path = await pickNativeSaveFile(defaultPath, filters);
        if (!path) {
          return;
        }
        await writeAbsoluteBlobFile(path, blob);
        if (
          workspace &&
          isNativeHandle(workspace.handle) &&
          /\.excalidraw$/i.test(path) &&
          isPathInsideDirectory(path, workspace.handle.path)
        ) {
          await refreshWorkspaceFromDisk({ throttle: false, visibleError: true });
        }
        setError(`已导出到 ${path}`);
        return;
      }

      downloadBlob(blob, filename);
      setError(`已导出 ${filename}`);
    },
    [activeScene, refreshWorkspaceFromDisk, workspace],
  );

  const exportCurrent = useCallback(
    async (type: "png" | "svg" | "json") => {
      if (!activeScene) {
        return;
      }
      const draft = getActiveDraft();
      if (!draft) {
        setError("当前文件还没有可导出的内容");
        return;
      }
      const elements = draft.elements.filter(
        (element) =>
          !(
            element &&
            typeof element === "object" &&
            (element as { isDeleted?: boolean }).isDeleted
          ),
      );

      if (type === "json") {
        const raw = serializeAsJSON(
          draft.elements as never,
          draft.appState as never,
          draft.files as never,
          "local",
        );
        await saveExportBlob(
          new Blob([raw], { type: "application/json" }),
          `${stem(sceneFilename(activeScene))} export.excalidraw`,
          [{ name: "Excalidraw", extensions: ["excalidraw"] }],
        );
        return;
      }

      if (type === "png") {
        const blob = await exportToBlob({
          elements: elements as never,
          appState: { ...draft.appState, exportBackground: true },
          files: draft.files as never,
          mimeType: "image/png",
          exportPadding: 24,
        });
        await saveExportBlob(blob, `${stem(sceneFilename(activeScene))} export.png`, [
          { name: "PNG image", extensions: ["png"] },
        ]);
        return;
      }

      const svg = await exportToSvg({
        elements: elements as never,
        appState: { ...draft.appState, exportBackground: true },
        files: draft.files as never,
        exportPadding: 24,
      });
      await saveExportBlob(
        new Blob([svg.outerHTML], { type: "image/svg+xml" }),
        `${stem(sceneFilename(activeScene))} export.svg`,
        [{ name: "SVG image", extensions: ["svg"] }],
      );
    },
    [activeScene, getActiveDraft, saveExportBlob],
  );

  const buildAgentSharePayload = useCallback(
    async (options: {
      runtimeCurrentSelection: boolean;
      forceSceneScope?: boolean;
    }): Promise<AgentSharePayload> => {
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
        !options.forceSceneScope && selectedIds.size > 0
          ? collectAgentShareElements(allElements, selectedIds)
          : [];
      const elementsToShare = selectedElements.length > 0 ? selectedElements : allElements;
      if (elementsToShare.length === 0) {
        throw new Error("当前画布没有可分享的图形。");
      }

      const scope = selectedElements.length > 0 ? "selection" : "scene";
      const shareId = options.runtimeCurrentSelection ? "current-selection" : createShareId();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + AGENT_SHARE_TTL_MS);
      const createdAtIso = createdAt.toISOString();
      const expiresAtIso = expiresAt.toISOString();
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
        elementIds: elementsToShare
          .map(elementId)
          .filter((id): id is string => Boolean(id)),
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
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
        expiresAt: expiresAtIso,
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
          selection: {
            ...selection,
            elements: elementsToShare,
          },
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
          createdAt: createdAtIso,
          expiresAt: expiresAtIso,
          bounds,
          elementCount: elementsToShare.length,
          text,
          runtimeCurrentSelection: options.runtimeCurrentSelection,
        }),
      };
    },
    [activeScene, getActiveDraft],
  );

  const copyHandoffPrompt = useCallback(
    async (
      share: AgentShareSummary,
      target: AgentTarget,
      statusOverride?: AgentShareStatus | null,
    ) => {
      if (!isShareReadable(share)) {
        setError(
          `Share ${share.shareId} is ${share.status}. Create a fresh Agent Share to use this context.`,
        );
        return false;
      }
      const status = statusOverride ?? agentShareStatus;
      const baseUrl = status?.baseUrl ?? DEFAULT_AGENT_SHARE_BASE_URL;
      const mcpUrl = `${baseUrl}/mcp`;
      const manifestUrl = `${baseUrl}/v1/shares/${share.shareId}/manifest`;
      return copyAgentText(
        buildAgentHandoffPrompt(target, {
          share,
          baseUrl,
          mcpUrl,
          manifestUrl,
          apiEnabled: Boolean(status?.enabled),
        }),
        target === "codex" ? "Codex handoff prompt" : "Claude handoff prompt",
      );
    },
    [agentShareStatus, copyAgentText],
  );

  const shareActiveToAgent = useCallback(async (
    preferredScope: "selection" | "scene" = "selection",
  ) => {
    if (!workspace || !activeScene) {
      return;
    }
    if (!isTauriRuntime()) {
      setError("Share to Agent 目前只在 Mac App 中可用。");
      return;
    }

    setIsSharingToAgent(true);
    setError(null);
    try {
      if (saveStatus === "dirty") {
        await saveNowRef.current();
      }

      const status = agentShareStatus?.enabled
        ? agentShareStatus
        : await startAgentShareServer();
      setAgentShareStatus(status);
      if (!status.baseUrl) {
        throw new Error("Agent Sharing API 没有返回可用的本地地址。");
      }

      const share = await buildAgentSharePayload({
        runtimeCurrentSelection: false,
        forceSceneScope: preferredScope === "scene",
      });
      const registeredShare = await registerAgentShare(share);
      const nextStatus = await refreshAgentShareStatus();
      await refreshAgentShares();
      const handoffStatus = nextStatus ?? status;
      const copied = await copyHandoffPrompt(
        registeredShare,
        "codex",
        handoffStatus,
      );
      setHandoffPanel({
        share: registeredShare,
        autoCopiedTarget: "codex",
      });
      setError(
        copied
          ? `已创建 Agent 分享：${registeredShare.title}，Codex handoff prompt 已复制。`
          : `已创建 Agent 分享：${registeredShare.title}，请在面板中复制 handoff prompt。`,
      );
      if (nextStatus) {
        setAgentShareStatus(nextStatus);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSharingToAgent(false);
    }
  }, [
    activeScene,
    agentShareStatus,
    buildAgentSharePayload,
    copyHandoffPrompt,
    refreshAgentShareStatus,
    refreshAgentShares,
    saveStatus,
    workspace,
  ]);

  const beginEditShare = useCallback((share: AgentShareSummary) => {
    setEditingShareId(share.shareId);
    setEditingShareTitle(share.title);
    setEditingShareDescription(share.description);
    setEditingShareLabels(share.labels.join(", "));
  }, []);

  const cancelEditShare = useCallback(() => {
    setEditingShareId(null);
    setEditingShareTitle("");
    setEditingShareDescription("");
    setEditingShareLabels("");
  }, []);

  const saveShareMetadata = useCallback(
    async (shareId: string) => {
      const title = editingShareTitle.trim();
      if (!title) {
        setError("Share 名称不能为空。");
        return;
      }
      try {
        await renameAgentShare(shareId, {
          title,
          description: editingShareDescription.trim(),
          labels: labelsFromInput(editingShareLabels),
        });
        cancelEditShare();
        await refreshAgentShares();
        await refreshAgentShareStatus();
        setError("Share 信息已更新。");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [
      cancelEditShare,
      editingShareDescription,
      editingShareLabels,
      editingShareTitle,
      refreshAgentShareStatus,
      refreshAgentShares,
    ],
  );

  const revokeShare = useCallback(
    async (shareId: string) => {
      try {
        await revokeAgentShare(shareId);
        await refreshAgentShares();
        await refreshAgentShareStatus();
        setError("Share 已取消。");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshAgentShareStatus, refreshAgentShares],
  );

  const removeShare = useCallback(
    async (shareId: string) => {
      try {
        await deleteAgentShare(shareId);
        await refreshAgentShares();
        await refreshAgentShareStatus();
        setError("Share 已删除。");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshAgentShareStatus, refreshAgentShares],
  );

  const cleanExpiredShares = useCallback(async () => {
    try {
      const count = await cleanExpiredAgentShares();
      await refreshAgentShares();
      await refreshAgentShareStatus();
      setError(`已清理 ${count} 个过期分享。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshAgentShareStatus, refreshAgentShares]);

  const revokeAllShares = useCallback(async () => {
    try {
      await revokeAllAgentShares();
      await refreshAgentShares();
      await refreshAgentShareStatus();
      setError("所有 Share 已取消。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshAgentShareStatus, refreshAgentShares]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    if (!exposeCurrentSelection) {
      void setCurrentSelectionShare(null)
        .then(() => refreshAgentShareStatus())
        .catch(() => undefined);
      return;
    }
    if (!activeScene) {
      void setCurrentSelectionShare(null)
        .then(() => refreshAgentShareStatus())
        .catch(() => undefined);
      return;
    }
    const syncTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const status = agentShareStatus?.enabled
            ? agentShareStatus
            : await startAgentShareServer();
          setAgentShareStatus(status);
          const share = await buildAgentSharePayload({
            runtimeCurrentSelection: true,
          });
          await setCurrentSelectionShare(share);
          await refreshAgentShareStatus();
        } catch (cause) {
          void setCurrentSelectionShare(null).catch(() => undefined);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    }, 650);
    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [
    activeScene,
    agentShareStatus?.enabled,
    buildAgentSharePayload,
    currentSelectionRevision,
    exposeCurrentSelection,
    refreshAgentShareStatus,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void listen<string>("agent-sharing-menu", (event) => {
      if (event.payload === "agent-share-current") {
        void shareActiveToAgent();
        return;
      }
      if (event.payload === "agent-toggle-api") {
        void toggleAgentSharing();
        return;
      }
      if (event.payload === "agent-open-manager") {
        setIsSharesManagerOpen(true);
        void refreshAgentShares();
        return;
      }
      if (event.payload === "agent-open-settings") {
        setIsAgentSettingsOpen(true);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [refreshAgentShares, shareActiveToAgent, toggleAgentSharing]);

  const agentBaseUrl =
    agentShareStatus?.baseUrl ?? DEFAULT_AGENT_SHARE_BASE_URL;
  const agentMcpUrl = `${agentBaseUrl}/mcp`;
  const codexMcpConfig = useMemo(
    () =>
      [
        "[mcp_servers.personal_excalidraw]",
        `url = "${agentMcpUrl}"`,
        "enabled = true",
      ].join("\n"),
    [agentMcpUrl],
  );
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
  const agentApiReference = useMemo(
    () =>
      [
        "Personal Excalidraw Agent Sharing HTTP API",
        `Base URL: ${agentBaseUrl}`,
        "Auth: none. The server binds to 127.0.0.1 and is controlled by the App's Agent Sharing switch.",
        "",
        "Endpoints:",
        "GET /health",
        "GET /v1/status",
        "GET /v1/shares",
        "GET /v1/shares/{shareId}/manifest",
        "GET /v1/shares/{shareId}/selection.json",
        "GET /v1/shares/{shareId}/scene.excalidraw",
        "GET /v1/shares/{shareId}/brief.md",
        "GET /v1/shares/{shareId}/render.png",
        "GET /v1/shares/{shareId}/render.svg",
        "POST /mcp",
        "",
        "Read order for agents: brief.md, render.png/render.svg, selection.json, scene.excalidraw.",
        "Use MCP list_recent_shares to find the right named share before asking the user for a shareId.",
      ].join("\n"),
    [agentBaseUrl],
  );
  const agentSkillTemplate = useMemo(
    () =>
      [
        "---",
        "name: personal-excalidraw-agent-share",
        "description: Use when a user mentions an Excalidraw sketch, canvas, selected shapes, shareId, vibe UI mockup, UI sketch, architecture sketch, or asks an agent to implement, review, explain, or turn a shared drawing into work items using Personal Excalidraw Agent Sharing.",
        "---",
        "",
        "# Personal Excalidraw Agent Share",
        "",
        "Use the personal-excalidraw MCP server first when it is available. If MCP is not available but the user provides a manifest URL, use the local HTTP API directly.",
        "",
        "## Workflow",
        "",
        "1. Call list_recent_shares and match by title, description, sourceFile, labels, and textPreview.",
        "2. Read brief.md first for the sketch intent and source metadata.",
        "3. Read image.png or image.svg to inspect the visual layout.",
        "4. Read selection.json when exact text, bounds, element IDs, grouping, or interaction hints are needed.",
        "5. Read scene.excalidraw only when the full source file is necessary.",
        "",
        "## Constraints",
        "",
        "- Treat every share as read-only unless the user explicitly asks for a write-back workflow and the tool supports it.",
        "- Do not assume unshared canvas content exists.",
        "- If the API is off, unreachable, expired, or revoked, ask the user to open Personal Excalidraw, turn on Agent Sharing, and create or re-enable a share.",
        "- Prefer the smallest resource that answers the question.",
        "",
        "## UI Implementation From Sketch",
        "",
        "1. Convert the sketch into layout regions, components, visual hierarchy, states, and interactions.",
        "2. Identify ambiguous parts and make conservative assumptions grounded in the existing codebase.",
        "3. Implement using the app's current frontend patterns and design system.",
        "4. Run the local app and verify with screenshots or visual inspection when possible.",
      ].join("\n"),
    [],
  );

  const backupVisibleScenes = useCallback(async () => {
    if (!workspace || filteredScenes.length === 0) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportDir = joinPath(".personal-excalidraw", "exports", stamp);
    await ensureDirectory(workspace.handle, exportDir);
    for (const scene of filteredScenes) {
      const raw = await readTextFile(workspace.handle, scene.relativePath);
      await writeTextFile(workspace.handle, joinPath(exportDir, sceneFilename(scene)), raw);
    }
    setError(`已导出 ${filteredScenes.length} 个 .excalidraw 到 ${exportDir}`);
  }, [filteredScenes, workspace]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      Object.values(thumbnailUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    };
  }, []);

  const saveLabel =
    saveStatus === "saving"
      ? "Saving"
      : saveStatus === "dirty"
        ? "Unsaved"
        : saveStatus === "saved"
          ? "Saved"
          : saveStatus === "error"
            ? "Save failed"
            : "Ready";

  const saveStateTitle = (() => {
    if (saveStatus === "saving") {
      return "正在保存到当前工作区文件。";
    }
    if (saveStatus === "dirty") {
      const changedAt = lastLocalChangeAtRef.current
        ? ` 最近更改：${formatDateTime(
            new Date(lastLocalChangeAtRef.current).toISOString(),
          )}`
        : "";
      return `有未保存更改。点击立即保存。${changedAt}`;
    }
    if (saveStatus === "error") {
      const failedAt = lastSaveErrorAtRef.current
        ? ` 失败时间：${formatDateTime(
            new Date(lastSaveErrorAtRef.current).toISOString(),
          )}`
        : "";
      return `上次保存失败。点击重试保存。${failedAt}`;
    }
    if (lastSuccessfulSaveAtRef.current) {
      return `已保存。上次保存：${formatDateTime(
        new Date(lastSuccessfulSaveAtRef.current).toISOString(),
      )}`;
    }
    return "当前文件已就绪。";
  })();

  const renderPendingCreate = (depth: number): ReactNode => {
    if (!pendingCreate) {
      return null;
    }

    const paddingLeft = 10 + depth * 14;
    const Icon = pendingCreate.kind === "file" ? File : Folder;
    return (
      <form
        className="tree-create-row"
        style={{ paddingLeft }}
        onSubmit={(event) => {
          event.preventDefault();
          void commitPendingCreate();
        }}
      >
        <span className="tree-spacer" />
        <Icon size={15} />
        <input
          ref={pendingCreateInputRef}
          value={pendingCreate.name}
          onBlur={() => {
            if (!suppressPendingCreateBlurRef.current) {
              void commitPendingCreate();
            }
          }}
          onChange={(event) => {
            setPendingCreate((previous) =>
              previous ? { ...previous, name: event.target.value } : previous,
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelPendingCreate();
            }
          }}
          aria-label={
            pendingCreate.kind === "file" ? "新建文件名称" : "新建目录名称"
          }
        />
      </form>
    );
  };

  const runMenuAction = (action: () => Promise<void> | void) => {
    setOpenMenuSceneId(null);
    void Promise.resolve(action()).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const renderFileNode = (node: FileTreeNode, depth = 0): ReactNode => {
    const paddingLeft = 10 + depth * 14;

    if (node.kind === "directory") {
      const expanded = expandedFolders.has(node.relativePath);
      return (
        <div className="tree-group" key={node.relativePath || "root"}>
          <button
            className={
              selectedFolder === node.relativePath
                ? "tree-row tree-row--folder selected"
                : "tree-row tree-row--folder"
            }
            onClick={() => {
              setSelectedFolder(node.relativePath);
              setExpandedFolders((previous) => {
                const next = new Set(previous);
                if (next.has(node.relativePath)) {
                  next.delete(node.relativePath);
                } else {
                  next.add(node.relativePath);
                }
                return next;
              });
            }}
            style={{ paddingLeft }}
            title={node.relativePath}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={16} />
            <span>{node.name}</span>
          </button>
          {expanded && (
            <div className="tree-children">
              {node.children.map((child) => renderFileNode(child, depth + 1))}
              {pendingCreate?.parentPath === node.relativePath &&
                renderPendingCreate(depth + 1)}
            </div>
          )}
        </div>
      );
    }

    const isActive = node.scene?.id === activeSceneId;
    const rowEdit =
      node.scene && pendingSceneEdit?.sceneId === node.scene.id
        ? pendingSceneEdit
        : null;
    const isMenuOpen = Boolean(node.scene && openMenuSceneId === node.scene.id);

    return (
      <div className="tree-file-block" key={node.relativePath}>
        <div
          className={isActive ? "tree-file-row active" : "tree-file-row"}
          title={node.relativePath}
        >
          {rowEdit?.kind === "rename" ? (
            <form
              className="tree-file-open tree-file-open--editing"
              style={{ paddingLeft }}
              onSubmit={(event) => {
                event.preventDefault();
                void commitPendingSceneEdit();
              }}
            >
              <span className="tree-spacer" />
              <File size={15} />
              <input
                ref={pendingSceneEditInputRef}
                value={rowEdit.value}
                onBlur={() => void commitPendingSceneEdit()}
                onChange={(event) => {
                  setPendingSceneEdit((previous) =>
                    previous ? { ...previous, value: event.target.value } : previous,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelPendingSceneEdit();
                  }
                }}
                aria-label="重命名文件"
              />
            </form>
          ) : (
            <button
              className="tree-file-open"
              onClick={() => {
                if (node.scene) {
                  void openScene(node.scene);
                }
              }}
              style={{ paddingLeft }}
            >
              <span className="tree-spacer" />
              <File size={15} />
              <span>{node.name}</span>
              {node.scene?.favorite && <Star size={13} fill="currentColor" />}
            </button>
          )}
          {isActive && activeScene && (
            <div className={isMenuOpen ? "tree-row-menu open" : "tree-row-menu"}>
              <button
                className="tree-row-menu__trigger"
                title="文件操作"
                aria-label="文件操作"
                aria-expanded={isMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenuSceneId(isMenuOpen ? null : activeScene.id);
                }}
              >
                <MoreHorizontal size={15} />
              </button>
              {isMenuOpen && (
                <div className="tree-row-menu__panel">
                  <button
                    type="button"
                    onClick={() =>
                      runMenuAction(async () => {
                        await saveNow();
                        setError("已保存到当前文件");
                      })
                    }
                  >
                    <Save size={14} />
                    <span>保存</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(renameActive)}>
                    <Pencil size={14} />
                    <span>重命名</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(duplicateActive)}>
                    <Copy size={14} />
                    <span>复制</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(trashActive)}>
                    <Trash2 size={14} />
                    <span>删除</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(toggleFavorite)}>
                    <Heart
                      size={14}
                      fill={activeScene.favorite ? "currentColor" : "none"}
                    />
                    <span>{activeScene.favorite ? "取消收藏" : "收藏"}</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(editTags)}>
                    <Tags size={14} />
                    <span>标签</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(shareActiveToAgent)}>
                    <Share2 size={14} />
                    <span>分享给 Agent</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(() => exportCurrent("png"))}>
                    <Download size={14} />
                    <span>导出 PNG</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(() => exportCurrent("svg"))}>
                    <Download size={14} />
                    <span>导出 SVG</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(() => exportCurrent("json"))}>
                    <Download size={14} />
                    <span>导出 Excalidraw</span>
                  </button>
                  <button type="button" onClick={() => runMenuAction(backupVisibleScenes)}>
                    <Archive size={14} />
                    <span>备份当前列表</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {rowEdit?.kind === "tags" && (
          <form
            className="tree-subedit-row"
            style={{ marginLeft: paddingLeft + 28 }}
            onSubmit={(event) => {
              event.preventDefault();
              void commitPendingSceneEdit();
            }}
          >
            <Tags size={14} />
            <input
              ref={pendingSceneEditInputRef}
              value={rowEdit.value}
              placeholder="标签，用逗号或空格分隔"
              onBlur={() => void commitPendingSceneEdit()}
              onChange={(event) => {
                setPendingSceneEdit((previous) =>
                  previous ? { ...previous, value: event.target.value } : previous,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelPendingSceneEdit();
                }
              }}
              aria-label="编辑标签"
            />
          </form>
        )}
      </div>
    );
  };

  if (!support.supported) {
    return (
      <main className="unsupported">
        <h1>Personal Excalidraw</h1>
        <p>{support.reason}</p>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="welcome">
        <section className="welcome__panel">
          <div>
            <p className="eyebrow">Local-first workspace</p>
            <h1>Personal Excalidraw</h1>
            <p className="welcome__copy">
              选择一个本地目录作为工作区，应用会创建 scenes、索引、缩略图、草稿和回收区。
            </p>
          </div>
          <button className="primary-action" onClick={pickWorkspace} disabled={isBooting}>
            {isBooting ? <Loader2 className="spin" size={18} /> : <FolderOpen size={18} />}
            选择或创建工作区
          </button>
          {recentWorkspaces.length > 0 && (
            <div className="recent-list">
              <div className="section-label">最近工作区</div>
              {recentWorkspaces.map((item) => (
                <button
                  className="recent-item"
                  key={item.id}
                  onClick={() => openWorkspaceHandle(item.handle)}
                >
                  <Folder size={16} />
                  <span>{item.name}</span>
                  <small>{formatDateTime(item.openedAt)}</small>
                </button>
              ))}
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    );
  }

  const activeSceneSourceFile = activeScene?.relativePath;
  const activeSceneShareLabel = activeScene
    ? sceneFilename(activeScene)
    : "No active file";

  return (
    <main
      className="personal-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const files = [...event.dataTransfer.files].filter((file) =>
          /\.excalidraw$/i.test(file.name),
        );
        void importFiles(files);
      }}
    >
      <aside className="file-sidebar">
        <div className="workspace-head">
          <div className="workspace-title">
            <Folder size={15} />
            <h1>{workspace.name}</h1>
          </div>
          <button className="icon-button" title="切换工作区" onClick={pickWorkspace}>
            <FolderOpen size={18} />
          </button>
        </div>

        <div className="explorer-actions">
          <button onClick={createNewScene} title="新建 .excalidraw">
            <FilePlus2 size={16} />
          </button>
          <button onClick={createFolder} title="新建目录">
            <FolderPlus size={16} />
          </button>
          <button onClick={pickFilesToImport} title="导入 .excalidraw">
            <Import size={16} />
          </button>
          <button onClick={rescan} title="重新扫描真实目录">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setIsAgentSettingsOpen(true)}
            title="Agent Sharing 设置"
          >
            <Settings size={16} />
          </button>
        </div>

        <label className="search-box">
          <Search size={15} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件、路径、画布文本"
          />
        </label>

        <div className="file-tree" aria-label="Workspace file tree">
          {pendingCreate?.parentPath === "" && renderPendingCreate(0)}
          {fileTree.children.length > 0 ? (
            fileTree.children.map((node) => renderFileNode(node))
          ) : (
            <div className="empty-list">工作区里还没有 .excalidraw 文件</div>
          )}
        </div>
      </aside>

      <section className="excalidraw-host">
        {activePayload && activeScene ? (
          <Excalidraw
            key={activeScene.id}
            initialData={activePayload as never}
            onChange={handleCanvasChange as never}
            autoFocus
            detectScroll={false}
            handleKeyboardGlobally
            UIOptions={{
              canvasActions: {
                toggleTheme: true,
              },
            }}
            renderTopRightUI={() => (
              <div className="personal-top-right">
                <button
                  className={
                    agentShareStatus?.enabled
                      ? "agent-share-toggle agent-share-toggle--on"
                      : "agent-share-toggle"
                  }
                  type="button"
                  title={
                    agentShareStatus?.enabled
                      ? "关闭 Agent Sharing API"
                      : "开启 Agent Sharing API"
                  }
                  onClick={() => void toggleAgentSharing()}
                >
                  {agentShareStatus?.enabled ? "Agent On" : "Agent Off"}
                </button>
                <AgentShareMenu
                  apiEnabled={Boolean(agentShareStatus?.enabled)}
                  activeSceneAvailable={Boolean(activeScene)}
                  currentSourceFile={activeSceneSourceFile}
                  isOpen={isAgentShareMenuOpen}
                  isSharing={isSharingToAgent}
                  recentShares={recentAgentShares}
                  onPrimaryShare={() => {
                    setIsAgentShareMenuOpen(false);
                    void shareActiveToAgent("selection");
                  }}
                  onToggleOpen={() =>
                    setIsAgentShareMenuOpen((open) => !open)
                  }
                  onClose={() => setIsAgentShareMenuOpen(false)}
                  onShareSelection={() => void shareActiveToAgent("selection")}
                  onShareScene={() => void shareActiveToAgent("scene")}
                  onCopyPrompt={(share, target) =>
                    void copyHandoffPrompt(share, target)
                  }
                  onOpenManager={() => {
                    setIsSharesManagerOpen(true);
                    void refreshAgentShares();
                  }}
                  formatDateTime={formatDateTime}
                  statusLabel={shareStatusLabel}
                />
                <button
                  className={`save-state save-state--${saveStatus}`}
                  type="button"
                  title={saveStateTitle}
                  disabled={saveStatus === "saving" || !activeScene}
                  onClick={() => void saveNowRef.current()}
                >
                  {saveStatus === "saving" && (
                    <Loader2 size={14} className="spin" />
                  )}
                  {saveLabel}
                </button>
              </div>
            )}
          >
            <MainMenu>
              <MainMenu.DefaultItems.LoadScene />
              <MainMenu.DefaultItems.SaveToActiveFile />
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.Separator />
              <MainMenu.Item
                icon={<Save size={16} />}
                onSelect={() => void saveNowRef.current()}
              >
                保存到工作区
              </MainMenu.Item>
              <MainMenu.Item
                icon={<FilePlus2 size={16} />}
                onSelect={() => void createNewScene()}
              >
                新建到工作区
              </MainMenu.Item>
              <MainMenu.Separator />
              <MainMenu.DefaultItems.CommandPalette className="highlighted" />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
            <WelcomeScreen />
          </Excalidraw>
        ) : (
          <div className="empty-canvas">
            <FilePlus2 size={28} />
            <button className="primary-action compact" onClick={createNewScene}>
              新建第一个白板
            </button>
          </div>
        )}
      </section>

      {isAgentSettingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onPointerDown={() => setIsAgentSettingsOpen(false)}
        >
          <section
            className="agent-settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-settings-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="agent-settings__header">
              <div>
                <p className="section-label">Agent Sharing</p>
                <h2 id="agent-settings-title">本地分享设置</h2>
              </div>
              <button
                className="icon-button"
                title="关闭"
                onClick={() => setIsAgentSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="agent-settings__status">
              <span
                className={
                  agentShareStatus?.enabled
                    ? "status-dot status-dot--on"
                    : "status-dot"
                }
              />
              <div>
                <strong>{agentShareStatus?.enabled ? "On" : "Off"}</strong>
                <span>{agentShareStatus?.baseUrl ?? "No listener"}</span>
              </div>
              <button onClick={() => void toggleAgentSharing()}>
                {agentShareStatus?.enabled ? "关闭 API" : "开启 API"}
              </button>
            </div>

            <div className="agent-settings__grid">
              <div className="settings-card">
                <p className="section-label">Runtime</p>
                <dl>
                  <div>
                    <dt>Port</dt>
                    <dd>{agentShareStatus?.port ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Shares</dt>
                    <dd>{agentShareStatus?.shareCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>TTL</dt>
                    <dd>7d snapshot</dd>
                  </div>
                  <div>
                    <dt>Auth</dt>
                    <dd>No token</dd>
                  </div>
                </dl>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={exposeCurrentSelection}
                    disabled={!activeScene}
                    onChange={(event) => {
                      setExposeCurrentSelection(event.target.checked);
                      setCurrentSelectionRevision((revision) => revision + 1);
                    }}
                  />
                  <span>Expose current selection</span>
                </label>
                <div className="settings-actions">
                  <button
                    onClick={() => {
                      setIsSharesManagerOpen(true);
                      void refreshAgentShares();
                    }}
                  >
                    <Archive size={14} />
                    Shares
                  </button>
                  <button onClick={() => void cleanExpiredShares()}>
                    <RefreshCw size={14} />
                    Clean
                  </button>
                  <button onClick={() => void revokeAllShares()}>
                    <Trash2 size={14} />
                    Revoke all
                  </button>
                </div>
              </div>

              <div className="settings-card">
                <p className="section-label">Agent Setup</p>
                <div className="settings-actions settings-actions--stack">
                  <button onClick={() => void copyAgentText(codexMcpConfig, "Codex MCP 配置")}>
                    <Copy size={14} />
                    Codex MCP
                  </button>
                  <button onClick={() => void copyAgentText(claudeMcpConfig, "Claude MCP 配置")}>
                    <Copy size={14} />
                    Claude MCP
                  </button>
                  <button onClick={() => void copyAgentText(agentApiReference, "HTTP API 说明")}>
                    <Copy size={14} />
                    HTTP API
                  </button>
                  <button onClick={() => void copyAgentText(agentSkillTemplate, "Skill 模板")}>
                    <Copy size={14} />
                    Skill 模板
                  </button>
                </div>
              </div>
            </div>

            <div className="agent-settings__footer">
              <span>MCP/API: local-only, read-only, no token.</span>
              <button onClick={() => void shareActiveToAgent()} disabled={!activeScene || isSharingToAgent}>
                {isSharingToAgent ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Share2 size={14} />
                )}
                Share current
              </button>
            </div>
          </section>
        </div>
      )}

      {isSharesManagerOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onPointerDown={() => {
            setIsSharesManagerOpen(false);
            cancelEditShare();
          }}
        >
          <section
            className="agent-settings shares-manager"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shares-manager-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="agent-settings__header">
              <div>
                <p className="section-label">Agent Shares</p>
                <h2 id="shares-manager-title">分享管理</h2>
              </div>
              <button
                className="icon-button"
                title="关闭"
                onClick={() => {
                  setIsSharesManagerOpen(false);
                  cancelEditShare();
                }}
              >
                <X size={18} />
              </button>
            </header>

            <section className="share-current-panel">
              <div>
                <p className="section-label">Current canvas</p>
                <strong>{activeSceneShareLabel}</strong>
                <span>
                  Create a new share for the file you are viewing. The list
                  below is historical and may include other files.
                </span>
              </div>
              <div className="share-current-panel__actions">
                <button
                  onClick={() => void shareActiveToAgent()}
                  disabled={!activeScene || isSharingToAgent}
                >
                  {isSharingToAgent ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Share2 size={14} />
                  )}
                  Share current selection
                </button>
                <button
                  onClick={() => void shareActiveToAgent("scene")}
                  disabled={!activeScene || isSharingToAgent}
                >
                  {isSharingToAgent ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <File size={14} />
                  )}
                  Share whole file
                </button>
              </div>
            </section>

            <div className="settings-actions">
              <button onClick={() => void refreshAgentShares()}>
                <RefreshCw size={14} />
                Refresh
              </button>
              <button onClick={() => void cleanExpiredShares()}>
                <Trash2 size={14} />
                Clean expired
              </button>
              <button onClick={() => void revokeAllShares()}>
                <Trash2 size={14} />
                Revoke all
              </button>
            </div>

            <div className="share-list">
              {agentShares.length === 0 ? (
                <div className="empty-list">还没有 Agent Share</div>
              ) : (
                agentShares.map((share) => {
                  const isCurrentFileShare =
                    Boolean(activeSceneSourceFile) &&
                    share.sourceFile === activeSceneSourceFile;
                  return (
                    <article
                      className={
                        isCurrentFileShare
                          ? "share-row"
                          : "share-row share-row--other-file"
                      }
                      key={share.shareId}
                    >
                      {editingShareId === share.shareId ? (
                        <form
                          className="share-edit"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveShareMetadata(share.shareId);
                          }}
                        >
                          <input
                            value={editingShareTitle}
                            onChange={(event) =>
                              setEditingShareTitle(event.target.value)
                            }
                            placeholder="Share 名称"
                            autoFocus
                          />
                          <textarea
                            value={editingShareDescription}
                            onChange={(event) =>
                              setEditingShareDescription(event.target.value)
                            }
                            placeholder="描述"
                            rows={3}
                          />
                          <input
                            value={editingShareLabels}
                            onChange={(event) =>
                              setEditingShareLabels(event.target.value)
                            }
                            placeholder="标签，用逗号或空格分隔"
                          />
                          <div className="share-row__actions">
                            <button type="submit">
                              <Save size={14} />
                              保存
                            </button>
                            <button type="button" onClick={cancelEditShare}>
                              <X size={14} />
                              取消
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div
                            className="share-row__preview"
                            aria-label={`Preview for ${share.title}`}
                          >
                            {sharePreviewUrls[share.shareId] ? (
                              <img
                                alt=""
                                src={sharePreviewUrls[share.shareId]}
                              />
                            ) : (
                              <span>Preview unavailable</span>
                            )}
                          </div>
                          <div className="share-row__main">
                            <div>
                              <strong>{share.title}</strong>
                              <span>{share.shareId}</span>
                            </div>
                            <p>{share.description || share.sourceFile}</p>
                            <p className="share-row__source">
                              Source file: {share.sourceFile}
                            </p>
                            <div className="share-meta">
                              <span>{shareStatusLabel(share.status)}</span>
                              <span>{share.scope}</span>
                              <span>
                                {isCurrentFileShare
                                  ? "current file"
                                  : "not current file"}
                              </span>
                              <span>{formatDateTime(share.expiresAt)}</span>
                              {share.lastReadAt && (
                                <span>Read {formatDateTime(share.lastReadAt)}</span>
                              )}
                            </div>
                            {share.labels.length > 0 && (
                              <div className="share-tags">
                                {share.labels.map((label) => (
                                  <span key={label}>{label}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="share-row__actions">
                            <button
                              disabled={!isShareReadable(share)}
                              onClick={() =>
                                void copyHandoffPrompt(share, "codex")
                              }
                            >
                              <Copy size={14} />
                              Codex
                            </button>
                            <button
                              disabled={!isShareReadable(share)}
                              onClick={() =>
                                void copyHandoffPrompt(share, "claude")
                              }
                            >
                              <Copy size={14} />
                              Claude
                            </button>
                            <button onClick={() => beginEditShare(share)}>
                              <Pencil size={14} />
                              Rename
                            </button>
                            <button
                              disabled={share.status === "revoked"}
                              onClick={() => void revokeShare(share.shareId)}
                            >
                              <X size={14} />
                              Revoke
                            </button>
                            <button onClick={() => void removeShare(share.shareId)}>
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      <input
        ref={fileInputRef}
        hidden
        multiple
        type="file"
        accept=".excalidraw,application/json"
        onChange={(event) => {
          void importFiles([...(event.target.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />

      {handoffPanel && (
        <AgentShareHandoffPanel
          state={handoffPanel}
          onCopyPrompt={(share, target) => void copyHandoffPrompt(share, target)}
          onOpenManager={() => {
            setIsSharesManagerOpen(true);
            void refreshAgentShares();
          }}
          onClose={() => setHandoffPanel(null)}
          formatDateTime={formatDateTime}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </main>
  );
};
