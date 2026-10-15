import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
test("servicios ejecutan como cuatro procesos independientes y comparten contratos HTTP", async () => {
  const dir = mkdtempSync(tmpdir() + "/rayo-processes-");
  const names = ["auth", "trips", "tracking", "gateway"];
  const ports = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await freePort()])),
  );
  const children = [];
  let output = "";
  const env = {
    RAYO_MODE: "demo",
    ...process.env,
    SESSION_SECRET: "process-smoke-session-key",
    INTERNAL_KEY: "process-smoke-internal-key",
    SIMULATE_LOCATIONS: "false",
    AUTH_URL: "http://127.0.0.1:" + ports.auth,
    TRIPS_URL: "http://127.0.0.1:" + ports.trips,
    TRACKING_URL: "http://127.0.0.1:" + ports.tracking,
  };
  try {
    for (const name of names) {
      const child = spawn(process.execPath, ["services/run.mjs"], {
        cwd: process.cwd(),
        env: {
          ...env,
          SERVICE: name,
          PORT: String(ports[name]),
          DATA_DIR: dir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
    }
    const url = "http://127.0.0.1:" + ports.gateway;
    let data;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(url + "/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "admin@rayo.demo",
            password: "RayoDemo2026!",
          }),
        });
        if (res.ok) {
          data = await res.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(data?.token, output);
    const r = await fetch(url + "/api/trips", {
      headers: { authorization: "Bearer " + data.token },
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).length, 8);
    const locations = await fetch(url + "/api/locations", {
      headers: { authorization: "Bearer " + data.token },
    });
    assert.equal((await locations.json()).length, 6);
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once("exit", resolve);
            child.kill("SIGTERM");
          }),
      ),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
