import { addDays, format, getDay, startOfDay } from "date-fns";
import {
  fromZonedDateTime,
  systemTimeZone,
  toDateInput,
} from "./dateTimePreferences";
import type { DueFields } from "./dueTime";

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

type Candidate = {
  start: number;
  end: number;
  text: string;
  date: Date;
  time: TimeParts | null;
  label: string;
};

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
  let delta = (targetWeekday - current + 7) % 7;
  if (nextWeeks > 0) {
    if (delta === 0) delta = 7;
    delta += 7 * (nextWeeks - 1);
  }
  return addDays(startOfDay(from), delta);
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
      };
    }
    return {
      start,
      end: start + match[0].length,
      text: match[0],
      date,
      time: null,
      label: format(date, "M月d日"),
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
      const at = new Date(now);
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
      const at = new Date(now);
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
      const at = new Date(now);
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

  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? systemTimeZone();

  const candidates = [
    ...findRelativeDayCandidates(text, now),
    ...findDaysLaterCandidates(text, now),
    ...findWeekdayCandidates(text, now),
    ...findMonthDayCandidates(text, now),
    ...findStandaloneTimeCandidates(text, now),
  ];

  // Drop shorter candidates fully covered by a longer one so pickBest is stable
  const filtered = candidates.filter((candidate, index) => {
    return !candidates.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const otherLen = other.end - other.start;
      const selfLen = candidate.end - candidate.start;
      return otherLen > selfLen
        && other.start <= candidate.start
        && other.end >= candidate.end;
    });
  });

  const best = pickBest(filtered);
  if (!best) return null;

  const due = best.time
    ? timedDue(best.date, best.time, timeZone)
    : allDayDue(best.date, timeZone);

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
