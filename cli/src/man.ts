import type { Argument, Command, Option } from "commander";

const SKIP_COMMANDS = new Set(["help"]);

function visibleSubcommands(command: Command): Command[] {
  return command.commands.filter((cmd) => !SKIP_COMMANDS.has(cmd.name()));
}

function commandDescription(command: Command): string {
  return command.description() || command.summary();
}

function formatArgumentLine(argument: Argument, indent: string): string {
  const name = argument.name();
  const term = argument.variadic
    ? argument.required
      ? `<${name}...>`
      : `[${name}...]`
    : argument.required
      ? `<${name}>`
      : `[${name}]`;
  const requiredLabel = argument.required ? " [required]" : " [optional]";
  const description = argument.description || "";
  return `${indent}${term}${requiredLabel}${description ? ` — ${description}` : ""}`;
}

function formatOptionLine(option: Option, indent: string): string {
  const requiredLabel = option.mandatory ? " [required]" : " [optional]";
  const description = option.description || "";
  return `${indent}${option.flags}${requiredLabel}${description ? ` — ${description}` : ""}`;
}

function formatArguments(command: Command, indent: string): string[] {
  const args = command.registeredArguments ?? [];
  return args.map((argument) => formatArgumentLine(argument, indent));
}

function formatOptions(command: Command, indent: string): string[] {
  return command.options.map((option) => formatOptionLine(option, indent));
}

function formatSubcommandTree(help: ReturnType<Command["createHelp"]>, command: Command, indent: string): string[] {
  const lines: string[] = [];
  const children = visibleSubcommands(command);
  const description = commandDescription(command);

  if (children.length > 0) {
    lines.push(`${indent}${command.name()}${description ? ` — ${description}` : ""}`);
    lines.push(...formatArguments(command, `${indent}  `));
    lines.push(...formatOptions(command, `${indent}  `));
    for (const child of children) {
      lines.push(...formatSubcommandTree(help, child, `${indent}  `));
    }
    return lines;
  }

  const term = help.subcommandTerm(command);
  lines.push(`${indent}${term}${description ? ` — ${description}` : ""}`);
  lines.push(...formatArguments(command, `${indent}  `));
  lines.push(...formatOptions(command, `${indent}  `));
  return lines;
}

/** Human-readable command tree in the OpenInsight `man` style. */
export function formatMan(program: Command): string {
  const help = program.createHelp();
  const lines: string[] = [];
  lines.push(`${program.name()} — ${program.description()}`);
  lines.push("");
  lines.push(...formatOptions(program, "  "));
  if (program.options.length) lines.push("");

  for (const command of visibleSubcommands(program)) {
    lines.push(...formatSubcommandTree(help, command, "  "));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
