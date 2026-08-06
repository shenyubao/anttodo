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

function cliPublicConfigPlugin(env: Record<string, string>): Plugin {
  return {
    name: "anttodo-cli-public-config",
    generateBundle() {
      const supabaseUrl = env.VITE_SUPABASE_URL;
      const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const appUrl = env.VITE_PUBLIC_APP_URL;
      if (!supabaseUrl || !publishableKey || !appUrl) return;
      this.emitFile({
        type: "asset",
        fileName: ".well-known/anttodo-cli.json",
        source: `${JSON.stringify({
          supabaseUrl,
          publishableKey,
          appUrl,
          deviceAuthorizationEndpoint: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cli-device-auth`,
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
