import { describe, expect, it } from "vitest";
import {
  buildFormattedDescription,
  buildSubtaskExtrasFromSuggestion,
  formatAiSuggestedDueAt,
  isMidnightLocalDueAt,
  normalizeAiFormatSuggestion,
  normalizeAiSuggestedSubtasks,
  normalizeDueAt,
} from "./aiSubtaskDecompose";

describe("normalizeAiSuggestedSubtasks", () => {
  it("keeps title and validates assignee/due", () => {
    const rows = normalizeAiSuggestedSubtasks(
      {
        subtasks: [
          {
            title: " 汇总周报 ",
            assignee_user_id: "u1",
            due_at: "2026-08-10T01:00:00.000Z",
          },
          { title: "", assignee_user_id: "u1", due_at: null },
          { title: "汇总周报", assignee_user_id: "u2", due_at: "not-a-date" },
          {
            title: "写大纲",
            assignee_user_id: "unknown",
            due_at: "2026-08-11",
          },
        ],
      },
      { assignableUserIds: ["u1"] },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      title: "汇总周报",
      assignee_user_id: "u1",
      due_at: "2026-08-10T01:00:00.000Z",
    });
    expect(rows[1].title).toBe("写大纲");
    expect(rows[1].assignee_user_id).toBeNull();
    expect(rows[1].due_at).toMatch(/^2026-08-11/);
  });

  it("accepts bare arrays", () => {
    expect(
      normalizeAiSuggestedSubtasks([{ title: "A" }, { title: "B" }]).map(
        (item) => item.title,
      ),
    ).toEqual(["A", "B"]);
  });
});

describe("demo helpers", () => {
  it("detects non-uuid demo ids", async () => {
    const { isLocalDemoTaskContext, buildDemoAiSuggestedSubtasks } =
      await import("./aiSubtaskDecompose");
    expect(isLocalDemoTaskContext("workspace-team", "task-1")).toBe(true);
    expect(
      isLocalDemoTaskContext(
        "7e74efbb-780a-411b-aa7a-1867efbfa40a",
        "7e74efbb-780a-411b-aa7a-1867efbfa40b",
      ),
    ).toBe(false);
    expect(buildDemoAiSuggestedSubtasks({ title: "周报" }).length).toBeGreaterThan(0);
  });
});

describe("normalizeDueAt", () => {
  it("rejects invalid values", () => {
    expect(normalizeDueAt(null)).toBeNull();
    expect(normalizeDueAt("")).toBeNull();
    expect(normalizeDueAt("tomorrow")).toBeNull();
  });
});

describe("formatAiSuggestedDueAt", () => {
  it("formats valid dates", () => {
    expect(formatAiSuggestedDueAt("2026-08-10T00:00:00.000Z")).toMatch(/月/);
    expect(formatAiSuggestedDueAt(null)).toBeNull();
    expect(formatAiSuggestedDueAt("bad")).toBeNull();
  });
});

describe("buildSubtaskExtrasFromSuggestion", () => {
  it("drops assignable-out assignees", () => {
    expect(
      buildSubtaskExtrasFromSuggestion(
        {
          title: "x",
          assignee_user_id: "u9",
          due_at: "2026-08-10T01:00:00.000Z",
        },
        ["u1"],
      ),
    ).toEqual({
      assignee_id: null,
      due_at: "2026-08-10T01:00:00.000Z",
    });
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
        description: "仅正文",
        due_at: null,
        acceptance_criteria: null,
        references: null,
      }),
    ).toBe("仅正文");
  });
});

describe("isMidnightLocalDueAt", () => {
  it("detects local midnight instants", () => {
    // 2026-08-10 00:00 Asia/Shanghai == 2026-08-09T16:00:00.000Z
    expect(
      isMidnightLocalDueAt("2026-08-09T16:00:00.000Z", "Asia/Shanghai"),
    ).toBe(true);
    expect(
      isMidnightLocalDueAt("2026-08-10T01:00:00.000Z", "Asia/Shanghai"),
    ).toBe(false);
  });
});
