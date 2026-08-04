export type CliErrorType =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "api"
  | "configuration"
  | "confirmation_required";

export class CliError extends Error {
  readonly type: CliErrorType;
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly exitCode: number;

  constructor(input: {
    type: CliErrorType;
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
    exitCode?: number;
  }) {
    super(input.message);
    this.name = "CliError";
    this.type = input.type;
    this.code = input.code;
    this.hint = input.hint;
    this.details = input.details;
    this.exitCode = input.exitCode ?? (input.type === "authentication" ? 2 : 1);
  }
}

export function asCliError(error: unknown) {
  if (error instanceof CliError) return error;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  return new CliError({
    type: "api",
    code: typeof value?.code === "string" ? value.code : "unexpected_error",
    message: typeof value?.message === "string" ? value.message : "Unexpected error",
    details: value?.details,
  });
}
