import { randomBytes } from "node:crypto";
import { createPool, migrate } from "../services/production/db.mjs";
export async function testDatabase() {
  const base = createPool(process.env.TEST_DATABASE_URL);
  const schema = "t_" + randomBytes(8).toString("hex");
  await base.query("CREATE SCHEMA " + schema);
  const pool = createPool(process.env.TEST_DATABASE_URL, {
    options: "-c search_path=" + schema,
    max: 15,
  });
  await migrate(pool);
  return {
    pool,
    async close() {
      await pool.end();
      await base.query("DROP SCHEMA " + schema + " CASCADE");
      await base.end();
    },
  };
}
