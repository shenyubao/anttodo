import { describe, expect, it } from "vitest";
import {
  buildFormattedDescription,
  formatAiDueAt,
  isMidnightLocalDueAt,
  normalizeAiFormatSuggestion,
  normalizeDueAt,
} from "./aiTaskFormat";

describe("normalizeDueAt", () => {
  it("rejects invalid values", () => {
    expect(normalizeDueAt(null)).toBeNull();
    expect(normalizeDueAt("")).toBeNull();
    expect(normalizeDueAt("tomorrow")).toBeNull();
  });
});

describe("formatAiDueAt", () => {
  it("formats valid dates", () => {
    expect(formatAiDueAt("2026-08-10T00:00:00.000Z")).toMatch(/月/);
    expect(formatAiDueAt(null)).toBeNull();
    expect(formatAiDueAt("bad")).toBeNull();
  });
});

describe("normalizeAiFormatSuggestion", () => {
  it("normalizes structured format suggestion", () => {
    const suggestion = normalizeAiFormatSuggestion({
      title: " 整理周报 ",
      description: " 汇总本周进展 ",
      due_at: "2026-08-10T01:00:00.000Z",
      acceptance_criteria: " 文档完整 ",
      references: " https://example.com ",
    });
    expect(suggestion).toEqual({
      title: "整理周报",
      description: "汇总本周进展",
      due_at: "2026-08-10T01:00:00.000Z",
      acceptance_criteria: "文档完整",
      references: "https://example.com",
    });
  });

  it("rejects missing title", () => {
    expect(normalizeAiFormatSuggestion({ description: "x" })).toBeNull();
    expect(normalizeAiFormatSuggestion(null)).toBeNull();
  });
});

describe("buildFormattedDescription", () => {
  it("joins optional sections with markdown headings", () => {
    expect(
      buildFormattedDescription({
        title: "t",
        description: "正文",
        due_at: null,
        acceptance_criteria: "通过全部用例",
        references: "设计文档",
      }),
    ).toBe("正文\n\n## 验收标准\n通过全部用例\n\n## 参考资料\n设计文档");
  });

  it("omits empty sections", () => {
    expect(
      buildFormattedDescription({
        title: "t",
        description: null,
        due_at: null,
        acceptance_criteria: null,
        references: "链接",
      }),
    ).toBe("## 参考资料\n链接");
  });
});

describe("isMidnightLocalDueAt", () => {
  it("detects midnight in the requested timezone", () => {
    expect(isMidnightLocalDueAt("2026-08-10T16:00:00.000Z", "Asia/Shanghai")).toBe(true);
    expect(isMidnightLocalDueAt("2026-08-10T01:00:00.000Z", "Asia/Shanghai")).toBe(false);
    expect(isMidnightLocalDueAt("bad", "Asia/Shanghai")).toBe(false);
  });
});
