import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { testDatabase } from "./production-helper.mjs";
import { createPayments } from "../services/production/payments.mjs";
import { createDelivery } from "../services/production/outbox.mjs";
import { createAudit } from "../services/production/operations.mjs";
const enabled = Boolean(process.env.TEST_DATABASE_URL);
test(
  "pago firmado idempotente, importes y conciliación usan PostgreSQL",
  { skip: !enabled },
  async () => {
    const db = await testDatabase();
    const { pool } = db;
    const uid = randomUUID(),
      tripId = randomUUID();
    const actor = { sub: uid, role: "passenger" };
    const sdk = new Stripe("sk_test_local_fixture");
    const sessions = new Map();
    const stripe = {
      webhooks: sdk.webhooks,
      checkout: {
        sessions: {
          create: async (params) => {
            const id = "cs_" + randomUUID();
            const s = {
              id,
              url: "https://checkout.stripe.com/c/test",
              currency: "cop",
              amount_total: params.line_items[0].price_data.unit_amount,
              metadata: params.metadata,
              payment_intent: null,
              payment_status: "unpaid",
              status: "open",
              expires_at: Math.floor(Date.now() / 1000) + 1800,
            };
            sessions.set(id, s);
            return s;
          },
          retrieve: async (id) => sessions.get(id),
        },
      },
      refunds: { create: async () => ({ id: "re_fixture" }) },
    };
    const secret = "whsec_test_fixture";
    const payments = createPayments({
      pool,
      stripe,
      webhookSecret: secret,
      publicUrl: "https://rayo.example",
      audit: createAudit(pool),
    });
    try {
      await pool.query(
        "INSERT INTO users(id,name,email,role,password_hash,email_verified) VALUES($1,'Prueba','pay@example.com','passenger','unused',true)",
        [uid],
      );
      await pool.query(
        "INSERT INTO trips(id,passenger_id,passenger,origin,destination,category,fare,payment,status,origin_lat,origin_lng,destination_lat,destination_lng,route) VALUES($1,$2,'Prueba','A','B','mini',12500,'Tarjeta','requested',4.6,-74,4.7,-74,'[]')",
        [tripId, uid],
      );
      await assert.rejects(
        payments.checkout({ sub: "other", role: "passenger" }, tripId),
        /permiso/,
      );
      const result = await payments.checkout(actor, tripId);
      assert.ok(result.url.startsWith("https://checkout.stripe.com"));
      const stored = (await pool.query("SELECT * FROM payments")).rows[0];
      assert.equal(stored.amount, 12500);
      const session = sessions.get(stored.checkout_id);
      session.payment_status = "paid";
      session.payment_intent = {
        id: "pi_fixture",
        latest_charge: {
          id: "ch_fixture",
          amount: 1250000,
          amount_refunded: 0,
          balance_transaction: { fee: 25000, net: 1225000 },
        },
      };
      const payload = JSON.stringify({
        id: "evt_fixture_1",
        type: "checkout.session.completed",
        data: { object: session },
      });
      const signature = sdk.webhooks.generateTestHeaderString({
        payload,
        secret,
      });
      await assert.rejects(
        payments.webhook(Buffer.from(payload), "bad"),
        /Firma/,
      );
      await payments.webhook(Buffer.from(payload), signature);
      await payments.webhook(Buffer.from(payload), signature);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS n FROM stripe_events"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await pool.query("SELECT status FROM payments")).rows[0].status,
        "paid",
      );
      assert.deepEqual(
        await payments
          .reconcile({ sub: "admin", role: "admin" })
          .then(({ processed, mismatches }) => ({ processed, mismatches })),
        { processed: 1, mismatches: 0 },
      );
      assert.equal((await payments.list(actor))[0].providerFee, "25000");
      session.amount_total = 5;
      const report = await payments.reconcile({ sub: "admin", role: "admin" });
      assert.equal(report.mismatches, 1);
      assert.equal(
        (await pool.query("SELECT provider_amount FROM payments")).rows[0]
          .provider_amount,
        "1250000",
      );
      session.amount_total = 1250000;
      session.payment_status = "unpaid";
      await payments.reconcile({ sub: "admin", role: "admin" });
      assert.equal(
        (await pool.query("SELECT status FROM payments")).rows[0].status,
        "paid",
        "una respuesta atrasada no revierte un pago confirmado",
      );
      session.payment_status = "paid";
      await pool.query(
        "UPDATE payments SET status='pending',checkout_expires_at=now()-interval '1 minute'",
      );
      await assert.rejects(payments.checkout(actor, tripId), /procesado/);
      assert.equal(sessions.size, 1, "webhook tardío no permite otro cobro");
      await pool.query("UPDATE trips SET status='cancelled'");
      let releaseRefund, markStarted;
      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      const gate = new Promise((resolve) => {
        releaseRefund = resolve;
      });
      stripe.refunds.create = async () => {
        markStarted();
        await gate;
        return { id: "re_race" };
      };
      const refund = payments.refundCancelled();
      await started;
      const concurrent = pool.query(
        "UPDATE payments SET status='refunded' /* refund_race */",
      );
      // Release only after the competing update completes or waits on our row lock.
      for (let attempt = 0; attempt < 100; attempt++) {
        const activity = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE query LIKE '%UPDATE payments SET status=''refunded'' /* refund_race */%' AND (state='idle' OR wait_event_type='Lock')",
        );
        if (activity.rowCount) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      releaseRefund();
      await Promise.all([refund, concurrent]);
      assert.equal(
        (await pool.query("SELECT status FROM payments")).rows[0].status,
        "refunded",
        "un reembolso concurrente nunca retrocede a pagado",
      );
      await pool.query("UPDATE trips SET status='requested'");
      await pool.query("UPDATE payments SET status='partially_refunded'");
      await assert.rejects(payments.checkout(actor, tripId), /procesado/);
    } finally {
      await db.close();
    }
  },
);
test(
  "outbox sobrevive al proceso, reintenta y dos workers no duplican entrega",
  { skip: !enabled },
  async () => {
    const db = await testDatabase();
    const { pool } = db;
    const delivered = [];
    const transport = {
      sendMail: async (value) => {
        delivered.push(value);
      },
    };
    const delivery = createDelivery({
      pool,
      transport,
      from: "Rayo <no-reply@example.com>",
    });
    try {
      await assert.rejects(
        createDelivery({ pool, transport: null, from: null }).mailer.send({
          to: "a@example.com",
          subject: "A",
          text: "A",
        }),
        /SMTP/,
      );
      await delivery.mailer.send({
        to: "a@example.com",
        subject: "Verifica",
        text: "https://example.com/token",
      });
      await Promise.all([delivery.workOne(), delivery.workOne()]);
      assert.equal(delivered.length, 1);
      assert.equal(
        (await pool.query("SELECT status,payload FROM outbox")).rows[0].status,
        "sent",
      );
      assert.deepEqual(
        (await pool.query("SELECT payload FROM outbox")).rows[0].payload,
        {},
      );
      await delivery.mailer.send({
        to: "b@example.com",
        subject: "Prueba",
        text: "B",
      });
      const bad = createDelivery({
        pool,
        transport: {
          sendMail: async () => {
            throw Error("secret-should-not-leak");
          },
        },
        from: "from@example.com",
      });
      await bad.workOne();
      const job = (
        await pool.query(
          "SELECT status,last_error FROM outbox WHERE status='pending'",
        )
      ).rows[0];
      assert.equal(job.status, "pending");
      assert.equal(job.last_error, "EMAIL_DELIVERY_FAILED");
    } finally {
      await db.close();
    }
  },
);
