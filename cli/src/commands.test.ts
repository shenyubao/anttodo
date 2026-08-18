import { describe, expect, it } from "vitest";
import {
  buildProgram,
  commandTree,
  configureMachineErrors,
  normalizeLoginOptions,
} from "./commands.js";
import { formatMan } from "./man.js";

describe("command tree", () => {
  it("contains the requested domains and workspace selection", () => {
    const program = buildProgram();
    expect(program.commands.map((command) => command.name())).toEqual([
      "service", "auth", "workspace", "task", "note", "tag", "user",
      "group", "search", "comment", "activity", "attachment", "pomodoro", "stopwatch", "man",
    ]);
  });

  it("exposes service selection and one-shot service override", () => {
    const program = buildProgram();
    expect(program.options.some((option) => option.flags === "--service-url <url>")).toBe(true);
    expect(program.commands.find((command) => command.name() === "service")?.commands.map((command) => command.name()))
      .toEqual(["use", "list", "current", "reset"]);
  });

  it("exposes unified task tree operations", () => {
    const task = buildProgram().commands.find((command) => command.name() === "task");
    expect(task?.commands.map((command) => command.name())).toContain("move");
    expect(task?.commands.find((command) => command.name() === "create")?.options.some(
      (option) => option.flags === "--parent <task-id>",
    )).toBe(true);
  });

  it("includes complete JSON command paths and options", () => {
    const tree = commandTree(buildProgram()) as {
      commands: Array<{ name: string; commands: Array<{ name: string; command: string; options: unknown[] }> }>;
    };
    const taskCreate = tree.commands.find((command) => command.name === "task")?.commands
      .find((command) => command.name === "create");
    expect(taskCreate?.command).toBe("anttodo task create");
    expect(taskCreate?.options?.length).toBeGreaterThan(0);
  });

  it("exposes completed focus session recording commands", () => {
    const program = buildProgram();
    const pomodoro = program.commands.find((command) => command.name() === "pomodoro");
    const stopwatch = program.commands.find((command) => command.name() === "stopwatch");
    expect(pomodoro?.options.map((option) => option.flags)).toEqual([
      "--started-at <rfc3339>",
      "--ended-at <rfc3339>",
      "--planned-seconds <number>",
      "--task <task-id>",
      "--notes <text>",
    ]);
    expect(stopwatch?.options.map((option) => option.flags)).toEqual([
      "--started-at <rfc3339>",
      "--ended-at <rfc3339>",
      "--task <task-id>",
      "--notes <text>",
    ]);
    expect(commandTree(pomodoro!).risk).toBe("write");
    expect(commandTree(stopwatch!).risk).toBe("write");
  });

  it("prints OpenInsight-style text for man --format pretty and JSON otherwise", async () => {
    const capture = async (args: string[]) => {
      const program = configureMachineErrors(buildProgram());
      let stdout = "";
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        return true;
      }) as typeof process.stdout.write;
      try {
        await program.parseAsync(["node", "anttodo", ...args]);
      } finally {
        process.stdout.write = write;
      }
      return stdout;
    };

    const json = JSON.parse(await capture(["man"])) as { ok: true; data: ReturnType<typeof commandTree> };
    expect(json.data).toEqual(commandTree(buildProgram()));

    const pretty = await capture(["man", "--format", "pretty"]);
    expect(pretty).toBe(formatMan(buildProgram()));
    expect(pretty).toContain("--title <text> [required]");
    expect(pretty).toContain("login [options] — Authorize this CLI in a browser");
  });

  it("normalizes Commander's negative login options", () => {
    expect(normalizeLoginOptions({ wait: false, open: false })).toEqual({ noWait: true, noOpen: true });
    expect(normalizeLoginOptions({ wait: true, open: true })).toEqual({ noWait: false, noOpen: false });
  });

  it("converts nested parser failures into catchable errors without plain-text output", async () => {
    let stderr = "";
    const program = configureMachineErrors(buildProgram());
    program.configureOutput({ writeErr: (value) => { stderr += value; } });
    await expect(program.parseAsync(["node", "anttodo", "task", "get"]))
      .rejects.toMatchObject({ code: "commander.missingArgument" });
    expect(stderr).toBe("");
  });
});
