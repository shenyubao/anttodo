import type { Command } from "commander";
import { assertUuid, nonEmpty, positiveInteger } from "./validation.js";
import { requireConfirmation } from "./confirmation.js";
import {
  createOkrKeyResult, createOkrObjective, deleteOkrEntity, getOkrCycle, getOkrEntity,
  getOkrTree, listOkrCycles, listOkrTasks, publishOkr, setOkrTaskLink, updateOkrEntity,
  updateOkrProgress, type OkrContext,
} from "./okr-api.js";
import { finiteOkrNumber, invalidOkr, okrChoice, type OkrFields } from "./okr.js";

type Dependencies = {
  businessContext(command: Command): Promise<OkrContext>;
  emit(command: Command, data: unknown, meta?: Record<string, unknown>): void;
};
const statuses = ["none", "normal", "risk", "delayed"] as const;
const uuid = (id: string) => assertUuid(id, "id");
const cycleId = (value: string) => value === "current" ? value : assertUuid(value, "cycle");
const ownerId = (value: string, context: OkrContext) => value === "me" ? context.user.id : assertUuid(value, "owner");

function selection(command: Command) {
  return command.option("--cycle <current-or-id>", "cycle UUID or current active cycle", "current")
    .option("--owner <me-or-id>", "OKR owner UUID or me", "me");
}

function page(command: Command) {
  return command.option("--limit <number>", "maximum rows", "100").option("--offset <number>", "row offset", "0");
}

function pagination(options: Record<string, string>) {
  return { limit: positiveInteger(options.limit, "limit", 1000, 1), offset: positiveInteger(options.offset, "offset", 1_000_000) };
}

function editOptions(command: Command, kr = false) {
  command.option("--title <text>", "title").option("--note <markdown>", "Markdown note; empty string clears it")
    .option("--status-mode <mode>", "manual|automatic").option("--status <status>", "none|normal|risk|delayed");
  if (kr) command.option("--start <number>", "metric starting value").option("--target <number>", "metric target value")
    .option("--unit <unit>", "percent|cny|usd|none|custom").option("--custom-unit <text>", "custom unit label");
  return command;
}

export function okrFields(options: Record<string, string | undefined>, kr: boolean): OkrFields {
  const fields: OkrFields = {};
  if (options.title !== undefined) fields.title = nonEmpty(options.title, "title");
  if (options.note !== undefined) fields.note = options.note;
  if (options.statusMode !== undefined) fields.status_mode = okrChoice(options.statusMode, ["manual", "automatic"] as const, "status-mode");
  if (options.status !== undefined) fields.progress_status = okrChoice(options.status, statuses, "status");
  if (kr) {
    if (options.start !== undefined) fields.start_value = finiteOkrNumber(options.start, "start");
    if (options.target !== undefined) fields.target_value = finiteOkrNumber(options.target, "target");
    if (options.unit !== undefined) fields.metric_unit = okrChoice(options.unit, ["percent", "cny", "usd", "none", "custom"] as const, "unit");
    if (options.customUnit !== undefined) fields.custom_unit = nonEmpty(options.customUnit, "custom-unit");
  }
  if (!Object.keys(fields).length) invalidOkr("Pass at least one field to update");
  return fields;
}

export function registerOkrCommands(program: Command, { businessContext, emit }: Dependencies) {
  const risk = (command: Command, value: "read" | "write" | "high-risk-write") => Object.assign(command, { risk: value });
  const okr = program.command("okr").description("Manage OKR objectives, key results, progress, and task links");
  const cycles = okr.command("cycle").description("Read OKR cycles");
  risk(page(cycles.command("list").description("List cycles")), "read").action(async (options, command) => {
    const { limit, offset } = pagination(options);
    const rows = await listOkrCycles(await businessContext(command));
    const data = rows.slice(offset, offset + limit);
    emit(command, data, { count: data.length });
  });
  risk(cycles.command("get <id>").description("Get a cycle"), "read").action(async (id, _options, command) => {
    uuid(id);
    emit(command, await getOkrCycle(await businessContext(command), id));
  });
  risk(selection(okr.command("get").description("Get the complete OKR tree")), "read").action(async (options, command) => {
    cycleId(options.cycle);
    if (options.owner !== "me") uuid(options.owner);
    const context = await businessContext(command);
    emit(command, await getOkrTree(context, options.cycle, ownerId(options.owner, context)));
  });

  const objectives = okr.command("objective").description("Manage objectives");
  risk(page(selection(objectives.command("list").description("List objectives with their key results"))), "read")
    .action(async (options, command) => {
      cycleId(options.cycle);
      if (options.owner !== "me") uuid(options.owner);
      const { limit, offset } = pagination(options);
      const context = await businessContext(command);
      const { set } = await getOkrTree(context, options.cycle, ownerId(options.owner, context));
      const data = (set?.objectives ?? []).slice(offset, offset + limit);
      emit(command, data, { count: data.length });
    });
  risk(objectives.command("create").description("Create an objective with KR-based progress")
    .requiredOption("--title <text>").option("--cycle <current-or-id>", "cycle UUID or current active cycle", "current"), "write")
    .action(async (options, command) => {
      const title = nonEmpty(options.title, "title");
      cycleId(options.cycle);
      emit(command, await createOkrObjective(await businessContext(command), title, options.cycle));
    });

  const keyResults = okr.command("key-result").description("Manage key results");
  risk(page(keyResults.command("list").description("List an objective's key results").requiredOption("--objective <id>")), "read")
    .action(async (options, command) => {
      uuid(options.objective);
      const { limit, offset } = pagination(options);
      const objective = await getOkrEntity(await businessContext(command), "objective", options.objective);
      const data = ("key_results" in objective ? objective.key_results : []).slice(offset, offset + limit);
      emit(command, data, { count: data.length });
    });
  risk(keyResults.command("create").description("Create a KR and equally rebalance its siblings")
    .requiredOption("--objective <id>").requiredOption("--title <text>"), "write")
    .action(async (options, command) => {
      uuid(options.objective);
      const title = nonEmpty(options.title, "title");
      emit(command, await createOkrKeyResult(await businessContext(command), options.objective, title));
    });

  for (const [group, kind] of [[objectives, "objective"], [keyResults, "key_result"]] as const) {
    risk(group.command("get <id>").description("Get details, progress percent, and effective status"), "read")
      .action(async (id, _options, command) => {
        uuid(id);
        emit(command, await getOkrEntity(await businessContext(command), kind, id));
      });
    risk(editOptions(group.command("update <id>").description("Update only the specified fields"), kind === "key_result"), "write")
      .action(async (id, options, command) => {
        uuid(id);
        const fields = okrFields(options, kind === "key_result");
        emit(command, await updateOkrEntity(await businessContext(command), kind, id, fields));
      });
    risk(group.command("delete <id>").description("Permanently delete the entity and its dependent records; keep tasks")
      .option("--yes", "confirm permanent deletion"), "high-risk-write")
      .action(async (id, options, command) => {
        uuid(id);
        const context = await businessContext(command);
        const entity = await getOkrEntity(context, kind, id);
        await requireConfirmation(`Delete OKR ${kind}`, {
          entity, cascade: kind === "objective" ? "Key results, task links, and progress records" : "Task links and progress records",
          tasks_preserved: true, rebalance_remaining_weights: kind === "key_result",
        }, Boolean(options.yes));
        emit(command, await deleteOkrEntity(context, kind, id));
      });
  }

  risk(keyResults.command("progress <id>").description("Record KR progress; omitted fields retain their values")
    .option("--value <number-or-null>", "current metric value; null clears it")
    .option("--status <status>", "none|normal|risk|delayed").option("--detail <text>", "progress description, up to 2000 characters"), "write")
    .action(async (id, options, command) => {
      uuid(id);
      if (options.value === undefined && options.status === undefined && options.detail === undefined) invalidOkr("Pass --value, --status, or --detail");
      if ((options.detail?.length ?? 0) > 2000) invalidOkr("detail must be at most 2000 characters");
      const patch = {
        ...(options.value === undefined ? {} : { value: options.value === "null" ? null : finiteOkrNumber(options.value, "value") }),
        ...(options.status === undefined ? {} : { status: okrChoice(options.status, statuses, "status") }),
        ...(options.detail === undefined ? {} : { detail: options.detail }),
      };
      emit(command, await updateOkrProgress(await businessContext(command), id, patch));
    });
  risk(okr.command("publish").description("Publish your complete OKR set in a cycle")
    .option("--cycle <current-or-id>", "cycle UUID or current active cycle", "current"), "write")
    .action(async (options, command) => {
      cycleId(options.cycle);
      emit(command, await publishOkr(await businessContext(command), options.cycle));
    });

  const tasks = okr.command("task").description("Read and manage task links");
  risk(page(tasks.command("list").description("List linked tasks for exactly one objective or KR")
    .option("--objective <id>").option("--key-result <id>")), "read")
    .action(async (options, command) => {
      if (Boolean(options.objective) === Boolean(options.keyResult)) invalidOkr("Pass exactly one of --objective or --key-result");
      const id = uuid(options.objective ?? options.keyResult);
      const { limit, offset } = pagination(options);
      const data = await listOkrTasks(await businessContext(command), options.objective ? "objective" : "key_result", id, limit, offset);
      emit(command, data, { count: data.length });
    });
  risk(tasks.command("link <task-id>").description("Link or rebind an active todo to your KR")
    .requiredOption("--key-result <id>"), "write").action(async (id, options, command) => {
      uuid(id); uuid(options.keyResult);
      emit(command, await setOkrTaskLink(await businessContext(command), id, options.keyResult));
    });
  risk(tasks.command("unlink <task-id>").description("Remove a task's OKR link"), "write").action(async (id, _options, command) => {
    uuid(id);
    emit(command, await setOkrTaskLink(await businessContext(command), id, null));
  });
}
