# Excalidraw Agent MCP Share Design

Date: 2026-05-25

## Status

Approved design direction from brainstorming. This spec describes the first implementation slice and records later expansion paths for LAN and peer-to-peer sharing.

## Problem

The user often discusses UI, architecture, and product ideas inside Codex or Claude Code while the useful context lives in an Excalidraw sketch. Copying a full `.excalidraw` JSON blob into an agent conversation is noisy and brittle. The App needs a local sharing layer so the user can select shapes or a file, name the share, and let an agent read the right context through MCP.

## Goals

- Let the user create a named, read-only Agent Share from the current selection or current file.
- Let Codex, Claude Code, and similar tools discover recent shares by title, description, source file, and text preview.
- Provide each share as a context package: brief, PNG, SVG, selection JSON, and full `.excalidraw` snapshot.
- Keep the API off by default and local-only in the first version.
- Provide App UI for turning Agent Sharing on and off, managing shares, and copying MCP setup instructions.
- Provide prompt and skill guidance so agents know how to install and use the MCP server.

## Non-Goals For V1

- No cloud sync.
- No LAN access.
- No peer-to-peer sync.
- No writeback to Excalidraw.
- No automatic edits to Codex or Claude Code config files.
- No workspace-local share store.
- No scene search across the full library.

## Product Scope

V1 is a local Agent Sharing feature. The user can choose shapes and click `Share to Agent`, or share the current file when there is no active selection. The App creates a stable `shareId`, stores a snapshot package in the App data directory, and exposes it through a local MCP/API server while Agent Sharing is on.

The share is not live by default. It represents the selected content or file at creation time. A separate `Expose current selection` switch allows a running agent to inspect the current selection while the App is open, but this is runtime-only and not persisted as a share.

The default share TTL is 7 days. Expired shares are hidden from MCP/API reads and can be cleaned from the share manager.

## Storage Model

Shares live in the App global data directory, not inside the user's workspace.

```text
ApplicationSupport/PersonalExcalidraw/agent-shares/
  index.json
  audit.log
  sh_abc123/
    manifest.json
    brief.md
    selection.json
    scene.excalidraw
    render.png
    render.svg
```

`index.json` is the fast list for the UI and `list_recent_shares`. Each share directory contains the complete snapshot package. The directory name is the immutable `shareId`; user-facing naming lives in metadata so rename does not break URLs or MCP resource identifiers.

## Manifest Shape

```json
{
  "schemaVersion": 1,
  "shareId": "sh_abc123",
  "title": "Checkout redesign sketch",
  "description": "Error state and loading state for payment CTA",
  "labels": ["checkout", "ui"],
  "scope": "selection",
  "sourceFile": "scenes/checkout.excalidraw",
  "createdAt": "2026-05-25T10:00:00.000Z",
  "updatedAt": "2026-05-25T10:00:00.000Z",
  "expiresAt": "2026-06-01T10:00:00.000Z",
  "status": "active",
  "visibility": "local",
  "originDeviceId": "local-device-id",
  "ownerName": "Qihang",
  "syncMode": "snapshot",
  "permissions": ["read"],
  "selection": {
    "elementIds": ["..."],
    "bounds": { "x": 0, "y": 0, "width": 1200, "height": 800 },
    "text": ["Primary CTA", "Error state", "Loading"]
  },
  "textPreview": ["Primary CTA", "Error state", "Loading"],
  "assets": {
    "manifest": "/v1/shares/sh_abc123/manifest",
    "brief": "/v1/shares/sh_abc123/brief.md",
    "selectionJson": "/v1/shares/sh_abc123/selection.json",
    "excalidraw": "/v1/shares/sh_abc123/scene.excalidraw",
    "png": "/v1/shares/sh_abc123/render.png",
    "svg": "/v1/shares/sh_abc123/render.svg"
  }
}
```

`title`, `description`, and `labels` are editable after creation. Editing them updates `updatedAt` and both `manifest.json` and the corresponding `index.json` entry. It does not change the `shareId` or asset paths.

`visibility`, `originDeviceId`, `ownerName`, `syncMode`, and `permissions` are included now to keep the package compatible with future LAN and peer-to-peer sharing without changing the core manifest model.

## Index Shape

```json
{
  "schemaVersion": 1,
  "shares": [
    {
      "shareId": "sh_abc123",
      "title": "Checkout redesign sketch",
      "description": "Error state and loading state for payment CTA",
      "labels": ["checkout", "ui"],
      "sourceFile": "scenes/checkout.excalidraw",
      "scope": "selection",
      "createdAt": "2026-05-25T10:00:00.000Z",
      "updatedAt": "2026-05-25T10:00:00.000Z",
      "expiresAt": "2026-06-01T10:00:00.000Z",
      "status": "active",
      "visibility": "local",
      "textPreview": ["Primary CTA", "Error state", "Loading"]
    }
  ]
}
```

Supported statuses:

- `active`: readable until `expiresAt`.
- `expired`: no longer readable, can be cleaned.
- `revoked`: intentionally disabled, retained for audit/UI history until deleted.

Deleting a share removes its directory and index entry. Revoking a share keeps the index entry and audit trail but denies all reads.

## Local Service

Agent Sharing is controlled by an App setting:

- `Off`: no listener, no MCP/API access.
- `Local only`: bind to `127.0.0.1`, default port `37411`.

There is no bearer token in V1 because the service is local-only. Security comes from default-off behavior, loopback binding, read-only resources, explicit sharing, TTL, revoke/delete controls, and audit logging.

HTTP endpoints:

```text
GET /health
GET /v1/status
GET /v1/shares
GET /v1/shares/{shareId}/manifest
GET /v1/shares/{shareId}/brief.md
GET /v1/shares/{shareId}/selection.json
GET /v1/shares/{shareId}/scene.excalidraw
GET /v1/shares/{shareId}/render.png
GET /v1/shares/{shareId}/render.svg
GET /v1/current-selection/manifest
GET /v1/current-selection/brief.md
GET /v1/current-selection/render.png
```

Expired or revoked shares return a clear error with an actionable reason. If Agent Sharing is off, the process is not listening, so agents should use the setup prompt guidance to ask the user to enable it.

## MCP Surface

MCP is the primary integration path for Codex and Claude Code.

Resources:

```text
excalidraw://shares/{shareId}/manifest
excalidraw://shares/{shareId}/brief
excalidraw://shares/{shareId}/selection
excalidraw://shares/{shareId}/image.png
excalidraw://shares/{shareId}/image.svg
excalidraw://shares/{shareId}/scene.excalidraw
excalidraw://current-selection/manifest
excalidraw://current-selection/brief
excalidraw://current-selection/image.png
```

Tools:

```text
explain_api_status
list_recent_shares
get_share_manifest
get_share_brief
render_share
get_current_selection_share
```

`list_recent_shares` is the discovery tool. It returns `shareId`, `title`, `description`, `labels`, `sourceFile`, `scope`, `textPreview`, `createdAt`, `expiresAt`, `status`, and `visibility`. Agents should use this to match phrases like "the checkout sketch I just shared" before asking the user for a shareId.

Prompts:

```text
implement-ui-from-sketch
explain-architecture-sketch
turn-sketch-into-ticket
review-flow-from-sketch
generate-acceptance-criteria-from-sketch
```

Prompt guidance should recommend this read order:

1. `brief.md` for low-cost semantic context.
2. `render.png` or `render.svg` for visual layout.
3. `selection.json` for exact structure, text, bounds, and element IDs.
4. `scene.excalidraw` for full provenance or Excalidraw-compatible tooling.

## App UI

Settings page, `Agent Sharing` section:

```text
Agent Sharing: Off / Local only
Port: 37411
Expose current selection: on/off
Default Share TTL: 7 days
Open Shares Manager
Copy Codex MCP config
Copy Claude Code MCP config
Copy setup prompt for Codex/Claude
Revoke all shares
```

macOS menu bar:

```text
Agent Sharing
  Turn On / Turn Off
  Open Shares Manager
  Share Current Selection to Agent
  Expose Current Selection
  Copy Codex Setup Prompt
  Copy Claude Setup Prompt
  Revoke All Shares
```

Shares Manager:

- Lists `title`, `description`, `sourceFile`, `scope`, `createdAt`, `expiresAt`, `status`, and recent read status.
- Supports rename, edit description, edit labels, copy shareId, copy agent prompt, open source file, revoke, delete, clean expired, and revoke all.
- Shows whether Agent Sharing is currently off or local-only.

## Agent Setup Content

The App provides copyable config snippets and setup prompts. It does not modify external config files itself in V1.

Codex config snippet:

```toml
[mcp_servers.personal_excalidraw]
url = "http://127.0.0.1:37411/mcp"
enabled = true
```

Claude Code `.mcp.json` snippet:

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

Setup prompt for Codex or Claude Code:

```text
Please configure a local MCP server named personal-excalidraw at http://127.0.0.1:37411/mcp.

Also create or update your local skill/instructions for using this MCP:
- If I mention a sketch, canvas, Excalidraw, selected shapes, shareId, or vibe UI, first check the personal-excalidraw MCP.
- Use list_recent_shares to discover the right share by title, description, source file, labels, and text preview.
- Prefer brief.md and image.png/image.svg first.
- Read selection.json when exact text, bounds, element IDs, or structure are needed.
- Read scene.excalidraw only when full source data is needed.
- Do not assume unshared canvas content exists.
- If the MCP server is unavailable, ask me to enable Agent Sharing in the Excalidraw App.
- When implementing UI from a sketch, explain the inferred layout, components, states, and interactions before coding, then verify with a screenshot.
```

## Feedback Proposal Format

V1 does not write back to Excalidraw, but prompts can ask agents to return structured feedback that the App may support later.

```json
{
  "schemaVersion": 1,
  "shareId": "sh_abc123",
  "proposalType": "commentary",
  "summary": "The checkout flow needs a clearer loading state.",
  "comments": [
    {
      "target": { "elementIds": ["..."], "bounds": { "x": 0, "y": 0, "width": 300, "height": 120 } },
      "body": "Consider adding disabled and loading states for this CTA."
    }
  ],
  "suggestedChanges": []
}
```

Future writeback can turn this into comments, annotations, or generated sketch variants after explicit user review.

## Audit Log

The audit log records metadata only:

```text
time, shareId, resource, clientName, clientAddress, result
```

It does not record resource bodies. The share manager can display recent reads per share and provide cleanup controls.

## Future Phases

### LAN Share

LAN sharing allows the user to share a selected package with a coworker on the same network for 24 hours. It will require explicit `Share to LAN`, binding to a LAN interface, generated access link, short-lived access token, audit log visibility, and a prompt that helps the coworker's Codex or Claude Code configure temporary access.

### Peer-To-Peer Sync

Peer-to-peer sync is a later capability where two Excalidraw Apps establish a trusted session and exchange authorized share packages or live selection state. The V1 manifest reserves fields for this:

- `visibility: "local" | "lan" | "peer"`
- `originDeviceId`
- `ownerName`
- `peerSessionId`
- `syncMode: "snapshot" | "live"`
- `permissions: ["read"]`, later extendable to comments, proposals, or write.

P2P must have a separate design because it changes identity, connectivity, conflict, and permission boundaries.

## Testing And Acceptance

V1 is complete when:

- Agent Sharing defaults to off and creates no listener.
- Turning on local mode binds only to `127.0.0.1`.
- `Share to Agent` creates a named share package with manifest, brief, selection JSON, PNG, SVG, and `.excalidraw` snapshot.
- Renaming a share updates metadata without changing `shareId` or asset paths.
- `list_recent_shares` lets an agent find a share without a copied JSON blob.
- Expired and revoked shares cannot be read.
- Delete removes stored resources.
- The menu bar can open the share manager and perform cleanup/revoke actions.
- The copied Codex and Claude setup prompts contain enough information for the agent to configure MCP and create/update its own usage skill.
