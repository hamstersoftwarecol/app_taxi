import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import pg from "pg";
const directory = resolve(".local");
await mkdir(directory, { recursive: true, mode: 0o700 });
const candidates = [
  process.env.POSTGRES_BIN,
  "/opt/homebrew/opt/postgresql@17/bin",
  "/usr/local/opt/postgresql@17/bin",
  "/usr/lib/postgresql/17/bin",
].filter(Boolean);
let bin;
for (const value of candidates) {
  try {
    await access(join(value, "initdb"));
    bin = value;
    break;
  } catch {}
}
if (!bin)
  throw Error(
    "Instala PostgreSQL17 o define POSTGRES_BIN. Alternativa: deploy/compose.sh local.",
  );
const cluster = join(directory, "postgres");
const adminFile = join(directory, "db-admin-password");
const appFile = join(directory, "db-app-password");
const secret = async (file) => {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const value = randomBytes(32).toString("hex");
    await writeFile(file, value, { mode: 0o600, flag: "wx" });
    return value;
  }
};
const adminPassword = await secret(adminFile),
  appPassword = await secret(appFile);
try {
  await access(join(cluster, "PG_VERSION"));
} catch {
  const result = spawnSync(
    join(bin, "initdb"),
    [
      "-D",
      cluster,
      "-U",
      "rayo_admin",
      "--pwfile=" + adminFile,
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--encoding=UTF8",
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0)
    throw Error("No se pudo inicializar PostgreSQL local.");
}
const status = spawnSync(join(bin, "pg_ctl"), ["-D", cluster, "status"], {
  stdio: "ignore",
});
if (status.status !== 0) {
  const result = spawnSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      cluster,
      "-l",
      join(directory, "postgres.log"),
      "-o",
      "-h 127.0.0.1 -p 55432",
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0)
    throw Error(
      "No se pudo iniciar PostgreSQL en 127.0.0.1:55432. Revisa .local/postgres.log.",
    );
}
const client = new pg.Client({
  connectionString:
    "postgresql://rayo_admin:" + adminPassword + "@127.0.0.1:55432/postgres",
});
await client.connect();
try {
  if (
    !(await client.query("SELECT 1 FROM pg_roles WHERE rolname='rayo_app'"))
      .rowCount
  )
    await client.query(
      "CREATE ROLE rayo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" +
        appPassword +
        "'",
    );
  if (
    !(await client.query("SELECT 1 FROM pg_database WHERE datname='rayo'"))
      .rowCount
  )
    await client.query("CREATE DATABASE rayo OWNER rayo_app");
} finally {
  await client.end();
}
let env = "";
try {
  env = await readFile(".env", "utf8");
} catch {}
const defaults = {
  RAYO_MODE: "production",
  DATABASE_URL:
    "postgresql://rayo_app:" + appPassword + "@127.0.0.1:55432/rayo",
  PUBLIC_APP_URL: "http://localhost:3000",
  INTERNAL_KEY: randomBytes(48).toString("hex"),
  METRICS_TOKEN: randomBytes(32).toString("hex"),
  CORS_ORIGINS:
    "http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000,http://127.0.0.1:8081",
};
for (const [key, value] of Object.entries(defaults)) {
  const re = new RegExp("^" + key + "=(.*)$", "m");
  const found = env.match(re);
  if (!found) env += "\n" + key + "=" + value;
  else if (!found[1].trim()) env = env.replace(re, key + "=" + value);
}
await writeFile(".env", env.trim() + "\n", { mode: 0o600 });
let mobileEnv = "";
try {
  mobileEnv = await readFile("apps/mobile/.env.local", "utf8");
} catch {}
if (!/^EXPO_PUBLIC_API_URL=/m.test(mobileEnv))
  await writeFile(
    "apps/mobile/.env.local",
    mobileEnv + "\nEXPO_PUBLIC_API_URL=http://localhost:3100\n",
    { mode: 0o600 },
  );
console.log(
  "PostgreSQL local disponible y .env configurado. No se crearon usuarios de la aplicación.",
);
