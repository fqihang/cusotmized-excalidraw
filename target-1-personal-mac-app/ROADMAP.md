# Roadmap

## Phase 0: 骨架验证

目标：证明 Tauri + React + Excalidraw 能作为 Mac App 跑通。

- 创建 Tauri/Vite/React 工程。
- 嵌入 `<Excalidraw />`，引入官方 CSS，保证画布可见。
- 实现打开单个 `.excalidraw` 和保存回本地文件。
- 验证 dev/build/sign 基础流程。

## Phase 1: MVP 本地资料库

目标：完成个人本地 workspace 的日常可用闭环。

- Workspace 选择、初始化和最近 workspace。
- Scene 列表、新建、打开、重命名、复制、删除到 Trash。
- 自动保存、退出 flush、保存状态提示。
- 标准 `.excalidraw` 兼容读写。
- 缩略图生成和缓存。
- 标题、标签、收藏、最近打开。
- 基础搜索：标题、标签、文本元素、文件名。
- macOS 文件关联、拖拽打开、应用菜单和快捷键。

## Phase 2: MVP 打磨

目标：提升可靠性、性能和恢复能力。

- 文件 watcher：外部新增、删除、重命名、修改后自动刷新索引。
- 保存冲突提示：覆盖、保留副本、重新载入。
- Autosave draft 恢复。
- 缩略图后台队列、失败重试、批量重建。
- 大 workspace 扫描进度和取消。
- 错误日志、诊断导出。
- 基础 E2E 测试覆盖核心用户流程。

## Phase 3: Pro 个人版

目标：增强个人生产力，但仍保持本地优先。

- 版本历史：按保存点或时间间隔创建轻量 snapshot。
- 模板库：个人模板、快速新建、默认画布设置。
- 命令面板：快速打开、新建、标签、导出、切换 workspace。
- 批量导出：按标签或文件夹导出 PNG/SVG/PDF。
- 高级搜索：FTS、日期范围、元素类型、颜色、尺寸。
- 快速笔记入口：菜单栏或全局快捷键创建草图。
- 本地备份：定时打包 workspace 或复制到用户指定目录。

## Phase 4: 可选同步

目标：在不破坏本地优先的前提下，支持用户自选同步方式。

- iCloud Drive/Dropbox/Google Drive 文件夹兼容说明和冲突处理。
- WebDAV 或 Git-backed backup 作为高级选项。
- 多设备冲突 UI 和只读恢复模式。
- 仍不引入强制云账号。
