import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pollIntervalMs = 15_000;
const timeoutMinutes = Number(process.env.NOTARIZATION_TIMEOUT_MINUTES || 180);
const submitRetries = Math.max(1, Number(process.env.NOTARIZATION_SUBMIT_RETRIES || 5));
const submitRetryDelayMs = Math.max(
  5_000,
  Number(process.env.NOTARIZATION_SUBMIT_RETRY_DELAY_MS || 20_000),
);
const recentSubmissionSkewMs = Math.max(
  30_000,
  Number(process.env.NOTARIZATION_RECENT_SUBMISSION_SKEW_MS || 10 * 60_000),
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const NOTARIZE_STATE_PATH = join(root, "release", "notarize-state.json");

/**
 * @returns {"full" | "submit" | "skip"}
 */
export function resolveNotarizeMode() {
  const raw = (process.env.NOTARIZE_MODE || "full").trim().toLowerCase();
  if (raw === "submit" || raw === "skip" || raw === "full") return raw;
  throw new Error(`无效的 NOTARIZE_MODE=${raw}（支持 full | submit | skip）`);
}

function isTransientSubmitError(message) {
  return /deadlineExceeded|abortedUpload|timed?\s*out|ECONNRESET|ETIMEDOUT|ENETUNREACH|socket hang up|Broken pipe|Connection reset/i.test(
    message,
  );
}

export function authorizationArgs() {
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return ["--keychain-profile", process.env.APPLE_KEYCHAIN_PROFILE];
  }

  const key = process.env.APPLE_API_KEY;
  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;
  if (key && keyId && issuer) {
    return ["--key", key, "--key-id", keyId, "--issuer", issuer];
  }

  throw new Error(
    "缺少 Apple 公证凭据：请设置 APPLE_KEYCHAIN_PROFILE，或同时设置 APPLE_API_KEY、APPLE_API_KEY_ID、APPLE_API_ISSUER。",
  );
}

function tryParseJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // notarytool sometimes prints a banner line before JSON.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function submissionFromOutput(...chunks) {
  for (const chunk of chunks) {
    const parsed = tryParseJsonObject(chunk);
    if (parsed?.id) return parsed;
  }
  return null;
}

export async function notarytool(args) {
  try {
    const { stdout, stderr } = await execFileAsync("xcrun", ["notarytool", ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${stdout || ""}${stderr || ""}`.trim();
    if (!output) throw new Error(`notarytool 返回了空结果：${args[0]}`);
    const parsed = tryParseJsonObject(output);
    if (!parsed) throw new SyntaxError(`notarytool 返回了非 JSON：${output}`);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    // Apple may accept the upload while the local client still exits non-zero.
    // Prefer any submission id already present in stdout/stderr over failing hard.
    const recovered = submissionFromOutput(error.stdout, error.stderr);
    if (recovered) {
      console.warn(
        `notarytool ${args[0]} 退出码非零，但已解析到提交 ID ${recovered.id}，继续。`,
      );
      return recovered;
    }
    const details = [error.stderr, error.stdout, error.message]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .trim();
    throw new Error(`notarytool ${args[0]} 失败：${details || "未知错误"}`);
  }
}

async function findRecentSubmission(auth, archiveName, submittedAfterMs) {
  const history = await notarytool(["history", ...auth, "--output-format", "json"]);
  const entries = Array.isArray(history?.history)
    ? history.history
    : Array.isArray(history)
      ? history
      : [];
  const match = entries.find((entry) => {
    if (!entry?.id || entry.name !== archiveName) return false;
    const created = Date.parse(entry.createdDate || "");
    return Number.isFinite(created) && created >= submittedAfterMs;
  });
  return match || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} arch
 * @param {string} appOutDir
 * @returns {"arm64" | "x64" | "universal" | "unknown"}
 */
export function resolveArchLabel(arch, appOutDir = "") {
  if (typeof arch === "string") {
    if (arch === "arm64" || arch === "x64" || arch === "universal") return arch;
  }
  if (typeof arch === "number") {
    // builder-util Arch: ia32=0, x64=1, armv7l=2, arm64=3, universal=4
    if (arch === 3) return "arm64";
    if (arch === 1) return "x64";
    if (arch === 4) return "universal";
  }
  if (appOutDir.includes("mac-arm64")) return "arm64";
  if (appOutDir.includes("mac-x64") || /\/mac$/.test(appOutDir.replace(/\\/g, "/"))) {
    return "x64";
  }
  return "unknown";
}

/**
 * @returns {Promise<{
 *   version: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   apps: Array<{
 *     arch: string,
 *     appPath: string,
 *     submissionId: string,
 *     archiveName: string,
 *     submittedAt: string,
 *   }>,
 * } | null>}
 */
export async function readNotarizeState() {
  try {
    const raw = await readFile(NOTARIZE_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.apps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function resetNotarizeState(version) {
  await mkdir(dirname(NOTARIZE_STATE_PATH), { recursive: true });
  const now = new Date().toISOString();
  const state = {
    version: typeof version === "string" ? version : "",
    createdAt: now,
    updatedAt: now,
    apps: [],
  };
  await writeFile(NOTARIZE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

/**
 * @param {{
 *   arch: string,
 *   appPath: string,
 *   submissionId: string,
 *   archiveName: string,
 *   version?: string,
 * }} entry
 */
export async function appendNotarizeState(entry) {
  await mkdir(dirname(NOTARIZE_STATE_PATH), { recursive: true });
  const existing = (await readNotarizeState()) || {
    version: entry.version || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apps: [],
  };
  const apps = existing.apps.filter((app) => app.arch !== entry.arch);
  apps.push({
    arch: entry.arch,
    appPath: entry.appPath,
    submissionId: entry.submissionId,
    archiveName: entry.archiveName,
    submittedAt: new Date().toISOString(),
  });
  const state = {
    ...existing,
    version: entry.version || existing.version || "",
    updatedAt: new Date().toISOString(),
    apps,
  };
  await writeFile(NOTARIZE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

/**
 * @returns {Promise<Array<{
 *   id: string,
 *   status: string,
 *   createdDate: string,
 *   name: string,
 * }>>}
 */
export async function listNotarizationHistory() {
  const auth = authorizationArgs();
  const history = await notarytool(["history", ...auth, "--output-format", "json"]);
  const entries = Array.isArray(history?.history)
    ? history.history
    : Array.isArray(history)
      ? history
      : [];
  return entries.map((entry) => ({
    id: String(entry?.id || ""),
    status: String(entry?.status || "Unknown"),
    createdDate: String(entry?.createdDate || ""),
    name: String(entry?.name || ""),
  })).filter((entry) => entry.id);
}

/**
 * @param {string} submissionId
 * @param {{ timeoutMinutes?: number, auth?: string[] }} [options]
 */
export async function waitForNotarization(submissionId, options = {}) {
  const auth = options.auth ?? authorizationArgs();
  const minutes = options.timeoutMinutes ?? timeoutMinutes;
  const deadline = Date.now() + minutes * 60_000;

  while (Date.now() < deadline) {
    let info;
    try {
      info = await notarytool([
        "info",
        submissionId,
        ...auth,
        "--output-format",
        "json",
      ]);
    } catch (error) {
      console.warn(`读取 Apple 公证状态失败，15 秒后重试：${error.message}`);
      await delay(pollIntervalMs);
      continue;
    }

    if (info.status === "Accepted") {
      return info;
    }

    if (info.status !== "In Progress") {
      let log = "";
      try {
        const result = await execFileAsync(
          "xcrun",
          ["notarytool", "log", submissionId, ...auth],
          { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
        );
        log = `${result.stdout || ""}${result.stderr || ""}`.trim();
      } catch (error) {
        log = error.stderr || error.stdout || error.message;
      }
      throw new Error(`Apple 公证失败（${info.status}）：${submissionId}\n${log}`);
    }

    console.log(`Apple 公证处理中：${submissionId}`);
    await delay(pollIntervalMs);
  }

  throw new Error(`等待 Apple 公证超时（${minutes} 分钟）：${submissionId}`);
}

export async function stapleApp(appPath) {
  await execFileAsync("xcrun", ["stapler", "staple", appPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * @param {string} appPath
 * @param {{ mode?: "full" | "submit" | "skip", arch?: string, version?: string }} [options]
 */
export async function notarizeAppPath(appPath, options = {}) {
  const mode = options.mode ?? resolveNotarizeMode();
  if (mode === "skip") return null;

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "anttodo-notarize-"));
  // Prefer an ASCII archive name; Chinese product filenames have tripped notarytool
  // client failures after Apple already accepted the upload.
  const archiveName = "AntTodo.app.zip";
  const archivePath = join(temporaryDirectory, archiveName);
  const auth = authorizationArgs();
  const arch = options.arch || resolveArchLabel(undefined, dirname(appPath));

  try {
    console.log(`正在准备 Apple 公证包：${appPath}`);
    await execFileAsync(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    let submission;
    const submittedAfterMs = Date.now() - recentSubmissionSkewMs;
    for (let attempt = 1; attempt <= submitRetries; attempt += 1) {
      try {
        console.log(
          `正在上传 Apple 公证包（第 ${attempt}/${submitRetries} 次）…`,
        );
        submission = await notarytool([
          "submit",
          archivePath,
          ...auth,
          "--no-wait",
          "--output-format",
          "json",
        ]);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          const recent = await findRecentSubmission(auth, archiveName, submittedAfterMs);
          if (recent?.id) {
            console.warn(
              `notarytool submit 本地失败，但 Apple 历史中已有近期提交 ${recent.id}（${recent.status || "未知状态"}），改为继续。`,
            );
            submission = recent;
            break;
          }
        } catch (historyError) {
          console.warn(
            `查询 Apple 公证历史失败：${historyError instanceof Error ? historyError.message : historyError}`,
          );
        }

        const canRetry = attempt < submitRetries && isTransientSubmitError(message);
        if (!canRetry) throw error;
        console.warn(
          `Apple 公证上传失败（网络超时），${submitRetryDelayMs / 1000} 秒后重试：${message}`,
        );
        await delay(submitRetryDelayMs);
      }
    }
    if (!submission?.id) {
      throw new Error(`Apple 公证提交未返回 ID：${JSON.stringify(submission)}`);
    }

    console.log(`Apple 已接收公证提交：${submission.id}`);
    await appendNotarizeState({
      arch,
      appPath,
      submissionId: submission.id,
      archiveName,
      version: options.version,
    });

    if (mode === "submit") {
      console.log(
        `已写入公证状态（${arch} → ${submission.id}）。稍后运行 pnpm mac:deploy 等待并完成发布。`,
      );
      return submission;
    }

    await waitForNotarization(submission.id, { auth });
    await stapleApp(appPath);
    console.log(`Apple 公证成功并已装订票据：${submission.id}`);
    return submission;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export default async function notarizeMac(context) {
  if (process.platform !== "darwin") return;

  const mode = resolveNotarizeMode();
  if (mode === "skip") {
    console.log("NOTARIZE_MODE=skip，跳过 Apple 公证。");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);
  const arch = resolveArchLabel(context.arch, context.appOutDir);
  const version = context.packager.appInfo.version;

  await notarizeAppPath(appPath, { mode, arch, version });
}
