import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

test("production mobility exports PostgreSQL services", async () => {
  const { createMobilityService } =
    await import("../services/production/mobility.mjs");
  const { createTrackingService } =
    await import("../services/production/tracking.mjs");
  assert.equal(typeof createMobilityService, "function");
  assert.equal(typeof createTrackingService, "function");
});

test(
  "PostgreSQL mobility serializes assignment, pins quote fares and revokes tracking",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { default: pg } = await import("pg");
    const { createMobilityService } =
      await import("../services/production/mobility.mjs");
    const { createTrackingService } =
      await import("../services/production/tracking.mjs");
    const schema = "mobility_" + randomUUID().replaceAll("-", "");
    const master = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await master.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    const bus = { subscribe: async () => async () => {} };
    let mobility, tracking, ms, ts;
    const actor = (sub, role) => ({
      sub,
      role,
      name: sub,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const request = async (server, path, who, method = "GET", body) => {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method,
          headers: {
            "x-internal-key": "test",
            "x-actor": Buffer.from(JSON.stringify(who)).toString("base64url"),
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      return { status: r.status, body: await r.json() };
    };
    try {
      await pool.query(
        await readFile(
          new URL("../migrations/002_mobility.sql", import.meta.url),
          "utf8",
        ),
      );
      await pool.query(
        "CREATE TABLE test_card_payments(trip_id TEXT PRIMARY KEY, paid BOOLEAN NOT NULL)",
      );
      mobility = createMobilityService({
        paymentGuard: async (trip, client) =>
          (
            await client.query(
              "SELECT paid FROM test_card_payments WHERE trip_id=$1",
              [trip.id],
            )
          ).rows[0]?.paid === true,
        pool,
        internalKey: "test",
        bus,
        routes: {
          quote: async () => ({
            fare: 15000,
            distanceMeters: 1000,
            durationSeconds: 300,
            geometry: [
              [-74, 4],
              [-74.1, 4.1],
            ],
          }),
        },
      });
      tracking = createTrackingService({ pool, internalKey: "test", bus });
      ms = mobility.app.listen(0, "127.0.0.1");
      ts = tracking.app.listen(0, "127.0.0.1");
      await Promise.all([
        new Promise((r) => ms.on("listening", r)),
        new Promise((r) => ts.on("listening", r)),
      ]);
      const p = actor("passenger-a", "passenger"),
        p2 = actor("passenger-b", "passenger"),
        d = actor("driver-a", "driver"),
        admin = actor("admin-a", "admin");
      assert.deepEqual((await request(ms, "/drivers", admin)).body, []);
      assert.equal(
        (
          await request(ms, "/driver-applications", d, "POST", {
            plate: "ABC123",
            vehicle: "Sedan",
            category: "sedan",
            licenseNumber: "L1",
            licenseExpiresAt: "2099-01-01",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(ts, "/locations", d, "POST", {
            lat: 4,
            lng: -74,
            accuracy: 5,
            timestamp: Date.now(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(ms, "/drivers/driver-a/verification", admin, "PATCH", {
            status: "approved",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(ms, "/drivers/driver-a", d, "PATCH", {
            status: "available",
          })
        ).status,
        200,
      );
      const makeTrip = async (who, payment = "Efectivo") => {
        const q = await request(ms, "/quotes", who, "POST", {
          origin: { lat: 4, lng: -74 },
          destination: { lat: 4.1, lng: -74.1 },
          category: "sedan",
        });
        assert.equal(q.status, 201);
        const t = await request(ms, "/trips", who, "POST", {
          quoteId: q.body.id,
          payment,
          fare: 1,
        });
        assert.equal(t.status, 201);
        assert.equal(t.body.fare, 15000);
        assert.equal(
          (
            await request(ms, "/trips", who, "POST", {
              quoteId: q.body.id,
              payment: "Efectivo",
            })
          ).status,
          409,
        );
        return t.body;
      };
      const first = await makeTrip(p),
        second = await makeTrip(p2);
      const outcomes = await Promise.all(
        [first, second].map((t) =>
          request(ms, `/trips/${t.id}`, d, "PATCH", { status: "accepted" }),
        ),
      );
      assert.deepEqual(outcomes.map((o) => o.status).sort(), [200, 409]);
      const assigned = outcomes.find((o) => o.status === 200).body;
      const owner = assigned.passengerId === p.sub ? p : p2;
      const timestamp = Date.now();
      assert.equal(
        (
          await request(ts, "/locations", d, "POST", {
            lat: 4,
            lng: -74,
            accuracy: 5,
            timestamp,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(ts, "/locations", d, "POST", {
            lat: 4,
            lng: -74,
            accuracy: 5,
            timestamp,
          })
        ).status,
        409,
      );
      assert.equal(
        (await request(ts, "/locations?ids=all", owner)).body.length,
        1,
      );
      assert.equal(
        (
          await request(
            ts,
            "/locations?ids=all",
            actor("outsider", "passenger"),
          )
        ).body.length,
        0,
      );
      assert.equal(
        (
          await request(ms, `/trips/${assigned.id}`, owner, "PATCH", {
            status: "cancelled",
          })
        ).status,
        200,
      );
      assert.equal(
        (await request(ts, "/locations?ids=all", owner)).body.length,
        0,
      );
      const card = await makeTrip(p, "Tarjeta");
      assert.equal(
        (
          await request(ms, `/trips/${card.id}`, d, "PATCH", {
            status: "accepted",
          })
        ).status,
        200,
      );
      const unpaid = await request(ms, `/trips/${card.id}`, d, "PATCH", {
        status: "in_progress",
      });
      assert.equal(unpaid.status, 409);
      assert.equal(
        unpaid.body.error,
        "Confirma el pago con tarjeta antes de iniciar el viaje",
      );
      assert.equal(
        (await pool.query("SELECT status FROM trips WHERE id=$1", [card.id]))
          .rows[0].status,
        "accepted",
      );
      await pool.query("INSERT INTO test_card_payments VALUES($1,true)", [
        card.id,
      ]);
      await pool.query(
        "UPDATE drivers SET license_expires_at='2000-01-01' WHERE id=$1",
        [d.sub],
      );
      assert.equal(
        (
          await request(ms, `/trips/${card.id}`, d, "PATCH", {
            status: "in_progress",
          })
        ).status,
        409,
      );
      await pool.query(
        "UPDATE drivers SET license_expires_at='2099-01-01' WHERE id=$1",
        [d.sub],
      );

      assert.equal(
        (
          await request(ms, `/trips/${card.id}`, d, "PATCH", {
            status: "in_progress",
          })
        ).status,
        200,
      );
      await pool.query(
        "UPDATE drivers SET license_expires_at='2000-01-01' WHERE id=$1",
        [d.sub],
      );
      assert.equal(
        (
          await request(ms, `/trips/${card.id}`, d, "PATCH", {
            status: "completed",
          })
        ).status,
        200,
      );
      assert.equal(
        (await pool.query("SELECT status FROM drivers WHERE id=$1", [d.sub]))
          .rows[0].status,
        "offline",
      );

      assert.equal(
        (
          await request(ms, "/drivers/driver-a/verification", d, "PATCH", {
            status: "approved",
          })
        ).status,
        403,
      );

      assert.equal(
        (
          await request(ms, `/trips/${assigned.id}`, d, "PATCH", {
            status: "accepted",
          })
        ).status,
        409,
      );
    } finally {
      await mobility?.close();
      await tracking?.close();
      await Promise.all(
        [ms, ts].filter(Boolean).map((s) => new Promise((r) => s.close(r))),
      );
      await pool.end();
      await master.query(`DROP SCHEMA ${schema} CASCADE`);
      await master.end();
    }
  },
);
