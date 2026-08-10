import { describe, expect, it } from "vitest";
import {
  buildSmartFormatPrompt,
  buildSubtaskDecomposePrompt,
  DEFAULT_SMART_FORMAT_INSTRUCTION,
  DEFAULT_SUBTASK_DECOMPOSE_INSTRUCTION,
  normalizeAiPromptOverride,
} from "../../supabase/functions/_shared/ai-feature-prompts";
import {
  createDefaultAiFeatureSettings,
  hasEnabledAiFeature,
  normalizeAiFeatureSettings,
} from "./aiFeatureSettings";

describe("AI feature settings", () => {
  it("defaults both existing features to enabled", () => {
    const settings = createDefaultAiFeatureSettings("user-1");
    expect(settings).toMatchObject({
      smart_format_enabled: true,
      smart_format_prompt_override: null,
      subtask_decompose_enabled: true,
      subtask_decompose_prompt_override: null,
    });
    expect(hasEnabledAiFeature(settings)).toBe(true);
  });

  it("normalizes blank prompt overrides back to defaults", () => {
    const settings = normalizeAiFeatureSettings({
      ...createDefaultAiFeatureSettings("user-1"),
      smart_format_prompt_override: "   ",
      subtask_decompose_prompt_override: "  先提取明确动作  ",
    });
    expect(settings.smart_format_prompt_override).toBeNull();
    expect(settings.subtask_decompose_prompt_override).toBe("先提取明确动作");
    expect(normalizeAiPromptOverride(undefined)).toBeNull();
  });

  it("uses default business instructions when no override exists", () => {
    expect(buildSmartFormatPrompt({
      title: "整理发布计划",
      description: "周五前完成",
      nowIso: "2026-08-09T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).toContain(DEFAULT_SMART_FORMAT_INSTRUCTION);
    expect(buildSubtaskDecomposePrompt({
      title: "整理发布计划",
      description: "周五前完成",
      existingSubtasks: [],
      contacts: [],
      nowIso: "2026-08-09T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).toContain(DEFAULT_SUBTASK_DECOMPOSE_INSTRUCTION);
  });

  it("keeps the protected format contract and task context with a custom instruction", () => {
    const prompt = buildSmartFormatPrompt({
      instruction: "用简洁、直接的语气整理",
      title: "修复登录",
      description: "补充回归测试",
      nowIso: "2026-08-09T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
    });
    expect(prompt).toContain("用简洁、直接的语气整理");
    expect(prompt).not.toContain(DEFAULT_SMART_FORMAT_INSTRUCTION);
    expect(prompt).toContain("固定输出协议");
    expect(prompt).toContain('{"title":"...","description":"..."');
    expect(prompt).toContain("任务标题：\n修复登录");
    expect(prompt).toContain("任务描述：\n补充回归测试");
  });

  it("keeps contacts and existing subtasks outside a custom decompose instruction", () => {
    const prompt = buildSubtaskDecomposePrompt({
      instruction: "按交付物拆分",
      title: "发布版本",
      description: "小王负责安装包",
      existingSubtasks: ["更新版本号"],
      contacts: [{ user_id: "user-2", display_name: "小王" }],
      nowIso: "2026-08-09T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
    });
    expect(prompt).toContain("按交付物拆分");
    expect(prompt).not.toContain(DEFAULT_SUBTASK_DECOMPOSE_INSTRUCTION);
    expect(prompt).toContain("固定输出协议");
    expect(prompt).toContain("已有子任务：\n- 更新版本号");
    expect(prompt).toContain("小王 (user_id: user-2)");
  });
});
