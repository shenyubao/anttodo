import { describe, expect, it } from "vitest";
import { toDateInput, toTimeInput } from "./dateTimePreferences";
import { matchKey, parseTaskDateText } from "./parseTaskDateText";

const NOW = new Date(2026, 7, 3, 10, 0, 0); // Mon Aug 3 2026 10:00
const ZONE = "Asia/Shanghai";

function parse(text: string, now = NOW) {
  return parseTaskDateText(text, { now, timeZone: ZONE });
}

describe("parseTaskDateText", () => {
  it("parses tomorrow and strips it from the title", () => {
    const result = parse("明天帮我订机票");
    expect(result).not.toBeNull();
    expect(result!.match.text).toBe("明天");
    expect(result!.title).toBe("帮我订机票");
    expect(result!.due.due_is_all_day).toBe(true);
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-04");
    expect(result!.label).toBe("明天");
  });

  it("parses today / day after tomorrow", () => {
    expect(toDateInput(parse("今天交报告")!.due.due_at!, ZONE)).toBe("2026-08-03");
    expect(toDateInput(parse("后天开会")!.due.due_at!, ZONE)).toBe("2026-08-05");
    expect(parse("大后天出门")!.label).toBe("大后天");
  });

  it("parses N days later with optional time", () => {
    const plain = parse("3天后提交方案");
    expect(plain!.match.text).toBe("3天后");
    expect(plain!.title).toBe("提交方案");
    expect(plain!.due.due_is_all_day).toBe(true);
    expect(toDateInput(plain!.due.due_at!, ZONE)).toBe("2026-08-06");

    const timed = parse("3天后下午3点开会");
    expect(timed!.match.text).toBe("3天后下午3点");
    expect(timed!.title).toBe("开会");
    expect(timed!.due.due_is_all_day).toBe(false);
    expect(toDateInput(timed!.due.due_at!, ZONE)).toBe("2026-08-06");
    expect(toTimeInput(timed!.due.due_at!, ZONE)).toBe("15:00");
  });

  it("parses Chinese numeral days later", () => {
    const result = parse("两天后提醒我");
    expect(result!.match.text).toBe("两天后");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-05");
  });

  it("parses month-day and day-only", () => {
    const withMonth = parse("3月15日交税");
    expect(withMonth!.match.text).toBe("3月15日");
    expect(withMonth!.title).toBe("交税");
    expect(toDateInput(withMonth!.due.due_at!, ZONE)).toBe("2027-03-15");

    const dayOnly = parse("15日 orthodontist");
    expect(dayOnly!.match.text).toBe("15日");
    expect(toDateInput(dayOnly!.due.due_at!, ZONE)).toBe("2026-08-15");

    const pastDay = parse("1号还款");
    expect(toDateInput(pastDay!.due.due_at!, ZONE)).toBe("2026-09-01");
  });

  it("parses day with clock time", () => {
    const result = parse("15日下午2点30分去医院");
    expect(result!.match.text).toBe("15日下午2点30分");
    expect(result!.title).toBe("去医院");
    expect(result!.due.due_is_all_day).toBe(false);
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-15");
    expect(toTimeInput(result!.due.due_at!, ZONE)).toBe("14:30");
  });

  it("parses weekdays", () => {
    // NOW is Monday; 周五 → Aug 7
    const friday = parse("周五提交周报");
    expect(friday!.match.text).toBe("周五");
    expect(toDateInput(friday!.due.due_at!, ZONE)).toBe("2026-08-07");

    const nextMonday = parse("下周一开会");
    expect(nextMonday!.match.text).toBe("下周一");
    expect(toDateInput(nextMonday!.due.due_at!, ZONE)).toBe("2026-08-10");
  });

  it("prefers longer match over shorter relative day", () => {
    const result = parse("明天下午三点订机票");
    expect(result!.match.text).toBe("明天下午三点");
    expect(result!.title).toBe("订机票");
    expect(toTimeInput(result!.due.due_at!, ZONE)).toBe("15:00");
  });

  it("parses standalone time and rolls to tomorrow when past", () => {
    const morning = parse("下午3点打电话", new Date(2026, 7, 3, 10, 0, 0));
    expect(morning!.match.text).toBe("下午3点");
    expect(toDateInput(morning!.due.due_at!, ZONE)).toBe("2026-08-03");
    expect(toTimeInput(morning!.due.due_at!, ZONE)).toBe("15:00");

    const evening = parse("上午9点开会", new Date(2026, 7, 3, 10, 0, 0));
    expect(toDateInput(evening!.due.due_at!, ZONE)).toBe("2026-08-04");
  });

  it("parses numeric dates with year and common separators", () => {
    const dotted = parse("RPA独立分支合并回魔方，出包3.60 2026.9.2");
    expect(dotted!.match.text).toBe("2026.9.2");
    expect(dotted!.title).toBe("RPA独立分支合并回魔方，出包3.60");
    expect(dotted!.due.due_is_all_day).toBe(true);
    expect(toDateInput(dotted!.due.due_at!, ZONE)).toBe("2026-09-02");

    const dashed = parse("发布 2026-09-02");
    expect(dashed!.match.text).toBe("2026-09-02");
    expect(toDateInput(dashed!.due.due_at!, ZONE)).toBe("2026-09-02");

    const slashed = parse("上线 2026/9/2下午3点");
    expect(slashed!.match.text).toBe("2026/9/2下午3点");
    expect(slashed!.due.due_is_all_day).toBe(false);
    expect(toDateInput(slashed!.due.due_at!, ZONE)).toBe("2026-09-02");
    expect(toTimeInput(slashed!.due.due_at!, ZONE)).toBe("15:00");
  });

  it("does not treat version numbers as numeric dates", () => {
    expect(parse("出包3.60")).toBeNull();
    expect(parse("升级到1.2.3")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(parse("买菜")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
  });

  it("keeps title empty when the whole text is a date", () => {
    const result = parse("明天");
    expect(result!.title).toBe("");
    expect(result!.match.text).toBe("明天");
  });

  it("builds a stable match key", () => {
    const result = parse("明天帮我订机票")!;
    expect(matchKey(result.match)).toBe("0:2:明天");
  });

  it("parses next Friday as next week's Friday", () => {
    const nextFriday = parse("下周五提交");
    expect(nextFriday!.match.text).toBe("下周五");
    expect(toDateInput(nextFriday!.due.due_at!, ZONE)).toBe("2026-08-14");

    const afterNext = parse("下下星期五评审");
    expect(afterNext!.match.text).toBe("下下星期五");
    expect(toDateInput(afterNext!.due.due_at!, ZONE)).toBe("2026-08-21");
  });

  it("parses a month-day range and strips it from the title", () => {
    const result = parse("出差 8月5日到9月3日");
    expect(result).not.toBeNull();
    expect(result!.match.text).toBe("8月5日到9月3日");
    expect(result!.title).toBe("出差");
    expect(result!.due.due_is_all_day).toBe(true);
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-08-05");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-09-03");
  });

  it("parses a weekday range across calendar weeks", () => {
    const result = parse("下星期一到下下星期五开会");
    expect(result!.match.text).toBe("下星期一到下下星期五");
    expect(result!.title).toBe("开会");
    expect(result!.due.due_is_all_day).toBe(true);
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-08-10");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-21");
  });

  it("parses a relative range with an optional 从 prefix", () => {
    const result = parse("从明天到周五整理材料");
    expect(result!.match.text).toBe("从明天到周五");
    expect(result!.title).toBe("整理材料");
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-08-04");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-07");
  });

  it("parses a cross-year month-day range", () => {
    const result = parse("12月1日到1月5日盘点");
    expect(result!.match.text).toBe("12月1日到1月5日");
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-12-01");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2027-01-05");
  });

  it("parses a same-day timed range", () => {
    const result = parse("8月5日下午3点到8月5日晚上8点开会");
    expect(result!.match.text).toBe("8月5日下午3点到8月5日晚上8点");
    expect(result!.title).toBe("开会");
    expect(result!.due.due_is_all_day).toBe(false);
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-08-05");
    expect(toTimeInput(result!.due.due_start_at!, ZONE)).toBe("15:00");
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-05");
    expect(toTimeInput(result!.due.due_at!, ZONE)).toBe("20:00");
  });

  it("does not treat 到办公室 as a date range", () => {
    const result = parse("8月5日到办公室");
    expect(result!.match.text).toBe("8月5日");
    expect(result!.title).toBe("到办公室");
    expect(result!.due.due_is_all_day).toBe(true);
    expect(toDateInput(result!.due.due_at!, ZONE)).toBe("2026-08-05");
    expect(toDateInput(result!.due.due_start_at!, ZONE)).toBe("2026-08-05");
  });
});
