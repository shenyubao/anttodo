import { describe, expect, it, vi } from "vitest";
import {
  bracketedPaste,
  createAiTerminalManager,
  isTerminalSessionId,
  sanitizeTerminalPrompt,
  terminalCommand,
} from "./ai-terminal.mjs";

function fakePty() {
  const processes = [];
  const spawn = vi.fn((command, args, options) => {
    const dataListeners = [];
    const exitListeners = [];
    const child = {
      command,
      args,
      options,
      writes: [],
      write: vi.fn((value) => child.writes.push(value)),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn((listener) => dataListeners.push(listener)),
      onExit: vi.fn((listener) => exitListeners.push(listener)),
      emitData: (value) => dataListeners.forEach((listener) => listener(value)),
      emitExit: (value) => exitListeners.forEach((listener) => listener(value)),
    };
    processes.push(child);
    return child;
  });
  return { processes, spawn };
}

describe("AI terminal security helpers", () => {
  it("allows only stable task session identifiers", () => {
    expect(isTerminalSessionId("task:123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isTerminalSessionId("childTask:abc-123")).toBe(false);
    expect(isTerminalSessionId("task:../escape")).toBe(false);
  });

  it("maps only whitelisted commands", () => {
    expect(terminalCommand("codex")).toBe("codex");
    expect(terminalCommand("claude")).toBe("claude");
    expect(terminalCommand("sh")).toBeNull();
  });

  it("strips dangerous controls and bracket-pastes without Enter", () => {
    const sanitized = sanitizeTerminalPrompt("标题\u0000\u001b[31m\r\n描述\u0007");
    expect(sanitized).toBe("标题[31m\n描述");
    const pasted = bracketedPaste("任务\r\n描述");
    expect(pasted).toBe("\u001b[200~任务\n描述\u001b[201~");
    expect(pasted.endsWith("\r")).toBe(false);
    expect(pasted.endsWith("\n")).toBe(false);
  });
});

describe("AI terminal sessions", () => {
  it("keeps task and childTask sessions independent and supports resize/cleanup", async () => {
    const pty = fakePty();
    const timers = [];
    const sent = [];
    const manager = createAiTerminalManager({
      loadPty: async () => ({ spawn: pty.spawn }),
      env: { SHELL: "/bin/zsh", PATH: process.env.PATH },
      platform: "darwin",
      send: (...args) => sent.push(args),
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimer: vi.fn(),
    });

    await manager.start(7, {
      sessionId: "task:task-1",
      tool: "codex",
      cwd: process.cwd(),
      prompt: "主任务",
      cols: 80,
      rows: 24,
    });
    await manager.start(7, {
      sessionId: "task:nested-1",
      tool: "claude",
      cwd: process.cwd(),
      prompt: "子级任务",
      cols: 90,
      rows: 30,
    });

    expect(pty.processes).toHaveLength(2);
    pty.processes[0].emitData("ready");
    timers.at(-1)();
    expect(pty.processes[0].writes).toEqual([bracketedPaste("主任务")]);
    expect(pty.processes[1].writes).toEqual([]);

    expect(manager.resize("task:nested-1", 7, 1000, 1)).toBe(true);
    expect(pty.processes[1].resize).toHaveBeenCalledWith(500, 5);
    expect(manager.write("task:task-1", 7, "x")).toBe(true);
    expect(pty.processes[0].writes.at(-1)).toBe("x");

    pty.processes[1].emitExit({ exitCode: 1, signal: 0 });
    expect(sent.at(-1)?.[1]).toBe("anttodo:ai-terminal-exit");
    expect(manager.write("task:nested-1", 7, "x")).toBe(false);

    manager.stopOwner(7);
    expect(pty.processes[0].kill).toHaveBeenCalledOnce();
    expect(pty.processes[1].kill).toHaveBeenCalledOnce();
  });

  it("reuses a matching cached session instead of spawning another process", async () => {
    const pty = fakePty();
    const manager = createAiTerminalManager({
      loadPty: async () => ({ spawn: pty.spawn }),
      setTimer: () => 1,
      clearTimer: vi.fn(),
    });
    const input = {
      sessionId: "task:cache-1",
      tool: "codex",
      cwd: process.cwd(),
      prompt: "提示",
      cols: 80,
      rows: 24,
    };
    await manager.start(1, input);
    pty.processes[0].emitData("cached");
    const resumed = await manager.start(1, input);
    expect(pty.spawn).toHaveBeenCalledOnce();
    expect(resumed.buffer).toBe("cached");
    expect(resumed.running).toBe(true);
  });
});
