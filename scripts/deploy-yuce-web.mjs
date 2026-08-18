#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnvFiles } from "./load-local-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnvFiles(root);

const help = process.argv.includes("--help") || process.argv.includes("-h");
if (help) {
  console.log(`Usage: pnpm deploy:web:yuce

Builds the current worktree as a production Web container, smoke-tests it,
streams it to the Yuce server over SSH, performs a health-checked Compose
rollout with automatic rollback, and verifies the public site.

Configuration (environment or .env.local):
  ANTTODO_YUCE_WEB_SSH         SSH target; falls back to ANTTODO_SUPABASE_SELFHOST_SSH
  ANTTODO_YUCE_WEB_DEPLOY_DIR  Remote deploy/ubuntu directory; auto-detected if omitted
  ANTTODO_YUCE_WEB_URL         Public origin (default: https://todo.yuce-tech.cn)
`);
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const sshTarget = setting("ANTTODO_YUCE_WEB_SSH") || setting("ANTTODO_SUPABASE_SELFHOST_SSH");
const configuredDeployDir = setting("ANTTODO_YUCE_WEB_DEPLOY_DIR");
const publicOrigin = setting("ANTTODO_YUCE_WEB_URL") || "https://todo.yuce-tech.cn";

validateConfiguration();

const remote = await inspectRemote();
const platform = platformForArchitecture(remote.architecture);
const version = String(packageJson.version).replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
const image = `anttodo-web:yuce-${version}-${stamp}`;

console.log(`Yuce Web target: ${sshTarget}:${remote.deployDir}`);
console.log(`Remote architecture: ${remote.architecture} (${platform})`);
console.log("Building production Web assets with the locked local dependencies…");
await run("pnpm", ["build:web"]);
console.log(`Building ${image} from the current worktree…`);
await run("docker", [
  "build",
  "--platform",
  platform,
  "--file",
  "deploy/ubuntu/Dockerfile.runtime",
  "--tag",
  image,
  ".",
]);

console.log("Running the hardened Web container smoke test…");
await run("sh", ["deploy/ubuntu/smoke-test.sh", image]);

console.log("Streaming the verified image to the Yuce server…");
await transferImage(image);

console.log("Starting the health-checked production rollout…");
const rolloutOutput = await runRemoteScript(remoteRolloutScript(remote.deployDir, image), {
  capture: true,
  tee: true,
});
const deployedAsset = rolloutOutput
  .split(/\r?\n/)
  .find((line) => line.startsWith("ANTTODO_DEPLOYED_ASSET="))
  ?.slice("ANTTODO_DEPLOYED_ASSET=".length)
  .trim();

await verifyPublicSite(deployedAsset);
console.log(`Yuce Web deployment completed: ${publicOrigin}`);

function setting(name) {
  return process.env[name]?.trim() ?? "";
}

function validateConfiguration() {
  if (!sshTarget) {
    throw new Error(
      "Set ANTTODO_YUCE_WEB_SSH or ANTTODO_SUPABASE_SELFHOST_SSH in .env.local.",
    );
  }
  if (!/^[A-Za-z0-9_.@:-]+$/.test(sshTarget)) {
    throw new Error("The Yuce SSH target contains unsupported characters.");
  }
  if (configuredDeployDir && !/^\/[A-Za-z0-9_./-]+$/.test(configuredDeployDir)) {
    throw new Error("ANTTODO_YUCE_WEB_DEPLOY_DIR must be an absolute path.");
  }
  const parsed = new URL(publicOrigin);
  if (parsed.protocol !== "https:" || parsed.origin !== publicOrigin.replace(/\/$/, "")) {
    throw new Error("ANTTODO_YUCE_WEB_URL must be an HTTPS origin without a path.");
  }
}

async function inspectRemote() {
  const requestedDir = configuredDeployDir ? shellQuote(configuredDeployDir) : "''";
  const output = await runRemoteScript(`set -eu
requested_dir=${requestedDir}
if [ -n "$requested_dir" ]; then
  deploy_dir=$requested_dir
else
  matches=$(find "$HOME" -maxdepth 6 -type f -path '*/deploy/ubuntu/compose.yaml' -print 2>/dev/null || true)
  count=$(printf '%s\n' "$matches" | sed '/^$/d' | wc -l | tr -d ' ')
  if [ "$count" != "1" ]; then
    echo "Expected exactly one deploy/ubuntu/compose.yaml under $HOME; found $count." >&2
    echo "Set ANTTODO_YUCE_WEB_DEPLOY_DIR in .env.local." >&2
    exit 1
  fi
  deploy_dir=$(dirname "$matches")
fi
test -f "$deploy_dir/compose.yaml"
test -f "$deploy_dir/.env"
printf 'ANTTODO_REMOTE_ARCH=%s\n' "$(uname -m)"
printf 'ANTTODO_REMOTE_DEPLOY_DIR=%s\n' "$deploy_dir"
`, { capture: true });

  const architecture = valueFromOutput(output, "ANTTODO_REMOTE_ARCH");
  const deployDir = valueFromOutput(output, "ANTTODO_REMOTE_DEPLOY_DIR");
  if (!architecture || !deployDir) {
    throw new Error("The Yuce server did not return its architecture and deploy directory.");
  }
  if (!/^\/[A-Za-z0-9_./-]+$/.test(deployDir)) {
    throw new Error("The auto-detected remote deploy directory is unsafe.");
  }
  return { architecture, deployDir };
}

function platformForArchitecture(architecture) {
  if (["x86_64", "amd64"].includes(architecture)) return "linux/amd64";
  if (["aarch64", "arm64"].includes(architecture)) return "linux/arm64";
  throw new Error(`Unsupported Yuce server architecture: ${architecture}`);
}

function valueFromOutput(output, key) {
  return output
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function remoteRolloutScript(deployDir, image) {
  return `set -eu
deploy_dir=${shellQuote(deployDir)}
image=${shellQuote(image)}
cd "$deploy_dir"
test -f .env
test -f compose.yaml
docker image inspect "$image" >/dev/null

compose_with_image() {
  image_ref=$1
  shift
  ANTTODO_WEB_IMAGE="$image_ref" docker compose --env-file .env -f compose.yaml "$@"
}

current_container=$(compose_with_image "$image" ps -aq web)
rollback_image=""
if [ -n "$current_container" ]; then
  previous_image_id=$(docker inspect --format '{{.Image}}' "$current_container")
  rollback_image="anttodo-web:yuce-rollback-$(date +%Y%m%d%H%M%S)"
  docker tag "$previous_image_id" "$rollback_image"
  printf '%s\n' "$rollback_image" > .previous-image
fi

if ! compose_with_image "$image" up -d --remove-orphans --no-build --pull never; then
  if [ -n "$rollback_image" ]; then
    echo "Compose rollout failed; restoring $rollback_image" >&2
    compose_with_image "$rollback_image" up -d --remove-orphans --no-build --pull never || true
  fi
  exit 1
fi

health=""
attempt=0
while [ "$attempt" -lt 60 ]; do
  container=$(compose_with_image "$image" ps -aq web)
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)
  [ "$health" = "healthy" ] && break
  [ "$health" = "unhealthy" ] || [ "$health" = "exited" ] && break
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$health" != "healthy" ]; then
  echo "Yuce Web failed its health check with status: \${health:-missing}" >&2
  [ -n "\${container:-}" ] && docker logs --tail 200 "$container" >&2 || true
  if [ -n "$rollback_image" ]; then
    echo "Rolling back to $rollback_image" >&2
    compose_with_image "$rollback_image" up -d --remove-orphans --no-build --pull never
  fi
  exit 1
fi

asset=$(docker exec "$container" sh -c "find /usr/share/nginx/html/assets -maxdepth 1 -name 'index-*.js' -print | sed -n '1p'")
asset=$(basename "$asset")
echo "Yuce Web is healthy: $image"
printf 'ANTTODO_DEPLOYED_ASSET=/assets/%s\n' "$asset"
`;
}

async function verifyPublicSite(expectedAsset) {
  const origin = publicOrigin.replace(/\/$/, "");
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const health = await fetch(`${origin}/healthz?deploy=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (!health.ok || (await health.text()).trim() !== "ok") {
        throw new Error(`health endpoint returned HTTP ${health.status}`);
      }

      const htmlResponse = await fetch(`${origin}/?deploy=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (!htmlResponse.ok) throw new Error(`root page returned HTTP ${htmlResponse.status}`);
      const html = await htmlResponse.text();
      if (expectedAsset && !html.includes(expectedAsset)) {
        throw new Error(`public root has not switched to ${expectedAsset}`);
      }
      console.log(`Public verification passed${expectedAsset ? ` (${expectedAsset})` : ""}.`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw new Error(
    `Production container is healthy, but public verification failed: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function transferImage(imageName) {
  const save = spawn("docker", ["save", imageName], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const gzip = spawn("gzip", ["-1"], {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const remoteLoad = spawn("ssh", [sshTarget, "gzip -dc | docker load"], {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
  });

  save.stdout.pipe(gzip.stdin);
  gzip.stdout.pipe(remoteLoad.stdin);
  gzip.stdin.on("error", ignoreBrokenPipe);
  remoteLoad.stdin.on("error", ignoreBrokenPipe);

  const results = await Promise.allSettled([
    waitForExit(save, "docker save"),
    waitForExit(gzip, "gzip"),
    waitForExit(remoteLoad, "remote docker load"),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

function ignoreBrokenPipe(error) {
  if (error?.code !== "EPIPE") throw error;
}

async function runRemoteScript(script, options = {}) {
  return run("ssh", [sshTarget, "sh -s"], { ...options, input: script });
}

function run(command, args, { capture = false, tee = false, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"],
    });
    let stdout = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (tee) process.stdout.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code}).`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? code}).`));
    });
  });
}
