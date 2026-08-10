import {
  DEFAULT_SMART_FORMAT_INSTRUCTION,
  DEFAULT_SUBTASK_DECOMPOSE_INSTRUCTION,
  normalizeAiPromptOverride,
} from "../../supabase/functions/_shared/ai-feature-prompts";
import type { AiFeatureSettings } from "../types";

export type AiFeatureId = "smart_format" | "subtask_decompose";

export const AI_FEATURE_OPTIONS: Array<{
  id: AiFeatureId;
  label: string;
  description: string;
  enabledKey: "smart_format_enabled" | "subtask_decompose_enabled";
  promptKey: "smart_format_prompt_override" | "subtask_decompose_prompt_override";
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
  {
    id: "subtask_decompose",
    label: "智能分解子任务",
    description: "根据任务内容提取可执行的子任务建议。",
    enabledKey: "subtask_decompose_enabled",
    promptKey: "subtask_decompose_prompt_override",
    defaultInstruction: DEFAULT_SUBTASK_DECOMPOSE_INSTRUCTION,
  },
];

export function createDefaultAiFeatureSettings(userId: string): AiFeatureSettings {
  return {
    user_id: userId,
    smart_format_enabled: true,
    smart_format_prompt_override: null,
    subtask_decompose_enabled: true,
    subtask_decompose_prompt_override: null,
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
    subtask_decompose_prompt_override: normalizeAiPromptOverride(
      settings.subtask_decompose_prompt_override,
    ),
  };
}

export function hasEnabledAiFeature(settings: AiFeatureSettings) {
  return settings.smart_format_enabled || settings.subtask_decompose_enabled;
}
