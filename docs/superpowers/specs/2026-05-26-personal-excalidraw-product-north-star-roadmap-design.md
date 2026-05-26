# Personal Excalidraw Product North Star And Roadmap Design

Date: 2026-05-26

## Purpose

Personal Excalidraw is not only a customized Excalidraw fork. It is a local-first drawing workbench for people who use sketches as thinking tools, private knowledge artifacts, and AI coding context.

The product should keep Excalidraw's lightweight hand-drawn feel while adding the desktop capabilities that make it reliable for long-term personal use: local storage, file management, search, thumbnails, labels, backup, and stable save behavior. It should also make sketches readable by Codex, Claude Code, and other agent products through a local MCP/API bridge.

One-sentence positioning:

> A local-first Personal Excalidraw workbench that keeps Excalidraw's drawing freedom, adds private file management, and turns sketches into high-quality Agent context.

## Target User

The first user is a personal deep knowledge worker who also uses AI coding agents.

This user often creates:

- architecture sketches
- product and workflow diagrams
- meeting sketches
- UI and vibe coding sketches
- implementation notes and visual problem explanations

They need two things at the same time:

1. A private local place to store, find, and manage many `.excalidraw` files.
2. A reliable way to bring selected sketches into Codex or Claude Code as context for discussion, implementation, review, and planning.

Team and LAN sharing is an important future scenario, but it is not the first product center. The first product center is a strong single-user local workbench with a high-quality Agent handoff path.

## Product North Star

The product has three mutually reinforcing pillars.

### 1. Local Drawing Power

The app should preserve the Excalidraw experience: fast, expressive, low-friction, and sketch-first. The goal is not to replace Figma or turn Excalidraw into a heavy design system tool.

The drawing surface should feel familiar to Excalidraw users. Enhancements should focus on making the local desktop workflow better, not on changing the core drawing model unnecessarily.

### 2. Private File Management And Storage

Private local storage is a core feature, not an implementation detail.

The app should help users find and manage their drawings without relying on Finder as the primary interface. The first-stage management promise is:

- Findable: file tree, file name search, path search, canvas text search, recent files, thumbnails.
- Manageable: labels, favorites, rename, copy, delete, backup, list backup, and clear feedback for dangerous operations.

The knowledge-base layer can grow later from these foundations, but the first stage should focus on making local file work trustworthy.

### 3. Agent-Native Context Sharing

Sketches should not remain isolated screenshots. They should become structured context packages that agents can read.

The Agent Sharing surface should let users share a selected group of shapes or a whole file with Codex, Claude Code, or another local agent. The agent should be able to read:

- `brief.md` for low-cost semantic summary
- `render.png` or `render.svg` for visual layout
- `selection.json` for exact text, bounds, element IDs, and structure
- `scene.excalidraw` for full traceability

The first version is read-only. Long-term write-back is possible, but only as controlled, reviewable changes based on Excalidraw-native capabilities.

## Product Principles

### Local First

Files, indexes, thumbnails, share records, and exported context should default to the user's machine. The app should not require an account or cloud service for the core workflow.

### Preserve Excalidraw's Original Feel

The app should not make drawing feel heavier. New management and Agent features should surround the canvas rather than dominate it.

### Findable And Manageable

The user should be able to maintain a large personal collection of drawings. Searching, organizing, and safely operating on files are first-class product capabilities.

### Agent-Native, Not Clipboard-JSON Native

The user should not need to copy large `.excalidraw` JSON blobs into an agent chat. The app should create named, reusable shares and expose them through MCP/API in a way that agents can understand.

### Read-Only First, Controlled Write-Back Later

The current Agent boundary is read-only context passing. Future write-back should be explicit, previewable, and user-approved.

### Stability Before Expansion

Save status, file operations, menus, install packaging, API lifecycle, and error recovery must be reliable before adding broad collaboration or advanced automation.

## What We Will Not Do Yet

- No required cloud account.
- No default cloud sync.
- No subscription or hosted collaboration platform in the first product center.
- No attempt to become a full Figma replacement.
- No broad template/component-library push before local management and Agent handoff are solid.
- No direct agent writes to the canvas without user approval.
- No LAN or peer-to-peer sharing inside the local-only Agent Sharing mode.

## 8-12 Week Roadmap

The roadmap should be organized as one complete product loop, ordered by dependency:

1. Stability foundation.
2. Local file workbench.
3. Agent handoff.
4. End-to-end loop.

### Phase 1: Stability Foundation

Goal: the app should be safe to install and reliable for daily drawing work.

Scope:

- Install package, versioning, and release path are clear.
- Save states are trustworthy: Ready, Unsaved, Saving, and Error must not mislead users.
- File menus, row menus, popovers, and dialogs behave predictably.
- Menus close on outside click or Escape where users expect that behavior.
- Save, export, API startup, file operation, and packaging errors have clear feedback.
- Basic verification covers save behavior, file operations, Agent API start/stop, and Tauri packaging.

Success criteria:

- Users do not worry that a file is stuck in a false Unsaved state.
- App restart preserves workspace and recent working context.
- The DMG can be installed and launched directly.
- Common UI menus do not trap the user.

### Phase 2: Local File Workbench

Goal: users can find and manage many local `.excalidraw` files without relying on Finder as the primary workflow.

Scope:

- File tree.
- Recent files.
- Search by file name, relative path, and canvas text.
- Stable thumbnail generation and refresh.
- Labels and favorites.
- Rename, copy, delete, export, and backup.
- Backup current list.
- Workspace switching and re-indexing.
- Clear confirmation for dangerous operations.

Success criteria:

- A user with many drawings can quickly find the target drawing.
- A user can complete common organization tasks inside the app.
- Delete, rename, backup, and copy operations are understandable and recoverable enough for daily use.

### Phase 3: Agent Handoff

Goal: users can hand a sketch to Codex or Claude Code without copying raw JSON or guessing the next step.

Scope:

- Agent On/Off clearly shows local API state.
- Share current selection.
- Share whole file.
- Share from file row menu.
- Share result opens a handoff panel.
- Codex prompt is auto-copied after successful share creation.
- Codex and Claude prompts can be re-copied from recent shares and Shares Manager.
- Shares Manager supports naming, description, labels, revoke, delete, clean expired, and prompt copy.
- MCP resources, tools, and prompts remain read-only and documented.
- App provides Codex config, Claude config, HTTP API reference, and Skill Creator prompt.

Success criteria:

- After sharing, the user knows exactly what to paste into Codex or Claude Code.
- If the clipboard is overwritten, the user can recover the prompt from the app.
- The receiving agent can read brief, image, selection JSON, and scene source through MCP.
- Expired or revoked shares are visible but not readable.

### Phase 4: End-To-End Loop

Goal: the full user journey from local drawing to Agent discussion and back to share management works as one coherent flow.

Primary path:

1. User finds or opens a sketch in the local workbench.
2. User selects a group of shapes or chooses the whole file.
3. User creates an Agent share.
4. User continues discussion or implementation in Codex or Claude Code.
5. Agent reads the share through MCP/API.
6. User returns to the app to rename, revoke, delete, or re-copy the share prompt.

Success criteria:

- The user never has to manually copy raw Excalidraw JSON.
- The user can identify which share was used by title, source file, labels, and text preview.
- The user understands whether a share is active, expired, or revoked.
- The app remains the source of truth for local drawing storage and share lifecycle.

## Future Tracks

### Controlled Write-Back

Write-back is a long-term goal, not the current product boundary.

It should focus on operations that Excalidraw can represent clearly:

- change a specific text element
- adjust a specific element's color, stroke, fill, or border
- modify a connector, arrow, or relationship edge
- add comments or visual annotations
- generate an alternative sketch as a new file or new version
- generate a change proposal that the user can review and apply

Rules:

- Every write-back requires explicit user confirmation.
- Prefer preview or diff before applying changes.
- Target objects must be locatable by element ID or current selection.
- Avoid black-box "redraw the whole canvas" behavior.
- Generated alternatives should not overwrite the original drawing by default.

### LAN Sharing

LAN sharing should be a separate mode from local-only Agent Sharing.

Possible shape:

- `visibility: "lan"`
- explicit LAN share switch
- selected network interface or LAN host
- per-share secret or token
- default 24-hour TTL
- one-click revoke
- teammate-facing share link
- teammate-facing prompt for Codex or Claude Code

This mode must clearly warn the user that data is no longer only accessible from the same machine.

### Peer-To-Peer Sync

Peer-to-peer sync is a later collaboration track.

It should not mutate the snapshot share model. It needs its own concepts:

- session identity
- peer identity
- connection status
- permission state
- conflict handling
- sync lifecycle

### Knowledge-Base Layer

The first product stage is file workbench, not a full knowledge base. Later, the app can build a knowledge layer from existing assets:

- generated brief for each drawing
- project-level grouping
- links between drawings
- generated README or design notes from a set of drawings
- MCP search over historical sketch context

## Success Criteria

The product direction is working when:

- Users trust the app as a local place to store and manage many sketches.
- Users can find the drawing they need quickly.
- Users can safely organize, rename, copy, delete, favorite, label, and back up drawings.
- Users can share a selected sketch or whole file with Codex or Claude Code without copying raw JSON.
- Agents can read visual, structural, and semantic sketch context.
- The product boundary remains clear: local-first drawing and management first, read-only Agent context now, controlled write-back later.
- Future LAN, peer-to-peer, and knowledge-base features have clear entry points but do not distract the first-stage product.

## Decision Log

- Product artifact for this work: product north star plus 8-12 week roadmap.
- First user: personal deep knowledge worker plus AI coding user.
- Team and LAN collaboration: important but later.
- Drawing differentiation: preserve Excalidraw original feel and add Agent-native context sharing.
- Drawing productivity features like templates and component libraries: later, after the core workbench is reliable.
- MCP/Agent boundary now: read-only context passing.
- Write-back: long-term controlled capability, based on Excalidraw-native operations and user approval.
- Local management first stage: findable plus manageable.
- Near-term roadmap must cover stability, local file workbench, Agent handoff, and the end-to-end loop.

## Spec Self-Review

Placeholder scan: no unresolved placeholders are intentionally left in this design.

Internal consistency: the north star, principles, roadmap, and future tracks all preserve the same boundary: local-first workbench and read-only Agent handoff now; controlled write-back, LAN sharing, peer-to-peer sync, and knowledge-base features later.

Scope check: this is a strategy and roadmap spec, not an implementation plan. It is suitable for a later implementation planning pass that chooses one roadmap phase or a thin vertical slice.

Ambiguity check: "Agent write-back" is explicitly defined as a future, user-approved, Excalidraw-native operation class rather than unrestricted agent editing.

