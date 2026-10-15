import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../services/production/events.mjs";
import { testDatabase } from "./production-helper.mjs";
test("fallo LISTEN libera el cliente del pool antes de reintentar", async () => {
  let inUse = 0;
  const pool = {
    connect: async () => {
      inUse++;
      return {
        query: async () => {
          throw Error("LISTEN failure");
        },
        release: () => inUse--,
      };
    },
  };
  const bus = await createEventBus(pool);
  try {
    assert.equal(inUse, 0);
  } finally {
    await bus.close();
  }
});
test(
  "dos réplicas reciben eventos confirmados de PostgreSQL",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await testDatabase();
    const a = await createEventBus(db.pool),
      b = await createEventBus(db.pool);
    try {
      let ra, rb;
      const one = new Promise((resolve) => {
          ra = resolve;
        }),
        two = new Promise((resolve) => {
          rb = resolve;
        });
      await a.subscribe("rayo_events", (msg) => {
        if (msg.id === "replica-test") ra(msg);
      });
      await b.subscribe("rayo_events", (msg) => {
        if (msg.id === "replica-test") rb(msg);
      });
      await a.publish("rayo_events", { type: "trips", id: "replica-test" });
      const result = await Promise.race([
        Promise.all([one, two]),
        new Promise((resolve) => setTimeout(() => resolve([]), 1000)),
      ]);
      assert.equal(result.length, 2);
    } finally {
      await a.close();
      await b.close();
      await db.close();
    }
  },
);
