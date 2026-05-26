# Team Self-hosted Excalidraw

Team Self-hosted Excalidraw is a private, company-managed whiteboard workspace that keeps Excalidraw's fast drawing experience while adding durable team storage, access control, and intranet-friendly deployment.

## Target Customers

- Companies that cannot put product, architecture, security, or customer diagrams in a public SaaS.
- Platform, infrastructure, security, and IT teams that need an internal drawing service with SSO, backups, and admin controls.
- Product and engineering organizations that already use Excalidraw informally but need discoverable team files instead of browser-local canvases and ad hoc links.

## Core Selling Points

- **Private by default:** runs inside the company network with customer-owned database, object storage, and identity provider.
- **Team workspaces:** persistent boards, folders/projects, ownership, membership, and role-based sharing.
- **Real-time collaboration:** keeps Excalidraw-style low-latency multi-user editing, cursors, and presence.
- **Operationally boring:** Docker Compose first, then Kubernetes/Helm; explicit backup, restore, config, and observability surfaces.
- **Compatible with Excalidraw habits:** import/export `.excalidraw`, image support, local editing fallback, and share links remain familiar.

## Boundaries

| Area | Open-source Excalidraw app | Team Self-hosted scope | Excalidraw+ |
| --- | --- | --- | --- |
| Editor | Hand-drawn canvas, local-first app, export/import | Reuse/fork editor with team chrome and save hooks | Hosted commercial app |
| Storage | Browser localStorage/IndexedDB, Firebase-backed collab rooms, share-link backend | Postgres metadata, object storage for scene blobs/assets, managed snapshots | Cloud workspace storage |
| Collaboration | Room link contains room id and room key; Socket.IO broadcasts encrypted payloads | Authenticated rooms bound to board permissions, optional room key encryption | Commercial collaboration features |
| Permissions | Link possession is effectively access for collab/share | Workspace/project/board roles, signed internal links, audit trail | Managed SaaS permissions |
| Deployment | Static frontend Docker image; external Firebase and websocket assumptions | Full private stack: web, API, websocket, DB, object storage, reverse proxy | Vendor-hosted |
| Product intent | Free OSS showcase and embeddable package | Company intranet/team edition | Paid hosted product, not cloned in MVP |

The MVP should not pretend to be Excalidraw+. It is a pragmatic internal deployment that adds the missing team control plane around the OSS editor.
