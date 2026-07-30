import { describe, expect, it } from "vitest";
import { createDemoBundle, demoWorkspaces } from "./demo";

describe("demo workspace", () => {
  it("contains a complete product tour dataset", () => {
    const bundle = createDemoBundle();
    expect(demoWorkspaces.length).toBeGreaterThan(1);
    expect(bundle.labels.some((label) => label.parent_id)).toBe(true);
    expect(bundle.tasks.some((task) => task.label_ids.length > 1)).toBe(true);
    expect(bundle.tasks.some((task) => task.label_ids.length === 0)).toBe(true);
    expect(bundle.connectors.some((connector) => connector.type === "mock")).toBe(true);
    expect(bundle.conflicts.some((conflict) => conflict.status === "open")).toBe(true);
  });

  it("returns a fresh mutable copy for each demo session", () => {
    const first = createDemoBundle();
    const second = createDemoBundle();
    first.tasks[0].title = "changed";
    expect(second.tasks[0].title).not.toBe("changed");
  });
});
