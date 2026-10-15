import { createPool, migrate } from "../services/production/db.mjs";
const pool = createPool();
try {
  await migrate(pool);
  console.log("Migraciones PostgreSQL aplicadas.");
} finally {
  await pool.end();
}
