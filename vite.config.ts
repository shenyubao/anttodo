import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  version?: string;
};
const appVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

function parseDeployMode(value: string | undefined) {
  const mode = value?.trim() || "saas";
  if (mode !== "saas" && mode !== "onPremises") {
    throw new Error("ANTTODO_DEPLOY_MODE must be saas or onPremises");
  }
  return mode;
}

function parseEnterpriseSlug(env: Record<string, string>) {
  const workspaceSlug = env.ANTTODO_INSTANCE_ENTERPRISE_SLUG?.trim()
    || env.ANTTODO_WORKSPACE_SLUG?.trim()
    || env.VITE_WORKSPACE_SLUG?.trim()
    || "";
  if (workspaceSlug && (
    workspaceSlug.length < 2
    || workspaceSlug.length > 48
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug)
  )) {
    throw new Error("ANTTODO_INSTANCE_ENTERPRISE_SLUG must contain 2 to 48 lowercase letters, numbers, and hyphens");
  }
  return workspaceSlug;
}

function cliPublicConfigPlugin(env: Record<string, string>): Plugin {
  return {
    name: "anttodo-cli-public-config",
    generateBundle() {
      const supabaseUrl = env.VITE_SUPABASE_URL;
      const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const appUrl = env.VITE_PUBLIC_APP_URL;
      if (!supabaseUrl || !publishableKey || !appUrl) return;
      const instanceId = env.ANTTODO_INSTANCE_ID || "00000000-0000-4000-8000-000000000001";
      const displayName = env.ANTTODO_INSTANCE_DISPLAY_NAME?.trim() || "AntTodo.com";
      if (!displayName || displayName.length > 80) {
        throw new Error("ANTTODO_INSTANCE_DISPLAY_NAME must contain 1 to 80 characters");
      }
      const deployMode = parseDeployMode(env.ANTTODO_DEPLOY_MODE);
      const workspaceSlug = parseEnterpriseSlug(env);
      if (deployMode === "onPremises" && !workspaceSlug) {
        throw new Error("ANTTODO_INSTANCE_ENTERPRISE_SLUG is required when ANTTODO_DEPLOY_MODE=onPremises");
      }
      const deviceAuthorizationEndpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cli-device-auth`;
      this.emitFile({
        type: "asset",
        fileName: ".well-known/anttodo-cli.json",
        source: `${JSON.stringify({
          supabaseUrl,
          publishableKey,
          appUrl,
          deviceAuthorizationEndpoint,
          cliAuthProtocol: 2,
        })}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: ".well-known/anttodo.json",
        source: `${JSON.stringify({
          schemaVersion: 1,
          instanceId,
          displayName,
          deployMode,
          ...(workspaceSlug ? { workspaceSlug } : {}),
          appUrl,
          supabaseUrl,
          publishableKey,
          deviceAuthorizationEndpoint,
          cliAuthProtocol: 2,
        })}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, root, ""),
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
  return {
    plugins: [react(), tailwindcss(), cliPublicConfigPlugin(env)],
    base: "./",
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""),
      "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(env.VITE_PUBLIC_APP_URL ?? ""),
      "import.meta.env.ANTTODO_INSTANCE_DISPLAY_NAME": JSON.stringify(env.ANTTODO_INSTANCE_DISPLAY_NAME?.trim() || ""),
      "import.meta.env.ANTTODO_DEPLOY_MODE": JSON.stringify(parseDeployMode(env.ANTTODO_DEPLOY_MODE)),
      "import.meta.env.ANTTODO_INSTANCE_ENTERPRISE_SLUG": JSON.stringify(parseEnterpriseSlug(env)),
      "import.meta.env.ANTTODO_WORKSPACE_SLUG": JSON.stringify(parseEnterpriseSlug(env)),
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
