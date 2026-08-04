#!/usr/bin/env node
import { CommanderError } from "commander";
import { buildProgram, configureMachineErrors } from "./commands.js";
import { asCliError, CliError } from "./errors.js";
import { renderError } from "./output.js";

const program = configureMachineErrors(buildProgram());

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError && ["commander.helpDisplayed", "commander.version"].includes(error.code)) {
    process.exitCode = 0;
  } else {
    const normalized = error instanceof CommanderError
      ? new CliError({ type: "validation", code: error.code, message: error.message })
      : asCliError(error);
    const rendered = renderError(normalized, program.opts().format === "pretty" && !program.opts().json);
    process.stderr.write(rendered.text);
    process.exitCode = rendered.exitCode;
  }
}
