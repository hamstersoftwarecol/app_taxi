import { appBase, errorHandler, stream } from "../common.mjs";
import { productionActor } from "./http.mjs";
import { fail } from "../../packages/shared/domain.mjs";
import { coordinates, transaction, event } from "./mobility.mjs";
export function createTrackingService({
  pool,
  internalKey,
  audit = async () => {},
  bus,
}) {
  const app = appBase(internalKey);
  app.use(productionActor);
  const clients = new Set();
  let unsubscribe,
    closed = false;
  async function locations(actor, ids) {
    const requested =
      typeof ids === "string"
        ? ids.split(",").filter(Boolean).slice(0, 100)
        : [];
    const { rows } = await pool.query(
      `SELECT l.driver_id AS "driverId",l.lat,l.lng,l.accuracy,l.recorded_at AS "recordedAt",l.updated_at AS "updatedAt",false AS simulated FROM locations l WHERE ($1='admin' OR ($1='driver' AND l.driver_id=$2) OR ($1='passenger' AND EXISTS(SELECT 1 FROM trips t WHERE t.passenger_id=$2 AND t.driver_id=l.driver_id AND t.status IN ('accepted','in_progress')))) AND ($3::text[]='{}' OR l.driver_id=ANY($3))`,
      [actor.role, actor.sub, ids === "all" ? [] : requested],
    );
    return rows;
  }
  const subscription = bus
    .subscribe("rayo_events", async (msg) => {
      if (!["locations", "trips", "drivers"].includes(msg.type)) return;
      await Promise.all(
        [...clients].map(async (c) => {
          try {
            const rows = await locations(c.actor, c.ids);
            if (!c.res.destroyed)
              c.res.write("data: " + JSON.stringify(rows) + "\n\n");
          } catch {
            c.res.end();
            clients.delete(c);
          }
        }),
      );
    })
    .then((fn) => {
      if (closed) return fn();
      unsubscribe = fn;
    });
  const timer = setInterval(() => {
    for (const c of clients) c.res.write(": heartbeat\n\n");
  }, 15000);
  timer.unref();
  app.get("/locations", async (req, res) =>
    res.json(await locations(req.actor, req.query.ids)),
  );
  app.post("/locations", async (req, res) => {
    if (req.actor.role !== "driver") fail("Acceso denegado.", 403);
    const { lat, lng, accuracy } = req.body;
    coordinates({ lat, lng });
    const raw = req.body.recordedAt ?? req.body.timestamp;
    const time =
      typeof raw === "number"
        ? new Date(raw)
        : new Date(typeof raw === "string" ? raw : "invalid");
    if (
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 10000 ||
      !Number.isFinite(time.getTime()) ||
      time.getTime() > Date.now() + 5000 ||
      time.getTime() < Date.now() - 300000
    )
      fail("Precisión o fecha de ubicación no válida.");
    await transaction(pool, async (c) => {
      const d = (
        await c.query(
          "SELECT verification_status,license_expires_at>=CURRENT_DATE AS license_valid FROM drivers WHERE id=$1 FOR UPDATE",
          [req.actor.sub],
        )
      ).rows[0];
      if (!d || d.verification_status !== "approved" || !d.license_valid)
        fail("Conductor sin verificación vigente.", 403);
      const r = await c.query(
        `INSERT INTO locations(driver_id,lat,lng,accuracy,recorded_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(driver_id) DO UPDATE SET lat=$2,lng=$3,accuracy=$4,recorded_at=$5,updated_at=now() WHERE locations.recorded_at<$5 RETURNING driver_id`,
        [req.actor.sub, lat, lng, accuracy, time],
      );
      if (!r.rowCount) fail("Ubicación repetida o fuera de orden.", 409);
      await event(c, "locations", req.actor.sub);
    });
    await audit(req.actor, "location.updated", req.actor.sub, { accuracy });
    res.json({ ok: true, recordedAt: time.toISOString() });
  });
  app.get("/locations/events", async (req, res) => {
    stream(res);
    const c = { res, actor: req.actor, ids: req.query.ids };
    clients.add(c);
    res.on("close", () => clients.delete(c));
    try {
      res.write(
        "data: " + JSON.stringify(await locations(c.actor, c.ids)) + "\n\n",
      );
    } catch {
      clients.delete(c);
      res.end();
    }
  });
  app.use(errorHandler);
  return {
    app,
    close: async () => {
      closed = true;
      clearInterval(timer);
      for (const c of clients) c.res.end();
      await subscription;
      await unsubscribe?.();
    },
  };
}
