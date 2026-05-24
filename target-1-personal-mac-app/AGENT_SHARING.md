# Agent Sharing

Agent Sharing 的目标是让用户在 Excalidraw 里选择一组图形，点 `Share to Agent`，然后让 Codex、Claude Code 或其它 agent 通过本地 API/MCP 读取这个上下文包。用户不需要复制完整 `.excalidraw` JSON。

## 第一版范围

- 只读读取，不提供写回。
- 本地 API 默认关闭；开启后只监听 `127.0.0.1`。
- 每次开启生成 bearer token。
- share 默认是 snapshot，不实时追踪文件变化。
- 默认 TTL 为 24 小时；关闭 API 会停止监听并清空所有 share。
- 支持“当前选区”和“当前文件”两种 scope。
- 当前先提供 HTTP 数据面；MCP transport 复用同一个 share registry 后续补齐。

## 用户路径

1. 用户在画布中选择一组图形。
2. 点击右上角 `Share`，或在文件更多菜单点击“分享给 Agent”。
3. 如果 Agent Sharing 处于 Off，应用自动启动本地 API。
4. 应用保存当前 dirty scene，生成 snapshot share。
5. 应用把 shareId、manifest URL 和 bearer token 复制到剪贴板。
6. 用户把这段信息交给 agent，agent 读取 manifest、brief、image 和结构化 selection。

没有选区时，share scope 会退化为当前文件快照。

## App 入口

- 画布右上角：`Agent On/Off` 快速开关和 `Share` 快速分享。
- 文件更多菜单：对当前文件执行“分享给 Agent”。
- 左侧齿轮设置：查看 API 状态、端口、share 数量、TTL，复制 token env、Codex MCP 配置、Claude MCP 配置、HTTP API 说明和 skill 模板。
- `Revoke`：关闭本地 API 并立即清空所有 share。

## Share Manifest

每个 share 是一个上下文包：

```json
{
  "schemaVersion": 1,
  "shareId": "sh_abc123",
  "scope": "selection",
  "title": "Checkout redesign sketch",
  "sceneId": "...",
  "sourceFile": "scenes/checkout.excalidraw",
  "createdAt": "2026-05-24T10:00:00.000Z",
  "expiresAt": "2026-05-25T10:00:00.000Z",
  "selection": {
    "elementIds": ["..."],
    "bounds": { "x": 0, "y": 0, "width": 1200, "height": 800 },
    "text": ["Primary CTA", "Error state", "Loading"]
  },
  "assets": {
    "manifest": "/v1/shares/sh_abc123/manifest",
    "excalidraw": "/v1/shares/sh_abc123/scene.excalidraw",
    "selectionJson": "/v1/shares/sh_abc123/selection.json",
    "png": "/v1/shares/sh_abc123/render.png",
    "svg": "/v1/shares/sh_abc123/render.svg",
    "brief": "/v1/shares/sh_abc123/brief.md"
  }
}
```

对 agent 的读取优先级：

1. `brief.md`：先获得低成本语义摘要。
2. `render.png` 或 `render.svg`：理解视觉布局。
3. `selection.json`：需要精确结构、文本、bounds、元素 ID 时读取。
4. `scene.excalidraw`：需要完整追溯或兼容 Excalidraw 工具链时读取。

## HTTP API

Base URL 示例：`http://127.0.0.1:37411`

所有非 `/health` 请求都需要：

```text
Authorization: Bearer <token>
```

Endpoints：

- `GET /health`
- `GET /v1/status`
- `GET /v1/shares`
- `GET /v1/shares/{shareId}/manifest`
- `GET /v1/shares/{shareId}/selection.json`
- `GET /v1/shares/{shareId}/scene.excalidraw`
- `GET /v1/shares/{shareId}/brief.md`
- `GET /v1/shares/{shareId}/render.png`
- `GET /v1/shares/{shareId}/render.svg`

`/mcp` 当前返回 `501 mcp_transport_not_implemented`，表示 HTTP 数据面已就绪，MCP transport 待实现。

## MCP 规划

Resources：

- `excalidraw://shares/{shareId}/manifest`
- `excalidraw://shares/{shareId}/brief`
- `excalidraw://shares/{shareId}/selection`
- `excalidraw://shares/{shareId}/image.png`
- `excalidraw://shares/{shareId}/scene.excalidraw`

Tools：

- `list_recent_shares`
- `get_share_manifest`
- `render_share`
- `search_scenes`
- `get_current_selection_share`
- `explain_api_status`

Prompts：

- `implement-ui-from-sketch`
- `explain-architecture-sketch`
- `turn-sketch-into-ticket`
- `review-flow-from-sketch`
- `generate-acceptance-criteria-from-sketch`

## Codex 配置

```toml
[mcp_servers.personal_excalidraw]
url = "http://127.0.0.1:37411/mcp"
bearer_token_env_var = "PERSONAL_EXCALIDRAW_TOKEN"
enabled = true
```

当前 HTTP fallback 可直接使用剪贴板里的 manifest URL 和 token。

## Claude Code 配置

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

## Agent 行为约束

- 如果用户提到“草图”“画布”“选区”“shareId”“vibe UI”或 Excalidraw，上来先检查 personal-excalidraw MCP 或用户给出的 manifest URL。
- 优先读取 `brief.md` 和 `render.png`，需要精确结构时再读 `selection.json`。
- 不要假设未分享的画布内容存在。
- 如果 API 关闭或 token 无效，提示用户在应用里打开 Agent Sharing 并重新分享。
- 做 UI 实现时，先把草图解释成布局、组件、状态、交互，再实现并截图验证。

## 后续落地顺序

1. 把当前 HTTP 数据面补成完整 MCP resources/tools/prompts。
2. 设置面板增强：TTL 配置、audit log 可视化、Revoke all shares 分层确认。
3. Codex / Claude Code 配置复制按钮。
4. `search_scenes` 和 `get_current_selection_share`。
5. 明确实时跟随文件变化模式。
6. 写回能力后置：评论、替代 UI sketch、agent 生成变体。
