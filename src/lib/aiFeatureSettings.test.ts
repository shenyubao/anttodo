import { describe, expect, it } from "vitest";
import {
  buildSmartFormatPrompt,
  DEFAULT_SMART_FORMAT_INSTRUCTION,
  normalizeAiPromptOverride,
} from "../../supabase/functions/_shared/ai-feature-prompts";
import {
  createDefaultAiFeatureSettings,
  normalizeAiFeatureSettings,
} from "./aiFeatureSettings";

describe("AI feature settings", () => {
  it("defaults smart formatting to enabled", () => {
    const settings = createDefaultAiFeatureSettings("user-1");
    expect(settings).toMatchObject({
      smart_format_enabled: true,
      smart_format_prompt_override: null,
    });
  });

  it("normalizes blank prompt overrides back to defaults", () => {
    const settings = normalizeAiFeatureSettings({
      ...createDefaultAiFeatureSettings("user-1"),
      smart_format_prompt_override: "   ",
    });
    expect(settings.smart_format_prompt_override).toBeNull();
    expect(normalizeAiPromptOverride(undefined)).toBeNull();
  });

  it("uses default business instructions when no override exists", () => {
    expect(buildSmartFormatPrompt({
      title: "整理发布计划",
      description: "周五前完成",
      nowIso: "2026-08-09T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
    })).toContain(DEFAULT_SMART_FORMAT_INSTRUCTION);
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
});
