# 蚂蚁清单官网

独立部署于 `anttodo.com` 的单页官网。`www.anttodo.com` 由 Worker 以 308
重定向到主域名；产品应用继续部署在 `app.anttodo.com`。

```bash
pnpm landing:dev
pnpm landing:test
pnpm landing:build
pnpm deploy:landing
```

本地视觉验收可访问 `http://127.0.0.1:4174/?preview=1`，该参数只在开发模式
跳过已登录用户的自动跳转。生产环境会通过
`app.anttodo.com/auth/session-bridge` 获取不含用户信息的布尔登录状态。

Mac 版本信息由官网 Worker 的 `/api/downloads/macos` 同源代理读取，源清单为
`https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos/latest.json`；读取失败时页面会回退到稳定的
Apple Silicon 与 Intel 下载地址，并隐藏版本号。
