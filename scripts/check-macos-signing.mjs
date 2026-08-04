import { accessSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";

function fail(message) {
  console.error(`macOS 签名预检失败：${message}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail("只能在 macOS 主机上构建已签名的 macOS 安装包。");
}

if (process.env.CSC_LINK) {
  if (!process.env.CSC_KEY_PASSWORD) {
    fail("设置了 CSC_LINK，但缺少 CSC_KEY_PASSWORD。请提供 .p12 证书的导出密码。");
  }
} else {
  try {
    const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
    });
    const expectedIdentity = process.env.CSC_NAME || "Developer ID Application";
    if (!identities.includes(expectedIdentity)) {
      fail(`登录钥匙串中找不到有效的“${expectedIdentity}”证书。请安装 Developer ID Application 证书，或设置 CSC_NAME。`);
    }
  } catch (error) {
    fail(`无法读取登录钥匙串中的代码签名证书（${error.message}）。`);
  }
}

const apiKeyPath = process.env.APPLE_API_KEY;
const apiKeyId = process.env.APPLE_API_KEY_ID;
const apiIssuer = process.env.APPLE_API_ISSUER;
const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;

if (apiKeyPath || apiKeyId || apiIssuer) {
  if (!apiKeyPath || !apiKeyId || !apiIssuer) {
    fail("APPLE_API_KEY、APPLE_API_KEY_ID 与 APPLE_API_ISSUER 必须同时设置。");
  }

  try {
    accessSync(apiKeyPath, constants.R_OK);
  } catch {
    fail(`APPLE_API_KEY 指向的 .p8 文件不可读取：${apiKeyPath}`);
  }

  console.log("macOS 签名预检通过：已找到 Developer ID Application 证书和 App Store Connect API 公证凭据。");
  process.exit(0);
}

if (keychainProfile) {
  console.log("macOS 签名预检通过：已找到 Developer ID Application 证书和公证钥匙串配置。");
  process.exit(0);
}

fail("缺少公证凭据。请设置 APPLE_API_KEY、APPLE_API_KEY_ID、APPLE_API_ISSUER，或设置 APPLE_KEYCHAIN_PROFILE。");
