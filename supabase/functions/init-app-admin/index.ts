import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const APP_ADMIN_ROLE = "super_admin";

function normalizeMobile(value: unknown) {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0086")) digits = digits.slice(4);
  if (digits.startsWith("86") && digits.length === 13) digits = digits.slice(2);
  if (!/^1[3-9]\d{9}$/.test(digits)) return null;
  return `+86${digits}`;
}

function maskMobile(phone: string) {
  return `${phone.slice(0, 7)}****${phone.slice(-4)}`;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function authorized(req: Request) {
  const configured = Deno.env.get("INIT_APP_ADMIN_SECRET")?.trim();
  const provided = req.headers.get("x-init-app-admin-secret")?.trim() ?? "";
  return Boolean(configured && provided && constantTimeEqual(configured, provided));
}

async function findUserByPhone(admin: any, phone: string) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    const users = data?.users ?? [];
    const user = users.find((candidate: any) => normalizeMobile(candidate.phone) === phone);
    if (user) return user;
    if (users.length < 1_000) return null;
  }
  throw new Error("Too many auth users to scan during admin bootstrap");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    if (!authorized(req)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as { mobile?: unknown } | null;
    const configuredMobile = normalizeMobile(
      Deno.env.get("INIT_APP_ADMIN_MOBILE"),
    );
    const requestedMobile = normalizeMobile(body?.mobile);
    if (!configuredMobile || !requestedMobile || configuredMobile !== requestedMobile) {
      return Response.json({ error: "Invalid admin mobile" }, { status: 400 });
    }

    try {
      const existing = await findUserByPhone(ctx.supabaseAdmin, configuredMobile);
      if (existing) {
        const appMetadata = existing.app_metadata ?? {};
        const alreadyAdmin = appMetadata.is_app_admin === true
          && appMetadata.app_role === APP_ADMIN_ROLE;
        if (!alreadyAdmin) {
          const { error } = await ctx.supabaseAdmin.auth.admin.updateUserById(
            existing.id,
            {
              app_metadata: {
                ...appMetadata,
                is_app_admin: true,
                app_role: APP_ADMIN_ROLE,
              },
            },
          );
          if (error) throw error;
          return Response.json({
            status: "promoted",
            userId: existing.id,
            mobile: maskMobile(configuredMobile),
          });
        }
        return Response.json({
          status: "exists",
          userId: existing.id,
          mobile: maskMobile(configuredMobile),
        });
      }

      const { data, error } = await ctx.supabaseAdmin.auth.admin.createUser({
        phone: configuredMobile,
        phone_confirm: true,
        app_metadata: {
          is_app_admin: true,
          app_role: APP_ADMIN_ROLE,
        },
        user_metadata: {
          display_name: "系统管理员",
        },
      });
      if (error || !data.user) {
        if (error?.message.toLowerCase().includes("already registered")) {
          const raced = await findUserByPhone(ctx.supabaseAdmin, configuredMobile);
          if (raced) {
            return Response.json({
              status: "exists",
              userId: raced.id,
              mobile: maskMobile(configuredMobile),
            });
          }
        }
        throw error ?? new Error("Unable to create app admin");
      }
      return Response.json({
        status: "created",
        userId: data.user.id,
        mobile: maskMobile(configuredMobile),
      });
    } catch (error) {
      console.error("App admin bootstrap failed", {
        message: error instanceof Error ? error.message : "unknown_error",
      });
      return Response.json({ error: "Unable to bootstrap app admin" }, { status: 500 });
    }
  }),
};
