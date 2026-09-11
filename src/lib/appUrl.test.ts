import { describe, expect, it } from "vitest";
import {
  buildTaskOpenUrl,
  buildWeeklyReportOpenUrl,
} from "../../supabase/functions/_shared/app-url";

describe("buildTaskOpenUrl", () => {
  it("builds a task detail path under the public app origin", () => {
    expect(buildTaskOpenUrl("workspace-1", "task-1")).toBe(
      "https://app.anttodo.com/workspaces/workspace-1/tasks/task-1",
    );
  });

  it("uses the notes segment for note items", () => {
    expect(buildTaskOpenUrl("workspace-1", "note-1", "note")).toBe(
      "https://app.anttodo.com/workspaces/workspace-1/notes/note-1",
    );
  });

  it("encodes workspace and task ids", () => {
    expect(buildTaskOpenUrl("space/a", "task/b")).toBe(
      "https://app.anttodo.com/workspaces/space%2Fa/tasks/task%2Fb",
    );
  });

  it("builds and encodes a weekly report detail URL", () => {
    expect(buildWeeklyReportOpenUrl("space/a", "report/b", "https://tasks.example.com/"))
      .toBe("https://tasks.example.com/workspaces/space%2Fa/weekly-reports/report%2Fb");
  });
});
