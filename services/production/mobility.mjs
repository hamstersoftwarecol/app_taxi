import { randomUUID } from "node:crypto";
import { appBase, errorHandler, stream } from "../common.mjs";
import { productionActor } from "./http.mjs";
import { fail, textField } from "../../packages/shared/domain.mjs";
export const queryAliasing = `id, passenger_id AS "passengerId", passenger, origin, destination, category, fare, payment, status, driver_id AS "driverId", created_at AS "createdAt", origin_lat AS "originLat", origin_lng AS "originLng", destination_lat AS "destinationLat", destination_lng AS "destinationLng", route`;
const driverFields = `id,name,plate,vehicle,category,rating::float AS rating,(SELECT count(*)::integer FROM trips WHERE driver_id=drivers.id AND status='completed') AS trips,status,verification_status AS "verificationStatus",license_number AS "licenseNumber",license_expires_at AS "licenseExpiresAt",verification_reason AS "verificationReason"`;
const categories = ["mini", "sedan", "suv"];
const active = ["accepted", "in_progress"];
function admin(actor) {
  if (actor.role !== "admin") fail("Acceso denegado.", 403);
}
export function coordinates(point) {
  if (
    !point ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    fail("Coordenadas no válidas.");
  return point;
}
export async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const v = await fn(c);
    await c.query("COMMIT");
    return v;
  } catch (e) {
    await c.query("ROLLBACK");
    if (e.code === "23505")
      fail("El recurso ya está ocupado o registrado.", 409);
    throw e;
  } finally {
    c.release();
  }
}
export async function event(c, type, id) {
  await c.query("SELECT pg_notify('rayo_events',$1)", [
    JSON.stringify({ type, id }),
  ]);
}
export function createMobilityService({
  pool,
  internalKey,
  audit = async () => {},
  bus,
  routes,
  paymentGuard,
  notify = async () => {},
}) {
  const app = appBase(internalKey);
  app.use(productionActor);
  const clients = new Set();
  let unsubscribe;
  let closed = false;
  const subscription = bus
    .subscribe("rayo_events", (message) => {
      if (!["trips", "drivers"].includes(message.type)) return;
      for (const res of clients)
        res.write("data: " + JSON.stringify({ type: message.type }) + "\n\n");
    })
    .then((fn) => {
      if (closed) return fn();
      unsubscribe = fn;
    });
  const timer = setInterval(() => {
    for (const res of clients) res.write(": heartbeat\n\n");
  }, 15000);
  timer.unref();
  app.post("/quotes", async (req, res) => {
    if (!["passenger", "admin"].includes(req.actor.role))
      fail("Acceso denegado.", 403);
    const { origin, destination, category } = req.body;
    coordinates(origin);
    coordinates(destination);
    if (!categories.includes(category)) fail("Categoría no válida.");
    const q = await routes.quote({ origin, destination, category });
    if (
      !Number.isSafeInteger(q.fare) ||
      q.fare <= 0 ||
      !Array.isArray(q.geometry)
    )
      fail("No se pudo cotizar la ruta.", 502);
    const id = randomUUID();
    const r = await pool.query(
      `INSERT INTO quotes(id,owner_id,origin,destination,origin_lat,origin_lng,destination_lat,destination_lng,category,fare,route,distance_meters,duration_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING expires_at AS "expiresAt"`,
      [
        id,
        req.actor.sub,
        typeof origin.label === "string"
          ? origin.label.slice(0, 160)
          : `${origin.lat}, ${origin.lng}`,
        typeof destination.label === "string"
          ? destination.label.slice(0, 160)
          : `${destination.lat}, ${destination.lng}`,
        origin.lat,
        origin.lng,
        destination.lat,
        destination.lng,
        category,
        q.fare,
        JSON.stringify(q.geometry),
        Math.round(q.distanceMeters),
        Math.round(q.durationSeconds),
      ],
    );
    res.status(201).json({ id, quoteId: id, ...q, ...r.rows[0] });
  });
  app.get("/trips", async (req, res) => {
    let where = "";
    const args = [];
    if (req.actor.role === "passenger") {
      where = " WHERE passenger_id=$1";
      args.push(req.actor.sub);
    } else if (req.actor.role === "driver") {
      where =
        " WHERE driver_id=$1 OR (status='requested' AND category IN (SELECT category FROM drivers WHERE id=$1 AND verification_status='approved' AND license_expires_at>=CURRENT_DATE))";
      args.push(req.actor.sub);
    } else admin(req.actor);
    res.json(
      (
        await pool.query(
          `SELECT ${queryAliasing} FROM trips${where} ORDER BY created_at DESC LIMIT 500`,
          args,
        )
      ).rows,
    );
  });
  app.post("/trips", async (req, res) => {
    if (!["admin", "passenger"].includes(req.actor.role))
      fail("Acceso denegado.", 403);
    if (!["Efectivo", "Tarjeta"].includes(req.body.payment))
      fail("Pago no válido.");
    const trip = await transaction(pool, async (c) => {
      const q = (
        await c.query(
          "SELECT * FROM quotes WHERE id=$1 AND owner_id=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
          [req.body.quoteId, req.actor.sub],
        )
      ).rows[0];
      if (!q) fail("Cotización vencida o no disponible.", 409);
      await c.query("UPDATE quotes SET consumed_at=now() WHERE id=$1", [q.id]);
      const r = await c.query(
        `INSERT INTO trips(id,passenger_id,passenger,origin,destination,category,fare,payment,origin_lat,origin_lng,destination_lat,destination_lng,route) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${queryAliasing}`,
        [
          randomUUID(),
          req.actor.sub,
          req.actor.name || "Pasajero",
          q.origin,
          q.destination,
          q.category,
          q.fare,
          req.body.payment,
          q.origin_lat,
          q.origin_lng,
          q.destination_lat,
          q.destination_lng,
          JSON.stringify(q.route),
        ],
      );
      await event(c, "trips", r.rows[0].id);
      return r.rows[0];
    });
    await audit(req.actor, "trip.created", trip.id, {});
    res.status(201).json(trip);
  });
  app.patch("/trips/:id", async (req, res) => {
    const trip = await transaction(pool, async (c) => {
      const t = (
        await c.query("SELECT * FROM trips WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ])
      ).rows[0];
      if (!t) fail("Viaje no encontrado.", 404);
      const status = req.body.status;
      const transitions = {
        requested: ["accepted", "cancelled"],
        accepted: ["in_progress", "cancelled"],
        in_progress: ["completed", "cancelled"],
      };
      if (!transitions[t.status]?.includes(status))
        fail("Transición no válida.", 409);
      const a = req.actor;
      let driverId = t.driver_id;
      if (a.role === "passenger") {
        if (t.passenger_id !== a.sub || status !== "cancelled")
          fail("Acceso denegado.", 403);
      } else if (a.role === "driver") {
        if (status === "accepted") {
          if (req.body.driverId && req.body.driverId !== a.sub)
            fail("Acceso denegado.", 403);
          driverId = a.sub;
        } else if (t.driver_id !== a.sub) fail("Acceso denegado.", 403);
      } else admin(a);
      if (status === "in_progress") {
        const driver = (
          await c.query(
            "SELECT verification_status, license_expires_at>=CURRENT_DATE AS license_valid FROM drivers WHERE id=$1 FOR UPDATE",
            [driverId],
          )
        ).rows[0];
        if (
          !driver ||
          driver.verification_status !== "approved" ||
          !driver.license_valid
        )
          fail("Conductor sin verificación vigente.", 409);
        if (
          t.payment === "Tarjeta" &&
          paymentGuard &&
          (await paymentGuard(t, c)) !== true
        )
          fail("Confirma el pago con tarjeta antes de iniciar el viaje", 409);
      }
      if (status === "accepted") {
        driverId = driverId || req.body.driverId;
        const d = (
          await c.query(
            "SELECT *,license_expires_at>=CURRENT_DATE AS license_valid FROM drivers WHERE id=$1 FOR UPDATE",
            [driverId],
          )
        ).rows[0];
        if (
          !d ||
          d.verification_status !== "approved" ||
          d.category !== t.category ||
          d.status !== "available" ||
          !d.license_valid
        )
          fail("Conductor no disponible para esta categoría.", 409);
        await c.query(
          "UPDATE drivers SET status='busy',updated_at=now() WHERE id=$1",
          [driverId],
        );
      }
      if (["completed", "cancelled"].includes(status) && driverId)
        await c.query(
          "UPDATE drivers SET status=CASE WHEN verification_status='approved' AND license_expires_at>=CURRENT_DATE THEN 'available' ELSE 'offline' END,updated_at=now() WHERE id=$1",
          [driverId],
        );
      const r = await c.query(
        `UPDATE trips SET status=$2,driver_id=$3,updated_at=now() WHERE id=$1 RETURNING ${queryAliasing}`,
        [t.id, status, driverId],
      );
      await event(c, "trips", t.id);
      return r.rows[0];
    });
    await audit(req.actor, "trip.transition", trip.id, { status: trip.status });
    await notify({
      userId: trip.passengerId,
      title: "Tu viaje se actualizó",
      body: trip.status,
      data: { tripId: trip.id },
    }).catch(() => {});
    res.json(trip);
  });
  app.post("/driver-applications", async (req, res) => {
    if (req.actor.role !== "driver") fail("Acceso denegado.", 403);
    const b = req.body.profile || req.body;
    const plate = textField(b.plate, "Placa", 12),
      vehicle = textField(b.vehicle, "Vehículo", 100),
      license = textField(b.licenseNumber, "Licencia", 50);
    if (
      !categories.includes(b.category) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.licenseExpiresAt) ||
      !(new Date(b.licenseExpiresAt) > new Date())
    )
      fail("Categoría o vencimiento de licencia no válido.");
    const r = await pool.query(
      `INSERT INTO drivers(id,name,plate,vehicle,category,license_number,license_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET plate=$3,vehicle=$4,category=$5,license_number=$6,license_expires_at=$7,verification_status='pending',status='offline',updated_at=now() WHERE drivers.status<>'busy' RETURNING ${driverFields}`,
      [
        req.actor.sub,
        req.actor.name || "Conductor",
        plate,
        vehicle,
        b.category,
        license,
        b.licenseExpiresAt,
      ],
    );
    if (!r.rows[0])
      fail("Finaliza tu viaje antes de actualizar el perfil.", 409);
    await audit(req.actor, "driver.applied", req.actor.sub, {});
    res.status(201).json(r.rows[0]);
  });
  app.get("/driver-applications", async (req, res) => {
    admin(req.actor);
    res.json(
      (
        await pool.query(
          `SELECT ${driverFields} FROM drivers WHERE verification_status='pending' ORDER BY created_at`,
        )
      ).rows,
    );
  });
  app.patch("/drivers/:id/verification", async (req, res) => {
    admin(req.actor);
    if (!["approved", "rejected"].includes(req.body.status))
      fail("Estado no válido.");
    const d = await transaction(pool, async (c) => {
      const d = (
        await c.query(
          "SELECT *,license_expires_at>=CURRENT_DATE AS license_valid FROM drivers WHERE id=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!d) fail("Conductor no encontrado.", 404);
      if (d.status === "busy") fail("Conductor en viaje activo.", 409);
      if (req.body.status === "approved" && !d.license_valid)
        fail("Licencia vencida.", 409);
      const r = await c.query(
        `UPDATE drivers SET verification_status=$2,verification_reason=$3,status='offline',updated_at=now() WHERE id=$1 RETURNING ${driverFields}`,
        [
          d.id,
          req.body.status,
          typeof req.body.reason === "string"
            ? req.body.reason.slice(0, 500)
            : null,
        ],
      );
      await event(c, "drivers", d.id);
      return r.rows[0];
    });
    await audit(req.actor, "driver.verified", d.id, {
      status: req.body.status,
    });
    res.json(d);
  });
  app.get("/drivers", async (req, res) => {
    if (!["admin", "driver", "passenger"].includes(req.actor.role))
      fail("Acceso denegado.", 403);
    const rows = (
      await pool.query(
        `SELECT ${driverFields} FROM drivers WHERE ($1='admin' OR id=$2 OR verification_status='approved')`,
        [req.actor.role, req.actor.sub],
      )
    ).rows;
    res.json(
      rows.map((d) =>
        req.actor.role === "admin" || req.actor.sub === d.id
          ? d
          : {
              id: d.id,
              name: d.name,
              plate: d.plate,
              vehicle: d.vehicle,
              category: d.category,
              rating: Number(d.rating),
              status: d.status,
            },
      ),
    );
  });
  app.patch("/drivers/:id", async (req, res) => {
    if (
      req.actor.role !== "admin" &&
      !(req.actor.role === "driver" && req.actor.sub === req.params.id)
    )
      fail("Acceso denegado.", 403);
    if (!["available", "offline"].includes(req.body.status))
      fail("Estado no válido.");
    const d = await transaction(pool, async (c) => {
      const d = (
        await c.query(
          "SELECT *,license_expires_at>=CURRENT_DATE AS license_valid FROM drivers WHERE id=$1 FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      if (!d) fail("Conductor no encontrado.", 404);
      if (
        d.status === "busy" ||
        (
          await c.query(
            "SELECT 1 FROM trips WHERE driver_id=$1 AND status IN ('accepted','in_progress')",
            [d.id],
          )
        ).rowCount
      )
        fail("Conductor en viaje activo.", 409);
      if (
        req.body.status === "available" &&
        (d.verification_status !== "approved" || !d.license_valid)
      )
        fail("Conductor sin verificación vigente.", 403);
      const r = await c.query(
        `UPDATE drivers SET status=$2,updated_at=now() WHERE id=$1 RETURNING ${driverFields}`,
        [d.id, req.body.status],
      );
      await event(c, "drivers", d.id);
      return r.rows[0];
    });
    res.json(d);
  });
  app.get("/events", (req, res) => {
    stream(res);
    clients.add(res);
    res.on("close", () => clients.delete(res));
  });
  app.use(errorHandler);
  return {
    app,
    close: async () => {
      closed = true;
      clearInterval(timer);
      for (const res of clients) res.end();
      await subscription;
      await unsubscribe?.();
    },
  };
}
