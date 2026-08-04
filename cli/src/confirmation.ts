import { createInterface } from "node:readline/promises";
import { stderr, stdin } from "node:process";
import { CliError } from "./errors.js";

export async function requireConfirmation(action: string, details: unknown, yes: boolean) {
  if (yes) return;
  if (!stdin.isTTY || !stderr.isTTY) {
    throw new CliError({
      type: "confirmation_required",
      code: "confirmation_required",
      message: `${action} requires confirmation`,
      hint: "Review the details and rerun with --yes",
      details: { action, risk: "high-risk-write", preview: details },
      exitCode: 10,
    });
  }
  const prompt = createInterface({ input: stdin, output: stderr });
  try {
    const answer = await prompt.question(`${action} is permanent. Continue? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new CliError({
        type: "confirmation_required",
        code: "confirmation_declined",
        message: "Confirmation declined",
        details: { action, preview: details },
        exitCode: 10,
      });
    }
  } finally {
    prompt.close();
  }
}
