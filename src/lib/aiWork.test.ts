import { describe, expect, it } from "vitest";
import {
  aiWorkSettingsTitleFromEvent,
  buildSubtaskCliPrompt,
  buildTaskCliPrompt,
  isAiWorkConfigured,
  sameAssignee,
  subtaskTerminalSessionKey,
  taskTerminalSessionKey,
} from "./aiWork";

describe("AI work helpers", () => {
  it("builds a top-level prompt from the task title and description", () => {
    const prompt = buildTaskCliPrompt({ title: "修复登录", description: "补充回归测试" });
    expect(prompt).toContain("请处理如下待办。");
    expect(prompt).toContain("标题：修复登录\n描述：\n补充回归测试");
  });

  it("omits the description line when the task has no description", () => {
    const prompt = buildTaskCliPrompt({ title: "标签可移动顺序", description: "" });
    expect(prompt).toBe("请处理如下待办。\n\n标题：标签可移动顺序");
    expect(prompt).not.toContain("描述");
  });

  it("limits a subtask prompt to parent context and the selected subtask", () => {
    const prompt = buildSubtaskCliPrompt(
      { title: "发布桌面版", description: "准备 1.2.0" },
      { title: "验证 arm64 安装包" },
    );
    expect(prompt).toContain("父任务标题：发布桌面版");
    expect(prompt).toContain("父任务描述：\n准备 1.2.0");
    expect(prompt).toContain("当前子任务：验证 arm64 安装包");
    expect(prompt).toContain("请只处理");
  });

  it("omits parent description from a subtask prompt when empty", () => {
    const prompt = buildSubtaskCliPrompt(
      { title: "发布桌面版", description: "  " },
      { title: "验证 arm64 安装包" },
    );
    expect(prompt).toContain("父任务标题：发布桌面版");
    expect(prompt).not.toContain("父任务描述");
    expect(prompt).toContain("当前子任务：验证 arm64 安装包");
  });

  it("uses stable independent session keys", () => {
    expect(taskTerminalSessionKey("one")).toBe("task:one");
    expect(subtaskTerminalSessionKey("one")).toBe("subtask:one");
  });

  it("compares user and CLI targets without conflating them", () => {
    expect(sameAssignee({ kind: "cli", tool: "codex" }, { kind: "cli", tool: "codex" }))
      .toBe(true);
    expect(sameAssignee({ kind: "cli", tool: "codex" }, { kind: "user", userId: "codex" }))
      .toBe(false);
  });

  it("reads an optional title from the settings open event", () => {
    expect(aiWorkSettingsTitleFromEvent(new Event("x"))).toBe("设置 AI 助理");
    expect(aiWorkSettingsTitleFromEvent(
      new CustomEvent("x", { detail: { title: "产品" } }),
    )).toBe("产品");
  });

  it("treats tools plus a working path as configured", () => {
    expect(isAiWorkConfigured({ cli_tools: [], default_working_path: "/tmp" })).toBe(false);
    expect(isAiWorkConfigured({ cli_tools: ["codex"], default_working_path: null })).toBe(false);
    expect(isAiWorkConfigured({ cli_tools: ["codex"], default_working_path: "/tmp" })).toBe(true);
  });
});
