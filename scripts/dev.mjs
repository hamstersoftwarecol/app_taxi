import { createPlatform } from "../services/platform.mjs";
import { spawn } from "node:child_process";
const platform = await createPlatform({
  simulate: process.env.SIMULATE_LOCATIONS !== "false",
});
console.log(
  "Rayo API: " +
    platform.url +
    (process.env.RAYO_MODE === "demo"
      ? " · demo explícita"
      : " · PostgreSQL operativo"),
);
const stopWorker = platform.deps
  ? (await import("../services/production/platform.mjs")).startWorker(
      platform.deps,
    )
  : null;
const web = process.argv.includes("--services")
  ? null
  : spawn("npm", ["run", "dev", "-w", "apps/admin"], {
      stdio: "inherit",
      env: process.env,
    });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  web?.kill("SIGTERM");
  await stopWorker?.();
  await platform.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
web?.on("exit", close);
