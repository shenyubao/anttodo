---
sidebar_position: 1
title: CLI 快速开始
description: 使用 AntTodo CLI 登录、管理任务，并在脚本中稳定调用 API。
---

# CLI 快速开始

AntTodo CLI（`@anttodos/cli`）适合在终端、脚本和 CI 中管理任务、子任务、笔记、标签与团队空间。CLI 使用当前账号的权限执行操作，写入操作需要网络连接。

当前命令覆盖：

- 任务：创建、编辑标题/描述/标签、分配负责人、设置优先级与时间、完成/取消/恢复、批量操作和永久删除。
- 提醒与重复：管理提醒规则、重复频率、时区和持久提醒。
- 任务树：通过父任务创建、按父任务查询，并支持把任务移动到其他父任务或根级别。
- 笔记与标签：编辑、恢复、回收站、标签调整，以及标签改名、改色、移动、排序和权限配置。
- 团队空间：创建、编辑、删除、成员角色、移除成员和邀请链接；`user list`、`group list` 可查询成员与用户组。
- 专注记录：通过 `pomodoro` 和 `stopwatch` 写入完整、已结束的专注 session。
- 协作 API：搜索、评论、附件和活动记录。

## 1. 安装

正式用户可以全局安装，也可以每次通过 `npx` 临时运行：

```bash
npm install --global @anttodos/cli

# 不安装到全局时使用 npx
npx @anttodos/cli --help
```

如果你正在仓库内开发 CLI，请使用本地版本：

```bash
pnpm install
pnpm cli:run --help
```

也可以先打包，再从本地 tarball 安装：

```bash
pnpm --filter @anttodos/cli pack --pack-destination /tmp
npm install --global /tmp/anttodos-cli-*.tgz
```

下面的示例假设已经安装了 `anttodo` 命令；使用 `npx` 时，把 `anttodo` 替换为 `npx @anttodos/cli` 即可。

## 2. 配置自定义服务地址

CLI 默认连接 AntTodo 官方服务。使用自托管或企业私有服务时，服务地址必须提供与 Web/macOS 客户端相同的实例清单：
`/.well-known/anttodo.json`。

保存并切换到自定义服务：

```bash
anttodo service use https://todo.example.com
anttodo service current
anttodo service list
```

恢复官方服务：

```bash
anttodo service reset
```

如果只想让某一条命令访问自定义服务，不改变已保存的服务选择，可以使用全局参数：

```bash
anttodo --service-url https://todo.example.com task list
anttodo --service-url https://todo.example.com auth status --verify
```

每个服务的登录态、默认团队空间、缓存和设备授权请求彼此隔离。服务地址必须使用 HTTPS；本地开发时可显式设置 `ANTTODO_ALLOW_LOCAL_HTTP=1` 后使用 localhost HTTP 地址。

## 3. 登录并检查会话

交互式登录会打开浏览器完成授权，并将会话保存在本机：

```bash
anttodo auth login
anttodo auth status --verify
```

在无浏览器或自动化环境中，可以拆分为“生成设备码”和“等待授权”两步：

```bash
anttodo auth login --no-wait --no-open
anttodo auth login --device-code <设备码>
```

退出当前设备：

```bash
anttodo auth logout
```

CLI 不需要服务端密钥。不要把 Supabase service-role key 或其他私密令牌放进脚本、环境变量或日志中。

## 4. 选择团队空间

大多数任务命令都需要一个团队空间。先列出当前账号可访问的空间，再设置默认空间：

```bash
anttodo workspace list --format table
anttodo workspace use <团队空间 ID 或 slug>
```

也可以只对单次调用指定空间，不改变默认设置：

```bash
anttodo --workspace <团队空间 ID 或 slug> task list
```

## 5. 创建并完成第一个任务

```bash
anttodo task create \
  --title "整理 CLI 文档" \
  --description "补充安装、登录和自动化示例" \
  --priority high \
  --due-time 2026-08-10T18:00:00+08:00 \
  --timezone Asia/Shanghai

anttodo task list --status open --format table
anttodo task complete <任务 ID>
```

常用任务操作还包括：

```bash
anttodo task update <任务 ID> --title "新的标题" --description "新的描述"
anttodo task assign <任务 ID> --user <用户 ID>
anttodo task set-priority <任务 ID> high
anttodo task cancel <任务 ID>
anttodo task restore <任务 ID>
```

永久删除是不可逆操作，CLI 会要求显式确认：

```bash
anttodo task purge <任务 ID> --yes
```

需要同时修改多项任务时，使用 `task bulk`，通过重复的 `--id` 传入任务 ID：

```bash
anttodo task bulk complete --id task-1 --id task-2
anttodo task bulk set-priority --id task-3 --id task-4 --priority high
```

## 6. 记录专注 session

CLI 只记录已经完整结束的专注 session，不负责启动、暂停或实时计时。起止时间必须使用带时区的 RFC3339，且 session 至少持续 60 秒：

```bash
anttodo pomodoro \
  --started-at 2026-08-10T09:00:00+08:00 \
  --ended-at 2026-08-10T09:25:00+08:00 \
  --planned-seconds 1500 \
  --task <任务 ID> \
  --notes "完成初稿"

anttodo stopwatch \
  --started-at 2026-08-10T10:00:00+08:00 \
  --ended-at 2026-08-10T10:42:00+08:00
```

`pomodoro` 的计划时长由 `--planned-seconds` 指定；`stopwatch` 的计划时长自动等于起止时间计算出的实际时长。两者都只写入 `kind=focus`，任务关联和备注均为可选。

## 7. 设置提醒和重复规则

`task schedule` 同时管理到期时间、时区、提醒和重复规则：

```bash
anttodo task schedule <任务 ID> \
  --due-time 2026-08-14T17:00:00+08:00 \
  --timezone Asia/Shanghai \
  --reminder start:15:minute \
  --repeat weekly \
  --persistent-reminders
```

提醒值支持相对到期时间（例如 `start:15:minute`、`end:1:day`）和指定时刻（例如 `start:1:day@09:00`）。重复规则支持 `daily`、`weekdays`、`weekly`、`monthly`、`yearly`；不重复时使用 `none`。

清除时间、提醒和重复设置：

```bash
anttodo task schedule <任务 ID> --clear
```

## 8. 任务树、笔记和标签

```bash
# 任务树：创建子任务、查询直接子任务、移动任务
anttodo task create --title "核对示例" --parent <父任务 ID> --priority medium
anttodo task list --parent <父任务 ID>
anttodo task move <任务 ID> --parent <新的父任务 ID>
anttodo task move <任务 ID> --root

# 笔记
anttodo note list
anttodo note update <笔记 ID> --title "会议记录" --description "更新后的内容"
anttodo note restore <笔记 ID>

# 标签
anttodo tag create --name "文档" --color "#1677ff"
anttodo tag update <标签 ID> --name "产品文档" --color "#722ed1"
anttodo tag move <标签 ID> --parent <父标签 ID>
anttodo tag reorder <标签 ID> --before <另一个标签 ID>
```

笔记和标签的永久删除同样需要 `--yes`；回收站中的笔记可先用 `note list --trash` 检查，再执行 `note restore` 或 `note purge`。

## 9. 搜索、评论、附件和活动记录

```bash
anttodo search "发布说明" --kind all --format table

anttodo comment create <任务 ID> --body "已完成初稿"
anttodo comment list <任务 ID>
anttodo activity list <任务 ID>

anttodo attachment upload --task <任务 ID> --file ./release-notes.pdf
anttodo attachment download <附件 URI> --output ./release-notes.pdf
```

上传附件后，CLI 会返回附件 URI；需要在评论中插入附件时，可以使用 `--comment-image` 上传为评论图片，或将 URI 传给 `comment create --image-uri`。

## 10. 在脚本和 CI 中使用

所有命令都支持统一的输出格式：`json`、`pretty`、`table`、`ndjson` 和 `csv`。自动化场景建议使用 JSON，并让退出码控制流水线：

```bash
anttodo task list --format json > tasks.json
anttodo search "待发布" --format ndjson | jq -r '.id'
```

`--json` 是 `--format json` 的简写。成功响应包含 `ok: true`；失败时 CLI 输出结构化错误并返回非零退出码。使用 `anttodo man` 查看当前版本完整命令树和参数：

```bash
anttodo man --format pretty
```

## 11. 常见问题

- `not_logged_in`：先执行 `anttodo auth login`，再用 `auth status --verify` 检查会话。
- `workspace_required`：执行 `workspace list` 后用 `workspace use` 设置默认团队空间，或在命令上加 `--workspace`。
- 任务树、笔记或标签看不到：确认当前服务、账号和团队空间，并检查对象权限；CLI 不会绕过 RLS。
- CI 没有浏览器：使用 `auth login --no-wait --no-open` 获取设备码，在有浏览器的设备上完成授权后，再用设备码完成登录流程。

本地开发和验证可以运行：

```bash
pnpm cli:test
pnpm cli:test:integration
pnpm cli:test:browser
```
