import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { aiCliLabel, requestAiWorkSettings } from "./lib/aiWork";
import { trackAiTerminalSession, untrackAiTerminalSession } from "./lib/aiTerminalSessions";
import type { AiCliTool } from "./types";

export function TaskCliTerminal({
  taskId,
  sessionId,
  tool,
  cwd,
  prompt,
  targetLabel,
}: {
  taskId: string;
  sessionId: string;
  tool: AiCliTool;
  cwd: string;
  prompt: string;
  targetLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [exited, setExited] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    const bridge = window.anttodoDesktop?.aiWork?.terminal;
    const host = hostRef.current;
    if (!bridge || !host) {
      setError("终端仅在桌面版可用");
      return;
    }
    let disposed = false;
    setError("");
    setExited(false);
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: "#171717",
        foreground: "#f4f4f4",
        cursor: "#4772fa",
        selectionBackground: "#4772fa66",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    const removeData = bridge.onData(sessionId, (data) => terminal.write(data));
    const removeExit = bridge.onExit(sessionId, () => {
      untrackAiTerminalSession(sessionId);
      if (!disposed) setExited(true);
    });
    const input = terminal.onData((data) => void bridge.write(sessionId, data));
    const resize = new ResizeObserver(() => {
      fit.fit();
      void bridge.resize(sessionId, terminal.cols, terminal.rows);
    });
    resize.observe(host);

    void bridge.start({
      sessionId,
      tool,
      cwd,
      prompt,
      cols: terminal.cols,
      rows: terminal.rows,
    }).then((result) => {
      if (disposed) return;
      if (result.buffer) terminal.write(result.buffer);
      setExited(!result.running);
      if (result.running) trackAiTerminalSession(taskId, sessionId);
      else untrackAiTerminalSession(sessionId);
      terminal.focus();
    }).catch((cause) => {
      untrackAiTerminalSession(sessionId);
      if (!disposed) setError(cause instanceof Error ? cause.message : "终端启动失败");
    });

    return () => {
      disposed = true;
      resize.disconnect();
      input.dispose();
      removeData();
      removeExit();
      terminal.dispose();
    };
  }, [cwd, prompt, restartKey, sessionId, taskId, tool]);

  async function restart() {
    const bridge = window.anttodoDesktop?.aiWork?.terminal;
    if (!bridge) return;
    untrackAiTerminalSession(sessionId);
    await bridge.stop(sessionId);
    setRestartKey((value) => value + 1);
  }

  return (
    <section className="task-cli-terminal" aria-label={`${targetLabel}终端`}>
      {(error || exited) && (
        <header>
          <button type="button" onClick={() => void restart()}>
            <RefreshCw /> 重试
          </button>
        </header>
      )}
      {error ? (
        <div className="task-cli-terminal-error" role="alert">
          <strong>无法启动终端</strong>
          <p>{error}</p>
          <p>请确认 AI 助理工作目录有效，并已安装 {aiCliLabel(tool)} CLI。</p>
          <div>
            <button type="button" onClick={() => requestAiWorkSettings()}>重新配置</button>
            <button type="button" onClick={() => void restart()}>重试</button>
          </div>
        </div>
      ) : (
        <div className="task-cli-terminal-host" ref={hostRef} />
      )}
    </section>
  );
}
