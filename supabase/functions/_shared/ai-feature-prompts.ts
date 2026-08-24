export const AI_PROMPT_OVERRIDE_MAX_LENGTH = 8000;

export const DEFAULT_SMART_FORMAT_INSTRUCTION = `请把任务整理为更规范的结构化建议，供用户确认后再采纳。

保持原意与事实边界，优化标题和正文的表达与层次；从原文中提取截止时间、验收标准和参考资料，不要添加原文没有的事实与需求。`;

export function normalizeAiPromptOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AI_PROMPT_OVERRIDE_MAX_LENGTH);
}

export function effectiveSmartFormatInstruction(value: unknown) {
  return normalizeAiPromptOverride(value) ?? DEFAULT_SMART_FORMAT_INSTRUCTION;
}

export function buildSmartFormatPrompt(input: {
  instruction?: string | null;
  title: string;
  description: string;
  nowIso: string;
  timeZone: string;
}) {
  return `业务指令：
${effectiveSmartFormatInstruction(input.instruction)}

固定输出协议：
1. 只输出 JSON（不要 markdown 代码块），格式为：
{"title":"...","description":"...","due_at":null,"acceptance_criteria":null,"references":null}
2. title 必填，简明扼要，中文优先，不超过 60 字。
3. description 为正文说明，使用 Markdown 语法组织，结构清晰、层次分明；不含单独的「验收标准」「参考资料」小节；可为空字符串。
4. 若原文能识别截止时间，due_at 使用 ISO 8601 字符串；不确定则 null。若只有日期，用该日本地上午 09:00 再转 ISO。
5. 原文中的验收标准写入 acceptance_criteria，没有则为 null。
6. 原文中的参考资料、链接或文档写入 references，没有则为 null。
7. 结合当前时间与时区理解「今天、明天、下周」等表述。

当前时间：${input.nowIso}
时区：${input.timeZone}

任务标题：
${input.title}

任务描述：
${input.description || "(无描述)"}`;
}
