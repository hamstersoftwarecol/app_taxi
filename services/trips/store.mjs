import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { categories, fail, textField } from "../../packages/shared/domain.mjs";
export function createStore(path, seed = true) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS drivers(id TEXT PRIMARY KEY,name TEXT,plate TEXT,vehicle TEXT,category TEXT,rating REAL,status TEXT,trips INTEGER);
 CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,passengerId TEXT,passenger TEXT,origin TEXT,destination TEXT,category TEXT,fare INTEGER,payment TEXT,status TEXT,driverId TEXT REFERENCES drivers(id),createdAt TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS active_driver ON trips(driverId) WHERE status IN ('accepted','in_progress');`);
  if (seed && !db.prepare("SELECT id FROM drivers LIMIT 1").get()) {
    const insert = db.prepare("INSERT INTO drivers VALUES(?,?,?,?,?,?,?,?)");
    [
      [
        "driver-1",
        "Carlos Mendoza",
        "WPL 284",
        "Kia Picanto · Amarillo",
        "mini",
        4.9,
        "available",
        1284,
      ],
      [
        "driver-2",
        "Andrés Ramírez",
        "TZR 519",
        "Renault Logan · Amarillo",
        "sedan",
        4.8,
        "available",
        956,
      ],
      [
        "driver-3",
        "Miguel Torres",
        "VEX 673",
        "Chevrolet Onix · Amarillo",
        "sedan",
        4.9,
        "available",
        721,
      ],
      [
        "driver-4",
        "Laura Gómez",
        "TSM 102",
        "Renault Duster · Amarillo",
        "suv",
        5,
        "available",
        482,
      ],
      [
        "driver-5",
        "Diego Vargas",
        "WNL 345",
        "Kia Picanto · Amarillo",
        "mini",
        4.7,
        "offline",
        638,
      ],
      [
        "driver-6",
        "Sofía Castro",
        "WPR 807",
        "Renault Logan · Amarillo",
        "sedan",
        4.9,
        "available",
        1106,
      ],
    ].forEach((row) => insert.run(...row));
  }
  const listDrivers = () => db.prepare("SELECT * FROM drivers").all();
  function listTrips(actor) {
    if (actor.role === "admin")
      return db.prepare("SELECT * FROM trips ORDER BY createdAt DESC").all();
    if (actor.role === "driver")
      return db
        .prepare(
          "SELECT * FROM trips WHERE driverId=? OR (status='requested' AND category=(SELECT category FROM drivers WHERE id=?)) ORDER BY createdAt DESC",
        )
        .all(actor.sub, actor.sub);
    return db
      .prepare(
        "SELECT * FROM trips WHERE passengerId=? ORDER BY createdAt DESC",
      )
      .all(actor.sub);
  }
  function createTrip(input, actor) {
    const origin = textField(input.origin, "El origen"),
      destination = textField(input.destination, "El destino");
    if (origin.toLowerCase() === destination.toLowerCase())
      fail("El origen y el destino deben ser diferentes.");
    const category = categories.find((c) => c.id === input.category);
    if (!category) fail("La categoría no es válida.");
    if (actor.role === "driver") fail("No tienes permiso para reservar.", 403);
    const passenger =
      actor.role === "admin"
        ? textField(input.passenger, "El pasajero", 80)
        : actor.name;
    if (!["Efectivo", "Tarjeta"].includes(input.payment))
      fail("El método de pago no es válido.");
    const trip = {
      id: "RY-" + randomUUID().slice(0, 8).toUpperCase(),
      passengerId: actor.role === "admin" ? "admin-booking" : actor.sub,
      passenger,
      origin,
      destination,
      category: category.id,
      fare: category.fare,
      payment: input.payment,
      status: "requested",
      driverId: null,
      createdAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      ...Object.values(trip),
    );
    return trip;
  }
  function transitionTrip(id, input, actor) {
    const trip = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
    if (!trip) fail("Viaje no encontrado.", 404);
    const allowed = {
      requested: ["accepted", "cancelled"],
      accepted: ["in_progress", "cancelled"],
      in_progress: ["completed"],
      completed: [],
      cancelled: [],
    };
    if (
      actor.role === "passenger" &&
      (actor.sub !== trip.passengerId || input.status !== "cancelled")
    )
      fail("No tienes permiso para esta acción.", 403);
    if (
      actor.role === "driver" &&
      !(
        trip.driverId === actor.sub ||
        (trip.status === "requested" && input.status === "accepted")
      )
    )
      fail("No tienes permiso para este viaje.", 403);
    if (!allowed[trip.status].includes(input.status))
      fail("Este cambio de estado no está permitido.", 409);
    let driverId = trip.driverId;
    if (input.status === "accepted") {
      driverId = actor.role === "driver" ? actor.sub : input.driverId;
      const driver = db
        .prepare("SELECT * FROM drivers WHERE id=?")
        .get(driverId || "");
      if (!driver || driver.status !== "available")
        fail("El conductor no está disponible.", 409);
      if (driver.category !== trip.category)
        fail("El vehículo no coincide con la categoría.", 409);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (input.status === "accepted") {
        const result = db
          .prepare(
            "UPDATE drivers SET status='busy' WHERE id=? AND status='available'",
          )
          .run(driverId);
        if (!result.changes) fail("El conductor no está disponible.", 409);
      }
      db.prepare("UPDATE trips SET status=?,driverId=? WHERE id=?").run(
        input.status,
        driverId,
        id,
      );
      if (["completed", "cancelled"].includes(input.status) && driverId)
        db.prepare(
          "UPDATE drivers SET status='available',trips=trips+? WHERE id=?",
        ).run(input.status === "completed" ? 1 : 0, driverId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return db.prepare("SELECT * FROM trips WHERE id=?").get(id);
  }
  function setAvailability(id, status, actor) {
    if (
      actor.role !== "admin" &&
      !(actor.role === "driver" && actor.sub === id)
    )
      fail("No tienes permiso.", 403);
    if (!["available", "offline"].includes(status))
      fail("Disponibilidad no válida.");
    const driver = db.prepare("SELECT * FROM drivers WHERE id=?").get(id);
    if (!driver) fail("Conductor no encontrado.", 404);
    if (driver.status === "busy")
      fail("Finaliza el viaje activo antes de cambiar disponibilidad.", 409);
    db.prepare("UPDATE drivers SET status=? WHERE id=?").run(status, id);
    return listDrivers().find((d) => d.id === id);
  }
  return {
    db,
    listDrivers,
    listTrips,
    createTrip,
    transitionTrip,
    setAvailability,
  };
}
