import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { appBase, errorHandler, sign } from "../common.mjs";
import { fail } from "../../packages/shared/domain.mjs";
export function authService({ path, internalKey, secret }) {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,role TEXT,salt TEXT,hash TEXT)",
  );
  const add = db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)");
  for (const [id, name, email, role] of [
    ["admin", "Daniel Martínez", "admin@rayo.demo", "admin"],
    ["passenger-1", "Valentina Ríos", "pasajero@rayo.demo", "passenger"],
    ["driver-1", "Carlos Mendoza", "conductor@rayo.demo", "driver"],
  ]) {
    const salt = randomBytes(16).toString("hex");
    add.run(
      id,
      name,
      email,
      role,
      salt,
      scryptSync("RayoDemo2026!", salt, 64).toString("hex"),
    );
  }
  const app = appBase(internalKey);
  const attempts = new Map();
  app.post("/login", (req, res) => {
    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();
    const key = req.ip + email;
    const attempt = attempts.get(key);
    if (attempt && attempt.count >= 8 && Date.now() - attempt.at < 60000)
      fail("Demasiados intentos. Espera un minuto.", 429);
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const password = req.body.password;
    if (typeof password !== "string" || password.length > 200)
      fail("Credenciales no válidas.", 401);
    if (
      !user ||
      !timingSafeEqual(
        scryptSync(password, user.salt, 64),
        Buffer.from(user.hash, "hex"),
      )
    ) {
      attempts.set(key, { count: (attempt?.count || 0) + 1, at: Date.now() });
      fail("Correo o contraseña incorrectos.", 401);
    }
    attempts.delete(key);
    const publicUser = {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    res.json({ user: publicUser, token: sign(publicUser, secret) });
  });
  const cleanup = setInterval(() => {
    for (const [key, a] of attempts)
      if (Date.now() - a.at > 60000) attempts.delete(key);
  }, 60000);
  cleanup.unref();
  app.use(errorHandler);
  return {
    app,
    close: () => {
      clearInterval(cleanup);
      db.close();
    },
  };
}
