# Engineering Tasks

## P0: 技术验证和工程骨架

- 初始化 Tauri 2 + Vite + React + TypeScript 工程。
- 安装并嵌入 `@excalidraw/excalidraw`，引入 `@excalidraw/excalidraw/index.css`。
- 创建 100vh editor shell，验证空白画布、基础绘图和快捷键。
- 定义 renderer 与 Tauri command 的 typed bridge。
- 实现单文件打开：读取 `.excalidraw` 为 Blob，调用 `loadFromBlob` 得到 initialData。
- 实现单文件保存：`serializeAsJSON(..., "local")` 后由 Tauri 原子写入。
- 打通 macOS dev/build，记录本地运行命令和产物位置。

## P1: Workspace 和文件模型

- 设计 workspace 初始化命令：选择目录、创建 `.personal-excalidraw`、写入 `workspace.json`。
- 建立 `scenes/` 默认目录和相对路径规范。
- 引入 SQLite，创建 scene metadata、tag、search index schema。
- 实现 workspace 扫描：发现 `.excalidraw`、读取 metadata、提取文本元素、计算 hash。
- 实现最近 workspace 和最近 scene 本地设置。
- 实现路径安全校验，Tauri commands 只能操作授权 workspace 内文件。

## P1: Scene 管理

- 新建 scene：创建空 `.excalidraw`，生成 metadata，打开编辑器。
- 打开 scene：从列表、搜索结果、拖拽文件和 Finder 文件关联进入。
- 重命名 scene：同步文件名、metadata title 和列表状态。
- 复制 scene：复制 `.excalidraw` 和 metadata，生成新 scene id。
- 删除 scene：默认移动到 macOS Trash 或 workspace trash。
- Finder 集成：显示文件位置、复制文件路径。

## P1: 自动保存和恢复

- 在 `onChange` 中维护 dirty state、last edit time 和 pending save payload。
- 实现 500-1000ms debounce 保存队列。
- Tauri 实现临时文件写入、fsync、原子 rename。
- 窗口关闭、切换 scene、App 退出前 flush pending save。
- 保存失败时写入 autosave draft，并在 UI 展示恢复入口。
- 检测外部修改：比较 mtime/hash，提供覆盖、另存为、重新载入。

## P1: 缩略图

- 在保存成功后触发 renderer 缩略图生成任务。
- 用 `exportToBlob` 生成固定尺寸 PNG 缩略图。
- Tauri 写入 `.personal-excalidraw/thumbnails/<scene-id>.png`。
- 缩略图 metadata 记录 hash、尺寸、生成时间、错误。
- 列表实现占位图、加载状态和失败重试。

## P1: 搜索和标签

- 建立 tags 表和 scene_tags 关系。
- 从 Excalidraw elements 提取文本内容写入 search index。
- 实现搜索框：标题、文件名、标签、文本内容。
- 支持标签过滤、收藏过滤、最近打开排序、更新时间排序。
- 支持批量添加/移除标签。

## P1: Mac 基础体验

- 配置 `.excalidraw` 文件关联和打开事件。
- 支持文件拖拽到 App 打开或导入。
- 增加应用菜单：New, Open, Save Now, Export, Show in Finder, Close Workspace。
- 实现常用快捷键：`Cmd+N`, `Cmd+O`, `Cmd+S`, `Cmd+F`, `Cmd+W`。
- 保证无网络状态下 App 正常启动、编辑和保存。

## P1: Agent Sharing

- [x] 增加应用级 `Agent On/Off` 开关，默认关闭。
- [x] Tauri 侧启动/停止只读本地 HTTP API，只绑定 `127.0.0.1`。
- [x] 每次开启生成 bearer token，关闭时清空 share。
- [x] 支持当前选区或当前文件生成 snapshot share。
- [x] Share payload 包含 manifest、selection.json、scene.excalidraw、brief.md、render.png 和 render.svg。
- [x] 在文件更多菜单增加“分享给 Agent”入口。
- [x] 提供 Codex / Claude Code MCP 配置示例和 agent skill 模板。
- [x] 设置面板基础入口：状态、端口、TTL、token env、配置复制、Revoke。
- [ ] 设置面板增强：TTL 可配置、audit log 可视化、Revoke all shares 分层确认。
- [ ] 实现 MCP resources/tools/prompts，复用当前 share registry。
- [ ] 支持搜索 scene 并由 agent 请求显式分享。
- [ ] 评估实时跟随文件变化模式，默认仍保持 snapshot。
- [ ] 写回能力后置：评论、替代 UI sketch、agent 生成变体。

## P2: 测试和质量

- 单元测试：workspace path guard、metadata parser、text extraction、save payload generation。
- 集成测试：打开/保存 `.excalidraw` 后与上游格式兼容。
- E2E 测试：首次启动、新建、编辑、重启恢复、搜索、删除。
- 压测：1000 个 scene 的扫描、搜索、缩略图队列。
- 故障测试：权限不足、磁盘写失败、格式无效、外部文件修改。
- 增加诊断日志和用户可导出的 debug report。

## P3: Pro 个人版任务池

- 版本历史 snapshot 设计和恢复 UI。
- 模板库和快速新建模板。
- 命令面板和全局快速打开。
- 批量导出 PNG/SVG/PDF。
- 本地备份计划和恢复流程。
- iCloud/Dropbox 文件夹兼容测试和冲突指引。
