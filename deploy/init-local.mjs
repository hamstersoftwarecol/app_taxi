import { randomBytes } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory = new URL("./.local/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const secret = () => randomBytes(32).toString("hex");
const password = secret(),
  metrics = secret();
const tokenPath = fileURLToPath(new URL("metrics-token", directory));
// Exclusive creation prevents accidental replacement of an active database secret.
const file = await open(new URL(".env.local", directory), "wx", 0o600);
try {
  await file.writeFile(
    [
      "POSTGRES_USER=rayo",
      "POSTGRES_DB=rayo",
      `POSTGRES_PASSWORD=${password}`,
      `DATABASE_URL=postgresql://rayo:${password}@postgres:5432/rayo`,
      `INTERNAL_KEY=${secret()}`,
      `METRICS_TOKEN=${metrics}`,
      `METRICS_TOKEN_FILE=${JSON.stringify(tokenPath)}`,
      `GRAFANA_ADMIN_USER=operator`,
      `GRAFANA_ADMIN_PASSWORD=${secret()}`,
      "PUBLIC_APP_URL=http://localhost:8080",
      "CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081",
      "SMTP_HOST=mailpit",
      "SMTP_PORT=1025",
      "SMTP_TLS=false",
      "SMTP_REQUIRE_TLS=false",
      'SMTP_FROM="Rayo <no-reply@rayo.local>"',
      "MAPBOX_TOKEN=",
      "MAPBOX_PUBLIC_TOKEN=",
      "FARE_RULES_JSON=",
      "STRIPE_SECRET_KEY=",
      "STRIPE_WEBHOOK_SECRET=",
      "",
    ].join("\n"),
  );
  await writeFile(tokenPath, metrics + "\n", { flag: "wx", mode: 0o644 });
} finally {
  await file.close();
}
console.log(
  "Configuración local privada creada en deploy/.local/.env.local; los secretos no se muestran.",
);
