import { DatabaseSync } from "node:sqlite";
import { appBase, actorMiddleware, errorHandler, stream } from "../common.mjs";
import { fail } from "../../packages/shared/domain.mjs";
export function trackingService({
  path,
  internalKey,
  secret,
  simulate = true,
}) {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS locations(driverId TEXT PRIMARY KEY,lat REAL,lng REAL,updatedAt TEXT,simulated INTEGER)",
  );
  for (let i = 1; i <= 6; i++)
    db.prepare("INSERT OR IGNORE INTO locations VALUES(?,?,?,?,1)").run(
      "driver-" + i,
      4.64 + i * 0.009,
      -74.095 + i * 0.007,
      new Date().toISOString(),
    );
  const app = appBase(internalKey);
  app.use(actorMiddleware(secret));
  const clients = new Set();
  const locations = () => db.prepare("SELECT * FROM locations").all();
  const filter = (items, ids) =>
    items.filter((l) => ids === "all" || ids.split(",").includes(l.driverId));
  app.get("/locations", (req, res) =>
    res.json(filter(locations(), String(req.query.ids || ""))),
  );
  app.post("/locations", (req, res) => {
    if (req.actor.role !== "driver")
      fail("No tienes permiso para compartir ubicación.", 403);
    const { lat, lng } = req.body;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      fail("Coordenadas no válidas.");
    db.prepare("INSERT OR REPLACE INTO locations VALUES(?,?,?,?,0)").run(
      req.actor.sub,
      lat,
      lng,
      new Date().toISOString(),
    );
    publish();
    res.json({ ok: true });
  });
  const publish = () => {
    const items = locations();
    for (const { res, ids } of clients)
      res.write("data: " + JSON.stringify(filter(items, ids)) + "\n\n");
  };
  app.get("/locations/events", (req, res) => {
    stream(res);
    const c = { res, ids: String(req.query.ids || "") };
    clients.add(c);
    res.write("data: " + JSON.stringify(filter(locations(), c.ids)) + "\n\n");
    res.on("close", () => clients.delete(c));
  });
  let tick = 0;
  const timer = setInterval(() => {
    if (simulate) {
      tick++;
      for (let i = 1; i <= 6; i++)
        db.prepare(
          "UPDATE locations SET lat=?,lng=?,updatedAt=? WHERE driverId=? AND simulated=1",
        ).run(
          4.64 + i * 0.009 + Math.sin(tick * 0.06 + i) * 0.003,
          -74.095 + i * 0.007 + Math.cos(tick * 0.06 + i) * 0.003,
          new Date().toISOString(),
          "driver-" + i,
        );
    }
    publish();
  }, 3000);
  timer.unref();
  app.use(errorHandler);
  return {
    app,
    close: () => {
      clearInterval(timer);
      for (const c of clients) c.res.end();
      db.close();
    },
  };
}
