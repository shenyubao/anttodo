import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const architectures = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const productName = packageJson.build?.productName;
const publishVersion = typeof packageJson.version === "string" ? packageJson.version.trim() : "";

if (architectures.length === 0) {
  console.error("Usage: node scripts/verify-macos-package.mjs <arch> [...arch]");
  process.exit(1);
}

if (!productName) {
  console.error("macOS 产物验证失败：package.json 缺少 build.productName。");
  process.exit(1);
}

function fail(message) {
  console.error(`macOS 产物验证失败：${message}`);
  process.exit(1);
}

function loadAsar() {
  const electronBuilderPackage = require.resolve("electron-builder/package.json", {
    paths: [root],
  });
  return createRequire(electronBuilderPackage)("@electron/asar");
}

function assertNoSourceMaps(appPath, arch) {
  const asarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  if (!existsSync(asarPath)) {
    fail(`${arch} 应用缺少 app.asar：${asarPath}`);
  }

  const asar = loadAsar();
  const mapFiles = asar
    .listPackage(asarPath)
    .filter((entry) => typeof entry === "string" && entry.endsWith(".map"));
  if (mapFiles.length > 0) {
    const sample = mapFiles.slice(0, 8).join("\n");
    fail(
      `${arch} 应用包含 ${mapFiles.length} 个 source map，禁止打入发布包。示例：\n${sample}`,
    );
  }

  const unpackedDir = path.join(appPath, "Contents", "Resources", "app.asar.unpacked");
  if (existsSync(unpackedDir)) {
    const listed = execFileSync(
      "find",
      [unpackedDir, "-type", "f", "-name", "*.map"],
      { encoding: "utf8" },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (listed.length > 0) {
      fail(
        `${arch} 应用 unpack 目录包含 ${listed.length} 个 source map。示例：\n${listed.slice(0, 8).join("\n")}`,
      );
    }
  }
}

for (const arch of architectures) {
  const outputDirectory = arch === "x64" ? "mac" : `mac-${arch}`;
  const appPath = path.join(root, "release", outputDirectory, `${productName}.app`);
  if (!existsSync(appPath)) {
    fail(`找不到 ${arch} 应用：${appPath}`);
  }

  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
      stdio: "pipe",
    });
    const inspection = spawnSync("codesign", ["-dvvv", appPath], { encoding: "utf8" });
    if (inspection.status !== 0) throw new Error(inspection.stderr || "无法读取签名详情。");
    const details = inspection.stderr;
    if (!/Signature=Apple Development|Signature=Developer ID Application|Authority=Developer ID Application/m.test(details)) {
      fail(`${arch} 应用不是 Developer ID 签名。`);
    }
    execFileSync("xcrun", ["stapler", "validate", appPath], { stdio: "pipe" });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    fail(`${arch} 应用未通过签名或公证票据验证。${output ? `\n${output}` : ""}`);
  }

  assertNoSourceMaps(appPath, arch);
}

if (!publishVersion) {
  fail("package.json 缺少 version，无法写入发布版本戳。");
}
writeFileSync(path.join(releaseDir, "macos-publish-version"), `${publishVersion}\n`, "utf8");
console.log(`macOS 产物验证通过：${architectures.join(", ")}（版本 ${publishVersion}）`);
