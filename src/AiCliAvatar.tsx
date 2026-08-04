import clsx from "clsx";
import { aiCliLabel } from "./lib/aiWork";
import type { AiCliTool } from "./types";

function CodexMark() {
  // OpenAI blossom mark used for Codex.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .517 4.91 6.051 6.051 0 0 0 6.511 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.814 3.354-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.844-3.369L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.78-2.742a.766.766 0 0 0-.78 0L9.41 9.27V6.938a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135L6.27 11.7l-.02-.012V9.243a.08.08 0 0 1 .033-.062l4.83-2.787a.769.769 0 0 1 .78 0l4.83 2.787a.08.08 0 0 1 .033.062v5.579l-.02.01-4.83 2.787a.775.775 0 0 1-.78 0z"
      />
    </svg>
  );
}

function ClaudeMark() {
  // Anthropic-style asterisk mark used for Claude.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.8 2.4a.8.8 0 0 0-1.6 0v4.55L8.07 3.82a.8.8 0 1 0-1.13 1.13l3.13 3.13H5.5a.8.8 0 0 0 0 1.6h4.57L7 12.8a.8.8 0 1 0 1.13 1.13l3.07-3.07v4.54a.8.8 0 0 0 1.6 0v-4.54l3.07 3.07a.8.8 0 1 0 1.13-1.13l-3.07-3.07H18.5a.8.8 0 0 0 0-1.6h-4.57l3.13-3.13a.8.8 0 1 0-1.13-1.13L12.8 6.95V2.4Z"
      />
    </svg>
  );
}

export function AiCliAvatar({
  tool,
  className,
  title,
}: {
  tool: AiCliTool;
  className?: string;
  title?: string;
}) {
  const label = title ?? `负责人：${aiCliLabel(tool)}`;
  return (
    <span
      className={clsx("ai-cli-avatar", `ai-cli-avatar-${tool}`, className)}
      title={label}
      aria-label={label}
    >
      {tool === "codex" ? <CodexMark /> : <ClaudeMark />}
    </span>
  );
}
