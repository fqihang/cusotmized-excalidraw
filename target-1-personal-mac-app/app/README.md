# Personal Excalidraw Files

可运行的个人版。右侧主画布复用本仓库 `excalidraw/packages/*` 的源码体验；个人 App 不重新实现绘图能力，只在左侧像 VS Code/Sublime 一样展示真实 workspace 文件树，并负责本地索引、搜索和文件保存。在 Tauri Mac App 中通过 Rust command 直接读写本地 workspace；在 Chrome/Edge 中也可以通过浏览器目录授权运行：

- `scenes/`：标准 `.excalidraw` 白板文件。
- `.personal-excalidraw/index.json`：标题、标签、收藏、搜索文本、缩略图路径等索引。
- `.personal-excalidraw/thumbnails/`：保存后生成的 PNG 缩略图。
- `.personal-excalidraw/snapshots/`：自动保存前的轻量版本快照。
- `.personal-excalidraw/autosave/`：保存失败时的草稿兜底。
- `.personal-excalidraw/trash/`：删除时移动到本地回收区。

## 运行

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm install
npm run dev
```

用 Chrome 或 Edge 打开 Vite 输出的本地地址，然后选择或创建一个工作区目录。

## Mac App 运行

```bash
cd /Users/qihang.feng/Documents/AI/excalidraw/target-1-personal-mac-app/app
npm run tauri:dev
```

打包：

```bash
npm run package:release
```

正式打包命令会运行 app/Rust 测试、TypeScript 检查、Tauri 打包、DMG 校验、体积预算检查，并生成 `src-tauri/target/release/bundle/release-manifest.json`。产物会生成在 `src-tauri/target/release/bundle/` 下。当前 Mac bundle 是 `Personal Excalidraw Files.app`，bundle id 是 `io.personal.excalidraw.files`，用于避开旧 `Personal Excalidraw.app` 的 WebView 缓存。

只想检查已有产物和重写 manifest 时可用：

```bash
npm run package:release:reuse
```

## 已实现

- 工作区初始化、最近工作区、真实目录树展示、目录创建和全量扫描。
- 新建、打开、重命名、复制、删除到本地回收区。
- 标准 `.excalidraw` JSON 读写和拖拽/选择导入。
- 基于本地 git 源码 alias 的 Excalidraw 官方画布体验、自动保存、手动保存、保存失败草稿。
- 标题、文件名、路径、标签、文本元素全文搜索。
- 当前白板标签编辑、收藏、PNG/SVG/Excalidraw 导出。
- 当前筛选列表批量备份到 `.personal-excalidraw/exports/`。
- Excalidraw 官方快捷键、工具栏和主菜单保持 upstream 体验。

## 说明

同一套前端支持两种运行方式：Chrome/Edge 下使用 File System Access API；Tauri Mac App 下使用 Rust command 读写本机文件。`vite.config.ts` 将 `@excalidraw/*` 指向 `/Users/qihang.feng/Documents/AI/excalidraw/excalidraw/packages/*`，因此绘图层跟随本地 git 里的 Excalidraw 源码，而不是重新实现。
