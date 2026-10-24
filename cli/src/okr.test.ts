import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerOkrCommands, okrFields } from "./okr-commands.js";
import { commandTree } from "./commands.js";
import {
  currentOkrCycle, equalOkrWeights, finiteOkrNumber, normalizeOkrSet, okrProgressPercent,
  type OkrCycle, type OkrSet,
} from "./okr.js";
import type { OkrContext } from "./okr-api.js";

const cycle = { id: "c", status: "active", starts_on: "2026-01-01", ends_on: "2026-12-31" } as OkrCycle;
const id = "11111111-1111-4111-8111-111111111111";

describe("OKR calculations", () => {
  it("selects the covering active cycle and otherwise follows the app fallback", () => {
    const expired = { ...cycle, id: "old", ends_on: "2025-01-01" };
    const now = new Date("2026-10-24T12:00:00Z");
    expect(currentOkrCycle([expired, cycle], now)).toBe(cycle);
    expect(currentOkrCycle([expired], now)).toBe(expired);
    expect(currentOkrCycle([{ ...cycle, status: "closed" }], now)).toBeNull();
  });
  it("balances weights exactly and supports decreasing metrics", () => {
    expect(equalOkrWeights(3)).toEqual([33.33, 33.33, 33.34]);
    expect(equalOkrWeights(0)).toEqual([]);
    expect(okrProgressPercent({ start_value: 100, target_value: 0, current_value: 25 })).toBe(75);
    expect(okrProgressPercent({ start_value: 0, target_value: 100, current_value: null })).toBeNull();
  });
  it("normalizes numeric fields and computes O progress from weighted KRs", () => {
    const normalized = normalizeOkrSet({ objectives: [{
      id: "o", current_value: 99, status_mode: "manual", progress_status: "risk",
      key_results: [
        { start_value: "0", target_value: "100", current_value: "50", weight: "80" },
        { start_value: 0, target_value: 100, current_value: null, weight: 20 },
      ],
    }] } as unknown as OkrSet, cycle);
    expect(normalized.objectives[0]).toMatchObject({ progress_mode: "key_results", progress_percent: 40, effective_status: "risk" });
    expect(normalized.objectives[0].key_results[0]).toMatchObject({ current_value: 50, weight: 80, progress_percent: 50 });
  });
});

describe("OKR command contract", () => {
  function program() {
    const root = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    const businessContext = vi.fn<() => Promise<OkrContext>>().mockRejectedValue(new Error("context should not be reached"));
    registerOkrCommands(root, { businessContext, emit: vi.fn() });
    const configure = (command: Command) => { command.exitOverride(); command.commands.forEach(configure); };
    configure(root);
    return { root, businessContext };
  }
  it("exposes all domains, risk levels, and machine-readable command paths", () => {
    const { root } = program();
    const okr = root.commands[0];
    expect(okr.commands.map((command) => command.name())).toEqual(["cycle", "get", "objective", "key-result", "publish", "task"]);
    for (const name of ["objective", "key-result"]) {
      const commands = okr.commands.find((command) => command.name() === name)!.commands;
      expect(commandTree(commands.find((command) => command.name() === "get")!).risk).toBe("read");
      expect(commandTree(commands.find((command) => command.name() === "update")!).risk).toBe("write");
      expect(commandTree(commands.find((command) => command.name() === "delete")!).risk).toBe("high-risk-write");
    }
  });
  it.each([
    ["objective", "create"],
    ["key-result", "create", "--title", "KR"],
    ["objective", "update", id],
    ["key-result", "update", id, "--target", "Infinity"],
    ["key-result", "progress", id, "--value", "NaN"],
    ["key-result", "progress", id],
    ["key-result", "progress", id, "--status", "invalid"],
    ["key-result", "progress", id, "--detail", "x".repeat(2001)],
    ["task", "list"],
    ["task", "list", "--objective", id, "--key-result", id],
    ["get", "--owner", "not-a-uuid"],
    ["publish", "--cycle", "not-a-uuid"],
  ])("rejects invalid arguments before authentication: %j", async (...args) => {
    const { root, businessContext } = program();
    await expect(root.parseAsync(["node", "anttodo", "okr", ...args])).rejects.toBeDefined();
    expect(businessContext).not.toHaveBeenCalled();
  });
  it("parses partial fields and preserves explicit empty Markdown", () => {
    expect(okrFields({ note: "" }, true)).toEqual({ note: "" });
    expect(okrFields({ start: "100", target: "0", statusMode: "automatic", unit: "custom", customUnit: "次" }, true))
      .toEqual({ start_value: 100, target_value: 0, status_mode: "automatic", metric_unit: "custom", custom_unit: "次" });
    expect(() => okrFields({ title: "  " }, false)).toThrow();
    expect(() => finiteOkrNumber(" ", "value")).toThrow();
  });
});
