# AntTodo 智能体指南

## 项目定位

AntTodo 是一款面向 Web 和 macOS 的团队待办应用。两端共用同一套 React
应用，Electron 仅作为轻量且安全的外壳。Supabase 负责身份认证（Auth）、
Postgres、行级安全（RLS）、实时能力（Realtime）、Vault、Edge Functions
以及连接器的定时任务。

## 布局术语

描述应用的四栏布局时，从左到右统一使用以下名称：

1. **主导航栏**（`NavigationRail`）：包含账户、任务、连接器、搜索和通知等全局入口。
2. **侧边栏**（`Sidebar`）：包含智能视图和标签树。
3. **主工作区**（`workspace-main`）：展示任务列表或连接器内容。
4. **详情面板**（`TaskDetail`）：展示并编辑当前选中任务的详情。

“主工作区”专指第三栏界面区域；业务对象 `Workspace` 统一称为“团队空间”，
不得将两者混称。

## 常用命令

- `pnpm dev` — 启动浏览器客户端。
- `pnpm dev:mac` — 同时启动浏览器客户端和 macOS 客户端。
- `pnpm build` — 执行类型检查并生成 Web 构建产物。
- `pnpm package:mac` — 生成未签名的 macOS DMG 和 ZIP 安装包。
- `pnpm test` — 运行单元测试。
- `pnpm test:e2e` — 针对 `pnpm preview` 运行浏览器端到端测试。
- `pnpm supabase:start` — 启动本仓库的本地 Supabase 服务栈。
- `pnpm supabase:reset` — 根据迁移重建本地数据库。
- `pnpm supabase:test` — 运行 pgTAP 数据库测试。

## 代码边界

- 产品界面代码应放在 `src/`；Electron 代码应放在 `electron/`。
- 数据库变更应放在 `supabase/migrations/`。
- 编辑迁移前，必须先使用 `supabase migration new <name>` 创建迁移文件。
- Edge Functions 的共享代码应放在 `supabase/functions/_shared/`。
- 不得为 Electron 重复实现 React 页面或业务逻辑。
- macOS 桌面端拥有独立的本地存储（SQLite），不得假设改完云端或 React 层即覆盖桌面端。

## 桌面端本地存储

Web 端不以可写本地库为数据源。macOS 桌面端通过 Electron 维护独立的 local-first SQLite，用于离线缓存、本地写入与后续同步。相关代码：

- `electron/sqlite-worker.mjs`：本地表结构与读写。
- `electron/local-store.mjs`：主进程对本地库的封装。
- `src/lib/local-first/`：渲染进程的仓库、同步与类型。

凡改动任务、子任务、标签、评论、团队空间、附件或同步协议（含 Postgres 表结构、RLS、RPC、客户端类型、API payload），必须同时评估本地存储是否需要跟着改，例如：

- SQLite 表或列是否与云端字段对齐。
- `_entity_shadows`、`_client_outbox` 等同步载荷是否仍能读写新字段。
- `src/lib/local-first/` 的类型、仓库与同步逻辑是否仍正确。
- 现有本地库是否需要迁移，而不是只改 `CREATE TABLE IF NOT EXISTS`。

若评估后无需改动，应在交付说明中写明原因；不能默认忽略。

## 安全要求

- 浏览器代码只能使用 Supabase URL 和可公开使用的密钥（publishable key）。
- 禁止提交数据库密码、私密 API 密钥、连接器令牌或 `.env.*` 文件。
- 所有暴露的表都必须启用 RLS，并且只授予必要操作。
- UPDATE 策略必须同时具备 SELECT 权限、`USING` 和 `WITH CHECK`。
- 鉴权辅助函数应放在不对外暴露的 `anttodo_private` schema 中。
- 连接器凭据必须经由 Edge Functions 写入 Supabase Vault。
- Electron 必须启用沙箱，并禁用 Node 集成。

## 领域规则

- 任务可以没有标签；无标签任务归入收集箱，收集箱不是标签。
- 多标签任务采用严格的权限交集。
- 子标签默认继承权限，除非被明确解除继承。
- 团队空间的所有者和管理员可以管理该团队空间内的所有团队标签；个人标签仅创建者可见。
- 双向连接器产生的冲突必须被记录，禁止静默覆盖。
- 离线模式为只读；写操作必须在网络连接可用时执行。

## 验证要求

- 交付前运行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`。
- 涉及数据库结构变更时，重置本地 Supabase、运行 pgTAP，然后运行数据库顾问检查。
- 涉及数据模型或同步协议时，必须评估桌面端 SQLite 与 `src/lib/local-first/`；若有改动，在桌面端做冒烟验证。
- 在浏览器中验证 Web 布局，并对打包后的 Electron 应用进行冒烟测试。
- 保留与本次任务无关的用户改动，绝不删除来源不明的远程对象。
