# Architecture

## 推荐架构

采用 Tauri 2 + React + Vite + TypeScript。React 负责资料库 UI、Excalidraw 画布嵌入和状态编排；Tauri Rust 侧负责本地文件系统、workspace 扫描、原子写入、缩略图缓存路径、macOS 文件关联、菜单和系统集成。

```text
Mac App
├── React renderer
│   ├── Library shell: sidebar, search, tags, thumbnails
│   ├── Editor shell: Excalidraw canvas + save status
│   └── Bridge client: typed Tauri commands/events
├── Excalidraw runtime
│   ├── <Excalidraw initialData onChange onExcalidrawAPI />
│   ├── serializeAsJSON / loadFromBlob / restore
│   └── exportToBlob / exportToSvg for thumbnails and export
└── Tauri core
    ├── Workspace file service
    ├── Metadata/index service
    ├── Thumbnail cache service
    ├── File watcher and conflict detector
    ├── Agent Sharing local API
    └── macOS integration
```

## 上游复用边界

- 使用 `packages/excalidraw` 作为画布和编辑器核心，不 fork 绘图交互。
- 使用 `ExcalidrawProps.initialData` 加载当前 scene，使用 `onChange(elements, appState, files)` 捕获可保存状态。
- 使用 `serializeAsJSON(..., "local")` 保存标准本地 `.excalidraw`，保留 `files`，避免数据库模式丢弃图片数据。
- 使用 `loadFromBlob` 读取 `.excalidraw`、JSON、带 metadata 的 PNG/SVG，并继承上游格式校验和 restore 行为。
- 使用 `exportToBlob`/`exportToSvg` 生成缩略图和导出内容。
- 上游 app 层的 localStorage/IndexedDB 保存只作为节流、文件状态和图片保存参考；桌面版不依赖浏览器存储做权威数据源。

## 本地 Workspace 文件模型

用户选择一个普通文件夹作为 workspace。MVP 推荐使用显式 app 元数据目录，scene 文件仍是独立 `.excalidraw` 文件，便于 Finder 和 Web 版互通。

```text
My Excalidraw Workspace/
├── scenes/
│   ├── system-design.excalidraw
│   └── meeting-notes.excalidraw
├── .personal-excalidraw/
│   ├── workspace.json
│   ├── index.sqlite
│   ├── thumbnails/
│   │   ├── <scene-id>.png
│   │   └── <scene-id>.json
│   ├── autosave/
│   │   └── <scene-id>.draft.excalidraw
│   └── trash/
└── imports/
```

### Scene 文件

每个 scene 的权威内容是 `.excalidraw` JSON：

- `type`, `version`, `source` 按 Excalidraw 标准输出。
- `elements`, `appState`, `files` 由 `serializeAsJSON(..., "local")` 生成。
- App 自有字段不写入 scene 顶层，避免污染兼容性；标题、标签、收藏、缩略图状态写入 metadata/index。

### Metadata

`index.sqlite` 保存查询和列表所需的派生信息：

- `scene_id`
- `file_path`
- `title`
- `tags`
- `favorite`
- `created_at`
- `updated_at`
- `last_opened_at`
- `content_text`
- `thumbnail_path`
- `file_hash`
- `schema_version`

MVP 可以先用 SQLite；如果工程启动成本要更低，可以用 `index.json`，但搜索、批量更新和并发文件 watcher 很快会推动迁移到 SQLite。建议一开始就用 SQLite。

## 自动保存

自动保存由 renderer 收集变更，Tauri 负责可靠落盘。

1. `onChange` 收到 elements、appState、files。
2. renderer 更新内存草稿状态，并以 500-1000ms debounce 请求保存。
3. 保存前用 `serializeAsJSON(..., "local")` 生成 JSON 字符串。
4. Tauri 写入临时文件：`<name>.excalidraw.tmp`。
5. Tauri fsync 后原子 rename 覆盖目标文件。
6. 保存成功后发回 `saved_at`、`file_hash`，renderer 清除 dirty 状态。
7. 保存失败时保留内存草稿，并写入 `.personal-excalidraw/autosave/<scene-id>.draft.excalidraw`。
8. 窗口关闭、切换 scene、App 退出前执行 flush。

冲突策略：

- 如果外部进程修改了同一 `.excalidraw`，通过 `file_hash` 或 mtime 检测。
- MVP 不自动合并；提示用户保留当前副本、覆盖外部版本或另存为。
- Pro 阶段再考虑基于 element version 的三方合并。

## 缩略图

缩略图是派生缓存，不参与兼容性承诺。

- 保存成功后异步触发缩略图任务，不阻塞画布。
- renderer 可直接调用 `exportToBlob({ elements, appState, files, mimeType: "image/png" })` 生成 PNG Blob。
- Tauri 接收二进制并写入 `.personal-excalidraw/thumbnails/<scene-id>.png`。
- 缩略图 metadata 保存 scene hash、生成时间、尺寸和失败原因。
- 缩略图生成失败时列表显示占位图，并允许后台重试。

## 搜索和标签

搜索索引来自 `.excalidraw` 文件和用户 metadata：

- 标题：优先使用 metadata title，其次用文件名。
- 标签：存于 SQLite，支持多标签过滤。
- 文本内容：从 elements 中提取 text-like element 的原始文本，作为 `content_text`。
- 时间：使用文件 mtime 和 metadata `updated_at`。
- 路径：保留相对 workspace 路径，支持迁移 workspace。

MVP 使用 SQLite `LIKE` 或 FTS5 做本地搜索。建议直接启用 FTS5，避免后续重做搜索表。

## Agent Sharing

Agent Sharing 是给外部 agent 产品读取草图上下文的本地只读数据面。它不改变 `.excalidraw` 权威文件模型，也不默认暴露任何监听端口。

```text
React renderer
├── 读取当前 Excalidraw elements/appState/files
├── 根据选区生成 share payload
├── 导出 render.png / render.svg
├── 生成 brief.md 和 selection.json
└── 调用 Tauri register_agent_share

Tauri core
├── AgentShareRegistry: in-memory share + audit log
├── start_agent_share_server: 绑定 127.0.0.1，生成 bearer token
├── stop_agent_share_server: 停止监听，清空 share
└── HTTP endpoints: /v1/shares/{shareId}/...

Agent product
├── 读取 manifest
├── 优先读取 brief.md + render.png
├── 需要精确结构时读取 selection.json
└── 需要完整追溯时读取 scene.excalidraw
```

### 数据包边界

每个 share 是一个上下文包，而不是单一文件：

- `manifest`：shareId、scope、title、来源文件、TTL、资源 URL。
- `selection.json`：选区元素、bounds、文本摘录、文件上下文。
- `scene.excalidraw`：标准 Excalidraw JSON 快照。
- `render.png` / `render.svg`：给 vision 或截图验证使用。
- `brief.md`：低成本语义摘要，帮助 agent 先理解草图意图。

当前版本只做 snapshot。后续如果需要“实时跟随文件变化”，必须单独显式开启，避免 agent 在用户不知情时读到不断变化的画布。

### 安全策略

- 默认 Off：无监听进程，无 HTTP/MCP 访问。
- Local only：只绑定 `127.0.0.1`。
- Token required：每次开启生成新的 bearer token。
- Short TTL：share 默认 24 小时过期；关闭 API 会立即清空所有 share。
- Read-only：第一版没有写回、评论或修改画布能力。
- Audit log：Tauri registry 记录 share 资源读取事件，后续可在设置面板暴露。

### MCP 映射

MCP transport 会复用 AgentShareRegistry，不另建数据存储。规划资源：

- `excalidraw://shares/{shareId}/manifest`
- `excalidraw://shares/{shareId}/brief`
- `excalidraw://shares/{shareId}/selection`
- `excalidraw://shares/{shareId}/image.png`
- `excalidraw://shares/{shareId}/scene.excalidraw`

规划 tools：

- `list_recent_shares`
- `get_share_manifest`
- `render_share`
- `search_scenes`
- `get_current_selection_share`
- `explain_api_status`

规划 prompts：

- `implement-ui-from-sketch`
- `explain-architecture-sketch`
- `turn-sketch-into-ticket`
- `review-flow-from-sketch`
- `generate-acceptance-criteria-from-sketch`

## `.excalidraw` 格式兼容

兼容性原则：

- `.excalidraw` 文件必须能被上游 Excalidraw 打开。
- 读取时接受上游 `loadFromBlob` 支持的 `.excalidraw`、JSON、PNG/SVG metadata。
- 写入时只使用 `serializeAsJSON(..., "local")` 生成标准 JSON。
- App 自有 metadata 不混进 `.excalidraw`，而是放入 workspace index。
- 对图片等 binary files，保留在 `.excalidraw` 的 `files` 字段中，避免因外部资源路径导致迁移失败。

## 安全和权限

- 用户显式选择 workspace 后保存路径授权。
- 不上传任何 scene、索引或缩略图。
- Tauri command 只暴露白名单路径操作，所有路径必须在当前 workspace 内或来自用户打开文件授权。
- 删除默认走 macOS Trash；无法移动到 Trash 时才提示 fallback。
- Agent Sharing 默认关闭，仅本机监听，bearer token 授权，只读读取，关闭后失效所有 share。

## 技术风险

- Excalidraw package 深层 runtime import 可能受 exports map 限制；运行时代码尽量从 package root 导入，类型 deep import 只用于 TypeScript。
- 大文件和大量图片会导致 autosave JSON 大；需要 debounce、原子写和保存状态。
- 缩略图生成依赖 canvas/browser 环境，最好放 renderer 侧生成，Rust 侧只负责持久化。
- 文件 watcher 与自动保存可能形成自触发循环；需用 file hash 和写入来源标记去重。
