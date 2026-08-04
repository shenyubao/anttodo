import { describe, expect, it } from "vitest";
import { buildProgram } from "./commands.js";
import { formatMan } from "./man.js";

describe("formatMan", () => {
  it("renders an OpenInsight-style command tree with args and options", () => {
    const output = formatMan(buildProgram());

    expect(output).toContain("anttodo — AntTodo command-line client");
    expect(output).toContain("--workspace <id-or-slug> [optional] — override the active workspace");
    expect(output).toContain("auth — Authentication and local session management");
    expect(output).toContain("login [options] — Authorize this CLI in a browser");
    expect(output).toContain("--no-wait [optional] — initiate authorization and return immediately");
    expect(output).toContain("task — Todo task operations");
    expect(output).toContain("create [options] — Create a task");
    expect(output).toContain("--title <text> [required]");
    expect(output).toContain("--tag <tag-id> [optional] — attach a tag");
    expect(output).toContain("get <task-id> — Get one task");
    expect(output).toContain("<task-id> [required]");
    expect(output).toContain("set-duetime [options] <task-id> [due-time] — Set or clear task due time");
    expect(output).toContain("[due-time] [optional]");
    expect(output).not.toContain("└──");
  });
});
