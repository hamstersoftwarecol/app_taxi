import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./production-helper.mjs";

test("production auth exports service and bootstrap", async () => {
  const auth = await import("../services/production/auth.mjs");
  assert.equal(typeof auth.createAuthService, "function");
  assert.equal(typeof auth.bootstrapAdmin, "function");
});
test(
  "auth lifecycle uses PostgreSQL and single-use recovery",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const { createAuthService, bootstrapAdmin } =
      await import("../services/production/auth.mjs");
    const database = await testDatabase();
    const pool = database.pool;
    const email = `auth-${Date.now()}@example.com`,
      messages = [];
    process.env.PUBLIC_APP_URL = "https://rayo.example";
    const { app, close } = await createAuthService({
      pool,
      internalKey: "test-key",
      mailer: { send: async (m) => messages.push(m) },
      audit: async () => {},
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const post = async (path, body) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-key": "test-key",
            "x-client-ip": email,
          },
          body: JSON.stringify(body),
        },
      );
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = { error: text };
      }
      return { status: response.status, body: result };
    };
    const password = "StrongPassword-123!";
    try {
      assert.equal(
        (
          await post("/register", {
            name: "Test",
            email,
            password,
            role: "admin",
          })
        ).status,
        400,
      );
      const registration = await post("/register", {
        name: "Test",
        email,
        password,
        role: "passenger",
      });
      assert.equal(registration.status, 201);
      assert.equal(registration.body.token, undefined);
      assert.equal((await post("/login", { email, password })).status, 403);
      const token = new URL(
        messages.at(-1).text.match(/https:\/\/\S+/)[0],
      ).searchParams.get("token");
      const resend = await post("/resend-verification", { email });
      assert.equal(resend.status, 200);
      assert.deepEqual(
        resend.body,
        (await post("/resend-verification", { email: `absent-${email}` })).body,
      );
      assert.equal((await post("/verify-email", { token })).status, 400);
      await Promise.all([
        post("/resend-verification", { email }),
        post("/resend-verification", { email }),
      ]);
      const activeTokens = await pool.query(
        "SELECT count(*)::int AS count FROM auth_tokens WHERE user_id=$1 AND purpose='verify' AND used_at IS NULL",
        [registration.body.user.sub],
      );
      assert.equal(
        activeTokens.rows[0].count,
        1,
        "concurrent resend retains only the latest token",
      );
      const replacement = new URL(messages.at(-1).text).searchParams.get(
        "token",
      );
      assert.equal(
        (await post("/verify-email", { token: replacement })).status,
        200,
      );
      assert.equal((await post("/verify-email", { token })).status, 400);
      const login = await post("/login", { email, password });
      assert.equal(login.status, 200);
      assert.equal(
        (await post("/session", { token: login.body.token })).body.sub,
        registration.body.user.sub,
      );
      const second = await post("/login", { email, password });
      assert.equal(
        (await post("/logout", { token: second.body.token })).status,
        200,
      );
      assert.equal(
        (await post("/session", { token: second.body.token })).status,
        401,
      );
      const expired = await post("/login", { email, password });
      await pool.query(
        "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [
          (await import("node:crypto"))
            .createHash("sha256")
            .update(expired.body.token)
            .digest("hex"),
        ],
      );
      assert.equal(
        (await post("/session", { token: expired.body.token })).status,
        401,
      );
      const unknown = await post("/forgot-password", {
          email: `unknown-${email}`,
        }),
        known = await post("/forgot-password", { email });
      assert.deepEqual(known.body, unknown.body);
      const reset = new URL(
        messages.at(-1).text.match(/https:\/\/\S+/)[0],
      ).searchParams.get("token");
      assert.equal(
        (
          await post("/reset-password", {
            token: reset,
            password: "DifferentPassword-456!",
          })
        ).status,
        200,
      );
      assert.equal(
        (await post("/session", { token: login.body.token })).status,
        401,
      );
      assert.equal(
        (await post("/reset-password", { token: reset, password })).status,
        400,
      );
      const relogin = await post("/login", {
        email,
        password: "DifferentPassword-456!",
      });
      const parallel = await post("/login", {
        email,
        password: "DifferentPassword-456!",
      });
      assert.equal(
        (await post("/logout-all", { token: relogin.body.token })).status,
        200,
      );
      assert.equal(
        (await post("/session", { token: parallel.body.token })).status,
        401,
      );
      const lock = await pool.connect();
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM users WHERE email=$1 FOR UPDATE", [
        email,
      ]);
      const racingLogin = post("/login", {
        email,
        password: "DifferentPassword-456!",
      });
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%auth_sessions%' OR (datname=current_database() AND wait_event_type='Lock' AND query LIKE '%users%')",
        );
        if (activity.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      await lock.query("UPDATE users SET password_hash=$1 WHERE email=$2", [
        "scrypt:00000000000000000000000000000000:" + "00".repeat(64),
        email,
      ]);
      await lock.query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1",
        [registration.body.user.sub],
      );
      await lock.query("COMMIT");
      lock.release();
      assert.equal(
        blocked,
        true,
        "login must synchronize with password updates",
      );
      assert.equal(
        (await racingLogin).status,
        401,
        "old password cannot open session after reset commits",
      );
      for (let i = 0; i < 12; i++)
        await post("/login", { email, password: "IncorrectPassword-123!" });
      assert.equal(
        (await post("/login", { email, password: "DifferentPassword-456!" }))
          .status,
        429,
      );
      const admin = await bootstrapAdmin({
        pool,
        email: `admin-${email}`,
        name: "Admin",
        password,
      });
      assert.equal(admin.role, "admin");
      assert.equal(
        (
          await bootstrapAdmin({
            pool,
            email: `admin-${email}`,
            name: "Admin",
            password,
          })
        ).sub,
        admin.sub,
      );
    } finally {
      await new Promise((r) => server.close(r));
      await close();
      await database.close();
    }
  },
);
