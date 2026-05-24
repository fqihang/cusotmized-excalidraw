---
name: personal-excalidraw-agent-share
description: Use when a user mentions an Excalidraw sketch, canvas, selected shapes, shareId, vibe UI mockup, UI sketch, architecture sketch, or asks an agent to implement, review, explain, or turn a shared drawing into work items using Personal Excalidraw Agent Sharing.
---

# Personal Excalidraw Agent Share

Use the `personal-excalidraw` MCP server first when it is available. If MCP is not available but the user provides a manifest URL and bearer token, use the HTTP API directly.

## Workflow

1. Check API status or read the provided share manifest.
2. Read `brief.md` first for the sketch intent and source metadata.
3. Read `image.png` or `render.svg` to inspect the visual layout.
4. Read `selection.json` when you need exact text, bounds, element IDs, grouping, or interaction hints.
5. Read `scene.excalidraw` only when the full source file is necessary.
6. Preserve `shareId`, `sourceFile`, `createdAt`, and `expiresAt` in your working notes when they matter for traceability.

## Constraints

- Treat every share as read-only unless the user explicitly asks for a write-back workflow and the tool supports it.
- Do not assume unshared canvas content exists.
- If the API is off, unreachable, expired, or unauthorized, ask the user to open Personal Excalidraw, turn on Agent Sharing, and create a fresh share.
- Prefer the smallest resource that answers the question. Do not load the full `.excalidraw` file when `brief.md`, `image.png`, and `selection.json` are enough.

## UI Implementation From Sketch

When implementing a UI from a sketch:

1. Convert the sketch into layout regions, components, visual hierarchy, states, and interactions.
2. Identify ambiguous parts and make conservative assumptions grounded in the existing codebase.
3. Implement using the app's current frontend patterns and design system.
4. Run the local app and verify with screenshots or visual inspection when possible.
5. Report any assumption that materially affects the UI.

## Common Prompts

- `implement-ui-from-sketch`: Build the UI represented by the shared sketch.
- `explain-architecture-sketch`: Explain the system or data flow represented by the sketch.
- `turn-sketch-into-ticket`: Convert the sketch into implementation tasks and acceptance criteria.
- `review-flow-from-sketch`: Review UX, edge cases, and missing states in a flow sketch.
- `generate-acceptance-criteria-from-sketch`: Produce Given/When/Then acceptance criteria from the shared drawing.
