import { describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { renderError, renderSuccess } from "./output.js";

describe("CLI output", () => {
  it("wraps JSON success responses", () => {
    expect(JSON.parse(renderSuccess([{ id: "1" }], { count: 1 }, "json"))).toEqual({
      ok: true,
      data: [{ id: "1" }],
      meta: { count: 1 },
    });
  });

  it("renders tabular, CSV, and NDJSON lists", () => {
    const rows = [{ id: "1", title: "First" }, { id: "2", title: "Second" }];
    expect(renderSuccess(rows, {}, "table")).toContain("title");
    expect(renderSuccess(rows, {}, "csv")).toBe("id,title\n1,First\n2,Second\n");
    expect(renderSuccess(rows, {}, "ndjson").trim().split("\n")).toHaveLength(2);
  });

  it("uses exit 10 for confirmation errors", () => {
    const rendered = renderError(new CliError({
      type: "confirmation_required",
      code: "confirmation_required",
      message: "confirm",
      exitCode: 10,
    }));
    expect(rendered.exitCode).toBe(10);
    expect(JSON.parse(rendered.text).ok).toBe(false);
  });
});
