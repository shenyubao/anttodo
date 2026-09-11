import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getDefaultWorkspace: vi.fn(),
  setDefaultWorkspace: vi.fn(),
}));

vi.mock("./storage.js", () => storage);

import { resolveWorkspace } from "./api.js";

function clientFor(workspaces: Array<{ id: string; name: string; slug: string; role: string }>) {
  const memberships = workspaces.map(({ id, role }) => ({ role, workspace_id: id }));
  const workspaceRows = workspaces.map(({ id, name, slug }) => ({ id, name, slug }));
  const membersBuilder = {
    select: vi.fn(() => membersBuilder),
    eq: vi.fn(() => membersBuilder),
    order: vi.fn(async () => ({ data: memberships, error: null })),
  };
  const workspacesBuilder = {
    select: vi.fn(() => workspacesBuilder),
    in: vi.fn(async () => ({ data: workspaceRows, error: null })),
  };
  return {
    from: vi.fn((table: string) => (table === "workspaces" ? workspacesBuilder : membersBuilder)),
  };
}

describe("workspace selection", () => {
  beforeEach(() => {
    storage.getDefaultWorkspace.mockReset().mockResolvedValue(null);
    storage.setDefaultWorkspace.mockReset().mockResolvedValue(undefined);
  });

  it("automatically stores the only joined workspace", async () => {
    const workspace = { id: "00000000-0000-4000-8000-000000000001", name: "One", slug: "one", role: "owner" };
    await expect(resolveWorkspace({ client: clientFor([workspace]) as never, user: { id: "user" } as never }))
      .resolves.toEqual(workspace);
    expect(storage.setDefaultWorkspace).toHaveBeenCalledWith("user", workspace.id);
  });

  it("accepts an exact slug and returns candidates when selection is ambiguous", async () => {
    const workspaces = [
      { id: "00000000-0000-4000-8000-000000000001", name: "One", slug: "one", role: "owner" },
      { id: "00000000-0000-4000-8000-000000000002", name: "Two", slug: "two", role: "member" },
    ];
    const context = { client: clientFor(workspaces) as never, user: { id: "user" } as never };
    await expect(resolveWorkspace(context, "two")).resolves.toEqual(workspaces[1]);
    await expect(resolveWorkspace(context)).rejects.toMatchObject({
      code: "workspace_required",
      details: { workspaces },
    });
  });
});
