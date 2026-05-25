# Agent Sharing

Agent Sharing lets a user share Excalidraw context with Codex, Claude Code, or another local agent without copying a large `.excalidraw` JSON blob. The app creates a named, read-only context package and exposes it through a local HTTP/MCP server only while the user turns the feature on.

Implementation notes for future maintenance live in [AGENT_SHARING_MAINTAINER_NOTES.md](AGENT_SHARING_MAINTAINER_NOTES.md).

## First Version Scope

- Read-only local sharing.
- API switch is default Off. Off means no listener and no MCP/HTTP access.
- Local only: the server binds to `127.0.0.1`.
- No bearer token in this version because access is local-machine only.
- Share data is persisted in the app data directory, but cannot be read while the API is Off.
- Snapshot shares expire after 7 days by default.
- `Expose current selection` is a separate live runtime share and is cleared when disabled or when the API stops.
- Share management supports rename, prompt copy, revoke, delete, clean expired, and revoke all.

## User Path

1. User selects shapes on the canvas.
2. User clicks `Share`, uses the file row menu `分享给 Agent`, or uses the macOS `Agent` menu.
3. If Agent Sharing is Off, the app starts the local API.
4. The app saves a dirty scene first, then registers a snapshot share.
5. The app opens a handoff panel and auto-copies a Codex handoff prompt.
6. The user pastes that prompt into Codex or Claude Code.
7. If the receiving agent has MCP configured, it reads the share through MCP.
8. If MCP is missing, the prompt guides setup first, then the user retries the same share.
9. The user can re-copy prompts later from the `Share` menu or Shares Manager.

If no shapes are selected, the share scope falls back to the whole current scene.

## App Entrances

- Canvas top right: `Agent On/Off` and `Share`.
- File row menu: `分享给 Agent`.
- Settings: API status, port, share count, 7-day TTL, no-token status, current selection toggle, config copy buttons, and share cleanup actions.
- Shares Manager: open from settings or the macOS `Agent` menu; rename, revoke, delete, clean, and copy a share-specific prompt.
- macOS menu bar: `Agent > Share Current to Agent`, `Toggle Agent Sharing API`, `Open Shares Manager`, and `Open Agent Sharing Settings`.

## Share Handoff

The `Share` button is also the recovery entry for previous handoffs. It contains:

- `Share current selection`
- `Share whole file`
- recent shares with copy actions for readable shares
- disabled status text for expired or revoked shares
- `Open Shares Manager`

After creating a share, the app opens a handoff panel and auto-copies the Codex prompt. The prompt includes the shareId, MCP URL, manifest URL, a first-run MCP setup snippet, HTTP fallback guidance, and read-order rules.

## Share Manifest

Every share is a context package, not only an Excalidraw file:

```json
{
  "schemaVersion": 1,
  "shareId": "sh_abc123",
  "scope": "selection",
  "title": "Checkout redesign sketch",
  "description": "Error and loading states",
  "labels": ["checkout", "ui"],
  "sceneId": "...",
  "sourceFile": "scenes/checkout.excalidraw",
  "createdAt": "2026-05-25T10:00:00.000Z",
  "updatedAt": "2026-05-25T10:00:00.000Z",
  "expiresAt": "2026-06-01T10:00:00.000Z",
  "status": "active",
  "visibility": "local",
  "originDeviceId": "local-device",
  "ownerName": "local-user",
  "syncMode": "snapshot",
  "permissions": ["read"],
  "selection": {
    "elementIds": ["..."],
    "bounds": { "x": 0, "y": 0, "width": 1200, "height": 800 },
    "text": ["Primary CTA", "Error state", "Loading"]
  },
  "textPreview": ["Primary CTA"],
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

The title, description, and labels are the human-facing naming layer. Agents should use them, along with `sourceFile` and `textPreview`, to identify the right share before asking the user for a shareId.

## Read Order For Agents

1. `brief.md`: low-cost semantic summary.
2. `render.png` or `render.svg`: visual layout.
3. `selection.json`: exact text, bounds, element IDs, and structure.
4. `scene.excalidraw`: full source snapshot for traceability or tooling compatibility.

## HTTP API

Base URL: `http://127.0.0.1:37411`

Auth: none. The app controls access by starting and stopping the local listener.

Endpoints:

- `GET /health`
- `GET /v1/status`
- `GET /v1/shares`
- `GET /v1/shares/{shareId}/manifest`
- `GET /v1/shares/{shareId}/selection.json`
- `GET /v1/shares/{shareId}/scene.excalidraw`
- `GET /v1/shares/{shareId}/brief.md`
- `GET /v1/shares/{shareId}/render.png`
- `GET /v1/shares/{shareId}/render.svg`
- `GET /v1/current-selection/manifest`
- `GET /v1/current-selection/brief.md`
- `GET /v1/current-selection/render.png`
- `GET /v1/current-selection/render.svg`
- `POST /mcp`

Expired or revoked shares remain visible in lists but cannot be read.

## MCP Surface

Resources:

- `excalidraw://shares/{shareId}/manifest`
- `excalidraw://shares/{shareId}/brief`
- `excalidraw://shares/{shareId}/selection`
- `excalidraw://shares/{shareId}/image.png`
- `excalidraw://shares/{shareId}/image.svg`
- `excalidraw://shares/{shareId}/scene.excalidraw`
- `excalidraw://current-selection/manifest`
- `excalidraw://current-selection/brief`
- `excalidraw://current-selection/image.png`

Tools:

- `list_recent_shares`
- `search_scenes`
- `get_share_manifest`
- `get_share_brief`
- `render_share`
- `get_current_selection_share`
- `explain_api_status`

Prompts:

- `implement-ui-from-sketch`
- `explain-architecture-sketch`
- `turn-sketch-into-ticket`
- `review-flow-from-sketch`
- `generate-acceptance-criteria-from-sketch`

## Codex Config

```toml
[mcp_servers.personal_excalidraw]
url = "http://127.0.0.1:37411/mcp"
enabled = true
```

## Claude Code Config

```json
{
  "mcpServers": {
    "personal-excalidraw": {
      "type": "http",
      "url": "http://127.0.0.1:37411/mcp"
    }
  }
}
```

## Skill Creator Prompt

```markdown
Use the personal-excalidraw MCP server whenever the user mentions an Excalidraw sketch, canvas, selected shapes, shareId, vibe UI mockup, UI sketch, architecture sketch, or asks to implement, review, explain, or turn a drawing into work items.

Workflow:
1. Call `list_recent_shares` and match by title, description, sourceFile, labels, and textPreview.
2. Read `brief.md` first.
3. Inspect `image.png` or `image.svg`.
4. Read `selection.json` when exact structure, bounds, text, or element IDs are needed.
5. Read `scene.excalidraw` only when full source data is necessary.

Constraints:
- Treat shares as read-only.
- Do not assume unshared canvas content exists.
- If the API is Off, unreachable, expired, or revoked, ask the user to open Personal Excalidraw, turn on Agent Sharing, and create or re-enable a share.
- For UI implementation, translate the sketch into layout, components, states, and interactions before coding.
```

## Later Work

- LAN share links with explicit visibility, a 24-hour TTL, and a share prompt for a teammate's agent.
- Peer-to-peer sync for future collaborative or write-back flows.
- Write-back tools for comments, alternative UI sketches, or agent-generated variants.
- Settings confirmation for destructive bulk actions and a visible audit log.
