/**
 * Resolve the signed-in user from a Bearer access token.
 *
 * Self-hosted AntTodo still issues legacy HS256 session JWTs without a `kid`.
 * `@supabase/server`'s `auth: "user"` mode requires JWKS + kid, so it rejects
 * every real session with INVALID_CREDENTIALS. Prefer this helper (via
 * Auth `getUser`) until JWT signing keys / JWKS are configured.
 */
export type ResolvedUser = {
  id: string;
  email: string | null;
  token: string;
};

type AdminAuthClient = {
  auth: {
    getUser: (jwt: string) => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message: string } | null;
    }>;
  };
};

export async function resolveUser(
  req: Request,
  supabaseAdmin: AdminAuthClient,
): Promise<ResolvedUser | null> {
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)/i)?.[1];
  if (!token || token.startsWith("sb_")) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    token,
  };
}
