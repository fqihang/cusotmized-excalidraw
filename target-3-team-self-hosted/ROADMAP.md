# Roadmap

## Phase 1: Private Beta

Goal: prove a small internal team can use persistent private boards daily.

Scope:

- Single-company deployment.
- Docker Compose on one VM.
- OIDC login plus bootstrap admin.
- Workspace/project/board list.
- Board create/open/rename/archive/delete.
- Internal autosave to API and object storage.
- Socket.IO collaboration for authenticated editors.
- Owner/editor/viewer roles.
- Basic internal read-only share links with expiry.
- Manual export/import `.excalidraw`.
- Health checks and first backup/restore runbook.

Exit criteria:

- 5-10 pilot users can replace ad hoc Excalidraw links for normal team diagrams.
- No data loss after browser reload, container restart, and one restore drill.
- Permission and websocket join tests cover P0 roles.
- Operators can deploy from a tagged build and documented `.env`.

## Phase 2: Company Intranet Edition

Goal: make the system acceptable for broader internal rollout.

Scope:

- Group sync from IdP.
- Admin settings for retention, upload limits, share policy, and allowed domains.
- Version history with named versions and restore-as-new-version.
- Audit log for board lifecycle, share, ACL, restore, and delete events.
- Object-store garbage collection.
- Redis-backed websocket fanout for multiple WS replicas.
- Observability: structured logs, Prometheus metrics, basic traces.
- Hardened backup/restore with scheduled jobs and recovery validation.
- Reverse proxy/TLS examples for internal CA.
- Helm/Kubernetes reference after Compose is stable.

Exit criteria:

- One department can run on the intranet edition with platform-team ownership.
- Backup restore meets agreed RPO/RTO.
- Admin can answer who accessed/shared/restored a board.
- Horizontal websocket/API scale has been tested in staging.

## Phase 3: Team SaaS Optional Route

This is optional and should not distract from self-hosted fit.

Scope:

- True multi-tenant data model and tenant isolation tests.
- Billing, plan limits, trials, and organization signup.
- Public anonymous invite controls and abuse prevention.
- Regional storage and data residency.
- Tenant-level encryption/key management options.
- Customer admin console and support tooling.
- Migration paths between self-hosted and hosted only if there is clear demand.

Entry criteria:

- Intranet deployments show repeatable usage and operating model.
- Security model passes an external review.
- Product differentiation from Excalidraw+ is explicit and legally/product-wise acceptable.
- There is a validated GTM reason to operate a public service.
