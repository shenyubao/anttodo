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
ordering management, workspace administration and invite links, weekly report
list/get/create/update/publish, full-text task
search, comments, activity history, and attachment upload/download/signed URLs.
Use `anttodo man` as the machine-readable API contract.

## OKR

```bash
anttodo okr cycle list --format table
anttodo okr cycle get <cycle-id>
anttodo okr get --cycle current --owner me
anttodo okr objective list --cycle <cycle-id> --owner <user-id>
anttodo okr objective create --title "Improve delivery reliability"
anttodo okr objective get <objective-id>
anttodo okr objective update <objective-id> --note "**Focus:** release quality" --status normal
anttodo okr key-result create --objective <objective-id> --title "Reduce incidents"
anttodo okr key-result list --objective <objective-id>
anttodo okr key-result update <kr-id> --start 10 --target 0 --unit none
anttodo okr key-result progress <kr-id> --value 3 --status normal --detail "Seven fewer incidents"
anttodo okr key-result get <kr-id>
anttodo okr publish
anttodo okr task link <task-id> --key-result <kr-id>
anttodo okr task list --objective <objective-id>
anttodo okr task unlink <task-id>
anttodo okr key-result delete <kr-id> --yes
anttodo okr objective delete <objective-id> --yes

anttodo weekly-report create --okr-progress "Reduced incidents from 10 to 3"
anttodo weekly-report update <report-id> --okr-progress "Updated OKR progress"
```

Cycle selection defaults to the active cycle covering today, otherwise the first
active cycle in application order. Use an explicit cycle UUID to read older
cycles. Tree and objective-list queries default to your own OKR; `--owner` can
select another visible member. All commands honor the selected workspace and
service. Writes require the OKR owner and an active cycle; task links also
require permission to organize the task. An unlink can remove a historical link
even if the old KR is no longer visible.

Creation uses application defaults; configure KR metrics using `update`.
`--status-mode manual|automatic` controls status interpretation. Objective
progress is derived from its KRs. Detail/tree reads include `progress_percent`
and `effective_status`; `current_value` remains the stored metric value.
Adding or removing a KR equally redistributes sibling weights. Deletion also
removes dependent links and progress records, preserving the tasks themselves.
If deletion succeeds but rebalancing fails, `okr_partial_failure` includes the
completed step; review the remaining weights in the app before publishing.

Omitted update fields retain their values. Pass `--note ""` or
`--okr-progress ""` to clear text, or `progress --value null` to clear a metric.
Notes accept Markdown and preserve existing mentions still present in the text;
the CLI does not create new mention notifications. Progress updates record
history; `--detail` accepts up to 2000 characters. Reports containing only OKR
progress can be published. OKR commands access the server directly and do not
queue offline writes.

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

To verify CLI writes refreshing the Web/mobile shared client and an optional
packaged Electron app, first build the Web app against local Supabase and run
`pnpm preview`, then run:

```bash
ANTTODO_CLI_BROWSER_URL=http://127.0.0.1:4173 \
ANTTODO_OKR_ELECTRON_PATH="/absolute/path/to/蚂蚁清单.app/Contents/MacOS/蚂蚁清单" \
pnpm cli:test:integration
```

Omit the Electron variable to check only Web and the mobile layout. The packaged
app must also be configured for the local Supabase stack. These checks use the
integration run's disposable account and isolated browser/app profiles.

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
