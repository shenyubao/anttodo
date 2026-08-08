const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

export type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekChatOptions = {
  messages: DeepSeekChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string };
};

export function deepseekConfig() {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY")?.trim();
  if (!apiKey) {
    throw new Error("DeepSeek is not configured");
  }
  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL")?.trim() || DEFAULT_BASE_URL)
    .replace(/\/+$/, "");
  const model = Deno.env.get("DEEPSEEK_MODEL")?.trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

export async function deepseekChatCompletion(options: DeepSeekChatOptions): Promise<string> {
  const { apiKey, baseUrl, model } = deepseekConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model ?? model,
      messages: options.messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 2048,
      thinking: { type: "disabled" },
      ...(options.responseFormat
        ? { response_format: options.responseFormat }
        : {}),
    }),
  });

  const payload = await response.json().catch(() => null) as ChatCompletionResponse | null;
  if (!response.ok) {
    const message = payload?.error?.message?.trim() || `DeepSeek request failed (${response.status})`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek returned an empty response");
  }
  return content;
}

/** Extract a JSON value from a model reply that may be fenced or wrapped. */
export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");
  if (arrayStart === -1 && objectStart === -1) return trimmed;
  if (arrayStart === -1) return trimmed.slice(objectStart);
  if (objectStart === -1) return trimmed.slice(arrayStart);
  return trimmed.slice(Math.min(arrayStart, objectStart));
}
