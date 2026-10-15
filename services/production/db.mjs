import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export function createPool(
  connectionString = process.env.DATABASE_URL,
  options = {},
) {
  if (!connectionString)
    throw new Error(
      "DATABASE_URL es obligatoria. La demo solo se activa con RAYO_MODE=demo.",
    );
  const max = Number(process.env.PG_POOL_SIZE || 10);
  if (!Number.isInteger(max) || max < 2 || max > 50)
    throw Error("PG_POOL_SIZE debe ser un entero entre 2 y 50.");
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options: "-c timezone=America/Bogota",
    application_name: "rayo-" + (process.env.SERVICE || "local"),
    ...options,
  });
  pool.on("error", () =>
    console.error(
      JSON.stringify({ level: "error", code: "POSTGRES_POOL_CONNECTION_LOST" }),
    ),
  );
  return pool;
}
export async function migrate(pool) {
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(726296001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS rayo_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../../migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(
        new URL("../../migrations/" + name, import.meta.url),
        "utf8",
      );
      const hash = createHash("sha256").update(sql).digest("hex");
      const existing = await c.query(
        "SELECT checksum FROM rayo_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== hash)
          throw Error("La migración aplicada cambió: " + name);
        continue;
      }
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query(
          "INSERT INTO rayo_migrations(name,checksum) VALUES($1,$2)",
          [name, hash],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(726296001)");
    c.release();
  }
}
