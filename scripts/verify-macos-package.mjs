import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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
const appBundleName = `${productName}.app`;

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

function assertValidAppBundle(appPath, label) {
  if (!existsSync(appPath)) {
    fail(`${label} 不存在：${appPath}`);
  }
  if (!existsSync(path.join(appPath, "Contents", "Info.plist"))) {
    fail(`${label} 缺少 Contents/Info.plist：${appPath}`);
  }
  const nestedApp = path.join(appPath, path.basename(appPath));
  if (existsSync(nestedApp)) {
    fail(`${label} 出现嵌套 .app（${nestedApp}），安装包不可用。`);
  }
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

/**
 * electron-builder 写入的 ZIP 常把 UTF-8 文件名存成未设置 language encoding bit，
 * Info-ZIP `unzip -Z1` / Python zipfile 会按 CP437 误读成乱码。
 * macOS 自带的 bsdtar/libarchive 能正确还原。
 */
function listZipEntries(zipPath) {
  const attempts = [
    ["bsdtar", ["-tf", zipPath]],
    ["tar", ["-tf", zipPath]],
  ];
  const errors = [];
  for (const [command, args] of attempts) {
    try {
      return execFileSync(command, args, { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim().replace(/^\.\//, ""))
        .filter(Boolean);
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
      errors.push(`${command}: ${output || "failed"}`);
    }
  }

  // 最后回退 unzip，并把 CP437 误读的 UTF-8 字节序列还原回来。
  try {
    const raw = execFileSync("unzip", ["-Z1", zipPath]);
    return raw
      .toString("latin1")
      .split("\n")
      .map((line) => {
        const trimmed = line.trim().replace(/^\.\//, "");
        if (!trimmed) return "";
        try {
          return Buffer.from(trimmed, "binary").toString("utf8");
        } catch {
          return trimmed;
        }
      })
      .filter(Boolean);
  } catch (error) {
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
    errors.push(`unzip: ${output || "failed"}`);
    fail(`无法读取 ZIP 内容。\n${errors.join("\n")}`);
  }
}

function assertZipLayout(arch) {
  const zipPath = path.join(releaseDir, `AntTodo-${publishVersion}-${arch}.zip`);
  if (!existsSync(zipPath)) {
    fail(`${arch} 缺少 ZIP：${zipPath}`);
  }

  const entries = listZipEntries(zipPath);
  const topLevels = new Set(
    entries
      .map((entry) => entry.split("/")[0])
      .filter(Boolean),
  );
  if (topLevels.size !== 1 || !topLevels.has(appBundleName)) {
    fail(
      `${arch} ZIP 顶层必须是 ${appBundleName}，实际为：${[...topLevels].join(", ") || "(空)"}`,
    );
  }
  if (!entries.some((entry) => entry === `${appBundleName}/Contents/` || entry.startsWith(`${appBundleName}/Contents/`))) {
    fail(`${arch} ZIP 缺少 ${appBundleName}/Contents/`);
  }
  if (entries.some((entry) => entry.startsWith(`${appBundleName}/${appBundleName}/`))) {
    fail(`${arch} ZIP 出现嵌套 ${appBundleName}/${appBundleName}/，安装包不可用。`);
  }
}

function detachMount(mountPoint) {
  if (!mountPoint) return;
  try {
    execFileSync("hdiutil", ["detach", mountPoint], { stdio: "pipe" });
  } catch {
    try {
      execFileSync("hdiutil", ["detach", mountPoint, "-force"], { stdio: "pipe" });
    } catch {
      // ignore detach failures after validation
    }
  }
}

function assertDmgLayout(arch) {
  const dmgPath = path.join(releaseDir, `AntTodo-${publishVersion}-${arch}.dmg`);
  if (!existsSync(dmgPath)) {
    fail(`${arch} 缺少 DMG：${dmgPath}`);
  }

  const mountRoot = mkdtempSync(path.join(tmpdir(), "anttodo-dmg-verify-"));
  let mountPoint = null;
  let validationError = null;
  try {
    const attachOutput = execFileSync(
      "hdiutil",
      ["attach", dmgPath, "-nobrowse", "-readonly", "-mountroot", mountRoot],
      { encoding: "utf8" },
    );
    const kids = execFileSync("ls", ["-1", mountRoot], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (kids.length === 0) {
      validationError = `${arch} DMG 挂载后为空。\n${attachOutput}`;
    } else {
      mountPoint = path.join(mountRoot, kids[0]);
      const appPath = path.join(mountPoint, appBundleName);
      if (!existsSync(appPath)) {
        validationError = `${arch} DMG 内缺少 ${appBundleName}：${appPath}`;
      } else if (!existsSync(path.join(appPath, "Contents", "Info.plist"))) {
        validationError = `${arch} DMG 内应用缺少 Contents/Info.plist：${appPath}`;
      } else if (existsSync(path.join(appPath, appBundleName))) {
        validationError =
          `${arch} DMG 内出现嵌套 ${appBundleName}/${appBundleName}，安装包不可用。`;
      }
    }
  } catch (error) {
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
    validationError = `${arch} 无法校验 DMG。${output ? `\n${output}` : ""}`;
  } finally {
    detachMount(mountPoint);
    rmSync(mountRoot, { recursive: true, force: true });
  }

  if (validationError) fail(validationError);
}

if (!publishVersion) {
  fail("package.json 缺少 version，无法校验发布产物文件名。");
}

for (const arch of architectures) {
  const outputDirectory = arch === "x64" ? "mac" : `mac-${arch}`;
  const appPath = path.join(root, "release", outputDirectory, appBundleName);
  assertValidAppBundle(appPath, `${arch} 预打包应用`);

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
  assertZipLayout(arch);
  assertDmgLayout(arch);
}

writeFileSync(path.join(releaseDir, "macos-publish-version"), `${publishVersion}\n`, "utf8");
console.log(`macOS 产物验证通过：${architectures.join(", ")}（版本 ${publishVersion}）`);
