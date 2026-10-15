import { fail } from "../../packages/shared/domain.mjs";
export function productionActor(req, res, next) {
  try {
    const value = req.headers["x-actor"];
    if (typeof value !== "string" || value.length > 4096)
      fail("Sesión interna requerida.", 401);
    const actor = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !actor.sub ||
      !["admin", "passenger", "driver"].includes(actor.role) ||
      !Number.isFinite(actor.exp) ||
      actor.exp <= Date.now() / 1000
    )
      fail("Sesión vencida.", 401);
    req.actor = actor;
    next();
  } catch (error) {
    next(
      error.status
        ? error
        : Object.assign(new Error("Sesión interna no válida."), {
            status: 401,
          }),
    );
  }
}
export function adminOnly(req, res, next) {
  if (req.actor?.role !== "admin")
    return next(
      Object.assign(new Error("Acceso de administrador requerido."), {
        status: 403,
      }),
    );
  next();
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
