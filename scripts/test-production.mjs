import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
if (!process.env.TEST_DATABASE_URL)
  throw Error(
    "Define TEST_DATABASE_URL con PostgreSQL de pruebas. No se usa DATABASE_URL para evitar ejecutar pruebas sobre operación real.",
  );
const files = (await readdir("tests"))
  .filter((f) => f.endsWith("-production.test.mjs"))
  .map((f) => "tests/" + f);
const child = spawn(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
