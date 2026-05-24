# Engineering Tasks

## P0: Foundation

- Define repository strategy: fork `excalidraw-app` vs. host `@excalidraw/excalidraw` in a new shell; document upstream sync process.
- Create internal config contract for web/API/WS: base URLs, OIDC, storage, DB, upload limits, encryption mode.
- Add runtime frontend config injection (`/config.js` or `/api/public-config`) so one web image can run in multiple intranet environments.
- Scaffold API service with health checks, typed config, migrations, and Postgres connection.
- Scaffold web app shell with authenticated routes, board list, and editor route.
- Scaffold websocket service with Socket.IO, health endpoint, and join-token verification.
- Add local Docker Compose for web, API, WS, Postgres, MinIO, and optional Redis.

## P0: Identity and Authorization

- Implement bootstrap admin flow for first local deployment.
- Implement OIDC login/logout/session refresh.
- Model users, groups, workspaces, projects, boards, permissions, share links, versions, assets, audit events.
- Add authorization middleware for workspace, board, asset, and version APIs.
- Add websocket authorization for connect/join and editor/viewer capability checks.
- Write permission matrix tests for owner/editor/viewer/no-access.

## P0: Board Persistence

- Implement board CRUD APIs.
- Implement current board load endpoint returning scene, app state, files metadata, role, and collab token.
- Implement snapshot save endpoint with debounce/idempotency support.
- Implement object storage writer for canonical scene blobs.
- Implement asset upload/download through signed URLs or API streaming.
- Replace upstream Firebase scene/file storage calls with internal adapter.
- Preserve `.excalidraw` import/export behavior.

## P0: Collaboration

- Map upstream Socket.IO events to authenticated board rooms.
- Issue short-lived collaboration tokens from API after permission check.
- Broadcast scene updates, full-scene sync, cursor, idle, and follow events.
- Reject mutation events from viewers.
- Debounce-persist latest scene during collaboration.
- Handle reconnect by loading latest canonical snapshot.
- Add tests for two-editor convergence, viewer read-only, removed-access rejection, and server restart recovery.

## P1: Sharing and Team Workflow

- Build share dialog for users/groups/roles.
- Build internal read-only link creation with expiry and revocation.
- Add recent boards and shared-with-me filters.
- Add project/folder organization.
- Add audit events for create/update/share/permission/restore/delete.
- Add admin share policy: disable links, internal-only links, expiry maximum.

## P1: Version History

- Add automatic snapshot policy and metadata.
- Add manual named version creation.
- Add version list and preview metadata.
- Implement restore-as-new-version.
- Add retention cleanup job for automatic versions.
- Add audit entries for named version and restore.

## P1: Operations

- Add `/healthz`, `/readyz`, and build-info endpoints for web/API/WS.
- Add structured JSON logging with request id and actor id.
- Add Prometheus metrics for API latency, websocket rooms/clients, save failures, object storage errors.
- Add backup scripts for Postgres and object storage.
- Add restore scripts and a documented recovery drill.
- Add production reverse proxy examples with internal TLS.

## P2: Hardening

- Add group sync from IdP.
- Add Redis adapter for multi-instance Socket.IO.
- Add asset garbage collection and orphan detection.
- Add per-workspace storage quotas.
- Add server-readable vs. client-key encryption mode switch.
- Add security review checklist and threat model.
- Add Helm chart after Compose deployment is stable.

## P3: Optional SaaS Track

- Add tenant isolation tests and tenant-aware migrations.
- Add billing and plan limits.
- Add abuse prevention, rate limits, and public invite controls.
- Add regional storage strategy.
- Add customer admin/support tooling.
