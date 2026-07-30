import { execFileSync } from "node:child_process";

const port = Number(process.argv[2] ?? 5173);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid port: ${process.argv[2]}`);
  process.exit(1);
}

let pids = [];
try {
  pids = execFileSync("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
} catch {
  // Nothing is listening on this port.
}

for (const pid of pids) {
  try {
    process.kill(Number(pid), "SIGKILL");
    console.log(`[free-port] freed :${port} (killed pid ${pid})`);
  } catch {
    // Process already exited.
  }
}
