# Personal Excalidraw

This repository is the product monorepo for Personal Excalidraw: a local-first
macOS drawing workspace based on Excalidraw, with file management and Agent/MCP
sharing features.

- `excalidraw/`: vendored/customized Excalidraw engine and UI source.
- `target-1-personal-mac-app/`: the main product app, built with Tauri, React,
  Vite, and Excalidraw.
- `docs/`: product planning, Agent Sharing design, MCP/API notes, and archived
  product-line explorations.
- `dist/`: local build output only. This directory is intentionally ignored by
  git.

Agent Sharing user docs and maintainer notes are in
`target-1-personal-mac-app/AGENT_SHARING.md` and
`target-1-personal-mac-app/AGENT_SHARING_MAINTAINER_NOTES.md`.

Repository structure and migration notes are in `docs/repository-structure.md`.

Build artifacts, dependency folders, and local bundles are intentionally excluded from git.
