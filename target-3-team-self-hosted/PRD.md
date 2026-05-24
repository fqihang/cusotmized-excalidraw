# PRD: Team Self-hosted Excalidraw

## Problem

Teams already use Excalidraw for architecture sketches, product flows, incident diagrams, and meeting notes, but the OSS app is centered on local browser state, encrypted collaboration links, and share-link uploads. Companies that require internal hosting need durable boards, identity, permissions, backups, and admin controls without adopting a public SaaS first.

## Goals

- Provide a company-internal Excalidraw workspace that can be deployed with Docker Compose.
- Persist boards and assets in company-owned infrastructure.
- Gate all board access through SSO or local admin-managed accounts.
- Preserve Excalidraw's core editing, import/export, image, and live collaboration behavior.
- Make backup/restore and operational ownership clear enough for an internal platform team.

## Success Metrics

- A team can deploy a working environment on one VM in under 60 minutes after prerequisites are available.
- Two authenticated users can create, edit, share, and collaboratively update the same board.
- Board state, image assets, membership, and versions survive browser reload, container restart, and DB/object-store restore.
- Permission test suite covers owner/editor/viewer/no-access paths for API and websocket joins.
- Recovery drill can restore a workspace to a known snapshot within the documented RPO/RTO targets.

## MVP Scope

- **Authentication:** OIDC/SAML-ready design, with MVP support for OIDC and a local bootstrap admin.
- **Workspace model:** one tenant/company deployment, multiple workspaces/projects, boards, and members.
- **Board storage:** durable board metadata in Postgres; canonical scene snapshots and binary assets in S3-compatible object storage.
- **Editor integration:** fork or wrapper around upstream `excalidraw-app`; replace Firebase/share backend dependencies with internal API endpoints.
- **Live collaboration:** Socket.IO-compatible websocket service for board rooms, using permission-checked join tokens.
- **Sharing:** internal share links with explicit role, expiry, and optional password/passcode for non-SSO users if allowed by admin policy.
- **Version history:** automatic snapshots on meaningful changes, manual named versions, restore-as-new-version.
- **Admin basics:** config page/API for workspace settings, retention, invite policy, and storage health.
- **Operations:** Docker Compose, `.env` config, reverse proxy notes, backup/restore runbook, health checks.

## Non-goals

- Public multi-tenant SaaS billing, plans, trials, or self-service organization signup.
- Reimplementing the Excalidraw drawing engine.
- Advanced Excalidraw+ parity such as comments, presentations, commercial templates, or vendor cloud migration.
- Offline-first multi-device sync beyond local browser resilience and server reconnect.
- Fine-grained element-level permissions.
- External anonymous internet sharing by default.
- Real-time CRDT rewrite in the MVP; use upstream reconciliation semantics first.

## Key Team Flows

### Create and Save a Board

1. User signs in through company SSO.
2. User creates a board in a workspace/project.
3. Frontend opens the Excalidraw editor with an empty scene.
4. API creates board metadata and returns a board id plus websocket join token.
5. Editor changes autosave to the API, which writes snapshots/assets to object storage.
6. Board appears in recent files and project listing.

### Invite a Collaborator

1. Owner opens sharing dialog.
2. Owner adds a member/group as viewer or editor.
3. API records ACL change and audit event.
4. Collaborator sees the board in shared/recent list and can join if permission allows.
5. Websocket service rejects joins if the member loses access while disconnected.

### Real-time Editing

1. Editor opens websocket connection with short-lived board join token.
2. Server verifies token, board role, and board status.
3. Peers exchange encrypted or plaintext-in-private-network payloads depending on deployment policy.
4. Server broadcasts scene deltas/presence to authorized clients and periodically persists canonical snapshots.
5. Reconnect fetches latest persisted snapshot plus any buffered recent updates.

### Share Read-only Link

1. Owner creates an internal link with viewer role and expiry.
2. Link resolves through the API, not directly through object storage.
3. Viewer can open the board without edit controls.
4. Expired/revoked links fail both HTTP load and websocket join.

### Restore a Version

1. Owner opens version history.
2. User previews timestamp, author, and optional name.
3. Restore creates a new head version; it does not erase audit history.
4. Active collaborators receive a scene reload notification or a server-side scene reset event.

## Functional Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | Users can sign in via configured OIDC provider and receive a session cookie/JWT. | P0 |
| FR-2 | Admin can bootstrap first workspace and assign workspace owners. | P0 |
| FR-3 | Users can create, rename, duplicate, archive, and delete boards according to role. | P0 |
| FR-4 | Editor autosaves scene and files to internal API/object storage. | P0 |
| FR-5 | Two editors can collaborate on the same board with cursors/presence and scene updates. | P0 |
| FR-6 | API and websocket join both enforce board ACLs. | P0 |
| FR-7 | Owners can share boards with users/groups as viewer or editor. | P0 |
| FR-8 | Owners can create expiring internal read-only links when admin policy allows. | P1 |
| FR-9 | System stores automatic and manual versions and supports restore-as-new-version. | P1 |
| FR-10 | Admin can configure retention, upload limits, allowed domains/groups, and storage backend. | P1 |
| FR-11 | Operators can run documented backup and restore for DB and object storage. | P0 |
| FR-12 | Audit log records create/update/share/permission/restore/delete events. | P1 |

## Permission Model

| Role | Board list | View | Edit | Share | Delete | Restore version | Manage ACL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace admin | All workspace boards | Yes | Yes | Yes | Yes | Yes | Yes |
| Board owner | Owned/shared boards | Yes | Yes | Yes | Yes | Yes | Yes |
| Editor | Shared boards | Yes | Yes | No by default | No | Create named version | No |
| Viewer | Shared boards | Yes | No | No | No | No | No |
| No access | No | No | No | No | No | No | No |

## Acceptance Criteria

### Permissions

- A viewer cannot call save, mutate metadata, create versions, or join editable websocket mode.
- An editor can modify board content but cannot grant others access unless explicitly promoted.
- Removing a user's access invalidates new API calls and new websocket joins within one minute.
- Object storage URLs are private or short-lived signed URLs; raw bucket paths are not sufficient authorization.
- Every permission-changing action writes an audit record with actor, target, role, timestamp, and source IP/user agent when available.

### Sharing

- Share links have role, expiry, creator, and revocation state.
- Expired/revoked links fail consistently in board load, asset load, and websocket join.
- Internal links never expose long-lived object storage credentials.
- Default deployment disables anonymous external sharing.

### Collaboration

- Two editors see each other's scene changes and pointer presence within an acceptable LAN latency budget.
- A viewer can join in read-only mode and receive scene/presence updates without broadcasting scene mutations.
- If websocket disconnects, local edits are marked unsynced and retried; user gets a visible save state.
- Server restart does not lose the latest persisted board snapshot.
- Conflicting updates converge using upstream Excalidraw element version/reconciliation behavior for MVP.

## Risks and Mitigations

- **Encryption vs. server-managed versions:** true E2EE limits server-side previews, search, and diff. Mitigation: support deployment mode choice: server-readable private intranet mode for MVP, optional client-side room-key mode for sensitive boards.
- **Fork drift from upstream Excalidraw:** keep editor changes behind adapters for storage, auth, and collaboration; track upstream changes regularly.
- **Websocket authorization gaps:** require board join tokens issued by API and verify role on each room join.
- **Large image assets:** enforce upload limits, object lifecycle policies, and asset garbage collection.
- **Restore complexity:** restore creates a new version rather than mutating history.

## Milestones

- **M0 Architecture spike:** prove editor can load/save through internal API and join private websocket room.
- **M1 Private Beta:** auth, board CRUD, autosave, collaboration, basic ACLs, Compose deployment.
- **M2 Intranet Release:** admin controls, backup/restore, version history, audit log, observability.
- **M3 Optional SaaS Track:** multi-tenant hardening only after self-hosted usage stabilizes.
