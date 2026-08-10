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
self-hosted instances. Only the publishable key and the user's
browser-authorized Supabase session are used; this package never accepts or
stores a service-role key.

Run `anttodo man --format pretty` for the full command tree.
Inside this repository, use `pnpm cli:run man` (or any other command and
options) to build and execute the local CLI.

The CLI also exposes task/note editing and bulk status operations, reminder and
recurrence schedules, subtask editing/assignment/reordering, tag access and
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

该命令会先完成 CLI 校验，再执行 `npm publish ./cli --access public`。

Pushing a `cli-v<version>` tag starts `.github/workflows/publish-cli.yml`; the
tag must match `cli/package.json` and the repository must provide an `NPM_TOKEN`
secret.
