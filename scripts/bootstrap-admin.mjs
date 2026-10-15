import { createPool, migrate } from "../services/production/db.mjs";
import { bootstrapAdmin } from "../services/production/auth.mjs";
import { readFileSync } from "node:fs";
const password = process.env.ADMIN_PASSWORD_FILE
  ? readFileSync(process.env.ADMIN_PASSWORD_FILE, "utf8").trim()
  : process.env.ADMIN_PASSWORD;
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_NAME || !password)
  throw Error(
    "Define ADMIN_EMAIL, ADMIN_NAME y ADMIN_PASSWORD_FILE (o ADMIN_PASSWORD). No hay credenciales predeterminadas.",
  );
const pool = createPool();
try {
  await migrate(pool);
  await bootstrapAdmin({
    pool,
    email: process.env.ADMIN_EMAIL,
    name: process.env.ADMIN_NAME,
    password,
  });
  console.log(
    "Administrador creado o existente. No se cambiaron credenciales existentes.",
  );
} finally {
  await pool.end();
}
