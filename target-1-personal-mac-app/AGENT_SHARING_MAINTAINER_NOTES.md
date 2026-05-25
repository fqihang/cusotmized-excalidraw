# Agent Sharing Maintainer Notes

Date: 2026-05-25

These notes summarize the implemented Agent Sharing code path for future
maintenance. The user-facing product and API contract live in
[AGENT_SHARING.md](AGENT_SHARING.md).

## Current State

Agent Sharing is implemented as a local-only, read-only context handoff from
Personal Excalidraw to Codex, Claude Code, or another MCP-capable agent.

- The API is Off by default.
- Turning the API On starts a local listener bound to `127.0.0.1`.
- No bearer token is required in the current local-only version.
- Shares are persisted snapshots with a default 7-day TTL.
- The `Share` menu can create a selection share, create a whole-file share,
  show recent shares, re-copy Codex/Claude prompts, and open Shares Manager.
- A successful share opens a handoff panel and auto-copies a Codex prompt.
- The prompt works both when MCP is already installed and when the receiving
  agent still needs setup guidance.

## Code Map

Frontend:

- `app/src/agentSharing.ts`
  - TypeScript contract for share status, share summaries, share payloads, and
    Tauri command wrappers.
- `app/src/agentSharingPrompts.ts`
  - Pure handoff prompt generation for Codex and Claude Code.
  - Keeps first-run MCP setup guidance outside of React and Rust code.
- `app/src/AgentShareHandoff.tsx`
  - Share menu UI.
  - Success handoff panel UI.
  - Readability helper for active versus expired/revoked shares.
- `app/src/App.tsx`
  - Builds share payloads from the active Excalidraw draft.
  - Starts the local API when needed.
  - Saves dirty files before sharing.
  - Registers snapshot shares.
  - Copies handoff prompts.
  - Owns settings, Shares Manager, current-selection exposure, and macOS menu
    event handling.
- `app/src/styles.css`
  - Share menu, handoff panel, settings, and Shares Manager presentation.

Tauri/Rust:

- `app/src-tauri/src/lib.rs`
  - Registers Agent Sharing commands.
  - Creates the `AgentShareState` under `app_data_dir()/agent-shares`.
  - Adds macOS Agent menu entries and forwards menu events to the webview.
- `app/src-tauri/src/agent_sharing.rs`
  - Share manifest and summary data types.
  - Persistent share store and index.
  - Local HTTP listener lifecycle.
  - HTTP read endpoints.
  - MCP JSON-RPC resources, tools, and prompts.
  - Read audit logging.
  - Unit tests for persistence, readability, MCP, HTTP, cleanup, revoke, and
    delete behavior.

Planning and product docs:

- `docs/superpowers/specs/2026-05-25-excalidraw-agent-mcp-share-design.md`
- `docs/superpowers/plans/2026-05-25-agent-mcp-share-implementation.md`
- `docs/superpowers/specs/2026-05-25-agent-share-handoff-design.md`
- `docs/superpowers/plans/2026-05-25-agent-share-handoff-implementation.md`

## Data Flow

1. User selects shapes or chooses to share the whole file.
2. `App.tsx` saves the active file if it is dirty.
3. `App.tsx` starts the local Agent Sharing API if it is Off.
4. `buildAgentSharePayload()` derives:
   - scope: `selection` or `scene`
   - title, description, labels
   - element IDs, bounds, and extracted text
   - `selection.json`
   - full `scene.excalidraw`
   - `render.png`
   - `render.svg`
   - `brief.md`
5. `register_agent_share` writes the snapshot into the Rust share store.
6. The frontend refreshes share status and recent share summaries.
7. `buildAgentHandoffPrompt()` generates the Codex/Claude prompt from the
   registered share and current API URL.
8. The app auto-copies the Codex prompt and opens the handoff panel.
9. The receiving agent reads the share through MCP first, or through HTTP as a
   read-only fallback.

## Storage Contract

The Rust store root is:

```text
app_data_dir()/agent-shares
```

The store contains:

```text
agent-shares/
  index.json
  audit.log
  sh_example/
    manifest.json
    selection.json
    scene.excalidraw
    render.png
    render.svg
    brief.md
```

`index.json` is the fast list surface for the app and MCP tools. The manifest is
the source of truth for an individual share. `lastReadAt` lives on summaries and
is updated through `record_read()` whenever an HTTP or MCP read succeeds.

## Share Contract

The manifest is the stable context package for agents. The important fields are:

- `shareId`: stable local identifier such as `sh_...`.
- `title`, `description`, `labels`: human naming layer for selecting a share.
- `scope`: `selection` or `scene`.
- `sourceFile`: workspace-relative `.excalidraw` file path.
- `status`: `active`, `expired`, or `revoked`.
- `visibility`: currently `local`; reserved values include `lan` and `peer`.
- `syncMode`: currently `snapshot`.
- `permissions`: currently `["read"]`.
- `selection`: selected element IDs, bounds, and text preview.
- `assets`: relative HTTP paths for manifest, brief, structured JSON, source
  scene, PNG, and SVG.

Agents should use `title`, `description`, `labels`, `sourceFile`, and
`textPreview` to pick the right share before asking the user for a `shareId`.

## API And MCP Boundary

HTTP:

- `/health`
- `/v1/status`
- `/v1/shares`
- `/v1/shares/{shareId}/manifest`
- `/v1/shares/{shareId}/selection.json`
- `/v1/shares/{shareId}/scene.excalidraw`
- `/v1/shares/{shareId}/brief.md`
- `/v1/shares/{shareId}/render.png`
- `/v1/shares/{shareId}/render.svg`
- `/v1/current-selection/manifest`
- `/v1/current-selection/brief.md`
- `/v1/current-selection/render.png`
- `/v1/current-selection/render.svg`
- `/mcp`

MCP:

- Resources expose persisted shares and the optional runtime current selection.
- Tools cover listing, searching, reading manifests, reading briefs, rendering,
  current selection, and API status.
- Prompts provide task-specific guidance for UI implementation, architecture
  explanation, tickets, flow review, and acceptance criteria.

The MCP endpoint uses Streamable HTTP-style JSON-RPC POST requests. `GET /mcp`
intentionally returns a method error instead of SSE.

## Security And Lifecycle

Current local-only assumptions:

- Binding is `127.0.0.1`, not LAN.
- No token is required.
- Turning the API Off stops the listener and clears runtime current-selection
  exposure.
- Persisted shares remain in app storage while Off, but cannot be read because
  there is no listener.
- Expired and revoked shares remain visible in lists but `ensure_readable()`
  blocks asset reads.
- `origin_allowed()` allows no-Origin clients, `null`, Tauri origins, and the
  local listener origin; it rejects unrelated browser origins.
- Share IDs only allow ASCII letters, numbers, `_`, and `-`.

Do not reuse the no-token local-only model for LAN sharing. LAN sharing needs a
separate explicit visibility mode, a link secret or token, a short TTL, and
visible revoke state.

## Product Decisions Worth Preserving

- Handoff prompts are generated on demand; they are not stored as separate
  files. This keeps prompts aligned with the current API URL and share status.
- The Share menu is also the recovery path. Users do not need to copy the prompt
  immediately because recent shares can re-copy Codex/Claude prompts later.
- MCP is the preferred read path, but the prompt includes HTTP fallback because
  first-run setup may happen before MCP is available.
- `brief.md` is the low-cost first read; agents should read image and structured
  JSON only when needed.
- Runtime current selection is separate from persisted snapshot shares because
  live-following behavior has different privacy and lifecycle expectations.

## Verification

Core commands:

```bash
cd target-1-personal-mac-app/app
npm run typecheck
npm run build
npm run tauri:build
```

```bash
cd target-1-personal-mac-app/app/src-tauri
cargo test
```

Manual smoke checks:

1. Start the app.
2. Turn Agent Sharing On.
3. Create a share from a selected group of shapes.
4. Confirm the handoff panel opens.
5. Confirm the Codex prompt can be pasted and contains the `shareId`, MCP URL,
   manifest URL, and setup fallback.
6. Open the Share menu and re-copy the same share prompt.
7. Open Shares Manager and rename, revoke, delete, and clean shares.
8. Stop Agent Sharing and confirm local reads fail because no listener exists.

## Extension Notes

LAN share links:

- Add an explicit `visibility: "lan"` mode.
- Bind to a selected LAN interface only after user confirmation.
- Add a per-share secret in the generated link.
- Default TTL should be shorter than local shares, for example 24 hours.
- The teammate prompt should include the URL and enough setup text for their
  Codex or Claude Code instance to install/use the remote MCP or HTTP endpoint.

Peer-to-peer sync:

- Keep snapshot shares and live sync separate in UI and data model.
- A future peer mode should introduce session identity, connection status, and
  per-peer permission state instead of mutating the local snapshot contract.

Write-back:

- Treat write-back as a separate permission class.
- Start with comments or alternative sketch variants rather than direct edits to
  existing elements.
- Require explicit user approval before applying agent-created scene changes.

Skill packaging:

- The current product provides prompt text for creating a skill.
- A future version can ship a ready-to-install Codex skill directory or a
  one-click copy bundle, but this should not block first-run MCP setup.

