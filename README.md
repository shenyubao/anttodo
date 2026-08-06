# AntTodo

AntTodo 是一个面向团队的待办应用，Web 与 macOS 桌面端共享同一套 React
源码。它使用 Supabase 提供认证、数据库、RLS、Realtime、Vault、Edge
Functions 和定时同步。

## 当前能力

- 手机号验证码登录、多团队空间、成员邀请与 `owner/admin/member` 角色。
- 所有、今天、指派给我、我关注的、收集箱等智能视图。
- 标题、描述、状态、日期、优先级、负责人、子任务和活动记录。
- 树形标签、继承/覆盖权限和多标签严格权限交集。
- IndexedDB 查询缓存；断网时可读、不可写。
- Mock 连接器、增量同步状态、出站队列、运行日志和冲突处理。
- 安全的 Electron 壳与未签名 macOS DMG/ZIP 构建。
- 基于 Capacitor 的 iOS 原生壳，与 Web/macOS 共享 React 应用。

## 技术栈

- React 19、TypeScript、Vite、Tailwind CSS、Radix UI
- TanStack Query、Supabase JS、IndexedDB
- Electron、electron-builder
- Supabase Postgres/Auth/Realtime/Vault/Cron/Edge Functions
- Vitest、Playwright、pgTAP

## 快速开始

要求：Node.js 22+、pnpm 11+；本地 Supabase 还需要 Docker。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

浏览器打开 `http://127.0.0.1:5173`。无需账号查看完整产品演示：

```text
http://127.0.0.1:5173/?demo=1
```

默认启动 Web：

```bash
pnpm dev
```

同时启动 Web 与 macOS 客户端：

```bash
pnpm dev:mac
```

同步 Web 构建产物与 iOS 工程，然后用 Xcode 打开：

```bash
pnpm ios:sync
pnpm ios:open
```

一键构建并提交 TestFlight（会 bump 版本、同步 Web 到 iOS、归档并上传）：

```bash
pnpm ios:testflight
```

需要与 macOS 公证相同的 App Store Connect API 凭据（`APPLE_API_KEY`、
`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`），可写入 `.env.local`。可用
`--dry-run` 只校验环境，`--skip-bump` / `--skip-sync` 跳过对应步骤。首次
真机构建时，在 Xcode 的 Signing & Capabilities 中选择 Apple Developer Team，
并让 Xcode 自动管理签名。iOS Bundle Identifier 默认为 `com.anttodo.ios`。

## 环境变量

`.env.local` 已被 Git 忽略。浏览器端只允许读取带 `VITE_` 前缀的公开配置：

```dotenv
VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_PUBLIC_APP_URL=https://todo.example.com
```

生产环境使用自托管 Supabase，`VITE_SUPABASE_URL` 应指向自托管 API 源（不是
`*.supabase.co`）。向生产推送迁移时还需要配置 SSH 目标：

```dotenv
ANTTODO_SUPABASE_SELFHOST_SSH=supabase
ANTTODO_SUPABASE_SELFHOST_DOCKER_DIR=/home/ubuntu/projects/supabase/docker
```

手机号登录还需要以下仅供 Supabase Edge Function 使用的服务端配置。禁止为这些
变量增加 `VITE_` 前缀，也不要提交真实值：

```dotenv
ALIYUN_APIKEY=
ALIYUN_SECRETKEY=
ALIYUN_REGION=cn-hangzhou
ALIYUN_SMS_ENDPOINT=dysmsapi.aliyuncs.com
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
SEND_SMS_HOOK_SECRETS=v1,whsec_<base64-secret>
```

`ALIYUN_SMS_SIGN_NAME` 必须与阿里云短信控制台中审核通过的签名完全一致，模板
验证码变量名应为 `code`。本地 Auth Hook 与 Edge Function 使用同一个
`SEND_SMS_HOOK_SECRETS`；线上应写入自托管栈的 Edge Function 环境变量，不要当作
Vite 环境变量提交。`config.toml` 中的 Twilio 占位值只用于绕过当前 Supabase CLI
的本地 Phone Provider 开关校验，Send SMS Hook 会完全替代它；不得填写真实
Twilio 凭据。

`VITE_PUBLIC_APP_URL` 是主站 Web 根地址（邀请链接与钉钉回调）。团队 SSO
入口使用 `https://app.anttodo.com/team/{slug}` 格式；主站根路径仅暴露手机号
登录，团队访问路径仅暴露钉钉 SSO。本地可用
`http://localhost:5173/team/{slug}` 调试团队登录页。

浏览器开发环境可回退到当前 HTTP(S) origin；打包后的 Electron 使用 `file:`
origin，因此线上构建必须显式配置 `VITE_PUBLIC_APP_URL` 才能复制可公开访问的
邀请链接与团队访问地址。

## 本地 Supabase

本仓库拥有独立的 `supabase/config.toml`，不会复用上级目录配置。

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:test
```

首次手机号验证后，通过界面创建团队；数据库触发器会自动创建 profile，创建团队
后会自动创建 owner 成员。
无标签待办显示在收集箱中，收集箱本身不是标签。连接器密钥由
`connector-admin` Edge Function 写入 Vault。

生产库迁移走自托管 SSH（`pnpm supabase:push`），不链接也不推送到 Supabase
Cloud。推送前：

1. 在本地执行 reset 和 pgTAP。
2. 确认 `ANTTODO_SUPABASE_SELFHOST_SSH` 已配置。
3. 检查远端未知对象，禁止删除不属于 AntTodo 的表或函数。
4. 执行迁移后查询表、RLS、策略和函数状态。

## 手机验证码登录

本地启动 Supabase 时，需要先让 CLI 能读取 Auth Hook 签名，并启动不校验 JWT
的短信 Hook。Hook 自身会验证 Supabase Standard Webhooks 签名：

```bash
set -a
source .env.local
set +a
pnpm supabase:start
supabase functions serve send-sms --env-file .env.local --no-verify-jwt
```

部署线上自托管环境时：

1. 将所有 `ALIYUN_*` 和 `SEND_SMS_HOOK_SECRETS` 写入自托管 Edge Function
   环境（不要上传为 Vite 环境变量）。
2. 按自托管流程发布 `send-sms`（`--no-verify-jwt`）。
3. 在 Auth（GoTrue）配置中启用 Phone Provider。
4. 配置 Send SMS HTTP Hook，URL 指向自托管
   `/functions/v1/send-sms`，并把生成的签名密钥同步到函数环境。
5. 将短信最短发送间隔设为 60 秒，并按实际成本配置 SMS/IP 限流。

## 文档站

产品文档位于 `docs/`（Docusaurus），线上地址为
[https://docs.anttodo.com](https://docs.anttodo.com)。

```bash
pnpm docs:dev
pnpm docs:build
pnpm deploy:docs
```

## 构建和测试

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package:mac
pnpm package:mac:all
pnpm ios:sync
pnpm ios:testflight
```

CLI 位于独立 workspace 包 `@anttodo/cli`，要求 Node.js 22+：

```bash
pnpm cli:build
pnpm cli:run man
pnpm cli:test
pnpm cli:pack
node cli/dist/index.js man --format pretty
```

CLI 默认连接 `https://app.anttodo.com`，正常使用不需要额外设置环境变量。

本地完整 CLI 集成测试需先启动 Supabase 与设备授权函数：

```bash
supabase functions serve cli-device-auth --no-verify-jwt --workdir .
pnpm cli:test:integration
pnpm cli:test:browser
```

本次仓库只生成可发布 tarball，不执行 npm 发布。

`pnpm package:mac` 会在 `release/` 生成使用 Developer ID 签名并已公证的 DMG
和 ZIP；若本机没有签名证书或公证凭据，命令会失败，避免产出未签名包。
`pnpm package:mac:all` 会同时生成 Apple Silicon 和 Intel 产物；证书和 CI 配置、
OSS 上传、稳定 `-latest` 下载地址与 GitHub Actions 发布见
[macOS 打包与 OSS 发布](docs/mac-release-oss.md)。

## 连接器

首版可运行 Mock 连接器。云效和钉钉的能力与配置模型已经预留，但不会在没有
开放平台凭据时发起真实请求。连接器必须遵循：

- 基于游标增量拉取。
- 通过幂等键回写任务。
- 重试失败的 outbox 项。
- 双方同时修改时生成冲突，由用户选择本地或远端版本。
- 永不把远端 token 返回给浏览器。

## 目录

```text
docs/                     Docusaurus 文档站（docs.anttodo.com）
cli/                      @anttodo/cli workspace 包
electron/                 Electron main/preload
src/                      共享 React 客户端
supabase/migrations/      数据库与 RLS
supabase/functions/       连接器 Edge Functions
supabase/tests/           pgTAP 数据库测试
tests/e2e/                Playwright 验收测试
```
