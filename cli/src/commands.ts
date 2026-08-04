import { Command, Option } from "commander";
import {
  assignTask,
  createSubtask,
  createTag,
  createTask,
  deleteSubtask,
  deleteTag,
  getSubtask,
  getTag,
  getTask,
  listSubtasks,
  listTags,
  listTasks,
  listUsers,
  listWorkspaces,
  resolveWorkspace,
  setTaskDueTime,
  setTaskPriority,
  softDeleteTask,
  tagDeletePreview,
  updateSubtaskDueTime,
  useWorkspace,
} from "./api.js";
import { authStatus, completeLogin, logout, renderQrCode, startLogin } from "./auth.js";
import { authenticatedContext } from "./client.js";
import { requireConfirmation } from "./confirmation.js";
import { CliError } from "./errors.js";
import { formatMan } from "./man.js";
import { renderSuccess } from "./output.js";
import { getDefaultWorkspace } from "./storage.js";
import type { OutputFormat } from "./types.js";
import {
  assertUuid,
  nonEmpty,
  parseExplicitAccessScope,
  parseDueTime,
  parseLabelKind,
  parsePriority,
  parseStatus,
  positiveInteger,
  validateTimeZone,
} from "./validation.js";

const collect = (value: string, previous: string[]) => [...previous, value];

function formatFor(command: Command): OutputFormat {
  const options = command.optsWithGlobals();
  return options.json ? "json" : options.format as OutputFormat;
}

function emit(command: Command, data: unknown, meta: Record<string, unknown> = {}) {
  process.stdout.write(renderSuccess(data, meta, formatFor(command)));
}

async function businessContext(command: Command) {
  const authenticated = await authenticatedContext();
  const workspace = await resolveWorkspace(authenticated, command.optsWithGlobals().workspace);
  return { ...authenticated, workspace };
}

function setRisk(command: Command, risk: "read" | "write" | "high-risk-write") {
  Object.assign(command, { risk });
  return command;
}

function addListOptions(command: Command, task = true) {
  command
    .option("--limit <number>", "maximum rows", "100")
    .option("--offset <number>", "row offset", "0");
  if (task) {
    command
      .option("--status <status>", "open|completed|cancelled|all", "open")
      .option("--priority <priority>")
      .option("--assignee <user-id>")
      .option("--tag <tag-id>")
      .option("--trash", "only trashed tasks")
      .option("--include-trash", "include active and trashed tasks");
  }
  return command;
}

export function commandTree(command: Command): Record<string, unknown> {
  const path = commandTreePath(command);
  return {
    name: command.name(),
    command: path,
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
      ...(argument.defaultValue === undefined ? {} : { default: argument.defaultValue }),
      ...(argument.argChoices ? { choices: argument.argChoices } : {}),
    })),
    options: command.options.map((option) => ({
      flags: option.flags,
      description: option.description,
      required: option.mandatory,
      variadic: option.variadic,
      ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
      ...(option.argChoices ? { choices: option.argChoices } : {}),
    })),
    risk: (command as Command & { risk?: string }).risk ?? "read",
    commands: command.commands.map(commandTree),
  };
}

function commandTreePath(command: Command): string {
  return command.parent
    ? `${commandTreePath(command.parent)} ${command.name()}`
    : command.name();
}

export function normalizeLoginOptions(options: { wait?: boolean; open?: boolean }) {
  return { noWait: options.wait === false, noOpen: options.open === false };
}

export function configureMachineErrors(command: Command) {
  command.exitOverride();
  command.configureOutput({ writeErr: () => undefined });
  command.commands.forEach(configureMachineErrors);
  return command;
}

export function buildProgram() {
  const program = new Command()
    .name("anttodo")
    .description("AntTodo command-line client")
    .version("0.1.0")
    .option("--workspace <id-or-slug>", "override the active workspace")
    .option("--json", "output the JSON envelope")
    .addOption(new Option("--format <format>", "json|pretty|table|ndjson|csv").choices(["json", "pretty", "table", "ndjson", "csv"]).default("json"));

  const auth = program.command("auth").description("Authentication and local session management");
  setRisk(auth.command("login").description("Authorize this CLI in a browser")
    .option("--no-wait", "initiate authorization and return immediately")
    .option("--device-code <code>", "complete a prior split-flow authorization")
    .option("--no-open", "do not open the browser")
    .action(async (options, command) => {
      const data = options.deviceCode
        ? await completeLogin(options.deviceCode)
        : await startLogin(normalizeLoginOptions(options));
      emit(command, data);
    }), "write");
  setRisk(auth.command("status").description("Show the current login status")
    .option("--verify", "verify the token with Supabase Auth")
    .action(async (options, command) => emit(command, await authStatus(Boolean(options.verify)))), "read");
  setRisk(auth.command("logout").description("Revoke the current CLI session")
    .action(async (_options, command) => emit(command, await logout())), "write");
  setRisk(auth.command("qrcode <url>").description("Render an authorization URL as a QR code")
    .addOption(new Option("--ascii", "return terminal QR text").conflicts("output"))
    .addOption(new Option("--output <path>", "write a PNG inside the current directory").conflicts("ascii"))
    .action(async (url, options, command) => emit(command, await renderQrCode(url, options))), "read");

  const workspace = program.command("workspace").description("Workspace selection");
  setRisk(workspace.command("list").description("List joined workspaces").action(async (_options, command) => {
    const context = await authenticatedContext();
    const active = await getDefaultWorkspace(context.user.id);
    const data = (await listWorkspaces(context)).map((item) => ({ ...item, active: item.id === active }));
    emit(command, data, { count: data.length });
  }), "read");
  setRisk(workspace.command("use <id-or-slug>").description("Save the default workspace").action(async (value, _options, command) => {
    const context = await authenticatedContext();
    emit(command, await useWorkspace(context, value));
  }), "write");

  const task = program.command("task").description("Todo task operations");
  setRisk(addListOptions(task.command("list").description("List tasks")).action(async (options, command) => {
    const context = await businessContext(command);
    if (options.tag) assertUuid(options.tag, "tag");
    if (options.assignee) assertUuid(options.assignee, "assignee");
    const data = await listTasks(context.client, context.workspace.id, "todo", {
      status: parseStatus(options.status),
      priority: options.priority ? parsePriority(options.priority) : undefined,
      assignee: options.assignee,
      tag: options.tag,
      trash: Boolean(options.trash),
      includeTrash: Boolean(options.includeTrash),
      limit: positiveInteger(options.limit, "limit", 1000, 1),
      offset: positiveInteger(options.offset, "offset", 1_000_000),
    });
    emit(command, data, { count: data.length, workspace: context.workspace.id });
  }), "read");
  setRisk(task.command("get <task-id>").description("Get one task").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await getTask(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo"));
  }), "read");
  setRisk(task.command("create").description("Create a task")
    .requiredOption("--title <text>")
    .option("--description <markdown>")
    .option("--tag <tag-id>", "attach a tag", collect, [])
    .option("--priority <priority>", "none|low|medium|high", "low")
    .option("--due-time <rfc3339>")
    .option("--timezone <iana-timezone>")
    .option("--assignee <user-id>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      options.tag.forEach((id: string) => assertUuid(id, "tag"));
      if (options.assignee) assertUuid(options.assignee, "assignee");
      const dueAt = options.dueTime ? parseDueTime(options.dueTime, false) : null;
      emit(command, await createTask(context.client, {
        workspaceId: context.workspace.id,
        kind: "todo",
        title: nonEmpty(options.title, "title"),
        description: options.description,
        labelIds: options.tag,
        priority: parsePriority(options.priority),
        dueAt,
        dueTimezone: dueAt ? validateTimeZone(options.timezone) : null,
        assigneeId: options.assignee,
      }));
    }), "write");
  setRisk(task.command("assign <task-id>").description("Assign or unassign a task")
    .addOption(new Option("--user <user-id>").conflicts("clear"))
    .addOption(new Option("--clear").conflicts("user"))
    .action(async (id, options, command) => {
      if (!options.user && !options.clear) throw new CliError({ type: "validation", code: "assignee_required", message: "Pass --user or --clear" });
      const context = await businessContext(command);
      emit(command, await assignTask(context.client, context.workspace.id, assertUuid(id, "task-id"), options.user ? assertUuid(options.user, "user") : null));
    }), "write");
  setRisk(task.command("set-priority <task-id> <priority>").description("Set task priority").action(async (id, priority, _options, command) => {
    const context = await businessContext(command);
    emit(command, await setTaskPriority(context.client, context.workspace.id, assertUuid(id, "task-id"), parsePriority(priority)));
  }), "write");
  setRisk(task.command("set-duetime <task-id> [due-time]").description("Set or clear task due time")
    .option("--clear")
    .option("--timezone <iana-timezone>")
    .action(async (id, dueTime, options, command) => {
      const context = await businessContext(command);
      if (dueTime && options.clear) throw new CliError({ type: "validation", code: "conflicting_due_time", message: "Pass a due time or --clear, not both" });
      const dueAt = parseDueTime(dueTime, Boolean(options.clear));
      emit(command, await setTaskDueTime(context.client, context.workspace.id, assertUuid(id, "task-id"), dueAt, dueAt ? validateTimeZone(options.timezone) : null));
    }), "write");
  setRisk(task.command("delete <task-id>").description("Move a task to the 30-day trash").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await softDeleteTask(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo"));
  }), "write");

  const subtask = program.command("subtask").description("Subtask operations");
  setRisk(addListOptions(subtask.command("list").description("List subtasks"), false)
    .requiredOption("--task <task-id>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      const data = await listSubtasks(context.client, context.workspace.id, assertUuid(options.task, "task"));
      const offset = positiveInteger(options.offset, "offset", 1_000_000);
      const limit = positiveInteger(options.limit, "limit", 1000, 1);
      emit(command, data.slice(offset, offset + limit), { count: data.length });
    }), "read");
  setRisk(subtask.command("get <subtask-id>").description("Get one subtask").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await getSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id")));
  }), "read");
  setRisk(subtask.command("create").description("Create a subtask")
    .requiredOption("--task <task-id>")
    .requiredOption("--title <text>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      emit(command, await createSubtask(context.client, context.user.id, context.workspace.id, assertUuid(options.task, "task"), nonEmpty(options.title, "title")));
    }), "write");
  setRisk(subtask.command("set-duetime <subtask-id> [due-time]").description("Set or clear subtask due time")
    .option("--clear")
    .action(async (id, dueTime, options, command) => {
      const context = await businessContext(command);
      if (dueTime && options.clear) throw new CliError({ type: "validation", code: "conflicting_due_time", message: "Pass a due time or --clear, not both" });
      emit(command, await updateSubtaskDueTime(context.client, context.workspace.id, assertUuid(id, "subtask-id"), parseDueTime(dueTime, Boolean(options.clear))));
    }), "write");
  setRisk(subtask.command("delete <subtask-id>").description("Permanently delete a subtask")
    .option("--yes")
    .action(async (id, options, command) => {
      const context = await businessContext(command);
      const item = await getSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id"));
      await requireConfirmation("subtask delete", item, Boolean(options.yes));
      emit(command, await deleteSubtask(context.client, context.workspace.id, id));
    }), "high-risk-write");

  const note = program.command("note").description("Note operations");
  setRisk(addListOptions(note.command("list").description("List notes"), false).action(async (options, command) => {
    const context = await businessContext(command);
    const data = await listTasks(context.client, context.workspace.id, "note", {
      status: "all",
      limit: positiveInteger(options.limit, "limit", 1000, 1),
      offset: positiveInteger(options.offset, "offset", 1_000_000),
    });
    emit(command, data, { count: data.length });
  }), "read");
  setRisk(note.command("get <note-id>").description("Get one note").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await getTask(context.client, context.workspace.id, assertUuid(id, "note-id"), "note"));
  }), "read");
  setRisk(note.command("create").description("Create a note")
    .requiredOption("--title <text>")
    .option("--description <markdown>")
    .option("--tag <tag-id>", "attach a tag", collect, [])
    .action(async (options, command) => {
      const context = await businessContext(command);
      options.tag.forEach((id: string) => assertUuid(id, "tag"));
      emit(command, await createTask(context.client, {
        workspaceId: context.workspace.id,
        kind: "note",
        title: nonEmpty(options.title, "title"),
        description: options.description,
        labelIds: options.tag,
      }));
    }), "write");
  setRisk(note.command("delete <note-id>").description("Move a note to the 30-day trash").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await softDeleteTask(context.client, context.workspace.id, assertUuid(id, "note-id"), "note"));
  }), "write");

  const tag = program.command("tag").description("Tag operations");
  setRisk(tag.command("list").description("List visible tags").action(async (_options, command) => {
    const context = await businessContext(command);
    const data = await listTags(context.client, context.workspace.id);
    emit(command, data, { count: data.length });
  }), "read");
  setRisk(tag.command("get <tag-id>").description("Get one tag").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await getTag(context.client, context.workspace.id, assertUuid(id, "tag-id")));
  }), "read");
  setRisk(tag.command("create").description("Create a tag")
    .requiredOption("--name <text>")
    .option("--color <hex>", "six-digit hex color", "#b8bdc8")
    .option("--parent <tag-id>")
    .option("--kind <kind>", "private|team", "private")
    .option("--team", "create a team tag (alias for --kind team)")
    .option("--view-scope <scope>", "all|users|groups", "all")
    .option("--manage-scope <scope>", "all|users|groups", "users")
    .option("--view-user <user-id>", "repeatable view user", collect, [])
    .option("--view-group <group-id>", "repeatable view group", collect, [])
    .option("--manage-user <user-id>", "repeatable manage user", collect, [])
    .option("--manage-group <group-id>", "repeatable manage group", collect, [])
    .action(async (options, command) => {
      if (!/^#[0-9a-f]{6}$/i.test(options.color)) throw new CliError({ type: "validation", code: "invalid_color", message: "Color must be #RRGGBB" });
      const context = await businessContext(command);
      const kind = parseLabelKind(options.team ? "team" : options.kind);
      const viewScope = parseExplicitAccessScope(options.viewScope);
      const manageScope = parseExplicitAccessScope(options.manageScope);
      const viewSubjectIds = viewScope === "groups" ? options.viewGroup : options.viewUser;
      const manageSubjectIds = manageScope === "groups" ? options.manageGroup : options.manageUser;
      [...viewSubjectIds, ...manageSubjectIds].forEach((id: string) => assertUuid(id, "permission subject"));
      emit(command, await createTag(context.client, context.user.id, {
        workspaceId: context.workspace.id,
        name: nonEmpty(options.name, "name"),
        color: options.color,
        parentId: options.parent ? assertUuid(options.parent, "parent") : null,
        kind,
        viewScope,
        manageScope,
        viewSubjectIds,
        manageSubjectIds,
      }));
    }), "write");
  setRisk(tag.command("delete <tag-id>").description("Permanently delete a tag tree")
    .option("--yes")
    .action(async (id, options, command) => {
      const context = await businessContext(command);
      const tagId = assertUuid(id, "tag-id");
      const preview = await tagDeletePreview(context.client, context.workspace.id, tagId);
      await requireConfirmation("tag delete", preview, Boolean(options.yes));
      emit(command, await deleteTag(context.client, context.workspace.id, tagId));
    }), "high-risk-write");

  const user = program.command("user").description("Workspace users");
  setRisk(user.command("list").description("List workspace members").action(async (_options, command) => {
    const context = await businessContext(command);
    const data = await listUsers(context.client, context.workspace.id);
    emit(command, data, { count: data.length });
  }), "read");

  setRisk(program.command("man").description("Return the complete command tree for agents").action(async (_options, command) => {
    if (formatFor(command) === "pretty") {
      process.stdout.write(formatMan(program));
      return;
    }
    emit(command, commandTree(program));
  }), "read");

  return program;
}
