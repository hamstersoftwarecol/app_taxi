import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./production-helper.mjs";
import { createProductionPlatform } from "../services/production/platform.mjs";
import { bootstrapAdmin } from "../services/production/auth.mjs";
const enabled = Boolean(process.env.TEST_DATABASE_URL);
test(
  "gateway operativo: sin seeds, roles, preferencias, soporte, webhooks y revocación SSE",
  { skip: !enabled },
  async () => {
    const db = await testDatabase();
    const previous = { ...process.env };
    process.env.INTERNAL_KEY = "x".repeat(48);
    process.env.PUBLIC_APP_URL = "http://localhost:3000";
    process.env.SMTP_FROM = "Rayo <test@example.com>";
    process.env.EXPO_PUSH_ENABLED = "true";
    const messages = [];
    const p = await createProductionPlatform({
      pool: db.pool,
      migrateDatabase: false,
      transport: { sendMail: async (m) => messages.push(m) },
      routes: {
        config: () => ({ provider: "mapbox", token: "pk.fixture" }),
        places: async () => [],
        quote: async () => ({
          fare: 12500,
          distanceMeters: 3000,
          durationSeconds: 600,
          geometry: [
            [-74, 4.6],
            [-74.1, 4.7],
          ],
        }),
      },
      ports: { auth: 0, trips: 0, tracking: 0, ops: 0, gateway: 0 },
      sessionPollMs: 30,
    });
    const call = async (path, method = "GET", body, token) => {
      const r = await fetch(p.url + "/api" + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json() };
    };
    try {
      assert.equal((await call("/trips")).status, 401);
      assert.equal(
        (
          await call("/login", "POST", {
            email: "admin@rayo.demo",
            password: "RayoDemo2026!",
          })
        ).status,
        401,
      );
      await bootstrapAdmin({
        pool: db.pool,
        email: "admin@example.com",
        name: "Operador",
        password: "Strong-Password-123!",
      });
      const admin = (
        await call("/login", "POST", {
          email: "admin@example.com",
          password: "Strong-Password-123!",
        })
      ).body.token;
      assert.deepEqual((await call("/trips", "GET", null, admin)).body, []);
      assert.deepEqual((await call("/drivers", "GET", null, admin)).body, []);
      const r = await call("/register", "POST", {
        name: "Pasajero",
        email: "person@example.com",
        password: "Strong-Password-123!",
        role: "passenger",
      });
      assert.equal(r.status, 201);
      assert.equal(messages.length, 0);
      await p.deps.delivery.workOne();
      assert.equal(messages.length, 1);
      const verification = new URL(messages[0].text).searchParams.get("token");
      assert.equal(
        (await call("/verify-email", "POST", { token: verification })).status,
        200,
      );
      const user = (
        await call("/login", "POST", {
          email: "person@example.com",
          password: "Strong-Password-123!",
        })
      ).body.token;
      assert.equal(
        (await call("/preferences", "PUT", { language: "es" }, user)).status,
        200,
      );
      assert.equal(
        (await call("/preferences", "GET", null, user)).body.language,
        "es",
      );
      assert.equal((await call("/audit", "GET", null, user)).status, 403);
      const ticket = await call(
        "/support",
        "POST",
        { subject: "Ayuda", message: "Prueba de soporte" },
        user,
      );
      assert.equal(ticket.status, 201);
      assert.equal((await call("/support", "GET", null, user)).body.length, 1);
      assert.equal(
        (
          await call(
            "/support/" + ticket.body.id,
            "PATCH",
            { status: "resolved", reply: "Atendido" },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "/devices",
            "POST",
            { token: "ExpoPushToken[fixture]", platform: "ios" },
            user,
          )
        ).status,
        201,
      );
      const stream = await fetch(p.url + "/api/events", {
        headers: { authorization: "Bearer " + user },
      });
      const reader = stream.body.getReader();
      await reader.read();
      assert.equal((await call("/logout", "POST", {}, user)).status, 200);
      const end = await Promise.race([
        reader.read(),
        new Promise((resolve) =>
          setTimeout(() => resolve({ done: false }), 1000),
        ),
      ]);
      assert.equal(end.done, true);
      assert.equal((await call("/me", "GET", null, user)).status, 401);
      const hook = await fetch(p.url + "/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "bad",
        },
        body: "{}",
      });
      assert.equal(hook.status, 503);
    } finally {
      await p.close();
      await db.close();
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  },
);
