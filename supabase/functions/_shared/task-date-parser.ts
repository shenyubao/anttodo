import { addDays, format, getDay, startOfDay } from "date-fns";
import {
  fromZonedDateTime,
  systemTimeZone,
  toDateInput,
  zonedDate,
} from "./time-zone-core.ts";

type DueFields = {
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
};

export type ParsedTaskDateMatch = {
  start: number;
  end: number;
  text: string;
};

export type ParsedTaskDate = {
  match: ParsedTaskDateMatch;
  title: string;
  due: DueFields & { due_timezone: string };
  label: string;
};

export type ParsedTaskDue = DueFields & { due_timezone: string };

type TimeParts = { hours: number; minutes: number };

type FloatingMonthDay = { month: number | null; day: number };

type Candidate = {
  start: number;
  end: number;
  text: string;
  date: Date;
  time: TimeParts | null;
  label: string;
  floating?: FloatingMonthDay;
  rangeEnd?: { date: Date; time: TimeParts | null };
};

const RANGE_SEPARATOR = /^\s*(?:到|至|~|～|—|–)\s*$/;

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const TIME_BODY =
  String.raw`(?:\d{1,2}[:：]\d{1,2}|[0-9一二两三四五六七八九十]+点(?:半|[0-9一二两三四五六七八九十]+分?)?)`;
const PERIOD = String.raw`(?:早上|早晨|上午|中午|下午|晚上|傍晚|凌晨)`;
const TIME_TOKEN = String.raw`(?:${PERIOD})?${TIME_BODY}`;

function parseNumberToken(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  if (raw.length === 1 && raw in CN_DIGIT) return CN_DIGIT[raw]!;
  if (raw.startsWith("十") && raw.length === 2) {
    const ones = CN_DIGIT[raw[1]!];
    return ones == null ? null : 10 + ones;
  }
  if (raw.endsWith("十") && raw.length === 2) {
    const tens = CN_DIGIT[raw[0]!];
    return tens == null ? null : tens * 10;
  }
  if (raw.includes("十") && raw.length === 3) {
    const tens = CN_DIGIT[raw[0]!];
    const ones = CN_DIGIT[raw[2]!];
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  return null;
}

function applyPeriod(hours: number, period: string): number {
  if (!period) return hours;
  if (period === "中午") return hours === 12 ? 12 : hours < 12 ? (hours === 0 ? 12 : hours) : 12;
  if (period === "凌晨") return hours === 12 ? 0 : hours;
  if (period === "晚上" || period === "傍晚" || period === "下午") {
    if (hours === 12) return 12;
    if (hours < 12) return hours + 12;
    return hours;
  }
  if (hours === 12) return 0;
  return hours;
}

function parseClock(raw: string): TimeParts | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const colon = trimmed.match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (colon) {
    const hours = Number(colon[1]);
    const minutes = Number(colon[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  const periodMatch = trimmed.match(
    /^(早上|早晨|上午|中午|下午|晚上|傍晚|凌晨)?(.+)$/,
  );
  if (!periodMatch) return null;
  const period = periodMatch[1] ?? "";
  const rest = periodMatch[2]!;

  const half = rest.match(/^([0-9一二两三四五六七八九十]+)点半$/);
  if (half) {
    const hours = parseNumberToken(half[1]!);
    if (hours == null || hours > 23) return null;
    return { hours: applyPeriod(hours, period), minutes: 30 };
  }

  const full = rest.match(
    /^([0-9一二两三四五六七八九十]+)点(?:([0-9一二两三四五六七八九十]+)分?)?$/,
  );
  if (full) {
    const hours = parseNumberToken(full[1]!);
    const minutes = full[2] ? parseNumberToken(full[2]) : 0;
    if (hours == null || minutes == null || hours > 23 || minutes > 59) return null;
    return { hours: applyPeriod(hours, period), minutes };
  }

  return null;
}

function stripMatch(text: string, start: number, end: number) {
  return `${text.slice(0, start)}${text.slice(end)}`
    .replace(/\s{2,}/g, " ")
    .trim();
}

function allDayDue(date: Date, timeZone: string): ParsedTaskDue {
  const key = toDateInput(date, timeZone);
  const start = fromZonedDateTime(key, "00:00", timeZone);
  const end = fromZonedDateTime(key, "23:59", timeZone);
  end.setSeconds(59, 999);
  return {
    due_start_at: start.toISOString(),
    due_at: end.toISOString(),
    due_is_all_day: true,
    due_timezone: timeZone,
  };
}

function timedDue(date: Date, time: TimeParts, timeZone: string): ParsedTaskDue {
  const key = toDateInput(date, timeZone);
  const dueAt = fromZonedDateTime(
    key,
    `${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}`,
    timeZone,
  );
  return {
    due_at: dueAt.toISOString(),
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: timeZone,
  };
}

function formatTimeLabel(time: TimeParts) {
  return `${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}`;
}

function nextWeekday(from: Date, targetWeekday: number, nextWeeks: number) {
  const current = getDay(from);
  const delta = (targetWeekday - current + 7) % 7 + 7 * nextWeeks;
  return addDays(startOfDay(from), delta);
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const candidate = new Date(year, month - 1, day);
  if (Number.isNaN(candidate.getTime()) || candidate.getDate() !== day) return null;
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1) return null;
  return startOfDay(candidate);
}

function resolveRangeMonthDays(
  now: Date,
  start: FloatingMonthDay,
  end: FloatingMonthDay,
): { startDate: Date; endDate: Date } | null {
  const year = now.getFullYear();
  const startMonth = start.month ?? now.getMonth() + 1;
  const endMonth = end.month ?? now.getMonth() + 1;
  let startDate = calendarDate(year, startMonth, start.day);
  let endDate = calendarDate(year, endMonth, end.day);
  if (!startDate || !endDate) return null;
  if (startDate.getTime() > endDate.getTime()) {
    endDate = calendarDate(year + 1, endMonth, end.day);
    if (!endDate) return null;
  } else if (endDate.getTime() < startOfDay(now).getTime()) {
    startDate = calendarDate(year + 1, startMonth, start.day);
    endDate = calendarDate(year + 1, endMonth, end.day);
    if (!startDate || !endDate) return null;
  }
  return { startDate, endDate };
}

function formatCandidateLabel(date: Date, time: TimeParts | null) {
  const dayLabel = format(date, "M月d日");
  return time ? `${dayLabel} ${formatTimeLabel(time)}` : dayLabel;
}

function isChronologicalRange(
  startDate: Date,
  endDate: Date,
  startTime: TimeParts | null,
  endTime: TimeParts | null,
) {
  if (startDate.getTime() < endDate.getTime()) return true;
  if (startDate.getTime() > endDate.getTime()) return false;
  const startMinutes = startTime ? startTime.hours * 60 + startTime.minutes : 0;
  const endMinutes = endTime ? endTime.hours * 60 + endTime.minutes : 23 * 60 + 59;
  return startMinutes <= endMinutes;
}

function rangeDue(
  startDate: Date,
  endDate: Date,
  startTime: TimeParts | null,
  endTime: TimeParts | null,
  timeZone: string,
): ParsedTaskDue | null {
  const startKey = toDateInput(startDate, timeZone);
  const endKey = toDateInput(endDate, timeZone);
  const allDay = !startTime && !endTime;
  const start = startTime
    ? fromZonedDateTime(
      startKey,
      `${String(startTime.hours).padStart(2, "0")}:${String(startTime.minutes).padStart(2, "0")}`,
      timeZone,
    )
    : fromZonedDateTime(startKey, "00:00", timeZone);
  const end = endTime
    ? fromZonedDateTime(
      endKey,
      `${String(endTime.hours).padStart(2, "0")}:${String(endTime.minutes).padStart(2, "0")}`,
      timeZone,
    )
    : fromZonedDateTime(endKey, "23:59", timeZone);
  if (!endTime) end.setSeconds(59, 999);
  if (start.getTime() > end.getTime()) return null;
  return {
    due_start_at: start.toISOString(),
    due_at: end.toISOString(),
    due_is_all_day: allDay,
    due_timezone: timeZone,
  };
}

function resolveMonthDay(now: Date, month: number | null, day: number) {
  const year = now.getFullYear();
  const baseMonth = month ?? now.getMonth() + 1;
  let candidate = new Date(year, baseMonth - 1, day);
  if (Number.isNaN(candidate.getTime()) || candidate.getDate() !== day) return null;
  const today = startOfDay(now);
  if (month == null) {
    if (startOfDay(candidate) < today) {
      candidate = new Date(year, baseMonth, day);
      if (Number.isNaN(candidate.getTime()) || candidate.getDate() !== day) return null;
    }
  } else if (startOfDay(candidate) < today) {
    candidate = new Date(year + 1, baseMonth - 1, day);
    if (Number.isNaN(candidate.getTime()) || candidate.getDate() !== day) return null;
  }
  return startOfDay(candidate);
}

function collectMatches(
  text: string,
  pattern: RegExp,
  build: (match: RegExpMatchArray, start: number) => Candidate | null,
) {
  const results: Candidate[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue;
    const candidate = build(match, match.index);
    if (candidate) results.push(candidate);
  }
  return results;
}

function findRelativeDayCandidates(text: string, now: Date): Candidate[] {
  const relative: Array<{ pattern: RegExp; days: number; label: string }> = [
    { pattern: new RegExp(String.raw`大后天(${TIME_TOKEN})?`, "g"), days: 3, label: "大后天" },
    { pattern: new RegExp(String.raw`后天(${TIME_TOKEN})?`, "g"), days: 2, label: "后天" },
    { pattern: new RegExp(String.raw`明天(${TIME_TOKEN})?`, "g"), days: 1, label: "明天" },
    { pattern: new RegExp(String.raw`今天(${TIME_TOKEN})?`, "g"), days: 0, label: "今天" },
  ];

  const results: Candidate[] = [];
  for (const item of relative) {
    for (const match of text.matchAll(item.pattern)) {
      if (match.index == null) continue;
      // Avoid "大后天" being matched as "后天"
      if (item.label === "后天" && match.index >= 1 && text[match.index - 1] === "大") continue;
      const dayDate = addDays(startOfDay(now), item.days);
      const timeRaw = match[1];
      if (timeRaw) {
        const time = parseClock(timeRaw);
        if (!time) continue;
        results.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          date: dayDate,
          time,
          label: `${item.label} ${formatTimeLabel(time)}`,
        });
      } else {
        results.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          date: dayDate,
          time: null,
          label: item.label,
        });
      }
    }
  }
  return results;
}

function findDaysLaterCandidates(text: string, now: Date): Candidate[] {
  const pattern = new RegExp(
    String.raw`([0-9一二两三四五六七八九十]+)天(?:之)?后(${TIME_TOKEN})?`,
    "g",
  );
  return collectMatches(text, pattern, (match, start) => {
    const days = parseNumberToken(match[1]!);
    if (days == null || days < 0 || days > 366) return null;
    const dayDate = addDays(startOfDay(now), days);
    const timeRaw = match[2];
    if (timeRaw) {
      const time = parseClock(timeRaw);
      if (!time) return null;
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date: dayDate,
        time,
        label: `${days}天后 ${formatTimeLabel(time)}`,
      };
    }
    return {
      start,
      end: start + match[0].length,
      text: match[0],
      date: dayDate,
      time: null,
      label: `${days}天后`,
    };
  });
}

function findWeekdayCandidates(text: string, now: Date): Candidate[] {
  const pattern = new RegExp(
    String.raw`(下*)(周|星期)([一二三四五六日天])(${TIME_TOKEN})?`,
    "g",
  );
  return collectMatches(text, pattern, (match, start) => {
    const nextWeeks = match[1]!.length;
    const weekday = WEEKDAY_MAP[match[3]!];
    if (weekday == null) return null;
    const date = nextWeekday(now, weekday, nextWeeks);
    const timeRaw = match[4];
    const baseLabel = `${match[1]}${match[2]}${match[3]}`;
    if (timeRaw) {
      const time = parseClock(timeRaw);
      if (!time) return null;
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: `${baseLabel} ${formatTimeLabel(time)}`,
      };
    }
    return {
      start,
      end: start + match[0].length,
      text: match[0],
      date,
      time: null,
      label: baseLabel,
    };
  });
}

function findMonthDayCandidates(text: string, now: Date): Candidate[] {
  const pattern = new RegExp(
    String.raw`(?:([0-9一二两三四五六七八九十]+)月)?([0-9一二两三四五六七八九十]+)([日号])(${TIME_TOKEN})?`,
    "g",
  );
  return collectMatches(text, pattern, (match, start) => {
    const month = match[1] ? parseNumberToken(match[1]) : null;
    const day = parseNumberToken(match[2]!);
    if (day == null || day < 1 || day > 31) return null;
    if (month != null && (month < 1 || month > 12)) return null;
    // Avoid matching bare digits that aren't calendar-ish (e.g. "3天后" handled elsewhere)
    if (!match[1] && match[3] !== "日" && match[3] !== "号") return null;
    const date = resolveMonthDay(now, month, day);
    if (!date) return null;
    const timeRaw = match[4];
    const floating = { month, day };
    if (timeRaw) {
      const time = parseClock(timeRaw);
      if (!time) return null;
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: `${format(date, "M月d日")} ${formatTimeLabel(time)}`,
        floating,
      };
    }
    return {
      start,
      end: start + match[0].length,
      text: match[0],
      date,
      time: null,
      label: format(date, "M月d日"),
      floating,
    };
  });
}

function resolveAbsoluteDate(year: number, month: number, day: number): Date | null {
  if (year < 1970 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(year, month - 1, day);
  if (Number.isNaN(candidate.getTime()) || candidate.getDate() !== day) return null;
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1) return null;
  return startOfDay(candidate);
}

function findNumericDateCandidates(text: string): Candidate[] {
  // Require a 4-digit year so version-like tokens ("3.60") are not treated as dates.
  const pattern = new RegExp(
    String.raw`(?<![\d./-])(\d{4})([./-])(\d{1,2})\2(\d{1,2})(?![\d./-])(?:\s*(${TIME_TOKEN}))?`,
    "g",
  );
  return collectMatches(text, pattern, (match, start) => {
    const year = Number(match[1]);
    const month = Number(match[3]);
    const day = Number(match[4]);
    const date = resolveAbsoluteDate(year, month, day);
    if (!date) return null;
    const timeRaw = match[5];
    const labelDate = format(date, "yyyy-M-d");
    if (timeRaw) {
      const time = parseClock(timeRaw);
      if (!time) return null;
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: `${labelDate} ${formatTimeLabel(time)}`,
      };
    }
    return {
      start,
      end: start + match[0].length,
      text: match[0],
      date,
      time: null,
      label: labelDate,
    };
  });
}

function findStandaloneTimeCandidates(text: string, now: Date): Candidate[] {
  const results: Candidate[] = [];

  const tonight = collectMatches(
    text,
    new RegExp(String.raw`今晚(${TIME_BODY})?`, "g"),
    (match, start) => {
      const time = parseClock(match[1] ? `晚上${match[1]}` : "晚上8点");
      if (!time) return null;
      let date = startOfDay(now);
      const at = startOfDay(now);
      at.setHours(time.hours, time.minutes, 0, 0);
      if (at.getTime() < now.getTime()) date = addDays(date, 1);
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: formatTimeLabel(time),
      };
    },
  );
  results.push(...tonight);

  const withPeriod = collectMatches(
    text,
    new RegExp(String.raw`(${PERIOD}${TIME_BODY})`, "g"),
    (match, start) => {
      const time = parseClock(match[1]!);
      if (!time) return null;
      let date = startOfDay(now);
      const at = startOfDay(now);
      at.setHours(time.hours, time.minutes, 0, 0);
      if (at.getTime() < now.getTime()) date = addDays(date, 1);
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: formatTimeLabel(time),
      };
    },
  );
  results.push(...withPeriod);

  const bare = collectMatches(
    text,
    new RegExp(String.raw`(${TIME_BODY})`, "g"),
    (match, start) => {
      // Skip if this time is already part of a longer candidate region later;
      // filter in pickBest via length. Still skip if preceded by date anchors.
      const before = text.slice(Math.max(0, start - 2), start);
      if (/[天月日号周]/.test(before) || before.endsWith("下") || before.endsWith("星")) {
        return null;
      }
      if (before.endsWith("晚") && text.slice(start - 2, start) === "今晚") return null;
      const time = parseClock(match[1]!);
      if (!time) return null;
      let date = startOfDay(now);
      const at = startOfDay(now);
      at.setHours(time.hours, time.minutes, 0, 0);
      if (at.getTime() < now.getTime()) date = addDays(date, 1);
      return {
        start,
        end: start + match[0].length,
        text: match[0],
        date,
        time,
        label: formatTimeLabel(time),
      };
    },
  );
  results.push(...bare);

  return results;
}

function rangePrefixStart(text: string, start: number) {
  const prefix = text.slice(0, start);
  const match = prefix.match(/从\s*$/);
  return match ? start - match[0].length : start;
}

function findRangeCandidates(text: string, now: Date, points: Candidate[]): Candidate[] {
  const results: Candidate[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const left = points[i]!;
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const right = points[j]!;
      if (left.end > right.start) continue;
      if (!RANGE_SEPARATOR.test(text.slice(left.end, right.start))) continue;

      let startDate = left.date;
      let endDate = right.date;
      let leftLabel = left.label;
      let rightLabel = right.label;
      if (left.floating && right.floating) {
        const resolved = resolveRangeMonthDays(now, left.floating, right.floating);
        if (!resolved) continue;
        startDate = resolved.startDate;
        endDate = resolved.endDate;
        leftLabel = formatCandidateLabel(startDate, left.time);
        rightLabel = formatCandidateLabel(endDate, right.time);
      }
      if (!isChronologicalRange(startDate, endDate, left.time, right.time)) continue;

      const start = rangePrefixStart(text, left.start);
      results.push({
        start,
        end: right.end,
        text: text.slice(start, right.end),
        date: startDate,
        time: left.time,
        label: `${leftLabel}–${rightLabel}`,
        rangeEnd: { date: endDate, time: right.time },
      });
    }
  }
  return results;
}

function pickBest(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const lengthDelta = b.end - b.start - (a.end - a.start);
    if (lengthDelta !== 0) return lengthDelta;
    const timeScore = (b.time ? 1 : 0) - (a.time ? 1 : 0);
    if (timeScore !== 0) return timeScore;
    return a.start - b.start;
  });

  // Prefer longer non-overlapping; take the top-ranked
  return ranked[0] ?? null;
}

export function matchKey(match: ParsedTaskDateMatch) {
  return `${match.start}:${match.end}:${match.text}`;
}

export function parseTaskDateText(
  text: string,
  options?: {
    now?: Date;
    timeZone?: string;
  },
): ParsedTaskDate | null {
  if (!text.trim()) return null;

  const timeZone = options?.timeZone ?? systemTimeZone();
  // Interpret relative calendar words in the requested zone, not in the
  // browser/server process zone. This matters around Shanghai midnight.
  const now = zonedDate(options?.now ?? new Date(), timeZone);

  const points = [
    ...findRelativeDayCandidates(text, now),
    ...findDaysLaterCandidates(text, now),
    ...findWeekdayCandidates(text, now),
    ...findMonthDayCandidates(text, now),
    ...findNumericDateCandidates(text),
    ...findStandaloneTimeCandidates(text, now),
  ];

  const dropCovered = (candidates: Candidate[]) =>
    candidates.filter((candidate, index) => {
      return !candidates.some((other, otherIndex) => {
        if (index === otherIndex) return false;
        const otherLen = other.end - other.start;
        const selfLen = candidate.end - candidate.start;
        return otherLen > selfLen
          && other.start <= candidate.start
          && other.end >= candidate.end;
      });
    });

  // Drop nested point matches first so ranges pair the longest date tokens.
  const pointCandidates = dropCovered(points);
  const candidates = dropCovered([
    ...pointCandidates,
    ...findRangeCandidates(text, now, pointCandidates),
  ]);

  const best = pickBest(candidates);
  if (!best) return null;

  const due = best.rangeEnd
    ? rangeDue(best.date, best.rangeEnd.date, best.time, best.rangeEnd.time, timeZone)
    : best.time
    ? timedDue(best.date, best.time, timeZone)
    : allDayDue(best.date, timeZone);
  if (!due) return null;

  return {
    match: {
      start: best.start,
      end: best.end,
      text: best.text,
    },
    title: stripMatch(text, best.start, best.end),
    due,
    label: best.label,
  };
}
