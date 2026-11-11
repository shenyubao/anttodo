# AntTodo 开放平台发布记录 · 2026-11-04

## 生产入口

- AntTodo Web：`1.0.202611040059`，https://app.anttodo.com
- 文档：https://app.anttodo.com/openapi
- OpenAPI 3.1：https://app.anttodo.com/api/open/v1/openapi.json
- 独立部署：https://todo.yuce-tech.cn/openapi
- VisTab：`0.4.23`，https://vistab.app

REST v1 提供团队空间、统一列表、标签元数据、分页任务、子任务、日期、版本控制、幂等、完成/重新打开、回收站/恢复、移动、手动排序和复制。连接器操作遵循原有服务端权限，客户端按 capabilities 显示操作。笔记、评论、附件、标签管理、Webhook 与 Todoist 兼容层不开放。

个人 Token 与 OAuth 凭据均为专用不透明凭据。原生 Supabase OAuth 会话留在 Vault；隔离角色只能进入受限 dispatcher，不能直连数据表、Storage 或既有业务 RPC。CLI 原有授权行为保留。有效权限为业务授权和实时成员/标签权限的交集。

VisTab 使用同一服务端领域实现及共享连接表单，支持官方 OAuth、独立部署的 confidential 客户端及个人 Token。任务面板可见且在线时每 30 秒刷新，恢复焦点/网络和写入后立即刷新。缓存隔离到账号、连接和实例，离线只读，失败保留成功结果，不排队写入。

## 验证

- AntTodo：类型检查、975 项单元测试、Web/CLI 构建通过。
- 数据库：完整本地重置，40 个 pgTAP 文件、1,121 项断言通过；安全顾问无问题。
- Deno：开放 API 与 CLI 授权函数类型检查通过。
- 浏览器：公开文档、Token 仅内存保存、React StrictMode 一次性展示通过；生产页面布局已检查。
- Electron：打包后的 arm64 应用验证沙箱开启、Node 集成关闭、共享任务界面和离线只读通过。
- VisTab：类型检查、434 项单元测试、三浏览器构建、公开资源密钥扫描通过；扩展与网站表单 E2E 通过。
- Chrome MV3、Edge MV3、Firefox MV2 实际加载与持久化、双语及后台生命周期冒烟通过。
- 官网和独立部署的真实 HTTP 验证：个人 Token、public OAuth/PKCE、授权码单次使用、刷新轮换、任务增改、幂等、直接调用 Supabase 拒绝、立即撤销通过。
- VisTab 官网/独立部署的 Token、confidential OAuth、凭据刷新、读取/写入、断开连接：Token、confidential OAuth 回调、临近到期的自动刷新/轮换、任务读写、断开及即时撤销全部通过；隔离测试账号已清理。

本次上线 Web、数据库、Edge Functions、VisTab Worker、网页预览与三种浏览器 ZIP 下载。未提交扩展商店，也未发布 macOS 安装包或提交 iOS 商店。iOS 使用共享 React/Query/Realtime 路径，本次没有进行 iOS 真机验收。

## 部署与回滚

- 官方 Worker：`3ef35fd3-2546-49eb-819b-e9f55ecbd4ea`。
- 官方前一稳定 Worker：`d9aa4db4-e8d3-4003-8892-81b51ac9cc0b`。
- 独立部署镜像：`anttodo-web:yuce-1.0.202611040059-20261103t170007z`。
- 独立部署原镜像：`anttodo-web:yuce-1.0.202611021459-20261102t070410z`。
- AntTodo 备份：服务器 `/root/backups/anttodo-openapi-20261104/`，包含完整数据库及运行配置，权限 0600/0700。
- VisTab Worker：`8f1778cc-70c6-4b52-8cbe-e09c98cecab3`；原稳定回滚点 `042e5d04-4ba6-4995-85c3-f779b7bde0fb`。
- VisTab 集成约束变更前的加密连接/授权流备份位于本地忽略的 `.credentials/anttodo-provider-backup-20261104.json`，权限 0600。

回滚网页时保留新增授权表、隔离角色、访问令牌钩子及撤销记录。不得恢复旧授权状态或删除来源不明的远程对象。部署脚本现会保留不属于本仓库的远程函数目录。
