# macOS 打包与 OSS 发布

## Apple 签名与公证

所有 `package:mac` 命令均强制使用 **Developer ID Application** 证书签名，并向
Apple 公证；凭据不完整时打包会失败。适用于从官网下载、而非 Mac App Store
分发的 DMG/ZIP。

打包命令会先运行 `pnpm mac:signing:check`：本机检查登录钥匙串中的签名身份，CI
则检查 `CSC_LINK` 和 `.p12` 密码，随后才执行耗时的构建。

### 本地打包

1. 在 Apple Developer 的 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list)
   创建 **Developer ID Application** 证书。按页面提示先用“钥匙串访问”创建 CSR，
   下载 `.cer` 后双击导入登录钥匙串；私钥必须保留在创建 CSR 的钥匙串中。
2. 在 App Store Connect 的“用户与访问 → Integrations → App Store Connect API”创建
   **Team API key**，下载一次性的 `.p8` 私钥，并记录 Key ID 和 Issuer ID。不可使用
   Individual API key，因为它不能用于 `notarytool`。
3. 导出环境变量后执行打包（不要把 `.p8` 放进仓库）：

   ```bash
   export APPLE_API_KEY=/absolute/path/AuthKey_XXXXXXXXXX.p8
   export APPLE_API_KEY_ID=XXXXXXXXXX
   export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   pnpm package:mac:all
   ```

   也可将凭据一次性保存到本机钥匙串；当前项目的打包脚本默认使用
   `anttodo-notarization` profile，之后无需再设置上述环境变量：

   ```bash
   xcrun notarytool store-credentials anttodo-notarization \
     --key /absolute/path/AuthKey_XXXXXXXXXX.p8 \
     --key-id XXXXXXXXXX \
     --issuer xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   pnpm package:mac:all
   ```

`electron-builder` 会从登录钥匙串选择 Developer ID Application 证书；若有多张
匹配证书，可额外设置 `CSC_NAME` 为完整证书名称。完成后可用下列命令验证：

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/蚂蚁清单.app"
spctl --assess --type execute --verbose=4 "release/mac-arm64/蚂蚁清单.app"
```

### GitHub Actions 凭据

在仓库的 Actions secrets 中创建以下项目（均不能提交到仓库）：

- `MACOS_CERTIFICATE_P12_BASE64`：含私钥的 Developer ID Application `.p12` 文件
  的 Base64 内容。导入 `.cer` 后在“钥匙串访问”中导出 `.p12`，再执行
  `base64 -i certificate.p12 | tr -d '\n'` 取得内容。
- `MACOS_CERTIFICATE_PASSWORD`：导出该 `.p12` 时设置的密码。
- `APPLE_API_KEY_P8_BASE64`：Team API key 的 `.p8` 文件的 Base64 内容，例如
  `base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'`。
- `APPLE_API_KEY_ID`：App Store Connect 显示的 Key ID。
- `APPLE_API_ISSUER`：App Store Connect 显示的 Issuer ID。
- `ALIYUN_ACCESS_KEY_ID`：阿里云 OSS 访问密钥 ID。
- `ALIYUN_ACCESS_KEY_SECRET`：阿里云 OSS 访问密钥 Secret。

工作流只在 runner 临时目录还原 `.p8`，并由 `electron-builder` 导入临时钥匙串签名。
发布前应在 GitHub Actions 日志中确认有 `signing` 和 `notarize` 步骤成功完成。

## 产物与稳定下载地址

`pnpm package:mac:all` 会同时生成 Apple Silicon（`arm64`）和 Intel（`x64`）
版本的 DMG 与 ZIP。`pnpm upload:mac:oss` 会上传版本化 DMG/ZIP（及 ZIP 的
`.blockmap`），并覆盖以下稳定对象（默认 `OSS_PREFIX=release`）。大文件分片上传
使用串行 part，并在上传后回读校验 SHA-256，避免并行分片偶发写出“大小正确但内容损坏”
的对象（Gatekeeper 会显示“已损坏，无法打开”）：

```text
release/macos/AntTodo-arm64-latest.dmg
release/macos/AntTodo-x64-latest.dmg
release/macos/AntTodo-arm64-latest.zip
release/macos/AntTodo-x64-latest.zip
release/macos/AntTodo-<version>-arm64.zip
release/macos/AntTodo-<version>-x64.zip
release/macos/latest-mac.yml
release/macos/latest.json
```

官网首次安装应引用 `-latest` DMG 地址；`latest.json` 还提供版本化地址、文件大小和
SHA-256，可供下载页动态展示或校验。桌面端应用内更新通过 `latest-mac.yml` 与同目录
下的 ZIP 完成（由 `electron-updater` 下载并替换应用，无需手动重装）。

打包时 `package.json` 的 `build.publish`（generic provider）会写入应用内的
`app-update.yml`，feed URL 为：

`https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com/release/macos`

## 阿里云 OSS 配置

1. 创建 OSS bucket（生产使用 `anttodo-yuce`），并确保公开读可访问对象，或通过
   等价策略让官网与桌面端能拉取 `latest.json`、`latest-mac.yml`、DMG 与 ZIP。
2. 创建只允许目标 bucket 读写对象的 AccessKey。
3. 在 GitHub 仓库配置以下 Actions secrets：
   - `ALIYUN_ACCESS_KEY_ID`
   - `ALIYUN_ACCESS_KEY_SECRET`
4. 配置以下 Actions variables：
   - `OSS_BUCKET`：bucket 名称，例如 `anttodo-yuce`。
   - `OSS_REGION`：例如 `cn-hangzhou`。
   - `OSS_PREFIX`：对象路径前缀，默认 `release`。
   - `OSS_PUBLIC_BASE_URL`：OSS 公网 HTTPS 根地址，例如
     `https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com`。
   - `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`：桌面端使用的
     Supabase 公开配置。
   - `VITE_PUBLIC_APP_URL`：可选，默认 `https://app.anttodo.com`。

## 发布

在 `.env.local`（或 `.env`）中配置：

```dotenv
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
OSS_BUCKET=anttodo-yuce
OSS_REGION=cn-hangzhou
OSS_PREFIX=release
OSS_PUBLIC_BASE_URL=https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com
```

本地推荐拆成三步（Apple 公证排队长时可分开执行，默认等待上限
`NOTARIZATION_TIMEOUT_MINUTES=180`）：

```bash
# 1) bump 版本、签名打包，并向 Apple 提交公证（不阻塞等待；不推库）
pnpm mac:submit

# 2) 查看 Apple 公证历史 / 本地待完成提交（ID、时间、状态）
pnpm mac:list

# 3) 等待公证 Accepted → 装订票据 → 生成 DMG/ZIP → 上传 OSS
pnpm mac:deploy
```

需要一次跑完：

```bash
pnpm mac:all      # 等价于 mac:submit && mac:deploy
pnpm deploy:mac   # 同 mac:all
```

`mac:submit` 默认不推数据库迁移（走 `pnpm deploy:web` / `pnpm supabase:push`）。需要一并推库时加 `--push`。会把各架构的 submission ID 写入
`release/notarize-state.json`，供 `mac:deploy` 继续。若 submit 本地失败但
Apple 已接收上传，脚本会从近期历史恢复 ID。

仅上传 `release/` 中已有的 DMG、ZIP 与更新 feed：

```bash
pnpm upload:mac:oss
```

命令行环境变量仍可覆盖 `.env.local` 中的同名值。

推送与 `package.json` 版本一致的 `v*` tag 会触发
`.github/workflows/release-macos.yml`。也可以在 GitHub Actions 页面手动运行。
tag 与 `package.json` 版本不一致时发布会失败，避免错误覆盖 latest 地址。

当前发布流程会强制签名和公证；未配置上述 secrets 的发布任务会失败。
