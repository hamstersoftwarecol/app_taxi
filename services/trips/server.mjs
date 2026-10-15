import { createStore } from "./store.mjs";
import { appBase, actorMiddleware, errorHandler, stream } from "../common.mjs";
export function tripsService({ path, internalKey, secret }) {
  const store = createStore(path);
  const admin = { sub: "admin", name: "Daniel", role: "admin" };
  if (!store.db.prepare("SELECT id FROM trips LIMIT 1").get()) {
    const samples = [
      [
        "María Fernanda",
        "Parque de la 93",
        "Aeropuerto El Dorado",
        "sedan",
        "in_progress",
        "driver-6",
      ],
      [
        "Juan Sebastián",
        "Centro Comercial Andino",
        "Chapinero Alto",
        "sedan",
        "accepted",
        "driver-2",
      ],
      ["Camila Rodríguez", "Usaquén", "Zona T", "suv", "requested", null],
      [
        "Santiago López",
        "Museo del Oro",
        "Teusaquillo",
        "mini",
        "completed",
        "driver-1",
      ],
      [
        "Isabella Gómez",
        "Salitre Plaza",
        "Parque Simón Bolívar",
        "sedan",
        "completed",
        "driver-2",
      ],
      [
        "Mateo Herrera",
        "La Candelaria",
        "Centro Internacional",
        "sedan",
        "completed",
        "driver-3",
      ],
      ["Gabriela Ruiz", "Chicó Norte", "Unicentro", "suv", "cancelled", null],
      [
        "Nicolás Moreno",
        "Rosales",
        "Quinta Camacho",
        "mini",
        "completed",
        "driver-1",
      ],
    ];
    for (const i of [3, 4, 5, 6, 7, 0, 1, 2]) {
      const [passenger, origin, destination, category, status, driverId] =
        samples[i];
      const t = store.createTrip(
        {
          passenger,
          origin,
          destination,
          category,
          payment: i % 2 ? "Tarjeta" : "Efectivo",
        },
        admin,
      );
      if (status === "cancelled") store.transitionTrip(t.id, { status }, admin);
      else if (status !== "requested") {
        store.transitionTrip(t.id, { status: "accepted", driverId }, admin);
        if (["in_progress", "completed"].includes(status))
          store.transitionTrip(t.id, { status: "in_progress" }, admin);
        if (status === "completed")
          store.transitionTrip(t.id, { status: "completed" }, admin);
      }
      store.db
        .prepare("UPDATE trips SET createdAt=? WHERE id=?")
        .run(new Date(Date.now() - i * 17 * 60000).toISOString(), t.id);
    }
  }
  const app = appBase(internalKey);
  app.use(actorMiddleware(secret));
  const clients = new Set();
  const emit = () => {
    for (const client of clients)
      client.write(
        "data: " + JSON.stringify({ type: "trips", at: Date.now() }) + "\n\n",
      );
  };
  app.get("/trips", (req, res) => res.json(store.listTrips(req.actor)));
  app.post("/trips", (req, res) => {
    const trip = store.createTrip(req.body, req.actor);
    emit();
    res.status(201).json(trip);
  });
  app.patch("/trips/:id", (req, res) => {
    const trip = store.transitionTrip(req.params.id, req.body, req.actor);
    emit();
    res.json(trip);
  });
  app.get("/drivers", (req, res) =>
    res.json(
      store.listDrivers().map((d) =>
        req.actor.role === "admin" || req.actor.sub === d.id
          ? d
          : {
              id: d.id,
              name: d.name,
              plate: d.plate,
              vehicle: d.vehicle,
              category: d.category,
              rating: d.rating,
              status: d.status,
            },
      ),
    ),
  );
  app.patch("/drivers/:id", (req, res) => {
    const driver = store.setAvailability(
      req.params.id,
      req.body.status,
      req.actor,
    );
    emit();
    res.json(driver);
  });
  app.get("/events", (req, res) => {
    stream(res);
    clients.add(res);
    res.on("close", () => clients.delete(res));
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  app.use(errorHandler);
  return {
    app,
    store,
    close: () => {
      clearInterval(heartbeat);
      for (const c of clients) c.end();
      store.db.close();
    },
  };
}
