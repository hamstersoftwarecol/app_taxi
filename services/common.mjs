import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../packages/shared/domain.mjs";
export function sign(user, secret) {
  const body = Buffer.from(
    JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 28800 }),
  ).toString("base64url");
  return (
    body + "." + createHmac("sha256", secret).update(body).digest("base64url")
  );
}
export function verify(token, secret) {
  try {
    const [body, sig] = token.split(".");
    const expected = createHmac("sha256", secret).update(body).digest();
    const provided = Buffer.from(sig, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      throw Error();
    const user = JSON.parse(Buffer.from(body, "base64url").toString());
    if (user.exp <= Date.now() / 1000) throw Error();
    return user;
  } catch {
    fail("Tu sesión terminó. Vuelve a ingresar.", 401);
  }
}
export function appBase(internalKey, { rawPaths = [] } = {}) {
  const app = express();
  app.disable("x-powered-by");
  const json = express.json({ limit: "16kb" });
  const raw = express.raw({ type: "application/json", limit: "256kb" });
  app.use((req, res, next) =>
    rawPaths.includes(req.path) ? raw(req, res, next) : json(req, res, next),
  );
  if (internalKey)
    app.use((req, res, next) => {
      if (req.headers["x-internal-key"] !== internalKey)
        return res.status(403).json({ error: "Acceso interno requerido." });
      next();
    });
  return app;
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "No pudimos completar la operación.",
  });
  if (!error.status)
    console.error(
      JSON.stringify({
        level: "error",
        code: String(error.code || error.name || "INTERNAL_ERROR"),
      }),
    );
}
export function actorMiddleware(secret) {
  return (req, res, next) => {
    try {
      req.actor = verify(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
        secret,
      );
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function listen(app, port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.on("error", reject);
  });
}
export function stream(res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
}
