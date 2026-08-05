import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { resolveUser } from "../_shared/resolveUser.ts";

type WorkspaceAdminRequest = {
  action: "delete";
  workspaceId: string;
  confirmationName: string;
};

const WORKSPACE_BUCKETS = ["task-attachments", "comment-images"] as const;

type StorageBucket = {
  list: (
    path: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } },
  ) => Promise<{
    data: Array<{ id: string | null; name: string }> | null;
    error: { message: string } | null;
  }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

type StorageAdminClient = {
  storage: { from: (bucket: string) => StorageBucket };
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function listWorkspaceFiles(
  storage: StorageBucket,
  prefix: string,
): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;

    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id) files.push(path);
      else files.push(...await listWorkspaceFiles(storage, path));
    }

    if (data.length < 100) break;
    offset += data.length;
  }

  return files;
}

async function removeWorkspaceFiles(
  adminClient: StorageAdminClient,
  bucket: string,
  workspaceId: string,
) {
  const storage = adminClient.storage.from(bucket);
  const files = await listWorkspaceFiles(storage, workspaceId);
  for (let index = 0; index < files.length; index += 100) {
    const { error } = await storage.remove(files.slice(index, index + 100));
    if (error) throw error;
  }
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return jsonError("Method not allowed", 405);

    const user = await resolveUser(req, ctx.supabaseAdmin);
    if (!user) return jsonError("Authentication required", 401);
    const userId = user.id;

    const body = await req.json().catch(() => null) as WorkspaceAdminRequest | null;
    if (
      body?.action !== "delete" ||
      typeof body.workspaceId !== "string" ||
      typeof body.confirmationName !== "string"
    ) {
      return jsonError("Invalid request");
    }

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("workspace_members")
      .select("role, workspaces!inner(name)")
      .eq("workspace_id", body.workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError || !membership) {
      return jsonError("Workspace not found", 404);
    }
    if (membership.role !== "owner") {
      return jsonError("Workspace owner access required", 403);
    }

    const workspace = membership.workspaces as unknown as { name: string };
    if (workspace.name !== body.confirmationName) {
      return jsonError("Workspace confirmation does not match", 409);
    }

    try {
      for (const bucket of WORKSPACE_BUCKETS) {
        await removeWorkspaceFiles(
          ctx.supabaseAdmin as unknown as StorageAdminClient,
          bucket,
          body.workspaceId,
        );
      }
    } catch {
      return jsonError("Workspace files could not be removed. Please retry.", 409);
    }

    const { error } = await ctx.supabaseAdmin.rpc("delete_workspace_owned", {
      p_workspace_id: body.workspaceId,
      p_actor_id: userId,
      p_confirmation_name: body.confirmationName,
    });
    if (error) {
      if (error.message.includes("workspace_owner_required")) {
        return jsonError("Workspace owner access required", 403);
      }
      if (error.message.includes("workspace_confirmation_mismatch")) {
        return jsonError("Workspace confirmation does not match", 409);
      }
      return jsonError("Workspace could not be deleted. Please retry.", 409);
    }

    return Response.json({ deleted: true });
  }),
};
