# Agent Share Handoff Design

Date: 2026-05-25

## Context

Personal Excalidraw can already create local, persisted Agent Shares and expose them through a local no-token MCP/HTTP server. The current share flow successfully creates a `shareId`, copies a manifest URL, and stores the share in the app registry.

The experience gap is after creation: the user sees that a share exists, but does not know what to do next in Codex or Claude Code. Clipboard-only handoff also creates anxiety because the prompt can be overwritten and is hard to recover without knowing where to look.

## Goals

- Make the next step after sharing explicit: go to Codex or Claude Code and paste a handoff prompt.
- Keep the fastest path fast by auto-copying a Codex handoff prompt after share creation.
- Provide visible recovery paths so users can re-copy prompts from persisted shares later.
- Support both receiving-agent states:
  - MCP/skill already configured.
  - MCP/skill not configured yet.
- Keep the first iteration local-only, read-only, and compatible with the existing Agent Share registry.

## Non-Goals

- Do not auto-edit Codex or Claude Code configuration files from Personal Excalidraw.
- Do not implement write-back to Excalidraw.
- Do not implement LAN teammate sharing or peer-to-peer sync in this iteration.
- Do not make Agent Sharing depend on MCP availability for installation guidance.

## Chosen Approach

Use a Share Handoff Flow.

The existing `Share` button becomes a menu that can create new shares and recover recent persisted shares. After a successful share, the app opens a handoff panel and auto-copies a Codex prompt. The prompt is self-contained enough to bootstrap an unconfigured Codex session, while full setup references remain available from app copy actions.

This avoids hiding the recovery path in settings only, and it avoids turning the Agent status switch into a large hub before the product needs that complexity.

## UX Flow

### Share Menu

The top-right `Share` control becomes a menu with these actions:

- `Share current selection`
- `Share whole file`
- Recent shares, limited to the latest 3 to 5:
  - share title
  - short source/status metadata
  - `Copy Codex prompt` for readable shares
  - `Copy Claude Code prompt` for readable shares
  - disabled status text for expired or revoked shares
- `Open Shares Manager`

The menu is the primary recovery entry when the clipboard was overwritten. Users should reasonably expect previous share prompts to be recoverable from the same place where they created the share. Expired or revoked shares may appear briefly for orientation, but the menu should not imply they are readable.

### Success Handoff Panel

After a share is created, the app shows a small handoff panel:

- share title
- shareId
- source file
- expiration/status
- `Copy Codex handoff prompt`
- `Copy Claude Code handoff prompt`
- `Open Shares Manager`

The app auto-copies the Codex handoff prompt on successful share creation. If clipboard write fails, the panel stays open and the copy buttons remain available.

### Shares Manager

Shares Manager remains the full persistent management surface:

- rename metadata
- revoke
- delete
- clean expired
- revoke all
- copy Codex/Claude handoff prompt for any readable share

Expired or revoked shares remain visible for context but read/copy actions should indicate why the share cannot be used and suggest creating a fresh share.

## Handoff Prompt Structure

Each share has two generated handoff prompt variants: Codex and Claude Code. Prompts are generated from the persisted share summary at copy time, not stored as separate per-share files.

The Codex handoff prompt contains:

- Task framing: continue work from this Personal Excalidraw share.
- Share metadata:
  - `title`
  - `shareId`
  - `sourceFile`
  - local MCP URL
  - local manifest URL
- Primary path:
  - Check whether the `personal-excalidraw` MCP server is available.
  - If available, call `get_share_manifest`, then read `brief`, then inspect `image`, then read `selection.json` only when exact structure is needed.
- Bootstrap path:
  - If MCP is missing, guide the user to add the minimal Codex MCP configuration.
  - Guide the user to create or update a compact `personal-excalidraw` skill.
  - Ask the user to retry after enabling the MCP server.
- HTTP fallback:
  - If MCP is unavailable but the manifest URL is reachable, use HTTP read-only endpoints as fallback.
- Rules:
  - Treat the share as read-only.
  - Do not assume unshared canvas content exists.
  - If the API is off, unreachable, expired, or revoked, ask the user to return to Personal Excalidraw, turn on Agent Sharing, and create or re-enable a share.

The Claude Code prompt uses the same share metadata and read-order rules, but its bootstrap path references Claude Code `.mcp.json`.

## Bootstrap Layering

The prompt uses a layered setup model:

1. Share handoff prompt: short, self-contained, and enough to bootstrap.
2. App copy actions: full Codex setup prompt, full Claude setup prompt, full skill template, and HTTP API reference.
3. MCP prompts: richer workflow prompts after MCP is already configured.

This is intentionally not dependent on MCP for first-run setup, because MCP may be the missing component.

## State And Data

Use the existing persisted share registry:

- `shareId`
- `title`
- `description`
- `labels`
- `scope`
- `sourceFile`
- `createdAt`
- `expiresAt`
- `status`
- assets: manifest, brief, image, selection JSON, scene snapshot

Prompt text is derived from share summary plus current Agent Sharing status:

- base URL
- MCP URL
- manifest URL
- current API enabled/disabled state

No new storage model is needed for handoff prompts.

## Error Handling

- API off: share menu shows the disabled state and offers to start Agent Sharing. Prompt tells the receiving agent to ask the user to turn Agent Sharing on.
- MCP missing: prompt asks the receiving agent to guide setup, not to assume configuration.
- Share expired: show the share with expired status and suggest creating a fresh share.
- Share revoked: show the share with revoked status and block read/copy actions that would imply it is usable.
- Clipboard failure: keep the handoff panel open and show copy buttons.
- No selection: allow sharing the whole current file.
- No active file: disable share creation and show a clear reason.

## Testing

Manual verification:

- Create a selection share and confirm the handoff panel opens.
- Confirm Codex prompt is copied after share creation.
- Reopen the Share menu and copy the same prompt from recent shares.
- Open Shares Manager and copy the same prompt from the persisted share.
- Stop Agent Sharing and verify share read guidance explains that the API is off.
- Revoke a share and verify copy/read actions communicate that it is revoked.

Automated or component-level checks:

- Prompt generation includes shareId, MCP URL, manifest URL, source file, and bootstrap instructions.
- Prompt generation does not require MCP to be available.
- Share menu recent-list filtering excludes or disables unusable shares consistently.
- Existing Agent Share registry tests continue to pass.

## Open Follow-Ups

- LAN teammate share links remain a separate future design.
- Peer-to-peer sync remains a separate future design.
- Write-back comments or generated sketch variants remain a separate future design.
