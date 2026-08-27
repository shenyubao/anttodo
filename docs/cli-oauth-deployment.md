# CLI 独立设备认证部署

AntTodo CLI 使用协议 v2：CLI 本地只保存每台设备的随机凭据和最长 15 分钟的
access JWT 缓存；OAuth refresh token 与 PKCE verifier 只存放在 Supabase Vault。
CLI 拿到的 JWT 继续直连 Data API、Storage，并完全复用现有 RLS。

## 部署顺序

1. 部署 `20260825130728_cli_oauth_credentials.sql`，并在 Auth 配置启用
   `anttodo_private.cli_access_token_hook`。
2. 启用 Supabase OAuth 2.1 Server，将 Authorization Path 设置为
   `/oauth/consent`，关闭动态客户端注册。
3. 注册一个 confidential OAuth client。grant 固定为 `authorization_code` 和
   `refresh_token`，response type 为 `code`，scope 固定为
   `email profile phone`，token endpoint auth method 为
   `client_secret_basic`。
4. 回调 URI 必须精确匹配
   `https://<supabase-host>/functions/v1/cli-device-auth`，不允许通配符。
5. 将 client ID/secret 写入 Edge secrets，部署 `cli-device-auth`，随后部署 Web
   和包含 `cliAuthProtocol: 2` 的 `/.well-known/anttodo.json`，最后发布新版 CLI。

本地 OAuth 集成测试需要使用能把 `[auth.oauth_server]` 注入 Auth 容器的 Supabase
CLI；本仓库已用 v2.115.0 验证。v2.108.0 会忽略这段本地配置，应先升级再启动服务栈。

官方 Supabase 项目可运行配置脚本。脚本通过 Auth Admin API 创建客户端，把 secret
经临时 `0600` 文件直接交给 Supabase CLI，完成后立即删除临时文件；不会打印 secret。

```bash
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
SUPABASE_PROJECT_REF=PROJECT \
SUPABASE_ACCESS_TOKEN=... \
PUBLIC_APP_URL=https://app.anttodo.com \
node scripts/configure-cli-oauth.mjs
```

自托管实例使用相同客户端参数和精确回调 URI。需要在自托管 Auth 配置中启用 OAuth
Server 与 Custom Access Token Hook。Envoy/Kong 默认只开放社交登录用的
`/auth/v1/authorize`；CLI 走 OAuth 2.1 的 `/auth/v1/oauth/authorize` 和
`/auth/v1/oauth/token`，必须同样设为开放路由放在受保护的 `/auth/v1/` 之前，
否则浏览器跳转会得到 `401 Unauthorized`。Token 端点不能靠补 `apikey` 头绕过：
网关会把非 JWT 的 `Authorization: Basic` 覆盖成 Bearer。然后在 Edge Functions
运行环境设置：

- `CLI_OAUTH_CLIENT_ID`
- `CLI_OAUTH_CLIENT_SECRET`
- `CLI_OAUTH_PUBLIC_URL`（浏览器可访问的 Supabase 根地址）
- `PUBLIC_APP_URL`
- Supabase 默认注入的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、
  `SUPABASE_SERVICE_ROLE_KEY`

client secret 不得写入仓库、公开实例清单或日志。每个环境应注册独立客户端。

## 运维语义

- 设备授权期限为 7、90、360 天或无固定到期日，默认 360 天。
- “无限”只表示设备凭据本身没有到期日；账户删除、设备撤销和 Supabase session
  安全策略仍可提前使它失效。
- 撤销立即阻止后续换票；已经签发的无状态 JWT 最迟 15 分钟后完全失效。
- 旧 CLI 会话不会迁移，用户必须用新版 CLI 重新授权；旧版新登录收到 HTTP 426
  `cli_upgrade_required`。

部署后执行 `pnpm supabase:reset`、`pnpm supabase:test`、数据库 advisors、
`pnpm typecheck`、`pnpm test`、`pnpm build`，并完成 CLI 浏览器授权及单设备撤销冒烟测试。
