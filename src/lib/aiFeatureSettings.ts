import {
  DEFAULT_SMART_FORMAT_INSTRUCTION,
  normalizeAiPromptOverride,
} from "../../supabase/functions/_shared/ai-feature-prompts";
import type { AiFeatureSettings } from "../types";

export type AiFeatureId = "smart_format";

export const AI_FEATURE_OPTIONS: Array<{
  id: AiFeatureId;
  label: string;
  description: string;
  enabledKey: "smart_format_enabled";
  promptKey: "smart_format_prompt_override";
  defaultInstruction: string;
}> = [
  {
    id: "smart_format",
    label: "智能格式化",
    description: "整理任务标题、正文、截止时间、验收标准和参考资料。",
    enabledKey: "smart_format_enabled",
    promptKey: "smart_format_prompt_override",
    defaultInstruction: DEFAULT_SMART_FORMAT_INSTRUCTION,
  },
];

export function createDefaultAiFeatureSettings(userId: string): AiFeatureSettings {
  return {
    user_id: userId,
    smart_format_enabled: true,
    smart_format_prompt_override: null,
  };
}

export function normalizeAiFeatureSettings(
  settings: AiFeatureSettings,
): AiFeatureSettings {
  return {
    ...settings,
    smart_format_prompt_override: normalizeAiPromptOverride(
      settings.smart_format_prompt_override,
    ),
  };
}
