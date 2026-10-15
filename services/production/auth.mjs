import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { appBase, errorHandler } from "../common.mjs";
import { fail } from "../../packages/shared/domain.mjs";
const derive = promisify(scrypt);
const hash = (t) => createHash("sha256").update(t).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const user = (row) => ({
  sub: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  emailVerified: row.email_verified,
});
function emailAddress(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(value)
  )
    fail("Correo inválido.");
  return value.trim().toLowerCase();
}
function passwordValid(value) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 128 ||
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/[0-9]/.test(value) ||
    !/[^a-zA-Z0-9]/.test(value)
  )
    fail(
      "La contraseña requiere 12 a 128 caracteres, mayúsculas, minúsculas, números y símbolos.",
    );
}
async function passwordHash(password) {
  passwordValid(password);
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt, 64)).toString("hex")}`;
}
async function passwordMatches(password, stored) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [format, salt, key] = stored.split(":");
  if (format !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex"),
    actual = await derive(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function bootstrapAdmin({ pool, email, name, password }) {
  const normalized = emailAddress(email);
  if (typeof name !== "string" || !name.trim() || name.length > 160)
    fail("Nombre inválido.");
  const encoded = await passwordHash(password);
  const result = await pool.query(
    `INSERT INTO users(id,name,email,role,password_hash,email_verified) VALUES($1,$2,$3,'admin',$4,true) ON CONFLICT(email) DO NOTHING RETURNING *`,
    [randomUUID(), name.trim(), normalized, encoded],
  );
  const row =
    result.rows[0] ||
    (await pool.query("SELECT * FROM users WHERE email=$1", [normalized]))
      .rows[0];
  if (row.role !== "admin")
    fail("El correo ya pertenece a una cuenta sin rol administrador.", 409);
  return user(row);
}
export async function createAuthService({
  pool,
  internalKey,
  mailer,
  audit = async () => {},
}) {
  if (!pool || !internalKey)
    throw Error("Production auth requires pool and internalKey.");
  const app = appBase(internalKey);
  async function rate(req, email, action, limit = 10) {
    // x-client-ip is accepted only after appBase authenticates the internal gateway.
    const ip = String(
      req.headers["x-client-ip"] || req.socket.remoteAddress || "unknown",
    ).slice(0, 128);
    for (const scope of [`email:${email}`, `ip:${ip}`]) {
      const { rows } = await pool.query(
        `INSERT INTO auth_rate_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END, window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`,
        [`${action}:${hash(scope)}`],
      );
      if (rows[0].attempts > (scope.startsWith("ip:") ? limit * 5 : limit))
        fail("Demasiados intentos. Intenta de nuevo más tarde.", 429);
    }
  }
  function delivery() {
    if (typeof mailer?.send !== "function")
      fail("El envío de correo no está configurado.", 503);
    let base;
    try {
      base = new URL(process.env.PUBLIC_APP_URL);
    } catch {
      fail("PUBLIC_APP_URL no está configurada.", 503);
    }
    if (base.protocol !== "https:" && base.hostname !== "localhost")
      fail("PUBLIC_APP_URL requiere HTTPS.", 503);
    return base;
  }
  async function sendToken(row, purpose) {
    const base = delivery(),
      token = opaque();
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [row.id]);
      await db.query(
        "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",
        [row.id, purpose],
      );
      await db.query(
        `INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+ $4::interval)`,
        [
          hash(token),
          row.id,
          purpose,
          purpose === "verify" ? "24 hours" : "30 minutes",
        ],
      );
    });
    const link = new URL(
      purpose === "verify" ? "/auth/verify-email" : "/auth/reset-password",
      base,
    );
    link.searchParams.set("token", token);
    try {
      await mailer.send({
        to: row.email,
        subject:
          purpose === "verify"
            ? "Confirma tu correo"
            : "Recupera tu contraseña",
        text: `${link.href}`,
      });
    } catch {
      await pool.query("DELETE FROM auth_tokens WHERE token_hash=$1", [
        hash(token),
      ]);
      fail("No se pudo enviar el correo. Intenta de nuevo.", 503);
    }
  }
  async function session(token, db = pool) {
    if (typeof token !== "string" || token.length > 256)
      fail("Sesión inválida.", 401);
    const { rows } = await db.query(
      `SELECT u.*,s.id AS session_id,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [hash(token)],
    );
    if (!rows[0]) fail("Tu sesión terminó. Vuelve a ingresar.", 401);
    return rows[0];
  }
  app.post("/register", async (req, res) => {
    const { name, password, role } = req.body;
    const email = emailAddress(req.body.email);
    if (typeof name !== "string" || !name.trim() || name.length > 160)
      fail("Nombre inválido.");
    if (!["passenger", "driver"].includes(role)) fail("Rol inválido.");
    passwordValid(password);
    await rate(req, email, "register", 5);
    delivery();
    let row;
    try {
      row = (
        await pool.query(
          "INSERT INTO users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            randomUUID(),
            name.trim(),
            email,
            role,
            await passwordHash(password),
          ],
        )
      ).rows[0];
    } catch (e) {
      if (e.code === "23505") fail("El correo ya está registrado.", 409);
      throw e;
    }
    try {
      await sendToken(row, "verify");
    } catch (error) {
      await transaction(pool, async (db) => {
        await db.query("DELETE FROM auth_tokens WHERE user_id=$1", [row.id]);
        await db.query(
          "DELETE FROM users WHERE id=$1 AND email_verified=false",
          [row.id],
        );
      });
      throw error;
    }
    await audit(row.id, "auth.register", row.id);
    res.status(201).json({
      user: user(row),
      message: "Revisa tu correo para confirmar tu cuenta.",
    });
  });
  app.post("/login", async (req, res) => {
    const email = emailAddress(req.body.email);
    await rate(req, email, "login");
    const { row, token, id, expiresAt } = await transaction(
      pool,
      async (db) => {
        const row = (
          await db.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [
            email,
          ])
        ).rows[0];
        const valid = await passwordMatches(
          req.body.password,
          row?.password_hash ||
            "scrypt:00000000000000000000000000000000:" + "00".repeat(64),
        );
        if (!row || !valid) fail("Correo o contraseña incorrectos.", 401);
        if (!row.email_verified)
          fail("Confirma tu correo antes de ingresar.", 403);
        const token = opaque(),
          id = randomUUID();
        const { rows } = await db.query(
          `INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours') RETURNING expires_at`,
          [id, row.id, hash(token)],
        );
        return { row, token, id, expiresAt: rows[0].expires_at.toISOString() };
      },
    );
    await audit(row.id, "auth.login", id);
    res.json({
      user: user(row),
      token,
      expiresAt,
    });
  });
  app.post("/session", async (req, res) => {
    const row = await session(req.body.token);
    res.json({
      ...user(row),
      exp: Math.floor(row.expires_at.getTime() / 1000),
      sessionId: row.session_id,
    });
  });
  for (const all of [false, true])
    app.post(all ? "/logout-all" : "/logout", async (req, res) => {
      const row = await session(req.body.token);
      await pool.query(
        `UPDATE auth_sessions SET revoked_at=now() WHERE ${all ? "user_id" : "id"}=$1`,
        [all ? row.id : row.session_id],
      );
      await audit(
        row.id,
        all ? "auth.logout_all" : "auth.logout",
        row.session_id,
      );
      res.json({ ok: true });
    });
  async function consume(token, purpose, fn) {
    if (typeof token !== "string" || token.length > 256)
      fail("Enlace inválido.");
    return transaction(pool, async (db) => {
      const candidate = (
        await db.query(
          "SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND purpose=$2",
          [hash(token), purpose],
        )
      ).rows[0];
      if (!candidate) fail("El enlace venció o ya fue usado.");
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        candidate.user_id,
      ]);
      const { rows } = await db.query(
        "SELECT * FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(token), purpose],
      );
      if (!rows[0]) fail("El enlace venció o ya fue usado.");
      await fn(db, rows[0].user_id);
      await db.query(
        "UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1",
        [hash(token)],
      );
      return rows[0].user_id;
    });
  }
  app.post("/verify-email", async (req, res) => {
    await rate(req, hash(String(req.body.token || "")), "verify", 30);
    const id = await consume(req.body.token, "verify", async (db, id) =>
      db.query("UPDATE users SET email_verified=true WHERE id=$1", [id]),
    );
    await audit(id, "auth.email_verified", id);
    res.json({ ok: true });
  });
  app.post("/resend-verification", async (req, res) => {
    const email = emailAddress(req.body.email);
    await rate(req, email, "resend", 5);
    delivery();
    await mailer.assertConfigured?.();
    const row = (
      await pool.query("SELECT * FROM users WHERE email=$1", [email])
    ).rows[0];
    if (row && !row.email_verified) {
      try {
        await sendToken(row, "verify");
      } catch {
        await audit(null, "auth.verification_delivery_failed", "mail");
      }
    }
    res.json({
      message: "Si la cuenta necesita confirmación, recibirás instrucciones.",
    });
  });
  app.post("/forgot-password", async (req, res) => {
    const email = emailAddress(req.body.email);
    await rate(req, email, "forgot", 5);
    delivery();
    await mailer.assertConfigured?.();
    const row = (
      await pool.query("SELECT * FROM users WHERE email=$1", [email])
    ).rows[0];
    if (row) {
      try {
        await sendToken(row, "reset");
      } catch {
        await audit(null, "auth.recovery_delivery_failed", "mail");
      }
    }
    res.json({
      message: "Si existe una cuenta con ese correo, recibirás instrucciones.",
    });
  });
  app.post("/reset-password", async (req, res) => {
    passwordValid(req.body.password);
    await rate(req, hash(String(req.body.token || "")), "reset", 20);
    const encoded = await passwordHash(req.body.password);
    const id = await consume(req.body.token, "reset", async (db, id) => {
      await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        encoded,
        id,
      ]);
      await db.query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1",
        [id],
      );
      await db.query(
        "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose='reset'",
        [id],
      );
    });
    await audit(id, "auth.password_reset", id);
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return { app, close: async () => {} };
}
