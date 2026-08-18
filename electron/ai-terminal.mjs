import { stat } from "node:fs/promises";
import path from "node:path";

const CLI_COMMANDS = Object.freeze({
  codex: "codex",
  claude: "claude",
});
const MAX_BUFFER_LENGTH = 1_000_000;

export function sanitizeTerminalPrompt(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function bracketedPaste(value) {
  return `\u001b[200~${sanitizeTerminalPrompt(value)}\u001b[201~`;
}

export function isTerminalSessionId(value) {
  return typeof value === "string"
    && /^task:[a-zA-Z0-9-]{1,100}$/.test(value);
}

export function terminalCommand(tool) {
  return CLI_COMMANDS[tool] ?? null;
}

function safeShell(env, platform) {
  const candidate = env.SHELL;
  if (typeof candidate === "string" && path.isAbsolute(candidate)) return candidate;
  return platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

async function validateWorkingDirectory(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    throw new Error("默认工作路径必须是绝对路径");
  }
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("默认工作路径不存在或不是目录");
}

export function createAiTerminalManager({
  loadPty = () => import("node-pty"),
  env = process.env,
  platform = process.platform,
  send,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const sessions = new Map();

  function appendBuffer(session, data) {
    session.buffer = `${session.buffer}${data}`.slice(-MAX_BUFFER_LENGTH);
  }

  function emit(session, channel, payload) {
    send?.(session.ownerId, channel, { sessionId: session.id, ...payload });
  }

  function stop(sessionId, ownerId) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) return false;
    if (session.prefillTimer) clearTimer(session.prefillTimer);
    session.prefillTimer = null;
    try {
      session.process?.kill();
    } catch {
      // The process may already have exited.
    }
    sessions.delete(sessionId);
    return true;
  }

  function stopOwner(ownerId) {
    for (const [sessionId, session] of sessions) {
      if (session.ownerId === ownerId) stop(sessionId, ownerId);
    }
  }

  async function start(ownerId, input) {
    if (!isTerminalSessionId(input?.sessionId)) throw new Error("终端会话标识无效");
    const command = terminalCommand(input.tool);
    if (!command) throw new Error("不支持的 CLI 工具");
    await validateWorkingDirectory(input.cwd);

    const existing = sessions.get(input.sessionId);
    if (existing) {
      if (existing.ownerId !== ownerId) throw new Error("无权访问该终端会话");
      if (existing.tool === input.tool && existing.cwd === input.cwd) {
        return {
          sessionId: existing.id,
          buffer: existing.buffer,
          running: !existing.exited,
          exitCode: existing.exitCode,
        };
      }
      stop(input.sessionId, ownerId);
    }

    const ptyModule = await loadPty();
    const spawn = ptyModule.spawn ?? ptyModule.default?.spawn;
    if (typeof spawn !== "function") throw new Error("终端组件加载失败");
    const shell = safeShell(env, platform);
    const child = spawn(shell, ["-ilc", `exec ${command}`], {
      name: "xterm-256color",
      cols: Math.max(20, Number(input.cols) || 80),
      rows: Math.max(5, Number(input.rows) || 24),
      cwd: input.cwd,
      env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    const session = {
      id: input.sessionId,
      ownerId,
      tool: input.tool,
      cwd: input.cwd,
      process: child,
      buffer: "",
      exited: false,
      exitCode: null,
      prefilled: false,
      prefillTimer: null,
    };
    sessions.set(session.id, session);

    const prefill = () => {
      if (session.prefilled || session.exited || sessions.get(session.id) !== session) return;
      session.prefilled = true;
      session.prefillTimer = null;
      child.write(bracketedPaste(input.prompt));
    };
    session.prefillTimer = setTimer(prefill, 1200);

    child.onData((data) => {
      appendBuffer(session, data);
      emit(session, "anttodo:ai-terminal-data", { data });
      if (!session.prefilled) {
        if (session.prefillTimer) clearTimer(session.prefillTimer);
        session.prefillTimer = setTimer(prefill, 120);
      }
    });
    child.onExit(({ exitCode, signal }) => {
      if (session.prefillTimer) clearTimer(session.prefillTimer);
      session.prefillTimer = null;
      session.exited = true;
      session.exitCode = exitCode;
      emit(session, "anttodo:ai-terminal-exit", { exitCode, signal });
    });

    return { sessionId: session.id, buffer: "", running: true, exitCode: null };
  }

  function write(sessionId, ownerId, data) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId || session.exited) return false;
    if (typeof data !== "string" || data.length > 65_536) return false;
    session.process.write(data);
    return true;
  }

  function resize(sessionId, ownerId, cols, rows) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId || session.exited) return false;
    const safeCols = Math.min(500, Math.max(20, Math.floor(Number(cols) || 80)));
    const safeRows = Math.min(200, Math.max(5, Math.floor(Number(rows) || 24)));
    session.process.resize(safeCols, safeRows);
    return true;
  }

  return { start, write, resize, stop, stopOwner };
}
