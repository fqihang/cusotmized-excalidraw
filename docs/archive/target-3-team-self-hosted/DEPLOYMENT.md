# Deployment

## MVP Deployment Shape

Target first deployment is a company intranet service on one VM:

- `web`: static Excalidraw team frontend.
- `api`: auth, board metadata, ACLs, snapshots, assets, audit.
- `ws`: Socket.IO collaboration.
- `postgres`: metadata database.
- `minio`: S3-compatible scene and asset storage.
- `redis`: optional in single-node mode, recommended before multiple websocket replicas.
- `reverse-proxy`: Caddy/nginx/Traefik with internal TLS.

## Docker Compose Draft

```yaml
services:
  reverse-proxy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./ops/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - web
      - api
      - ws

  web:
    image: registry.internal/excalidraw-team-web:${APP_VERSION:-latest}
    environment:
      PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}
      TEAM_API_URL: ${PUBLIC_BASE_URL}/api
      TEAM_WS_URL: ${PUBLIC_BASE_URL}
    depends_on:
      - api
      - ws

  api:
    image: registry.internal/excalidraw-team-api:${APP_VERSION:-latest}
    env_file: .env
    depends_on:
      - postgres
      - minio
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost:8080/readyz"]
      interval: 10s
      timeout: 3s
      retries: 12

  ws:
    image: registry.internal/excalidraw-team-ws:${APP_VERSION:-latest}
    env_file: .env
    depends_on:
      - api
      - redis
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost:8090/readyz"]
      interval: 10s
      timeout: 3s
      retries: 12

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: excalidraw_team
      POSTGRES_USER: excalidraw
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${S3_ROOT_PASSWORD}
    volumes:
      - minio_data:/data

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data

volumes:
  caddy_data:
  postgres_data:
  minio_data:
  redis_data:
```

This is a deployment contract, not a final compose file. Image names, Caddyfile, migrations, and bootstrap commands still need to be implemented.

The web image should not require rebuilding for every intranet hostname. Its entrypoint should render a small runtime config file, for example `/usr/share/nginx/html/config.js`, from `PUBLIC_BASE_URL`, `TEAM_API_URL`, and `TEAM_WS_URL`, or the app should fetch equivalent public config from the API before mounting Excalidraw.

## Intranet Deployment Steps

1. Provision a VM with Docker Engine, Compose plugin, persistent disk, and access to the internal container registry.
2. Create DNS entry, for example `draw.internal.example.com`.
3. Issue TLS certificate from internal CA or configure reverse proxy with company-managed certificate.
4. Create `.env` from the configuration draft below.
5. Start Postgres and MinIO.
6. Run API migrations and bootstrap admin.
7. Start API, WS, web, and reverse proxy.
8. Verify `/healthz`, `/readyz`, login, board create, autosave, asset upload, and two-user collaboration.
9. Configure scheduled backups and run one restore drill before onboarding real teams.

## Configuration Draft

```dotenv
APP_VERSION=latest
PUBLIC_BASE_URL=https://draw.internal.example.com
NODE_ENV=production

DATABASE_URL=postgres://excalidraw:${POSTGRES_PASSWORD}@postgres:5432/excalidraw_team
POSTGRES_PASSWORD=change-me

SESSION_SECRET=change-me-32-bytes-minimum
JWT_SIGNING_SECRET=change-me-32-bytes-minimum
BOOTSTRAP_ADMIN_EMAIL=admin@example.com

OIDC_ENABLED=true
OIDC_ISSUER_URL=https://idp.internal.example.com
OIDC_CLIENT_ID=excalidraw-team
OIDC_CLIENT_SECRET=change-me
OIDC_ALLOWED_DOMAINS=example.com
OIDC_GROUPS_CLAIM=groups

S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://draw-minio.internal.example.com
S3_REGION=us-east-1
S3_BUCKET_SCENES=excalidraw-scenes
S3_BUCKET_ASSETS=excalidraw-assets
S3_ACCESS_KEY=excalidraw
S3_SECRET_KEY=change-me
S3_FORCE_PATH_STYLE=true

REDIS_URL=redis://redis:6379/0

UPLOAD_MAX_BYTES=4194304
BOARD_AUTOSAVE_DEBOUNCE_MS=1000
BOARD_AUTO_VERSION_MIN_INTERVAL_SEC=120
AUTO_VERSION_RETENTION_DAYS=90
SHARE_LINKS_ENABLED=true
SHARE_LINK_MAX_TTL_DAYS=30
ANONYMOUS_LINKS_ENABLED=false

ENCRYPTION_MODE=server-readable
CLIENT_KEY_MODE_ENABLED=false

LOG_LEVEL=info
METRICS_ENABLED=true
```

## Backup

Minimum backup set:

- Postgres logical dump or physical backup.
- Object storage buckets for scene snapshots and assets.
- Deployment `.env` and reverse proxy config, stored in a secret manager or secured ops repository.
- Application image tags and migration version.

Suggested schedule:

- Postgres: nightly full backup, WAL/PITR if available.
- Object storage: nightly bucket sync plus versioning if supported.
- Config: backup on every release/config change.
- Retention: 30 daily, 12 monthly for metadata; align scene retention with company policy.

Example commands for local Compose operations:

```bash
docker compose exec postgres pg_dump -U excalidraw -d excalidraw_team -Fc > backups/postgres-$(date +%Y%m%d%H%M).dump
mc mirror --overwrite minio/excalidraw-scenes backups/object-storage/excalidraw-scenes
mc mirror --overwrite minio/excalidraw-assets backups/object-storage/excalidraw-assets
```

## Restore

Restore drill:

1. Stop API and WS to prevent writes.
2. Restore Postgres backup to a clean database.
3. Restore object storage buckets.
4. Start API in migration-check mode; ensure schema version matches app version.
5. Start API, WS, and web.
6. Verify admin login, board list, selected board load, images, version history, and collaboration.
7. Record RPO/RTO and failed checks.

Restore acceptance:

- Metadata and object snapshots refer to existing object keys.
- Latest board version loads without missing images.
- Permissions and share links are restored with the same revocation/expiry state.
- Audit history is intact.

## Operational Checks

- `GET /healthz`: process is up.
- `GET /readyz`: DB, object storage, and optional Redis reachable.
- Websocket ready check reports adapter status and active room count.
- Synthetic test creates a board, saves a small scene, uploads one image, opens as second user, then deletes the board.

## Security Defaults

- TLS everywhere after reverse proxy.
- Private object buckets; no public bucket policy.
- Secure, HTTP-only session cookies.
- Short-lived websocket join tokens.
- No anonymous links unless explicitly enabled.
- Upload size and MIME type validation.
- Audit every ACL, share, restore, delete, and admin setting change.
