# Ubuntu Web deployment

This Compose project serves only the AntTodo Web application and its public
instance manifests. Supabase and the TLS gateway are external dependencies.

## Deploy

```bash
git clone git@github.com:shenyubao/anttodo.git
cd anttodo/deploy/ubuntu
cp .env.example .env
# Fill the independent Supabase URL and publishable key.
./deploy.sh
```

The default image is `ghcr.io/shenyubao/anttodo-web:latest`; set
`ANTTODO_WEB_IMAGE` to a version tag or digest for a pinned rollout. The Web
container listens on `127.0.0.1:5000` by default. A gateway on the same host can
forward to that address. For a gateway on another private-network host, set
`ANTTODO_WEB_BIND` to the Ubuntu server's private IP. Preserve the `Host`,
`X-Forwarded-For`, and `X-Forwarded-Proto` headers.

Before exposing the site, the independent Supabase instance must have all
repository migrations and RLS policies applied, plus the required Storage
buckets, RPCs, Realtime publication, Edge Functions, and connector schedules.
Configure all of the following on that Supabase deployment:

- `PUBLIC_APP_URL=https://todo.yuce-tech.cn` and the matching Auth redirect
  allowlist;
- SMS Hook, DingTalk SSO, notification dispatch, Vault entries, connector
  schedules, and server-side AI credentials;
- Web and Electron CORS access to Auth, REST, Storage, Realtime, and Functions.

Only the Supabase URL and publishable key are public. Never put service-role,
database, SMS, connector, Vault, or AI secrets in this Compose `.env`. Backups,
upgrades, and security hardening for self-hosted Supabase are managed separately
from this Compose project. Before upgrading, review the current
[Supabase self-hosting guide](https://supabase.com/docs/guides/self-hosting) and
release breaking changes; recent self-hosted releases changed the default API
gateway and Auth external-URL handling.

The public `/.well-known/anttodo.json` and compatibility
`/.well-known/anttodo-cli.json` are generated at container startup. They are
anonymous, CORS-readable, and intentionally contain no server secrets.
`ANTTODO_INSTANCE_DISPLAY_NAME` is the public instance name written to the
manifest as `displayName`. The login-page title is
`蚂蚁待办 x {ANTTODO_INSTANCE_DISPLAY_NAME}` and the browser tab uses the same
value. Set `ANTTODO_DEPLOY_MODE=onPremises` and
`ANTTODO_INSTANCE_ENTERPRISE_SLUG` for a single-enterprise instance. The public
manifest then includes `deployMode` and `workspaceSlug`, so Web and desktop
login skip the enterprise Slug field and use the well-known value.

Verify:

```bash
curl -fsS http://127.0.0.1:5000/healthz
curl -fsS http://127.0.0.1:5000/.well-known/anttodo.json | jq
docker compose --env-file .env -f compose.yaml ps
```

From a development checkout, build, smoke-test, transfer, and roll out the
current worktree to the Yuce production service with:

```bash
pnpm deploy:web:yuce
```

Set `ANTTODO_YUCE_WEB_SSH` (or `ANTTODO_SUPABASE_SELFHOST_SSH`) in
`.env.local`. The command auto-detects the remote `deploy/ubuntu` directory;
set `ANTTODO_YUCE_WEB_DEPLOY_DIR` when more than one checkout exists. It keeps
the previous container image as a rollback tag and restores it automatically
when the new container fails its health check. The local release path builds
the Web assets first and packages them with `Dockerfile.runtime`; the regular
multi-stage `Dockerfile` remains the reproducible CI image build.

Build and run the same hardened container smoke test locally with:

```bash
pnpm docker:web:build
pnpm docker:web:test
```

`deploy.sh` records the running image digest before pulling, prints the newly
resolved digest, waits for `/healthz`, and restores the previous digest when the
new container does not become healthy.
