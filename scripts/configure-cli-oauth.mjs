import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const projectUrl = required("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const projectRef = required("SUPABASE_PROJECT_REF");
const publicAppUrl = required("PUBLIC_APP_URL").replace(/\/$/, "");
const redirectUri = `${projectUrl}/functions/v1/cli-device-auth`;
const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: client, error } = await supabase.auth.admin.oauth.createClient({
  client_name: "AntTodo CLI",
  client_uri: publicAppUrl,
  redirect_uris: [redirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: "email profile phone",
  token_endpoint_auth_method: "client_secret_basic",
});
if (error || !client?.client_secret) throw error ?? new Error("OAuth client secret was not returned");

const temporaryDirectory = mkdtempSync(join(tmpdir(), "anttodo-cli-oauth-"));
const secretsFile = join(temporaryDirectory, "edge-secrets.env");
try {
  writeFileSync(secretsFile, [
    `CLI_OAUTH_CLIENT_ID=${JSON.stringify(client.client_id)}`,
    `CLI_OAUTH_CLIENT_SECRET=${JSON.stringify(client.client_secret)}`,
    `CLI_OAUTH_PUBLIC_URL=${JSON.stringify(projectUrl)}`,
    `PUBLIC_APP_URL=${JSON.stringify(publicAppUrl)}`,
    "",
  ].join("\n"), { mode: 0o600 });
  execFileSync(resolve("node_modules/.bin/supabase"), [
    "secrets", "set", "--env-file", secretsFile, "--project-ref", projectRef, "--workdir", ".",
  ], { stdio: "inherit" });
  const { error: registrationError } = await supabase.rpc("cli_device_auth_register_client_v2", {
    p_client_id: client.client_id,
  });
  if (registrationError) throw registrationError;
} catch (cause) {
  await supabase.auth.admin.oauth.deleteClient(client.client_id).catch(() => undefined);
  throw cause;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write(`AntTodo CLI OAuth client configured: ${client.client_id}\n`);
