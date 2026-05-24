# Architecture

## Upstream Observations

- The upstream Dockerfile builds a static `excalidraw-app` bundle and serves it from nginx; it does not include a database, object store, API, websocket server, or identity provider.
- The OSS app stores ordinary work locally in `localStorage` and IndexedDB.
- Live collaboration uses Socket.IO and `VITE_APP_WS_SERVER_URL`; room links carry `#room=<roomId>,<roomKey>`.
- Collaboration scene persistence uses Firebase Firestore, while images/assets go to Firebase Storage under room/share prefixes.
- Payloads are encrypted client-side with AES-GCM; the room/share key is kept in the URL hash so it is not sent as a query string.
- Firebase rules in the OSS project allow broad get/write and disallow list; this is acceptable for link-key privacy experiments, not for managed team authorization.
- Shareable readonly links use a backend get/post URL plus encrypted payload and Firebase-hosted assets.

## Target Principles

- Keep Excalidraw's editor and reconciliation model; add a team control plane around it.
- Make identity and authorization server-side, not link-possession-only.
- Prefer simple deployable components: web, API, websocket, Postgres, S3-compatible object storage, reverse proxy.
- Store canonical board snapshots durably; use websockets for live updates, not as the only persistence layer.
- Avoid public SaaS assumptions in MVP.

## Logical Components

```text
Browser
  |
  | HTTPS
  v
Reverse proxy / TLS
  |
  +--> Web app: Excalidraw editor shell
  |
  +--> API service: auth, boards, ACLs, snapshots, signed assets
  |
  +--> WebSocket service: collaboration rooms, presence, scene broadcast
          |
          +--> Redis optional: room fanout / pubsub / ephemeral presence

API service
  |
  +--> Postgres: users, groups, workspaces, boards, ACLs, versions, audit
  |
  +--> Object storage: scene blobs, image assets, exports
```

## Frontend

- Start from upstream `excalidraw-app` or a thin host app around `@excalidraw/excalidraw`.
- Do not rely only on Vite build-time env for self-hosted URLs. The production image should either generate `/config.js` at container startup or load `/api/public-config` before mounting the app.
- Replace Firebase and public share backend calls with an internal storage adapter:
  - `GET /api/boards/:id/current`
  - `PUT /api/boards/:id/snapshots`
  - `POST /api/boards/:id/assets`
  - `GET /api/assets/:assetId/download-url`
- Replace anonymous collab link flow with authenticated board open flow:
  - API issues a short-lived websocket join token after checking board role.
  - Editor opens Socket.IO with board id and join token.
- Keep import/export `.excalidraw` for portability.
- Add team chrome outside the canvas: board title, save status, share dialog, version history, workspace switcher.
- Read-only mode hides edit affordances and prevents mutation calls.

## API Service

Suggested stack: Node.js/TypeScript with Fastify or NestJS, Prisma/Drizzle, Postgres, S3 SDK. Go or Rails are also viable; the key is adapter isolation from the editor.

Core API areas:

- `auth`: OIDC callback, session, local bootstrap admin, logout.
- `workspaces`: settings, members, retention policy.
- `boards`: CRUD, archive/delete, move between projects.
- `permissions`: users/groups, owner/editor/viewer roles, share links.
- `snapshots`: create current snapshot, list versions, restore version.
- `assets`: upload metadata, signed upload/download, garbage collection markers.
- `audit`: immutable event listing for admins.
- `health`: DB/object-store connectivity and build metadata.

## WebSocket Collaboration

Use Socket.IO initially because upstream client already imports `socket.io-client` and expects Socket.IO-style events.

Room join flow:

1. Browser requests `POST /api/boards/:id/collab-token`.
2. API verifies user role and returns a short-lived JWT with board id, user id, role, and capability flags.
3. Browser connects to `VITE_APP_TEAM_WS_URL` and emits join with token.
4. WebSocket service verifies token, joins `board:<id>`, emits current room users.
5. Scene updates from editors are broadcast to editors/viewers; mutations from viewers are rejected.

Persistence strategy:

- For MVP, clients continue broadcasting Excalidraw scene updates using upstream element version semantics.
- WebSocket service can debounce-persist the latest canonical scene through API/internal repository code.
- API also accepts direct autosave from the active editor as a fallback.
- Every N seconds or M element changes, persist a compact full snapshot to object storage and a metadata row to Postgres.
- Redis is optional for single-node Compose; required once websocket service scales horizontally.

Encryption modes:

- **Server-readable private mode, default MVP:** TLS protects transport; server stores scene JSON/compressed blobs and can version, preview, index, and restore.
- **Client-key sensitive mode, optional:** scene/assets encrypted in browser; server stores ciphertext and metadata only. This preserves Excalidraw-style privacy but limits previews, search, and server-side diffs.

## Object Storage

Use S3-compatible storage so deployment can choose MinIO, AWS S3, Ceph, or an internal object platform.

Buckets/prefixes:

- `scenes/workspaceId/boardId/versionId.excalidraw.json.zst`
- `assets/workspaceId/boardId/fileId`
- `exports/workspaceId/boardId/exportId`
- `backups/` only if local backup jobs write to the same object system

Rules:

- Buckets are private.
- API issues short-lived signed URLs or streams files through the API.
- Assets record checksum, MIME type, size, createdBy, boardId, and reference count.
- Garbage collection removes unreferenced assets after retention grace period.

## Database

Postgres is the source of truth for metadata and authorization.

Minimum tables:

- `users`: id, email, displayName, status, identityProviderSubject.
- `groups`: id, workspaceId, name, externalId.
- `group_members`: groupId, userId.
- `workspaces`: id, name, slug, settings.
- `projects`: id, workspaceId, name, parentId nullable.
- `boards`: id, workspaceId, projectId, title, ownerId, currentVersionId, archivedAt, deletedAt.
- `board_permissions`: boardId, subjectType, subjectId, role.
- `share_links`: id, boardId, role, tokenHash, expiresAt, revokedAt, createdBy.
- `board_versions`: id, boardId, versionNumber, objectKey, sceneVersion, createdBy, createdAt, label, reason.
- `assets`: id, boardId, objectKey, checksum, bytes, mimeType, createdBy, lastReferencedAt.
- `audit_events`: id, workspaceId, actorId, action, entityType, entityId, metadata, createdAt.

## Permissions

Authorization must be checked at every boundary:

- Page/API board load.
- Snapshot create/restore.
- Asset upload/download.
- Websocket join.
- Websocket mutation broadcast.
- Share-link resolution.

Recommended policy:

- Workspace admin bypasses board ACL inside the workspace.
- Board owner has full board control.
- Editor can mutate scene and create versions but cannot manage ACL by default.
- Viewer can load and subscribe read-only.
- Share links map to a bounded role and expiry; they never imply admin rights.

## Version History

- Store every persisted full snapshot with monotonic `versionNumber`.
- Save automatic versions on debounce windows, e.g. at most once every 2 minutes during activity and once when collaborators leave.
- Save manual named versions immediately.
- Restore creates a new head version with `reason=restore` and `restoredFromVersionId`.
- Keep an audit trail for restores and deletes.
- Retention defaults: keep all named versions, keep automatic versions for 90 days, configurable by workspace.

## Deployment Topology

### Single-VM Intranet MVP

- `reverse-proxy`: Caddy/nginx/Traefik, TLS from internal CA.
- `web`: static frontend.
- `api`: HTTP API.
- `ws`: Socket.IO collaboration service.
- `postgres`: metadata DB.
- `minio`: local S3-compatible storage.
- `redis`: optional, disabled for one websocket instance or enabled for future fanout.

### Hardened Intranet

- Managed Postgres or HA Postgres.
- Managed object storage or replicated MinIO.
- Multiple API/WS replicas behind reverse proxy.
- Redis for websocket pubsub and token/session cache.
- Central logs, metrics, traces, alerts.
- OIDC with company IdP and group sync.

### Optional Team SaaS

- Introduce tenants, per-tenant isolation, billing, rate limits, abuse controls, regional storage, and public signup only after self-hosted maturity.
