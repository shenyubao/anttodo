import type { OutputFormat } from "./types.js";
import { asCliError } from "./errors.js";

export type SuccessEnvelope = {
  ok: true;
  data: unknown;
  meta: Record<string, unknown>;
};

function rowsFrom(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item) => item && typeof item === "object"
      ? item as Record<string, unknown>
      : { value: item });
  }
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [{ value: data }];
}

function scalar(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvCell(value: unknown) {
  const text = scalar(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderSuccess(
  data: unknown,
  meta: Record<string, unknown>,
  format: OutputFormat,
) {
  const envelope: SuccessEnvelope = { ok: true, data, meta };
  if (format === "json") return `${JSON.stringify(envelope)}\n`;
  if (format === "pretty") return `${JSON.stringify(envelope, null, 2)}\n`;
  const rows = rowsFrom(data);
  if (format === "ndjson") {
    return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`;
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (format === "csv") {
    return `${[
      headers.map(csvCell).join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    ].join("\n")}\n`;
  }
  if (!headers.length) return "\n";
  const widths = headers.map((header) => Math.max(
    header.length,
    ...rows.map((row) => scalar(row[header]).length),
  ));
  const line = (values: string[]) => values
    .map((value, index) => value.padEnd(widths[index]))
    .join("  ")
    .trimEnd();
  return `${line(headers)}\n${line(widths.map((width) => "-".repeat(width)))}\n${rows
    .map((row) => line(headers.map((header) => scalar(row[header]))))
    .join("\n")}\n`;
}

export function renderError(error: unknown, pretty = false) {
  const cliError = asCliError(error);
  const envelope = {
    ok: false,
    error: {
      type: cliError.type,
      code: cliError.code,
      message: cliError.message,
      ...(cliError.hint ? { hint: cliError.hint } : {}),
      ...(cliError.details !== undefined ? { details: cliError.details } : {}),
    },
  };
  return {
    text: `${JSON.stringify(envelope, null, pretty ? 2 : undefined)}\n`,
    exitCode: cliError.exitCode,
  };
}
