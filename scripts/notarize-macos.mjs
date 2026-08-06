import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pollIntervalMs = 15_000;
const timeoutMinutes = Number(process.env.NOTARIZATION_TIMEOUT_MINUTES || 60);
const submitRetries = Math.max(1, Number(process.env.NOTARIZATION_SUBMIT_RETRIES || 5));
const submitRetryDelayMs = Math.max(
  5_000,
  Number(process.env.NOTARIZATION_SUBMIT_RETRY_DELAY_MS || 20_000),
);
const recentSubmissionSkewMs = Math.max(
  30_000,
  Number(process.env.NOTARIZATION_RECENT_SUBMISSION_SKEW_MS || 10 * 60_000),
);

function isTransientSubmitError(message) {
  return /deadlineExceeded|abortedUpload|timed?\s*out|ECONNRESET|ETIMEDOUT|ENETUNREACH|socket hang up|Broken pipe|Connection reset/i.test(
    message,
  );
}

function authorizationArgs() {
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

async function notarytool(args) {
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
        `notarytool ${args[0]} 退出码非零，但已解析到提交 ID ${recovered.id}，继续轮询。`,
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

export default async function notarizeMac(context) {
  if (process.platform !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "anttodo-notarize-"));
  // Prefer an ASCII archive name; Chinese product filenames have tripped notarytool
  // client failures after Apple already accepted the upload.
  const archiveName = "AntTodo.app.zip";
  const archivePath = join(temporaryDirectory, archiveName);
  const auth = authorizationArgs();

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
              `notarytool submit 本地失败，但 Apple 历史中已有近期提交 ${recent.id}（${recent.status || "未知状态"}），改为继续轮询。`,
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
    const deadline = Date.now() + timeoutMinutes * 60_000;
    while (Date.now() < deadline) {
      let info;
      try {
        info = await notarytool([
          "info",
          submission.id,
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
        await execFileAsync("xcrun", ["stapler", "staple", appPath], {
          maxBuffer: 10 * 1024 * 1024,
        });
        console.log(`Apple 公证成功并已装订票据：${submission.id}`);
        return;
      }

      if (info.status !== "In Progress") {
        let log = "";
        try {
          const result = await execFileAsync(
            "xcrun",
            ["notarytool", "log", submission.id, ...auth],
            { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
          );
          log = `${result.stdout || ""}${result.stderr || ""}`.trim();
        } catch (error) {
          log = error.stderr || error.stdout || error.message;
        }
        throw new Error(`Apple 公证失败（${info.status}）：${submission.id}\n${log}`);
      }

      console.log(`Apple 公证处理中：${submission.id}`);
      await delay(pollIntervalMs);
    }

    throw new Error(`等待 Apple 公证超时（${timeoutMinutes} 分钟）：${submission.id}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
