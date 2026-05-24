# Personal Mac App

一句话定位：一个本地优先、无账号、面向个人知识工作者的 Mac 版 Excalidraw 工作台，把白板文件、缩略图、搜索、标签和最近工作区管理做成原生桌面体验。

## 目标用户

- 经常用 Excalidraw 画架构图、产品草图、会议图和个人笔记的人。
- 需要把大量 `.excalidraw` 文件保存在本机，并希望用 Finder 之外的方式快速浏览、检索和整理的人。
- 不想先接入云账号、团队协作或订阅体系，只需要稳定个人桌面工具的人。

## 核心卖点

- 本地优先：所有画布、索引、缩略图和标签默认保存在用户选择的本机 workspace。
- 原生 Mac 入口：支持最近文件、拖拽打开、系统文件关联、菜单快捷键和离线使用。
- Excalidraw 兼容：编辑核心不重写，直接嵌入 Excalidraw React 组件，并保存标准 `.excalidraw` JSON。
- 管理能力补齐：在画布外增加文档列表、缩略图、全文搜索、标签、收藏、最近打开和自动保存状态。
- Agent Sharing：把当前文件或选区打包成本地只读 share，供 Codex、Claude Code 等 agent 读取草图上下文。
- 可渐进增强：MVP 先做个人文件管理，后续再做命令面板、批量导出、模板库、版本历史和可选同步。

## 如何复用上游 Excalidraw

- 画布层复用 `@excalidraw/excalidraw` React component，按上游 README 的要求引入 `@excalidraw/excalidraw/index.css`，并把容器固定为非零高度。
- 状态接入使用 `Excalidraw` 的 `initialData` 加载当前 scene，用 `onChange(elements, appState, files)` 捕获编辑变化。
- 文件兼容使用上游 `serializeAsJSON(elements, appState, files, "local")` 生成标准 `.excalidraw` 内容，用 `loadFromBlob`/restore 逻辑读取已有 `.excalidraw`、含 scene metadata 的 PNG/SVG。
- 缩略图复用 `@excalidraw/utils` 或 package root 导出的 `exportToBlob`/`exportToSvg`，在保存后异步生成 workspace 缩略图缓存。
- 上游 `excalidraw-app/data/LocalData.ts` 的本地保存思路可参考，但 Mac App 的真实持久化应落在 Tauri Rust 文件系统层，而不是浏览器 localStorage/IndexedDB。

## 推荐运行形态

- 前端：React + Vite + TypeScript + `@excalidraw/excalidraw`。
- 桌面壳：Tauri 2，首发 macOS。
- 本地数据：用户选择 workspace 文件夹，内部保存 scene 文件、索引数据库、缩略图缓存和设置。
- 不做云账号：MVP 不接登录、服务端同步或多人协作。

## Agent Sharing

Agent Sharing 用来把“画布里的上下文”交给其它 agent 产品，而不是让用户复制一大段 `.excalidraw` JSON。

当前第一版范围：

- 应用右上角提供 `Agent On/Off` 开关，默认关闭。
- 左侧工具栏的齿轮入口提供完整 Agent Sharing 设置。
- 开启后只监听 `127.0.0.1`，默认端口 `37411`；如果端口被占用，会自动选择本机可用端口。
- 每次开启都会生成本地 bearer token；关闭后停止监听并失效所有 share。
- `Share` 按钮或文件更多菜单里的“分享给 Agent”会把当前选区打包；没有选区时分享当前文件快照。
- share 是只读、快照式、短期有效，默认 TTL 为 24 小时。
- 应用会把 shareId、manifest URL 和 bearer token 复制到剪贴板；设置面板可复制 Codex MCP 配置、Claude MCP 配置、HTTP API 说明和 skill 模板。

本地 API 示例：

```bash
curl -H "Authorization: Bearer $PERSONAL_EXCALIDRAW_TOKEN" \
  http://127.0.0.1:37411/v1/shares/sh_example/manifest
```

当前 API 已提供 `/v1/status`、`/v1/shares`、`/v1/shares/{shareId}/manifest`、`selection.json`、`scene.excalidraw`、`brief.md`、`render.png` 和 `render.svg`。MCP transport 会复用同一个 share registry 继续实现。

MCP transport 补齐后的 Codex 配置示例：

```toml
[mcp_servers.personal_excalidraw]
url = "http://127.0.0.1:37411/mcp"
bearer_token_env_var = "PERSONAL_EXCALIDRAW_TOKEN"
enabled = true
```

MCP transport 补齐后的 Claude Code `.mcp.json` 示例：

```json
{
  "mcpServers": {
    "personal-excalidraw": {
      "type": "http",
      "url": "http://127.0.0.1:37411/mcp",
      "headers": {
        "Authorization": "Bearer ${PERSONAL_EXCALIDRAW_TOKEN}"
      }
    }
  }
}
```

详细设计见 [AGENT_SHARING.md](AGENT_SHARING.md)。
