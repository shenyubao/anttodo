# Open API deployment

The REST endpoint is `/api/open/v1`; public documentation is `/openapi`.
Cloudflare uses `worker.ts`; self-hosted nginx renders a Supabase proxy from
the instance configuration. Install database migrations before deploying the
`open-api` Edge Function and either web frontend.

## Authorization boundary

Third parties receive opaque access/refresh tokens from the AntTodo OAuth broker at
`/api/open/v1/oauth/authorize` and `/oauth/token`. Native Supabase tokens stay in Vault;
third-party tokens cannot call Auth, Storage or other Edge Functions. Native internal
OAuth JWTs use the `anttodo_openapi` database role. This role has
no table access, Storage access or execution permission on existing business
RPCs. Its sole business entrypoint is `open_api_dispatch`, owned by a non-login,
non-BYPASSRLS executor which inherits the existing authenticated-user policies.
The dispatcher verifies the live grant/session, selected workspaces, current
membership and operation permission before entering task business logic.

The existing access-token hook still handles CLI clients. Other OAuth clients
fail closed into the isolated role. An immutable grant is bound to each new
OAuth session; refresh cannot inherit a later, broader grant. Revocation is
checked on every operation. New schema migrations must not grant EXECUTE to
PUBLIC or table privileges to `anttodo_openapi`.

## Instance setup

Enable the Supabase OAuth server, keep dynamic client registration disabled,
and retain `/oauth/consent` as the authorization UI. The existing hook URI
`pg-functions://postgres/anttodo_private/cli_access_token_hook` stays unchanged.
OAuth clients must include `prompt=consent` and PKCE S256 when starting a new
authorization. Standard OIDC `profile` scope does not grant task access.

Run `scripts/configure-open-api.mjs` with `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL`, and `OPEN_API_SECRETS_FILE`.
Set `VISTAB_APP_URL` to register the VisTab logical confidential client as well.
Only the internal broker is registered with native Supabase Auth. External clients
are stored separately with hashed secrets, exact redirect URIs and PKCE S256. The script
writes secrets to a mode-0600 file and does not print them. Preserve the
returned client ID and secret for retries; supply them on later runs to avoid
registering duplicates. Store `OPEN_API_PERSONAL_CLIENT_ID`,
`OPEN_API_PERSONAL_CLIENT_SECRET`, `OPEN_API_OAUTH_PUBLIC_URL`, and
`PUBLIC_APP_URL` in Edge secrets. Store `ANTTODO_CLIENT_ID`,
`ANTTODO_CLIENT_SECRET`, and `ANTTODO_SERVICE_URL` in VisTab Worker secrets.
Remove the temporary file after secrets are installed.

Third-party application registration is available in AntTodo settings. The
developer's client secret is returned only at registration. The registered
redirect must exactly match the callback URL, including the full path.

## Verification and rollback

Run unit/type/build checks and pgTAP, then verify Token creation, OAuth consent,
refresh, restricted workspaces, direct RPC/Storage denial, revocation,
If-Match conflicts and idempotent retries. Check both the official and a public
HTTPS self-hosted instance with VisTab. Cache invalidation must reach Web,
macOS and iOS through the shared Realtime/query path. Offline writes are disabled.

Record current Worker/container versions and a database backup before rollout.
If web or VisTab rollback is needed, retain the additive database migration and
grant records; do not remove authorization data or undo credential revocations.
