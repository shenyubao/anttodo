#!/usr/bin/env node
import {
  authorizationArgs,
  listNotarizationHistory,
  readNotarizeState,
} from "./notarize-macos.mjs";

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function formatLocal(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

async function main() {
  // Touch auth early so missing credentials fail with a clear message.
  authorizationArgs();

  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = Math.max(1, Number(limitArg?.slice("--limit=".length) || 20) || 20);

  const [history, state] = await Promise.all([
    listNotarizationHistory(),
    readNotarizeState(),
  ]);

  if (state?.apps?.length) {
    console.log("本地待完成公证（release/notarize-state.json）：");
    console.log(
      `${pad("ARCH", 10)} ${pad("SUBMISSION ID", 38)} ${pad("SUBMITTED AT", 22)} APP PATH`,
    );
    for (const app of state.apps) {
      console.log(
        `${pad(app.arch, 10)} ${pad(app.submissionId, 38)} ${pad(formatLocal(app.submittedAt), 22)} ${app.appPath}`,
      );
    }
    console.log(`版本：${state.version || "-"}`);
    console.log("");
  }

  console.log("Apple 公证历史：");
  console.log(
    `${pad("STATUS", 12)} ${pad("CREATED (LOCAL)", 22)} ${pad("CREATED (UTC)", 24)} ${pad("ID", 38)} NAME`,
  );
  for (const entry of history.slice(0, limit)) {
    console.log(
      `${pad(entry.status, 12)} ${pad(formatLocal(entry.createdDate), 22)} ${pad(entry.createdDate || "-", 24)} ${pad(entry.id, 38)} ${entry.name || "-"}`,
    );
  }

  if (history.length === 0) {
    console.log("(无记录)");
  } else if (history.length > limit) {
    console.log(`… 仅显示最近 ${limit} 条（可用 --limit=N 调整）`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
