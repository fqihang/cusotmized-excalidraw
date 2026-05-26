# Packaging Pipeline

This product treats packaging as a release gate, not as a manual afterthought.
The canonical command is:

```bash
cd target-1-personal-mac-app/app
npm run package:release
```

The pipeline runs:

1. `npm test`
2. `npm run typecheck`
3. `cargo test` in `src-tauri`
4. transient `/Volumes/dmg.*` cleanup for interrupted macOS DMG builds
5. `npm run tauri:build`
6. `hdiutil verify` for the generated DMG on macOS
7. artifact and JavaScript bundle size checks
8. `release-manifest.json` generation with paths, SHA256, sizes, budget checks, and the largest JS assets

For fast local inspection of already-built artifacts:

```bash
cd target-1-personal-mac-app/app
npm run package:release:reuse
```

`package:release:reuse` skips tests and Tauri build, then validates the existing
bundle artifacts and rewrites the manifest.

## Artifact Locations

The macOS release artifacts are written under:

```text
target-1-personal-mac-app/app/src-tauri/target/release/bundle/
```

Expected files:

```text
macos/Personal Excalidraw Files.app
dmg/Personal Excalidraw Files_0.1.10_aarch64.dmg
release-manifest.json
```

## Size Budgets

The pipeline fails if any budget is exceeded:

| Surface | Budget |
| --- | ---: |
| DMG | 25 MiB |
| `.app` bundle | 40 MiB |
| frontend `dist` | 30 MiB |
| largest JS asset | 3 MiB |
| total JS assets | 12 MiB |

These are intentionally tighter than "whatever ships" but still above the
current baseline. Raising a budget should be a product decision recorded in the
PRD or change log; lowering a budget should happen after measured optimization.

## Performance Guardrails

The first release gate is package-weight based because it is deterministic in
CI/local automation and catches the most common desktop-app regressions:

- accidental dependency growth
- diagram/editor libraries moving into the startup path
- font or asset expansion
- broken DMG creation from stale mounted temporary images

Runtime smoke metrics to add next:

- cold launch to first editable canvas
- opening a large `.excalidraw` file
- generating a selection share PNG
- loading Shares Manager previews

## Failure Policy

Do not ship a DMG that fails this pipeline.

If the pipeline fails:

- For test/typecheck/Rust failures, fix the underlying product behavior first.
- For `hdiutil` failures, check for stale `/Volumes/dmg.*` mounts and rerun the
  pipeline.
- For budget failures, inspect `release-manifest.json` and the printed top JS
  assets before changing dependencies or budgets.
