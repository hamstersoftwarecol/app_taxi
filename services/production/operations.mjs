import { randomUUID } from "node:crypto";
import { appBase, errorHandler } from "../common.mjs";
import { productionActor, adminOnly, transaction } from "./http.mjs";
import { fail, textField } from "../../packages/shared/domain.mjs";
export function createAudit(pool) {
  return async (actor, action, resource, details = {}) => {
    const safe = {};
    for (const [key, value] of Object.entries(details))
      if (!/token|password|secret|email|license|position|lat|lng/i.test(key))
        safe[key] = value;
    await pool.query(
      "INSERT INTO audit_log(actor_id,action,resource,details) VALUES($1,$2,$3,$4)",
      [
        typeof actor === "string" ? actor : actor?.sub || null,
        action,
        String(resource),
        JSON.stringify(safe),
      ],
    );
  };
}
export function createOperationsService({
  pool,
  internalKey,
  routes,
  payments,
  delivery,
  audit,
}) {
  const app = appBase(internalKey, { rawPaths: ["/webhooks/stripe"] });
  app.post("/webhooks/stripe", async (req, res) =>
    res.json(await payments.webhook(req.body, req.headers["stripe-signature"])),
  );
  app.use(productionActor);
  app.get("/maps/config", (req, res) => res.json(routes.config()));
  app.get("/places", async (req, res) =>
    res.json(await routes.places(req.query.q)),
  );
  app.get("/preferences", async (req, res) =>
    res.json(
      (
        await pool.query("SELECT value FROM preferences WHERE user_id=$1", [
          req.actor.sub,
        ])
      ).rows[0]?.value || {},
    ),
  );
  app.put("/preferences", async (req, res) => {
    const { operationName, target, language } = req.body;
    const value = {};
    if (operationName !== undefined)
      value.operationName = textField(operationName, "Nombre de operación", 60);
    if (target !== undefined) {
      if (
        !Number.isInteger(Number(target)) ||
        Number(target) < 1 ||
        Number(target) > 10000
      )
        fail("Meta no válida.");
      value.target = String(Number(target));
    }
    if (language !== undefined) {
      if (!["es", "en"].includes(language)) fail("Idioma no admitido.");
      value.language = language;
    }
    const r = await pool.query(
      "INSERT INTO preferences(user_id,value) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET value=preferences.value||EXCLUDED.value,updated_at=now() RETURNING value",
      [req.actor.sub, JSON.stringify(value)],
    );
    res.json(r.rows[0].value);
  });
  app.post("/devices", async (req, res) => {
    const { token, platform } = req.body;
    if (process.env.EXPO_PUSH_ENABLED !== "true")
      fail("Las notificaciones push no están configuradas.", 503);
    if (
      typeof token !== "string" ||
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token) ||
      !["ios", "android"].includes(platform)
    )
      fail("Dispositivo push no válido.");
    await pool.query(
      "INSERT INTO devices(token,user_id,platform,session_id) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,session_id=EXCLUDED.session_id,updated_at=now()",
      [token, req.actor.sub, platform, req.actor.sessionId],
    );
    res.status(201).json({ registered: true });
  });
  app.delete("/devices", async (req, res) => {
    await pool.query("DELETE FROM devices WHERE token=$1 AND user_id=$2", [
      req.body.token,
      req.actor.sub,
    ]);
    res.json({ removed: true });
  });
  app.get("/support", async (req, res) => {
    const r = await pool.query(
      `SELECT id,user_id AS "userId",subject,message,status,reply,created_at AS "createdAt",updated_at AS "updatedAt" FROM support_tickets WHERE ($1='admin' OR user_id=$2) ORDER BY created_at DESC LIMIT 100`,
      [req.actor.role, req.actor.sub],
    );
    res.json(r.rows);
  });
  app.post("/support", async (req, res) => {
    const subject = textField(req.body.subject, "Asunto", 120),
      message = textField(req.body.message, "Mensaje", 4000);
    const r = await pool.query(
      "INSERT INTO support_tickets(id,user_id,subject,message) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), req.actor.sub, subject, message],
    );
    await audit(req.actor, "support.created", r.rows[0].id);
    if (process.env.SUPPORT_EMAIL) {
      try {
        await delivery.mailer.send({
          to: process.env.SUPPORT_EMAIL,
          subject: "Ticket Rayo " + r.rows[0].id,
          text: subject + "\n\n" + message,
        });
      } catch {
        await audit(req.actor, "support.email_unconfigured", r.rows[0].id);
      }
    }
    res.status(201).json(r.rows[0]);
  });
  app.patch("/support/:id", adminOnly, async (req, res) => {
    if (!["open", "resolved"].includes(req.body.status))
      fail("Estado no válido.");
    const reply = textField(req.body.reply, "Respuesta", 4000);
    const r = await pool.query(
      "UPDATE support_tickets SET status=$2,reply=$3,updated_at=now() WHERE id=$1 RETURNING *",
      [req.params.id, req.body.status, reply],
    );
    if (!r.rowCount) fail("Ticket no encontrado.", 404);
    await audit(req.actor, "support.replied", req.params.id);
    const u = (
      await pool.query("SELECT email FROM users WHERE id=$1", [
        r.rows[0].user_id,
      ])
    ).rows[0];
    let emailQueued = false;
    if (u) {
      try {
        await delivery.mailer.send({
          to: u.email,
          subject: "Respuesta a tu solicitud Rayo",
          text: reply,
        });
        emailQueued = true;
      } catch {}
    }
    res.json({ ...r.rows[0], emailQueued });
  });
  app.get("/payments", async (req, res) =>
    res.json(await payments.list(req.actor, req.query.tripId)),
  );
  app.post("/payments/checkout", async (req, res) =>
    res.json(
      await payments.checkout(
        req.actor,
        textField(req.body.tripId, "Viaje", 80),
      ),
    ),
  );
  app.post("/payments/reconcile", adminOnly, async (req, res) =>
    res.json(await payments.reconcile(req.actor)),
  );
  app.post("/payments/cash", adminOnly, async (req, res) =>
    res.json(await payments.confirmCash(req.actor, req.body.tripId)),
  );
  app.get("/reconciliation", adminOnly, async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
    ),
  );
  app.get("/audit", adminOnly, async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT * FROM audit_log WHERE id>COALESCE($1,0) ORDER BY id DESC LIMIT 100",
          [Number(req.query.after) || 0],
        )
      ).rows,
    ),
  );
  app.get("/outbox", adminOnly, async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,kind,status,attempts,last_error,created_at FROM outbox ORDER BY id DESC LIMIT 100",
        )
      ).rows,
    ),
  );
  app.post("/outbox/:id/retry", adminOnly, async (req, res) => {
    const r = await pool.query(
      "UPDATE outbox SET status='pending',attempts=0,available_at=now(),locked_at=NULL WHERE id=$1 AND status='failed' RETURNING id",
      [req.params.id],
    );
    if (!r.rowCount) fail("Mensaje fallido no encontrado.", 404);
    await audit(req.actor, "outbox.retry", req.params.id);
    res.json({ queued: true });
  });
  app.use(errorHandler);
  return { app, close: async () => {} };
}
