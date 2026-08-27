# AntTodo CLI

正式版本可使用 `npx @anttodos/cli` 或全局安装的 `anttodo` 命令；仓库内开发请使用 `pnpm cli:run`，或从 `pnpm pack` 生成的 tarball 安装。

```bash
# 已发布版本
npx @anttodos/cli auth login

# 仓库内开发版本
pnpm cli:run auth login
```

Requires Node.js 22 or newer. Commands return a JSON envelope by default and
also support `--format pretty|table|ndjson|csv`. Use `--workspace <id|slug>` to
override the saved workspace for one command.

No environment variables are required for normal use. The CLI uses
`https://app.anttodo.com` by default and discovers its public configuration
automatically. Environment overrides are only intended for local development or
self-hosted instances. Only the publishable key, a per-device credential, and a
cached access JWT are stored by this package; OAuth refresh tokens stay in the
service's Supabase Vault. The CLI never accepts or stores a service-role key.
Access JWTs are limited to 15 minutes and continue to use the service's RLS.

Custom services can be selected from the CLI. The address must serve the same
instance manifest used by the desktop client at
`/.well-known/anttodo.json`:

```bash
# Save and select a service for future commands
anttodo service use https://todo.example.com

# Inspect configured services or restore the official service
anttodo service list
anttodo service current
anttodo service reset

# Use a service for one command without changing the saved selection
anttodo --service-url https://todo.example.com task list
```

Service addresses, device credentials, workspace settings, pending device authorizations,
and read caches are isolated from one another. Custom services must use HTTPS;
localhost HTTP is available only when `ANTTODO_ALLOW_LOCAL_HTTP=1` is set for
local development.

Run `anttodo man --format pretty` for the full command tree.
Inside this repository, use `pnpm cli:run man` (or any other command and
options) to build and execute the local CLI.

The CLI also exposes task/note editing and bulk status operations, completed
pomodoro and stopwatch session recording, reminder and
recurrence schedules, task-tree editing/assignment/reordering, tag access and
ordering management, workspace administration and invite links, full-text task
search, comments, activity history, and attachment upload/download/signed URLs.
Use `anttodo man` as the machine-readable API contract.

Deployment order is database migration, `cli-device-auth` Edge Function, Web
authorization page and well-known configuration, then the npm package.

Repository checks:

```bash
pnpm cli:test
pnpm cli:pack
pnpm cli:verify
# With local Supabase and `supabase functions serve` running:
pnpm cli:test:integration
pnpm cli:test:browser
```

手动发布 CLI：

```bash
pnpm deploy:cli
```

该命令会先按 macOS 相同规则把版本写成 `1.0.YYYYMMDDHHmm`，再完成 CLI 校验，
最后执行 `npm publish ./cli --access public`。发布前请先 `npm login`，使用
`@anttodos/cli` 的维护者账号。

Pushing a `cli-v<version>` tag starts `.github/workflows/publish-cli.yml`; the
tag must match `cli/package.json` and the repository must provide an `NPM_TOKEN`
secret.
