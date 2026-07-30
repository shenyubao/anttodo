# AntTodo

AntTodo 是一个面向团队的待办应用，Web 与 macOS 桌面端共享同一套 React
源码。它使用 Supabase 提供认证、数据库、RLS、Realtime、Vault、Edge
Functions 和定时同步。

## 当前能力

- 手机号验证码登录、多团队空间、成员邀请与 `owner/admin/member` 角色。
- 所有、今天、指派给我、收集箱等智能视图。
- 标题、描述、状态、日期、优先级、负责人、子任务和活动记录。
- 树形标签、继承/覆盖权限和多标签严格权限交集。
- IndexedDB 查询缓存；断网时可读、不可写。
- Mock 连接器、增量同步状态、出站队列、运行日志和冲突处理。
- 安全的 Electron 壳与未签名 macOS DMG/ZIP 构建。

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

## 环境变量

`.env.local` 已被 Git 忽略。浏览器端只允许读取带 `VITE_` 前缀的公开配置：

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_PUBLIC_APP_URL=https://todo.example.com
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
`SEND_SMS_HOOK_SECRETS`；线上应通过 Supabase Function Secrets 注入这些值。
`config.toml` 中的 Twilio 占位值只用于绕过当前 Supabase CLI 的本地 Phone
Provider 开关校验，Send SMS Hook 会完全替代它；不得填写真实 Twilio 凭据。

`VITE_PUBLIC_APP_URL` 是邀请链接使用的 Web 站点根地址。浏览器开发环境可回退到
当前 HTTP(S) origin；打包后的 Electron 使用 `file:` origin，因此线上构建必须
显式配置该值才能复制可公开访问的邀请链接。

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

远端迁移前：

1. 在本地执行 reset 和 pgTAP。
2. 运行 Supabase database/security advisors。
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

部署线上环境时：

1. 使用 `supabase secrets set` 上传所有 `ALIYUN_*` 和
   `SEND_SMS_HOOK_SECRETS`，不要上传为 Vite 环境变量。
2. 使用 `supabase functions deploy send-sms --no-verify-jwt` 部署函数。
3. 在 Supabase Authentication 中启用 Phone Provider。
4. 在 Authentication > Hooks 新增 Send SMS HTTP Hook，URL 指向
   `/functions/v1/send-sms`，并把生成的签名密钥同步到 Function Secrets。
5. 将短信最短发送间隔设为 60 秒，并按实际成本配置 SMS/IP 限流。

## 构建和测试

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package:mac
```

`pnpm package:mac` 会在 `release/` 生成未签名的 DMG 和 ZIP。Apple Developer
签名、公证和自动更新不包含在 v1。

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
electron/                 Electron main/preload
src/                      共享 React 客户端
supabase/migrations/      数据库与 RLS
supabase/functions/       连接器 Edge Functions
supabase/tests/           pgTAP 数据库测试
tests/e2e/                Playwright 验收测试
```
