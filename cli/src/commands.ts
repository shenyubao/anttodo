import { Command, Option } from "commander";
import {
  assignTask,
  bulkTaskAction,
  createComment,
  createFocusSession,
  createSubtask,
  createTag,
  createTask,
  createWorkspace,
  deleteAttachment,
  deleteComment,
  deleteSubtask,
  deleteTag,
  deleteWorkspace,
  downloadAttachment,
  getSubtask,
  getTag,
  getTask,
  listActivity,
  listComments,
  listSubtasks,
  listTags,
  listUserGroups,
  listTasks,
  listUsers,
  listWorkspaces,
  purgeTask,
  removeWorkspaceMember,
  reorderSubtasks,
  reorderTags,
  resolveWorkspace,
  restoreTask,
  saveTaskSchedule,
  signedAttachmentUrl,
  setTaskStatus,
  setTaskDueTime,
  setTaskPriority,
  softDeleteTask,
  tagDeletePreview,
  updateComment,
  updateSubtask,
  updateTag,
  updateTask,
  updateWorkspace,
  updateWorkspaceMemberRole,
  uploadAttachment,
  updateSubtaskDueTime,
  useWorkspace,
  workspaceInvite,
} from "./api.js";
import { authStatus, completeLogin, logout, renderQrCode, startLogin } from "./auth.js";
import { authenticatedContext } from "./client.js";
import { requireConfirmation } from "./confirmation.js";
import { CliError } from "./errors.js";
import { formatMan } from "./man.js";
import { renderSuccess } from "./output.js";
import { getDefaultWorkspace } from "./storage.js";
import type { OutputFormat, TaskSchedule } from "./types.js";
import {
  assertUuid,
  nonEmpty,
  parseExplicitAccessScope,
  parseDueTime,
  parseFocusSessionInterval,
  parseLabelKind,
  parsePriority,
  parseRecurrence,
  parseReminder,
  parseStatus,
  positiveInteger,
  validateTimeZone,
} from "./validation.js";

const collect = (value: string, previous: string[] = []) => [...previous, value];

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
      .option("--search <text>", "search title and description")
      .option("--trash", "only trashed tasks")
      .option("--include-trash", "include active and trashed tasks");
  }
  return command;
}

function parseIdList(values: string[], name: string) {
  values.forEach((id) => assertUuid(id, name));
  return values;
}

function scheduleFromOptions(options: { reminder?: string[]; repeat?: string; persistentReminders?: boolean }, dueAt: string | null, dueTimezone?: string | null): TaskSchedule {
  const reminders = (options.reminder ?? []).map(parseReminder);
  if ((reminders.length || options.repeat) && !dueAt) {
    throw new CliError({ type: "validation", code: "schedule_requires_due_time", message: "Reminders and recurrence require a due time" });
  }
  return {
    dueAt,
    dueTimezone: dueAt ? dueTimezone ?? null : null,
    reminders,
    persistent: Boolean(options.persistentReminders),
    recurrence: parseRecurrence(options.repeat),
  };
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
  setRisk(workspace.command("create").description("Create a workspace")
    .requiredOption("--name <text>")
    .option("--slug <slug>")
    .action(async (options, command) => {
      const context = await authenticatedContext();
      emit(command, await createWorkspace(context.client, context.user.id, nonEmpty(options.name, "name"), options.slug));
    }), "write");
  setRisk(workspace.command("update").description("Update the active workspace")
    .option("--name <text>")
    .option("--slug <slug>")
    .action(async (options, command) => {
      if (options.name === undefined && options.slug === undefined) throw new CliError({ type: "validation", code: "empty_update", message: "Pass --name or --slug" });
      const context = await businessContext(command);
      emit(command, await updateWorkspace(context.client, context.workspace.id, {
        ...(options.name === undefined ? {} : { name: nonEmpty(options.name, "name") }),
        ...(options.slug === undefined ? {} : { slug: nonEmpty(options.slug, "slug") }),
      }));
    }), "write");
  setRisk(workspace.command("delete [id-or-slug]").description("Permanently delete a workspace")
    .option("--yes")
    .action(async (value, options, command) => {
      const context = await authenticatedContext();
      const target = await resolveWorkspace(context, value ?? command.optsWithGlobals().workspace);
      await requireConfirmation("workspace delete", { id: target.id, name: target.name }, Boolean(options.yes));
      emit(command, await deleteWorkspace(context.client, target.id, target.name));
    }), "high-risk-write");
  setRisk(workspace.command("member-role <user-id> <role>").description("Set a workspace member role").action(async (userId, role, _options, command) => {
    if (!["admin", "member"].includes(role)) throw new CliError({ type: "validation", code: "invalid_role", message: "Role must be admin or member" });
    const context = await businessContext(command);
    emit(command, await updateWorkspaceMemberRole(context.client, context.workspace.id, assertUuid(userId, "user-id"), role));
  }), "write");
  setRisk(workspace.command("member-remove <user-id>").description("Remove a workspace member").option("--yes").action(async (userId, options, command) => {
    const context = await businessContext(command);
    const id = assertUuid(userId, "user-id");
    await requireConfirmation("workspace member remove", { workspace: context.workspace.id, userId: id }, Boolean(options.yes));
    emit(command, await removeWorkspaceMember(context.client, context.workspace.id, id));
  }), "high-risk-write");
  setRisk(workspace.command("invite-link <action>").description("Manage workspace invite links")
    .option("--role <role>", "member|admin")
    .option("--link-id <id>")
    .action(async (action, options, command) => {
      if (!["get", "enable", "update-role", "disable", "accept"].includes(action)) throw new CliError({ type: "validation", code: "invalid_invite_action", message: `Invalid invite action: ${action}` });
      const context = await authenticatedContext();
      if (action === "accept") {
        if (!options.linkId) throw new CliError({ type: "validation", code: "link_id_required", message: "--link-id is required" });
        emit(command, await workspaceInvite(context.client, { action, linkId: assertUuid(options.linkId, "link-id") }));
        return;
      }
      const target = await resolveWorkspace(context, command.optsWithGlobals().workspace);
      const body: Record<string, unknown> = { action, workspaceId: target.id };
      if (action === "enable" || action === "update-role") {
        if (!["member", "admin"].includes(options.role)) throw new CliError({ type: "validation", code: "invalid_role", message: "--role must be member or admin" });
        body.role = options.role;
      }
      emit(command, await workspaceInvite(context.client, body));
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
      search: options.search,
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
    .option("--reminder <rule>", "repeatable: start:15:minute or start:1:day@09:00", collect, [])
    .option("--repeat <frequency>", "daily|weekdays|weekly|monthly|yearly")
    .option("--persistent-reminders", "keep reminders after delivery")
    .option("--assignee <user-id>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      options.tag.forEach((id: string) => assertUuid(id, "tag"));
      if (options.assignee) assertUuid(options.assignee, "assignee");
      const dueAt = options.dueTime ? parseDueTime(options.dueTime, false) : null;
      const hasSchedule = Boolean(options.reminder?.length || options.repeat || options.persistentReminders);
      const schedule = hasSchedule ? scheduleFromOptions(options, dueAt, dueAt ? validateTimeZone(options.timezone) : null) : null;
      const created = await createTask(context.client, {
        workspaceId: context.workspace.id,
        kind: "todo",
        title: nonEmpty(options.title, "title"),
        description: options.description,
        labelIds: options.tag,
        priority: parsePriority(options.priority),
        dueAt,
        dueTimezone: dueAt ? validateTimeZone(options.timezone) : null,
        assigneeId: options.assignee,
      });
      if (schedule) await saveTaskSchedule(context.client, context.workspace.id, created.id, schedule);
      emit(command, hasSchedule ? await getTask(context.client, context.workspace.id, created.id, "todo") : created);
    }), "write");
  setRisk(task.command("update <task-id>").description("Update task title, description, or tags")
    .option("--title <text>")
    .option("--description <markdown>")
    .option("--tag <tag-id>", "replace tags; repeatable", collect, [])
    .option("--clear-tags", "remove all tags")
    .action(async (id, options, command) => {
      if (options.clearTags && options.tag?.length) throw new CliError({ type: "validation", code: "conflicting_tags", message: "Pass --tag or --clear-tags, not both" });
      if (options.title === undefined && options.description === undefined && !options.clearTags && !options.tag?.length) throw new CliError({ type: "validation", code: "empty_update", message: "Pass at least one field to update" });
      const context = await businessContext(command);
      const labelIds = options.clearTags ? [] : options.tag ? parseIdList(options.tag, "tag") : undefined;
      emit(command, await updateTask(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo", {
        ...(options.title === undefined ? {} : { title: nonEmpty(options.title, "title") }),
        ...(options.description === undefined ? {} : { description: options.description }),
      }, labelIds));
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
    .option("--reminder <rule>", "repeatable: start:15:minute or start:1:day@09:00", collect, [])
    .option("--repeat <frequency>", "daily|weekdays|weekly|monthly|yearly")
    .option("--persistent-reminders")
    .action(async (id, dueTime, options, command) => {
      const context = await businessContext(command);
      if (dueTime && options.clear) throw new CliError({ type: "validation", code: "conflicting_due_time", message: "Pass a due time or --clear, not both" });
      const dueAt = parseDueTime(dueTime, Boolean(options.clear));
      const taskId = assertUuid(id, "task-id");
      const hasSchedule = Boolean(options.reminder?.length || options.repeat || options.persistentReminders || options.clear);
      emit(command, hasSchedule
        ? (await saveTaskSchedule(context.client, context.workspace.id, taskId, scheduleFromOptions(options, dueAt, dueAt ? validateTimeZone(options.timezone) : null))).task
        : await setTaskDueTime(context.client, context.workspace.id, taskId, dueAt, dueAt ? validateTimeZone(options.timezone) : null));
    }), "write");
  setRisk(task.command("schedule <task-id>").description("Manage task reminders and recurrence")
    .option("--due-time <rfc3339>")
    .option("--clear", "clear due time, reminders, and recurrence")
    .option("--timezone <iana-timezone>")
    .option("--reminder <rule>", "replace reminders; repeatable", collect)
    .option("--clear-reminders")
    .option("--repeat <frequency>", "daily|weekdays|weekly|monthly|yearly|none")
    .option("--persistent-reminders")
    .action(async (id, options, command) => {
      const context = await businessContext(command);
      const taskId = assertUuid(id, "task-id");
      const current = await getTask(context.client, context.workspace.id, taskId, "todo") as Record<string, unknown>;
      const dueAt = options.clear ? null : options.dueTime ? parseDueTime(options.dueTime, false) : String(current.due_at ?? "");
      const reminders = options.clear || options.clearReminders ? [] : options.reminder ? options.reminder.map(parseReminder) : (current.reminders ?? []) as never[];
      const recurrence = options.clear ? null : options.repeat !== undefined ? parseRecurrence(options.repeat) : current.recurrence as TaskSchedule["recurrence"] ?? null;
      emit(command, (await saveTaskSchedule(context.client, context.workspace.id, taskId, {
        dueAt: dueAt || null,
        dueTimezone: dueAt ? options.timezone ? validateTimeZone(options.timezone) : String(current.due_timezone ?? "UTC") : null,
        reminders,
        persistent: options.clear || options.clearReminders ? false : options.persistentReminders ?? Boolean(current.reminder_persistent),
        recurrence,
      })).task);
    }), "write");
  setRisk(task.command("delete <task-id>").description("Move a task to the 30-day trash").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await softDeleteTask(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo"));
  }), "write");
  for (const [name, status] of [["complete", "completed"], ["cancel", "cancelled"]] as const) {
    setRisk(task.command(`${name} <task-id>`).description(`${name === "complete" ? "Complete" : "Cancel"} a task`).action(async (id, _options, command) => {
      const context = await businessContext(command);
      emit(command, await setTaskStatus(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo", status));
    }), "write");
  }
  setRisk(task.command("restore <task-id>").description("Restore a trashed task").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await restoreTask(context.client, context.workspace.id, assertUuid(id, "task-id"), "todo"));
  }), "write");
  setRisk(task.command("purge <task-id>").description("Permanently delete a trashed task")
    .option("--yes")
    .action(async (id, options, command) => {
      const context = await businessContext(command);
      const taskId = assertUuid(id, "task-id");
      const item = await getTask(context.client, context.workspace.id, taskId, "todo");
      await requireConfirmation("task purge", item, Boolean(options.yes));
      emit(command, await purgeTask(context.client, context.workspace.id, taskId, "todo"));
    }), "high-risk-write");
  setRisk(task.command("bulk <action>").description("Apply an action to multiple tasks")
    .addOption(new Option("--id <task-id>", "repeatable task ID").argParser(collect).default([]))
    .option("--priority <priority>")
    .addOption(new Option("--user <user-id>").conflicts("clear"))
    .addOption(new Option("--clear").conflicts("user"))
    .option("--yes")
    .action(async (action, options, command) => {
      const validActions = ["complete", "cancel", "restore", "delete", "purge", "set-priority", "assign"];
      if (!validActions.includes(action)) throw new CliError({ type: "validation", code: "invalid_bulk_action", message: `Invalid bulk action: ${action}` });
      const ids = parseIdList(options.id ?? [], "task-id");
      if (!ids.length) throw new CliError({ type: "validation", code: "task_ids_required", message: "Pass --id at least once" });
      if (action === "purge") await requireConfirmation("task bulk purge", { ids }, Boolean(options.yes));
      if (action === "set-priority" && !options.priority) throw new CliError({ type: "validation", code: "priority_required", message: "--priority is required" });
      if (action === "assign" && !options.user && !options.clear) throw new CliError({ type: "validation", code: "assignee_required", message: "Pass --user or --clear" });
      const context = await businessContext(command);
      emit(command, await bulkTaskAction(context.client, context.workspace.id, ids, action, {
        priority: options.priority ? parsePriority(options.priority) : undefined,
        assigneeId: options.clear ? null : options.user ? assertUuid(options.user, "user") : undefined,
      }));
    }), "write");

  const subtask = program.command("subtask").description("Subtask operations");
  setRisk(addListOptions(subtask.command("list").description("List subtasks"), false)
    .requiredOption("--task <task-id>")
    .option("--status <status>", "open|completed|all", "all")
    .option("--priority <priority>")
    .option("--assignee <user-id>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      let data = await listSubtasks(context.client, context.workspace.id, assertUuid(options.task, "task")) as Array<Record<string, unknown>>;
      if (options.status !== "all") data = data.filter((item) => Boolean(item.completed) === (options.status === "completed"));
      if (options.priority) data = data.filter((item) => item.priority === parsePriority(options.priority));
      if (options.assignee) data = data.filter((item) => item.assignee_id === assertUuid(options.assignee, "assignee"));
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
    .option("--priority <priority>", "none|low|medium|high", "none")
    .action(async (options, command) => {
      const context = await businessContext(command);
      const created = await createSubtask(context.client, context.user.id, context.workspace.id, assertUuid(options.task, "task"), nonEmpty(options.title, "title"));
      emit(command, options.priority === "none" ? created : await updateSubtask(context.client, context.workspace.id, created.id, { priority: parsePriority(options.priority) }));
    }), "write");
  setRisk(subtask.command("update <subtask-id>").description("Update subtask title").requiredOption("--title <text>").action(async (id, options, command) => {
    const context = await businessContext(command);
    emit(command, await updateSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id"), { title: nonEmpty(options.title, "title") }));
  }), "write");
  setRisk(subtask.command("set-status <subtask-id> <status>").description("Set subtask completion status").action(async (id, status, _options, command) => {
    if (!["open", "completed"].includes(status)) throw new CliError({ type: "validation", code: "invalid_status", message: "Subtask status must be open or completed" });
    const context = await businessContext(command);
    emit(command, await updateSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id"), { completed: status === "completed" }));
  }), "write");
  setRisk(subtask.command("assign <subtask-id>").description("Assign or unassign a subtask")
    .addOption(new Option("--user <user-id>").conflicts("clear"))
    .addOption(new Option("--clear").conflicts("user"))
    .action(async (id, options, command) => {
      if (!options.user && !options.clear) throw new CliError({ type: "validation", code: "assignee_required", message: "Pass --user or --clear" });
      const context = await businessContext(command);
      emit(command, await updateSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id"), { assignee_id: options.user ? assertUuid(options.user, "user") : null }));
    }), "write");
  setRisk(subtask.command("set-priority <subtask-id> <priority>").description("Set subtask priority").action(async (id, priority, _options, command) => {
    const context = await businessContext(command);
    emit(command, await updateSubtask(context.client, context.workspace.id, assertUuid(id, "subtask-id"), { priority: parsePriority(priority) }));
  }), "write");
  setRisk(subtask.command("reorder").description("Reorder subtasks")
    .requiredOption("--task <task-id>")
    .requiredOption("--id <subtask-id>", "repeatable ordered ID", collect, [])
    .action(async (options, command) => {
      const context = await businessContext(command);
      emit(command, await reorderSubtasks(context.client, context.workspace.id, assertUuid(options.task, "task"), parseIdList(options.id, "subtask-id")));
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
  setRisk(addListOptions(note.command("list").description("List notes"), false)
    .option("--trash", "only trashed notes")
    .option("--include-trash", "include active and trashed notes")
    .option("--search <text>")
    .action(async (options, command) => {
    const context = await businessContext(command);
      const data = await listTasks(context.client, context.workspace.id, "note", {
        status: "all",
        search: options.search,
        trash: Boolean(options.trash),
        includeTrash: Boolean(options.includeTrash),
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
  setRisk(note.command("update <note-id>").description("Update note title, description, or tags")
    .option("--title <text>")
    .option("--description <markdown>")
    .option("--tag <tag-id>", "replace tags; repeatable", collect, [])
    .option("--clear-tags")
    .action(async (id, options, command) => {
      if (options.clearTags && options.tag?.length) throw new CliError({ type: "validation", code: "conflicting_tags", message: "Pass --tag or --clear-tags, not both" });
      if (options.title === undefined && options.description === undefined && !options.clearTags && !options.tag?.length) throw new CliError({ type: "validation", code: "empty_update", message: "Pass at least one field to update" });
      const context = await businessContext(command);
      emit(command, await updateTask(context.client, context.workspace.id, assertUuid(id, "note-id"), "note", {
        ...(options.title === undefined ? {} : { title: nonEmpty(options.title, "title") }),
        ...(options.description === undefined ? {} : { description: options.description }),
      }, options.clearTags ? [] : options.tag ? parseIdList(options.tag, "tag") : undefined));
    }), "write");
  setRisk(note.command("delete <note-id>").description("Move a note to the 30-day trash").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await softDeleteTask(context.client, context.workspace.id, assertUuid(id, "note-id"), "note"));
  }), "write");
  setRisk(note.command("restore <note-id>").description("Restore a trashed note").action(async (id, _options, command) => {
    const context = await businessContext(command);
    emit(command, await restoreTask(context.client, context.workspace.id, assertUuid(id, "note-id"), "note"));
  }), "write");
  setRisk(note.command("purge <note-id>").description("Permanently delete a trashed note")
    .option("--yes")
    .action(async (id, options, command) => {
      const context = await businessContext(command);
      const noteId = assertUuid(id, "note-id");
      const item = await getTask(context.client, context.workspace.id, noteId, "note");
      await requireConfirmation("note purge", item, Boolean(options.yes));
      emit(command, await purgeTask(context.client, context.workspace.id, noteId, "note"));
    }), "high-risk-write");

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
  setRisk(tag.command("update <tag-id>").description("Update tag name, color, parent, or permissions")
    .option("--name <text>")
    .option("--color <hex>")
    .option("--parent <tag-id>")
    .option("--clear-parent")
    .option("--view-scope <scope>", "all|users|groups")
    .option("--manage-scope <scope>", "all|users|groups")
    .option("--view-user <user-id>", "repeatable", collect, [])
    .option("--view-group <group-id>", "repeatable", collect, [])
    .option("--manage-user <user-id>", "repeatable", collect, [])
    .option("--manage-group <group-id>", "repeatable", collect, [])
    .action(async (id, options, command) => {
      if (options.clearParent && options.parent) throw new CliError({ type: "validation", code: "conflicting_parent", message: "Pass --parent or --clear-parent, not both" });
      if (options.color !== undefined && !/^#[0-9a-f]{6}$/i.test(options.color)) throw new CliError({ type: "validation", code: "invalid_color", message: "Color must be #RRGGBB" });
      const context = await businessContext(command);
      const viewScope = options.viewScope ? parseExplicitAccessScope(options.viewScope) : undefined;
      const manageScope = options.manageScope ? parseExplicitAccessScope(options.manageScope) : undefined;
      const viewSubjects = viewScope === "groups" ? options.viewGroup : viewScope === "users" ? options.viewUser : undefined;
      const manageSubjects = manageScope === "groups" ? options.manageGroup : manageScope === "users" ? options.manageUser : undefined;
      parseIdList([...(viewSubjects ?? []), ...(manageSubjects ?? [])], "permission subject");
      emit(command, await updateTag(context.client, context.workspace.id, assertUuid(id, "tag-id"), {
        ...(options.name === undefined ? {} : { name: nonEmpty(options.name, "name") }),
        ...(options.color === undefined ? {} : { color: options.color }),
        ...(options.clearParent ? { parentId: null } : options.parent ? { parentId: assertUuid(options.parent, "parent") } : {}),
        ...(viewScope === undefined ? {} : { viewScope, viewSubjectIds: viewSubjects ?? [] }),
        ...(manageScope === undefined ? {} : { manageScope, manageSubjectIds: manageSubjects ?? [] }),
      }));
    }), "write");
  setRisk(tag.command("move <tag-id>").description("Move a tag under another parent or to the root")
    .option("--parent <tag-id>")
    .option("--clear-parent")
    .action(async (id, options, command) => {
      if (options.clearParent && options.parent) throw new CliError({ type: "validation", code: "conflicting_parent", message: "Pass --parent or --clear-parent, not both" });
      if (!options.clearParent && !options.parent) throw new CliError({ type: "validation", code: "parent_required", message: "Pass --parent or --clear-parent" });
      const context = await businessContext(command);
      emit(command, await updateTag(context.client, context.workspace.id, assertUuid(id, "tag-id"), { parentId: options.clearParent ? null : assertUuid(options.parent, "parent") }));
    }), "write");
  setRisk(tag.command("reorder").description("Reorder sibling or top-level tags")
    .option("--parent <tag-id>")
    .requiredOption("--id <tag-id>", "repeatable ordered ID", collect, [])
    .action(async (options, command) => {
      const context = await businessContext(command);
      emit(command, await reorderTags(context.client, context.workspace.id, options.parent ? assertUuid(options.parent, "parent") : null, parseIdList(options.id, "tag-id")));
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

  const group = program.command("group").description("Workspace user groups");
  setRisk(group.command("list").description("List user groups and members").action(async (_options, command) => {
    const context = await businessContext(command);
    const data = await listUserGroups(context.client, context.workspace.id);
    emit(command, data, { count: data.length });
  }), "read");

  setRisk(program.command("search <query>").description("Search tasks and notes")
    .option("--kind <kind>", "todo|note|all", "all")
    .option("--status <status>", "open|completed|cancelled|all", "all")
    .option("--limit <number>", "maximum rows", "100")
    .option("--offset <number>", "row offset", "0")
    .action(async (query, options, command) => {
      if (!["todo", "note", "all"].includes(options.kind)) throw new CliError({ type: "validation", code: "invalid_kind", message: "Kind must be todo, note, or all" });
      const context = await businessContext(command);
      const kinds = options.kind === "all" ? ["todo", "note"] as const : [options.kind as "todo" | "note"];
      const rows = (await Promise.all(kinds.map((kind) => listTasks(context.client, context.workspace.id, kind, {
        search: nonEmpty(query, "query"), status: parseStatus(options.status), limit: positiveInteger(options.limit, "limit", 1000, 1), offset: positiveInteger(options.offset, "offset", 1_000_000),
      })))).flat();
      emit(command, rows, { count: rows.length, workspace: context.workspace.id });
    }), "read");

  const comment = program.command("comment").description("Task comments");
  setRisk(comment.command("list <task-id>").description("List task comments").option("--subtask <subtask-id>").action(async (taskId, options, command) => {
    const context = await businessContext(command);
    const id = assertUuid(taskId, "task-id");
    if (options.subtask) assertUuid(options.subtask, "subtask-id");
    emit(command, await listComments(context.client, id, options.subtask));
  }), "read");
  setRisk(comment.command("create <task-id>").description("Create a task comment")
    .requiredOption("--body <text>")
    .option("--image-uri <uri>", "repeatable", collect, [])
    .option("--mention <user-id>", "repeatable", collect, [])
    .option("--subtask <subtask-id>")
    .action(async (taskId, options, command) => {
      const context = await businessContext(command);
      parseIdList(options.mention, "mention");
      if (options.subtask) assertUuid(options.subtask, "subtask-id");
      emit(command, await createComment(context.client, { taskId: assertUuid(taskId, "task-id"), body: nonEmpty(options.body, "body"), imageUris: options.imageUri, mentionedUserIds: options.mention, subtaskId: options.subtask ?? null }));
    }), "write");
  setRisk(comment.command("update <comment-id>").description("Update a task comment")
    .requiredOption("--body <text>")
    .option("--image-uri <uri>", "repeatable", collect, [])
    .option("--mention <user-id>", "repeatable", collect, [])
    .action(async (commentId, options, command) => {
      const context = await authenticatedContext();
      emit(command, await updateComment(context.client, { commentId: assertUuid(commentId, "comment-id"), body: options.body, imageUris: options.imageUri, mentionedUserIds: parseIdList(options.mention, "mention") }));
    }), "write");
  setRisk(comment.command("delete <comment-id>").description("Delete a task comment").option("--yes").action(async (commentId, options, command) => {
    await requireConfirmation("comment delete", { id: commentId }, Boolean(options.yes));
    const context = await authenticatedContext();
    emit(command, await deleteComment(context.client, assertUuid(commentId, "comment-id")));
  }), "high-risk-write");

  const activity = program.command("activity").description("Task activity history");
  setRisk(activity.command("list <task-id>").description("List task activity").option("--before-created-at <rfc3339>").option("--before-id <event-id>").option("--limit <number>", "maximum rows", "50").action(async (taskId, options, command) => {
    const context = await businessContext(command);
    if (Boolean(options.beforeCreatedAt) !== Boolean(options.beforeId)) throw new CliError({ type: "validation", code: "cursor_required", message: "Pass --before-created-at and --before-id together" });
    const cursor = options.beforeCreatedAt ? { createdAt: parseDueTime(options.beforeCreatedAt, false)!, id: assertUuid(options.beforeId, "before-id") } : null;
    emit(command, await listActivity(context.client, assertUuid(taskId, "task-id"), cursor, positiveInteger(options.limit, "limit", 100, 1)));
  }), "read");

  const attachment = program.command("attachment").description("Task and comment attachments");
  setRisk(attachment.command("upload").description("Upload an attachment")
    .requiredOption("--task <task-id>")
    .requiredOption("--file <path>")
    .option("--comment-image")
    .option("--uploader <user-id>")
    .action(async (options, command) => {
      const context = await businessContext(command);
      emit(command, await uploadAttachment(context.client, context.workspace.id, assertUuid(options.task, "task-id"), options.file, Boolean(options.commentImage), options.uploader ? assertUuid(options.uploader, "uploader") : context.user.id));
    }), "write");
  setRisk(attachment.command("download <uri>").description("Download an attachment").requiredOption("--output <path>").action(async (uri, options, command) => {
    const context = await authenticatedContext();
    emit(command, await downloadAttachment(context.client, uri, options.output));
  }), "read");
  setRisk(attachment.command("url <uri>").description("Create a signed attachment URL").option("--expires <seconds>", "URL lifetime", "60").action(async (uri, options, command) => {
    const context = await authenticatedContext();
    emit(command, await signedAttachmentUrl(context.client, uri, positiveInteger(options.expires, "expires", 86_400, 1)));
  }), "read");
  setRisk(attachment.command("delete <uri>").description("Delete an attachment").option("--yes").action(async (uri, options, command) => {
    await requireConfirmation("attachment delete", { uri }, Boolean(options.yes));
    const context = await authenticatedContext();
    emit(command, await deleteAttachment(context.client, uri));
  }), "high-risk-write");

  setRisk(program.command("pomodoro").description("Record a completed pomodoro session")
    .requiredOption("--started-at <rfc3339>")
    .requiredOption("--ended-at <rfc3339>")
    .requiredOption("--planned-seconds <number>")
    .option("--task <task-id>")
    .option("--notes <text>")
    .action(async (options, command) => {
      const interval = parseFocusSessionInterval(options.startedAt, options.endedAt);
      const taskId = options.task ? assertUuid(options.task, "task") : null;
      const plannedSeconds = positiveInteger(options.plannedSeconds, "planned-seconds", Number.MAX_SAFE_INTEGER, 1);
      const context = await businessContext(command);
      emit(command, await createFocusSession(context.client, {
        userId: context.user.id,
        workspaceId: context.workspace.id,
        taskId,
        mode: "pomodoro",
        plannedSeconds,
        elapsedSeconds: interval.elapsedSeconds,
        notes: options.notes?.trim() || null,
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
      }));
    }), "write");

  setRisk(program.command("stopwatch").description("Record a completed stopwatch session")
    .requiredOption("--started-at <rfc3339>")
    .requiredOption("--ended-at <rfc3339>")
    .option("--task <task-id>")
    .option("--notes <text>")
    .action(async (options, command) => {
      const interval = parseFocusSessionInterval(options.startedAt, options.endedAt);
      const taskId = options.task ? assertUuid(options.task, "task") : null;
      const context = await businessContext(command);
      emit(command, await createFocusSession(context.client, {
        userId: context.user.id,
        workspaceId: context.workspace.id,
        taskId,
        mode: "stopwatch",
        plannedSeconds: interval.elapsedSeconds,
        elapsedSeconds: interval.elapsedSeconds,
        notes: options.notes?.trim() || null,
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
      }));
    }), "write");

  setRisk(program.command("man").description("Return the complete command tree for agents").action(async (_options, command) => {
    if (formatFor(command) === "pretty") {
      process.stdout.write(formatMan(program));
      return;
    }
    emit(command, commandTree(program));
  }), "read");

  return program;
}
