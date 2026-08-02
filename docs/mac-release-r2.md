# macOS 打包与 R2 发布

## 产物与稳定下载地址

`pnpm package:mac:all` 会同时生成 Apple Silicon（`arm64`）和 Intel（`x64`）
版本的 DMG 与 ZIP。`pnpm upload:mac:r2` 会上传版本化产物，并覆盖以下稳定对象：

```text
macos/AntTodo-arm64-latest.dmg
macos/AntTodo-arm64-latest.zip
macos/AntTodo-x64-latest.dmg
macos/AntTodo-x64-latest.zip
macos/latest.json
```

如果配置了 `R2_PREFIX=releases`，以上对象会统一放在 `releases/` 下。
官网应引用 `-latest` 地址；`latest.json` 还提供版本化地址、文件大小和 SHA-256，
可供下载页动态展示或校验。

## Cloudflare R2 配置

1. 创建一个 R2 bucket，并为它绑定生产自定义域名，例如
   `https://download.anttodo.com`。不要将限流的 `r2.dev` 地址用于官网生产下载。
2. 创建只允许目标 bucket 读写对象的 Cloudflare API Token。
3. 在 GitHub 仓库配置以下 Actions secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. 配置以下 Actions variables：
   - `R2_BUCKET`：bucket 名称。
   - `R2_PUBLIC_BASE_URL`：R2 自定义域名，必须使用 HTTPS。
   - `R2_PREFIX`：可选的对象路径前缀，例如 `releases`。
   - `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`：桌面端使用的
     Supabase 公开配置。
   - `VITE_PUBLIC_APP_URL`：可选，默认 `https://app.anttodo.com`。

## 发布

本地打包并上传：

```bash
R2_BUCKET=anttodo-downloads \
R2_PUBLIC_BASE_URL=https://download.anttodo.com \
pnpm release:mac:r2
```

仅上传 `release/` 中已有的四个包：

```bash
R2_BUCKET=anttodo-downloads \
R2_PUBLIC_BASE_URL=https://download.anttodo.com \
pnpm upload:mac:r2
```

推送与 `package.json` 版本一致的 `v*` tag 会触发
`.github/workflows/release-macos.yml`。也可以在 GitHub Actions 页面手动运行。
tag 与 `package.json` 版本不一致时发布会失败，避免错误覆盖 latest 地址。

当前产物未签名、未公证；正式对外发布前仍需补齐 Apple Developer 签名与公证。
