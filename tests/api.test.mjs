import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createPlatform } from "../services/platform.mjs";
test("API autentica, aísla roles y completa una reserva con persistencia", async () => {
  const dir = mkdtempSync(tmpdir() + "/rayo-");
  const platform = await createPlatform({
    mode: "demo",
    dataDir: dir,
    ports: { auth: 0, trips: 0, tracking: 0, gateway: 0 },
    simulate: false,
  });
  try {
    const call = async (path, method = "GET", body, token) => {
      const r = await fetch(platform.url + "/api" + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await call("/trips")).status, 401);
    assert.equal(
      (
        await call("/login", "POST", {
          email: "admin@rayo.demo",
          password: "wrong",
        })
      ).status,
      401,
    );
    const admin = (
      await call("/login", "POST", {
        email: "admin@rayo.demo",
        password: "RayoDemo2026!",
      })
    ).data.token;
    const passenger = (
      await call("/login", "POST", {
        email: "pasajero@rayo.demo",
        password: "RayoDemo2026!",
      })
    ).data.token;
    const driver = (
      await call("/login", "POST", {
        email: "conductor@rayo.demo",
        password: "RayoDemo2026!",
      })
    ).data.token;
    const created = await call(
      "/trips",
      "POST",
      {
        origin: "Chapinero",
        destination: "Usaquén",
        category: "mini",
        payment: "Efectivo",
      },
      passenger,
    );
    assert.equal(created.status, 201);
    assert.equal(created.data.fare, 12500);
    assert.equal(
      (
        await call(
          "/trips/" + created.data.id,
          "PATCH",
          { status: "accepted", driverId: "driver-1" },
          passenger,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/trips/" + created.data.id,
          "PATCH",
          { status: "accepted" },
          driver,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/trips/" + created.data.id,
          "PATCH",
          { status: "in_progress" },
          driver,
        )
      ).status,
      200,
    );
    const locations = await call("/locations", "GET", null, passenger);
    assert.equal(locations.data.length, 1);
    assert.equal(locations.data[0].driverId, "driver-1");
    assert.equal(
      (await call("/locations", "POST", { lat: 4.68, lng: -74.05 }, passenger))
        .status,
      403,
    );
    assert.equal(
      (await call("/locations", "POST", { lat: 400, lng: 0 }, driver)).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/trips/" + created.data.id,
          "PATCH",
          { status: "completed" },
          driver,
        )
      ).status,
      200,
    );
    assert.equal((await call("/trips", "GET", null, passenger)).data.length, 1);
    assert.ok((await call("/trips", "GET", null, admin)).data.length > 1);
    assert.equal(
      (
        await call(
          "/drivers/driver-1",
          "PATCH",
          { status: "offline" },
          passenger,
        )
      ).status,
      403,
    );
  } finally {
    await platform.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("desconectar un stream no detiene el gateway y restringe tracking de pasajero", async () => {
  const dir = mkdtempSync(tmpdir() + "/rayo-stream-");
  const p = await createPlatform({
    mode: "demo",
    dataDir: dir,
    ports: { auth: 0, trips: 0, tracking: 0, gateway: 0 },
    simulate: false,
  });
  try {
    const login = async (email) =>
      (
        await (
          await fetch(p.url + "/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password: "RayoDemo2026!" }),
          })
        ).json()
      ).token;
    const admin = await login("admin@rayo.demo");
    const passenger = await login("pasajero@rayo.demo");
    const r = await fetch(p.url + "/api/events", {
      headers: { authorization: "Bearer " + admin },
    });
    const reader = r.body.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((await fetch(p.url + "/health")).status, 200);
    assert.equal(
      (
        await fetch(p.url + "/api/locations/events", {
          headers: { authorization: "Bearer " + passenger },
        })
      ).status,
      403,
    );
  } finally {
    await p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("un stream se cierra cuando vence la sesión firmada", async () => {
  const { createHmac } = await import("node:crypto");
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "stream-expiry-test-only-secret";
  const dir = mkdtempSync(tmpdir() + "/rayo-expiry-");
  let p;
  try {
    p = await createPlatform({
      mode: "demo",
      dataDir: dir,
      ports: { auth: 0, trips: 0, tracking: 0, gateway: 0 },
      simulate: false,
    });
    const body = Buffer.from(
      JSON.stringify({
        sub: "admin",
        role: "admin",
        exp: Date.now() / 1000 + 0.2,
      }),
    ).toString("base64url");
    const token =
      body +
      "." +
      createHmac("sha256", process.env.SESSION_SECRET)
        .update(body)
        .digest("base64url");
    const r = await fetch(p.url + "/api/events", {
      headers: { authorization: "Bearer " + token },
    });
    const reader = r.body.getReader();
    await reader.read();
    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ done: false }), 700)),
    ]);
    assert.equal(
      result.done,
      true,
      "el stream debe terminar al expirar la sesión",
    );
  } finally {
    if (p) await p.close();
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
    rmSync(dir, { recursive: true, force: true });
  }
});
