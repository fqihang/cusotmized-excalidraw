# Repository Structure

This repository is the single source of truth for Personal Excalidraw. The
top-level repository is the only product git repository; product modules should
not become nested git repositories.

## Active Product Directories

```text
personal-excalidraw/
  excalidraw/
  target-1-personal-mac-app/
  docs/
  dist/
  README.md
  .gitignore
```

### `excalidraw/`

This directory contains the vendored and customized Excalidraw source used by
the product. It is not treated as a standalone clone of
`github.com/excalidraw/excalidraw` inside this product workspace.

When upstream Excalidraw needs to be compared or updated, use a separate clean
upstream clone outside this product repository, then intentionally copy or merge
the required changes into this directory.

### `target-1-personal-mac-app/`

This is the main product surface. It owns the local-first macOS app, file
management shell, Agent Sharing entry points, local MCP/API service integration,
and future LAN sharing experience.

This directory should not become its own git repository. It is a module inside
the top-level product repo.

### `docs/`

This directory holds product planning, implementation plans, MCP/API
documentation, Agent skill guidance, and archived strategy notes. Historical
ideas that are not active product lines belong under `docs/archive/`.

### `dist/`

This directory is for local installers and build artifacts. It is ignored by
git. Release artifacts can be copied here for local installation checks, but
source control should only track the source and documentation needed to recreate
them.

## Archived Product Lines

`target-3-team-self-hosted` has been archived under
`docs/archive/target-3-team-self-hosted/`.

The original target-3 idea overlapped with the direction now planned for
`target-1-personal-mac-app`: LAN sharing, local MCP/API reads, and future
peer-to-peer sync. Keeping it as a top-level product directory would split the
roadmap too early, so the active product line is target-1.

If a future self-hosted/team product becomes necessary, it should start from a
fresh design that builds on the mature target-1 sharing model instead of
reviving the old target-3 directory as-is.

## Local Workspace Convention

Use a stable local checkout path for the product repository, for example:

```text
/Users/qihang.feng/Documents/AI/personal-excalidraw
```

The older `/Users/qihang.feng/Documents/AI/excalidraw` folder can remain as a
legacy workspace or be manually removed after confirming no uncommitted personal
files are needed. New development should happen in the top-level product repo.

## Git Rules

- Keep exactly one `.git` directory at the product repository root.
- Do not create nested git repositories under `excalidraw/`,
  `target-1-personal-mac-app/`, or `docs/`.
- Keep build outputs, dependency folders, temporary worktrees, and local app
  data out of git.
- Treat upstream Excalidraw as an external source to compare against, not as the
  product repository itself.
