import { addDays, addMonths, addYears, getDaysInMonth } from "date-fns";
import type { DateFormat } from "../types";

export type DateSegmentKind = "year" | "month" | "day";

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type ApplyDateSegmentDigitResult = {
  parts: DateParts;
  buffer: string;
  advance: boolean;
};

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MIN = 1;
const YEAR_MAX = 9999;

export function parseDateInput(value: string): DateParts | null {
  const match = DATE_INPUT_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  return clampDateParts({ year, month, day });
}

export function formatDateParts(parts: DateParts): string {
  const clamped = clampDateParts(parts);
  return [
    String(clamped.year).padStart(4, "0"),
    String(clamped.month).padStart(2, "0"),
    String(clamped.day).padStart(2, "0"),
  ].join("-");
}

export function clampDateParts(parts: DateParts): DateParts {
  const year = clampNumber(parts.year, YEAR_MIN, YEAR_MAX);
  const month = clampNumber(parts.month, 1, 12);
  const maxDay = daysInMonth(year, month);
  const day = clampNumber(parts.day, 1, maxDay);
  return { year, month, day };
}

export function dateSegmentOrder(dateFormat: DateFormat): DateSegmentKind[] {
  if (dateFormat === "mdy") return ["month", "day", "year"];
  if (dateFormat === "dmy") return ["day", "month", "year"];
  return ["year", "month", "day"];
}

export function dateSegmentLimits(kind: DateSegmentKind, parts: DateParts) {
  if (kind === "year") return { min: YEAR_MIN, max: YEAR_MAX, maxDigits: 4 };
  if (kind === "month") return { min: 1, max: 12, maxDigits: 2 };
  return { min: 1, max: daysInMonth(parts.year, parts.month), maxDigits: 2 };
}

export function formatDateSegment(
  parts: DateParts,
  kind: DateSegmentKind,
  buffer = "",
) {
  const { maxDigits } = dateSegmentLimits(kind, parts);
  const raw = buffer || String(parts[kind]);
  return raw.padStart(maxDigits, "0");
}

export function adjacentDateSegment(
  dateFormat: DateFormat,
  kind: DateSegmentKind,
  direction: -1 | 1,
): DateSegmentKind {
  const order = dateSegmentOrder(dateFormat);
  const index = order.indexOf(kind);
  return order[(index + direction + order.length) % order.length]!;
}

export function incrementDateSegment(
  parts: DateParts,
  kind: DateSegmentKind,
  delta: number,
): DateParts {
  const current = toLocalDate(clampDateParts(parts));
  const next =
    kind === "year"
      ? addYears(current, delta)
      : kind === "month"
        ? addMonths(current, delta)
        : addDays(current, delta);
  return clampDateParts({
    year: next.getFullYear(),
    month: next.getMonth() + 1,
    day: next.getDate(),
  });
}

export function applyDateSegmentDigit(
  parts: DateParts,
  kind: DateSegmentKind,
  buffer: string,
  digit: string,
): ApplyDateSegmentDigitResult {
  if (!/^\d$/.test(digit)) {
    return { parts: clampDateParts(parts), buffer, advance: false };
  }

  const limits = dateSegmentLimits(kind, parts);
  let nextBuffer = `${buffer}${digit}`.replace(/\D/g, "");
  if (nextBuffer.length > limits.maxDigits) {
    nextBuffer = nextBuffer.slice(-limits.maxDigits);
  }

  const parsed = Number(nextBuffer);
  const committed = parsed === 0 ? limits.min : Math.min(limits.max, parsed);
  const nextParts = clampDateParts({ ...parts, [kind]: committed });
  const filled = nextBuffer.length >= limits.maxDigits;
  const cannotGrow = parsed !== 0 && parsed * 10 > limits.max;
  const advance = filled || cannotGrow;

  return {
    parts: nextParts,
    buffer: advance ? "" : nextBuffer,
    advance,
  };
}

export function applyDateSegmentBackspace(
  parts: DateParts,
  kind: DateSegmentKind,
  buffer: string,
): { parts: DateParts; buffer: string } {
  if (buffer.length > 0) {
    const nextBuffer = buffer.slice(0, -1);
    if (!nextBuffer) {
      return { parts: clampDateParts({ ...parts, [kind]: dateSegmentLimits(kind, parts).min }), buffer: "" };
    }
    const parsed = Number(nextBuffer);
    const limits = dateSegmentLimits(kind, parts);
    const committed = parsed === 0 ? limits.min : Math.min(limits.max, parsed);
    return { parts: clampDateParts({ ...parts, [kind]: committed }), buffer: nextBuffer };
  }

  const current = String(parts[kind]);
  if (current.length <= 1) {
    return { parts: clampDateParts({ ...parts, [kind]: dateSegmentLimits(kind, parts).min }), buffer: "" };
  }
  return applyDateSegmentBackspace(parts, kind, current);
}

function daysInMonth(year: number, month: number) {
  return getDaysInMonth(new Date(year, month - 1, 1));
}

function toLocalDate(parts: DateParts) {
  return new Date(parts.year, parts.month - 1, parts.day);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
