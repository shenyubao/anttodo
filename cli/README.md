# AntTodo CLI

```bash
npx @anttodo/cli auth login
anttodo workspace list --format table
anttodo task list
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

Deployment order is database migration, `cli-device-auth` Edge Function, Web
authorization page and well-known configuration, then the npm package.

Repository checks:

```bash
pnpm cli:test
pnpm cli:pack
# With local Supabase and `supabase functions serve` running:
pnpm cli:test:integration
pnpm cli:test:browser
```
