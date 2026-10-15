import test from "node:test";
import assert from "node:assert/strict";
import { createMapbox } from "../services/production/providers.mjs";
import { copToMinor } from "../services/production/payments.mjs";
test("rutas reales calculan precio servidor y no permiten cotizar sin configuración", async () => {
  await assert.rejects(
    createMapbox().quote({
      origin: { lat: 4.6, lng: -74 },
      destination: { lat: 4.7, lng: -74 },
      category: "mini",
    }),
    /tarifa|configurada/i,
  );
  const routes = createMapbox({
    token: "server-test",
    fares: JSON.stringify({
      mini: { base: 4000, perKm: 1500, perMinute: 250, minimum: 7000 },
    }),
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        routes: [
          {
            distance: 4000,
            duration: 600,
            geometry: {
              coordinates: [
                [-74, 4.6],
                [-74, 4.7],
              ],
            },
          },
        ],
      }),
    }),
  });
  const result = await routes.quote({
    origin: { lat: 4.6, lng: -74 },
    destination: { lat: 4.7, lng: -74 },
    category: "mini",
  });
  assert.equal(result.fare, 12500);
  assert.equal(result.distanceMeters, 4000);
  assert.equal(result.durationSeconds, 600);
  await assert.rejects(
    routes.quote({
      origin: { lat: 400, lng: -74 },
      destination: { lat: 4.7, lng: -74 },
      category: "mini",
    }),
    /punto válido/,
  );
});
test("COP convierte pesos a unidades menores Stripe sin redondear importe inválido", () => {
  assert.equal(copToMinor(18500), 1850000);
  assert.throws(() => copToMinor(0));
  assert.throws(() => copToMinor(1.5));
});
