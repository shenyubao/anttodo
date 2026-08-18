export const AI_PROMPT_OVERRIDE_MAX_LENGTH = 8000;

export const DEFAULT_SMART_FORMAT_INSTRUCTION = `请把任务整理为更规范的结构化建议，供用户确认后再采纳。

保持原意与事实边界，优化标题和正文的表达与层次；从原文中提取截止时间、验收标准和参考资料，不要添加原文没有的事实与需求。`;

export const DEFAULT_TASK_DECOMPOSE_INSTRUCTION = `请基于父任务标题与描述中的事实内容，归纳整理出可执行的子级任务建议。

- 只从原文已有信息中提取、归纳、重组；不要凭空补充步骤、目标、风险、验收或交付物。
- 优先识别原文中的清单项、分点、阶段、交付物和明确动作，并总结为独立子级任务。
- 信息不足时少拆，不要为凑数量编造通用流程。
- 描述为空或几乎无可用信息时，最多基于标题生成 1～2 条直接可执行项；仍不确定时只输出与标题最贴近的一条。`;

export type AiPromptContact = {
  user_id: string;
  display_name: string;
};

export function normalizeAiPromptOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AI_PROMPT_OVERRIDE_MAX_LENGTH);
}

export function effectiveSmartFormatInstruction(value: unknown) {
  return normalizeAiPromptOverride(value) ?? DEFAULT_SMART_FORMAT_INSTRUCTION;
}

export function effectiveTaskDecomposeInstruction(value: unknown) {
  return normalizeAiPromptOverride(value) ?? DEFAULT_TASK_DECOMPOSE_INSTRUCTION;
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

export function buildTaskDecomposePrompt(input: {
  instruction?: string | null;
  title: string;
  description: string;
  existingTasks: string[];
  contacts: AiPromptContact[];
  nowIso: string;
  timeZone: string;
}) {
  const contactLines = input.contacts.length
    ? input.contacts
      .map((contact) => `- ${contact.display_name} (user_id: ${contact.user_id})`)
      .join("\n")
    : "(无可用联系人)";
  const existing = input.existingTasks.length
    ? input.existingTasks.map((title) => `- ${title}`).join("\n")
    : "(暂无子级任务)";

  return `业务指令：
${effectiveTaskDecomposeInstruction(input.instruction)}

固定输出协议：
1. 只输出 JSON（不要 markdown 代码块），格式为 {"tasks":[{"title":"...","assignee_user_id":null,"due_at":null},...]}。
2. 生成 1～12 条；title 必填，简洁可执行，中文优先，不超过 60 字。
3. assignee_user_id 只能填写「组织联系人」中的 user_id，且仅当任务原文明确提到该人或可唯一对应；否则为 null。
4. due_at 仅在任务原文出现截止或时间表述时填写 ISO 8601；不确定则为 null。若只有日期，用该日本地上午 09:00 再转 ISO。
5. 不得重复「已有子级任务」中的标题，也不得只改写已有标题后再次输出。
6. 结合当前时间与时区理解「今天、明天、下周」等表述。

当前时间：${input.nowIso}
时区：${input.timeZone}

父任务标题：
${input.title}

父任务描述：
${input.description || "(无描述)"}

已有子级任务：
${existing}

组织联系人：
${contactLines}`;
}
