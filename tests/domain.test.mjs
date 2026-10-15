import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../services/trips/store.mjs";
const admin = { sub: "admin", role: "admin" };
const passenger = {
  sub: "passenger-1",
  role: "passenger",
  name: "Valentina Ríos",
};
const input = {
  origin: "Parque de la 93",
  destination: "Aeropuerto El Dorado",
  category: "sedan",
  passenger: "Valentina Ríos",
  payment: "Efectivo",
};
test("reserva calcula tarifa, persiste y empieza solicitada", () => {
  const s = createStore(":memory:", false);
  const trip = s.createTrip(input, passenger);
  assert.equal(trip.fare, 18500);
  assert.equal(trip.status, "requested");
  assert.equal(s.listTrips(passenger).length, 1);
  s.db.close();
});
test("rechaza direcciones vacías y categorías desconocidas", () => {
  const s = createStore(":memory:", false);
  assert.throws(
    () => s.createTrip({ ...input, origin: "  " }, passenger),
    /origen/i,
  );
  assert.throws(
    () => s.createTrip({ ...input, category: "jet" }, passenger),
    /categoría/i,
  );
  s.db.close();
});
test("asignación exclusiva y estados no reversibles", () => {
  const s = createStore(":memory:", true);
  const first = s.createTrip(input, admin);
  const second = s.createTrip(input, admin);
  s.transitionTrip(
    first.id,
    { status: "accepted", driverId: "driver-3" },
    admin,
  );
  assert.throws(
    () =>
      s.transitionTrip(
        second.id,
        { status: "accepted", driverId: "driver-3" },
        admin,
      ),
    /disponible/i,
  );
  s.transitionTrip(first.id, { status: "in_progress" }, admin);
  s.transitionTrip(first.id, { status: "completed" }, admin);
  assert.equal(
    s.listDrivers().find((d) => d.id === "driver-3").status,
    "available",
  );
  assert.throws(
    () =>
      s.transitionTrip(
        first.id,
        { status: "accepted", driverId: "driver-3" },
        admin,
      ),
    /estado/i,
  );
  s.db.close();
});
test("pasajero no puede ver ni modificar un viaje ajeno", () => {
  const s = createStore(":memory:", false);
  const trip = s.createTrip(input, passenger);
  const other = { sub: "other", role: "passenger", name: "Otro" };
  assert.equal(s.listTrips(other).length, 0);
  assert.throws(
    () => s.transitionTrip(trip.id, { status: "cancelled" }, other),
    /permiso/i,
  );
  s.db.close();
});
test("cancelar libera conductor y un pasajero no puede iniciar un viaje", () => {
  const s = createStore(":memory:", true);
  const t = s.createTrip(input, passenger);
  s.transitionTrip(t.id, { status: "accepted", driverId: "driver-3" }, admin);
  assert.throws(
    () => s.transitionTrip(t.id, { status: "in_progress" }, passenger),
    /permiso/i,
  );
  s.transitionTrip(t.id, { status: "cancelled" }, passenger);
  assert.equal(
    s.listDrivers().find((d) => d.id === "driver-3").status,
    "available",
  );
  s.db.close();
});

test("datos y ocupación sobreviven a la reapertura de SQLite", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(tmpdir() + "/rayo-persistence-");
  try {
    let s = createStore(dir + "/trips.sqlite", true);
    const t = s.createTrip(input, passenger);
    s.transitionTrip(t.id, { status: "accepted", driverId: "driver-3" }, admin);
    s.db.close();
    s = createStore(dir + "/trips.sqlite", true);
    assert.equal(s.listTrips(passenger)[0].status, "accepted");
    assert.equal(
      s.listDrivers().find((d) => d.id === "driver-3").status,
      "busy",
    );
    s.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
