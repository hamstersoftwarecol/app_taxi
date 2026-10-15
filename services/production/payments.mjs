import { randomUUID } from "node:crypto";
import { fail } from "../../packages/shared/domain.mjs";
import { transaction } from "./http.mjs";
export function copToMinor(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000)
    fail("Importe COP no válido.");
  return amount * 100;
}
export function createPayments({
  pool,
  stripe,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
  publicUrl = process.env.PUBLIC_APP_URL,
  audit,
  notify = async () => {},
}) {
  const ready = () => {
    if (!stripe || !publicUrl)
      fail("Los pagos Stripe no están configurados.", 503);
  };
  const owns = (actor, trip) => {
    if (actor.role !== "admin" && actor.sub !== trip.passenger_id)
      fail("No tienes permiso sobre este pago.", 403);
  };
  async function checkout(actor, tripId) {
    ready();
    const checkoutResult = await transaction(pool, async (c) => {
      const trip = (
        await c.query("SELECT * FROM trips WHERE id=$1 FOR UPDATE", [tripId])
      ).rows[0];
      if (!trip) fail("Viaje no encontrado.", 404);
      owns(actor, trip);
      if (trip.payment !== "Tarjeta" || trip.status === "cancelled")
        fail("Este viaje no admite pago con tarjeta.", 409);
      let payment = (
        await c.query("SELECT * FROM payments WHERE trip_id=$1 FOR UPDATE", [
          tripId,
        ])
      ).rows[0];
      if (["paid", "refunded", "partially_refunded"].includes(payment?.status))
        fail("Este pago ya fue procesado.", 409);
      if (payment?.checkout_id) {
        const previous = await retrieve(payment);
        const synced = await syncSession(c, payment, previous);
        if (synced.mismatch) return { mismatch: true };
        if (["paid", "refunded", "partially_refunded"].includes(synced.status))
          return { alreadyProcessed: true };
        if (previous.status !== "expired")
          return {
            url: previous.url || payment.checkout_url,
            paymentId: payment.id,
          };
      }
      if (!payment) {
        payment = (
          await c.query(
            "INSERT INTO payments(id,trip_id,user_id,amount) VALUES($1,$2,$3,$4) RETURNING *",
            [randomUUID(), tripId, trip.passenger_id, trip.fare],
          )
        ).rows[0];
      } else if (payment.checkout_id) {
        payment = (
          await c.query(
            "UPDATE payments SET generation=generation+1 WHERE id=$1 RETURNING *",
            [payment.id],
          )
        ).rows[0];
      }
      const metadata = {
        paymentId: payment.id,
        tripId: trip.id,
        generation: String(payment.generation),
      };
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: trip.id,
          line_items: [
            {
              price_data: {
                currency: "cop",
                unit_amount: copToMinor(payment.amount),
                product_data: { name: "Viaje Rayo " + trip.id },
              },
              quantity: 1,
            },
          ],
          metadata,
          payment_intent_data: { metadata },
          success_url: publicUrl + "/payments/return?status=success",
          cancel_url: publicUrl + "/payments/return?status=cancelled",
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        },
        {
          idempotencyKey:
            "rayo-checkout-" + payment.id + "-" + payment.generation,
        },
      );
      if (!session.id || !session.url)
        fail("Stripe no pudo crear el enlace de pago.", 502);
      await c.query(
        "UPDATE payments SET checkout_id=$2,checkout_url=$3,checkout_expires_at=to_timestamp($4),payment_intent_id=$5,status='pending',updated_at=now() WHERE id=$1",
        [
          payment.id,
          session.id,
          session.url,
          session.expires_at || Math.floor(Date.now() / 1000) + 1800,
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null,
        ],
      );
      await c.query(
        "INSERT INTO audit_log(actor_id,action,resource) VALUES($1,$2,$3)",
        [actor.sub, "payment.checkout", payment.id],
      );
      await c.query(
        "INSERT INTO payment_attempts(checkout_id,payment_id,generation,status) VALUES($1,$2,$3,'pending') ON CONFLICT(checkout_id) DO NOTHING",
        [session.id, payment.id, payment.generation],
      );
      return { url: session.url, paymentId: payment.id };
    });
    if (checkoutResult.alreadyProcessed)
      fail("Este pago ya fue procesado.", 409);
    if (checkoutResult.mismatch)
      fail("El importe del proveedor no coincide. Requiere revisión.", 409);
    return checkoutResult;
  }
  async function list(actor, tripId) {
    const values = [];
    let where = "";
    if (actor.role !== "admin") {
      values.push(actor.sub);
      where = "WHERE p.user_id=$1";
    }
    if (tripId) {
      values.push(tripId);
      where += (where ? " AND " : "WHERE ") + `p.trip_id=$${values.length}`;
    }
    return (
      await pool.query(
        `SELECT p.id,p.trip_id AS "tripId",p.amount,p.currency,p.status,p.refunded_amount AS "refundedAmount",p.provider_amount AS "providerAmount",p.provider_fee AS "providerFee",p.provider_net AS "providerNet",p.reconciled_at AS "reconciledAt",p.created_at AS "createdAt" FROM payments p ${where} ORDER BY p.created_at DESC LIMIT 500`,
        values,
      )
    ).rows;
  }
  async function syncSession(c, payment, session) {
    if (session.id !== payment.checkout_id) return { ignored: true };
    if (
      session.currency !== "cop" ||
      session.amount_total !== copToMinor(payment.amount) ||
      session.metadata?.paymentId !== payment.id
    ) {
      await c.query(
        "INSERT INTO audit_log(actor_id,action,resource,details) VALUES(NULL,'payment.mismatch',$1,$2)",
        [
          payment.id,
          JSON.stringify({
            currency: session.currency,
            amount: session.amount_total,
          }),
        ],
      );
      return { mismatch: true };
    }
    const intent =
      typeof session.payment_intent === "object"
        ? session.payment_intent
        : null;
    const charge =
      intent && typeof intent.latest_charge === "object"
        ? intent.latest_charge
        : null;
    const balance =
      charge && typeof charge.balance_transaction === "object"
        ? charge.balance_transaction
        : null;
    let status =
      session.payment_status === "paid"
        ? "paid"
        : session.status === "expired"
          ? "failed"
          : "pending";
    if (charge && charge.amount_refunded > 0)
      status =
        charge.amount_refunded >= charge.amount
          ? "refunded"
          : "partially_refunded";
    const rank = {
      pending: 0,
      failed: 0,
      paid: 1,
      partially_refunded: 2,
      refunded: 3,
    };
    if ((rank[payment.status] || 0) > (rank[status] || 0))
      status = payment.status;
    await c.query(
      "UPDATE payments SET status=$2,payment_intent_id=COALESCE($3,payment_intent_id),provider_amount=$4,provider_fee=COALESCE($5,provider_fee),provider_net=COALESCE($6,provider_net),refunded_amount=GREATEST(refunded_amount,$7),reconciled_at=now(),updated_at=now() WHERE id=$1",
      [
        payment.id,
        status,
        intent?.id || session.payment_intent || null,
        session.amount_total,
        balance?.fee ?? null,
        balance?.net ?? null,
        charge?.amount_refunded || 0,
      ],
    );
    await c.query(
      "INSERT INTO audit_log(actor_id,action,resource,details) VALUES(NULL,'payment.reconciled',$1,$2)",
      [
        payment.id,
        JSON.stringify({
          status,
          currency: "cop",
          amount: session.amount_total,
        }),
      ],
    );
    await c.query(
      "UPDATE payment_attempts SET status=$2,updated_at=now() WHERE checkout_id=$1",
      [session.id, status],
    );
    return { status };
  }
  async function retrieve(payment) {
    return stripe.checkout.sessions.retrieve(payment.checkout_id, {
      expand: ["payment_intent.latest_charge.balance_transaction"],
    });
  }
  async function webhook(raw, signature) {
    ready();
    if (!webhookSecret) fail("Webhook Stripe sin configurar.", 503);
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
    } catch {
      fail("Firma Stripe no válida.", 400);
    }
    const object = event.data?.object;
    const relevant = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "charge.refunded",
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
    ];
    if (!relevant.includes(event.type)) return { received: true };
    return transaction(pool, async (c) => {
      const inserted = await c.query(
        "INSERT INTO stripe_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [event.id, event.type],
      );
      if (!inserted.rowCount) return { received: true, duplicate: true };
      const payment = (
        await c.query(
          "SELECT * FROM payments WHERE checkout_id=$1 OR payment_intent_id=$2 OR id=$3 FOR UPDATE",
          [
            event.type.startsWith("checkout.") ? object.id : null,
            object.payment_intent ||
              (event.type.startsWith("payment_intent.") ? object.id : null),
            object.metadata?.paymentId || null,
          ],
        )
      ).rows[0];
      if (!payment) {
        await c.query(
          "UPDATE stripe_events SET status='unmatched' WHERE id=$1",
          [event.id],
        );
        return { received: true };
      }
      const session = await retrieve(payment);
      const result = await syncSession(c, payment, session);
      if (result.mismatch)
        await c.query(
          "UPDATE stripe_events SET status='mismatch' WHERE id=$1",
          [event.id],
        );
      await c.query("UPDATE stripe_events SET payment_id=$2 WHERE id=$1", [
        event.id,
        payment.id,
      ]);
      await c.query("SELECT pg_notify('rayo_events',$1)", [
        JSON.stringify({ type: "payments", id: payment.trip_id }),
      ]);
      return { received: true };
    });
  }
  async function reconcile(actor = { sub: null, role: "system" }) {
    ready();
    if (!["admin", "system"].includes(actor.role))
      fail("Acceso de administrador requerido.", 403);
    const items = (
      await pool.query(
        "SELECT * FROM payments WHERE checkout_id IS NOT NULL ORDER BY reconciled_at NULLS FIRST LIMIT 100",
      )
    ).rows;
    let processed = 0,
      mismatches = 0;
    for (const item of items) {
      try {
        const result = await transaction(pool, async (c) => {
          const locked = (
            await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
              item.id,
            ])
          ).rows[0];
          const session = await retrieve(locked);
          return syncSession(c, locked, session);
        });
        if (result.mismatch) mismatches++;
        processed++;
      } catch {
        mismatches++;
        await audit(actor, "payment.reconcile_failed", item.id);
      }
    }
    const id = randomUUID();
    await pool.query(
      "INSERT INTO reconciliation_runs(id,actor_id,processed,mismatches) VALUES($1,$2,$3,$4)",
      [id, actor.sub, processed, mismatches],
    );
    return { id, processed, mismatches };
  }
  async function confirmCash(actor, tripId) {
    if (actor.role !== "admin") fail("Acceso de administrador requerido.", 403);
    return transaction(pool, async (c) => {
      const t = (
        await c.query("SELECT * FROM trips WHERE id=$1 FOR UPDATE", [tripId])
      ).rows[0];
      if (!t) fail("Viaje no encontrado.", 404);
      if (t.payment !== "Efectivo" || t.status !== "completed")
        fail("Solo se concilia efectivo de viajes completados.", 409);
      await c.query(
        "INSERT INTO payments(id,trip_id,user_id,amount,status) VALUES($1,$2,$3,$4,'cash_confirmed') ON CONFLICT(trip_id) DO UPDATE SET status='cash_confirmed',reconciled_at=now(),updated_at=now()",
        [randomUUID(), t.id, t.passenger_id, t.fare],
      );
      await c.query(
        "INSERT INTO audit_log(actor_id,action,resource) VALUES($1,'payment.cash_confirmed',$2)",
        [actor.sub, t.id],
      );
      return { status: "cash_confirmed" };
    });
  }
  async function refundCancelled() {
    if (!stripe) return;
    const items = (
      await pool.query(
        "SELECT p.* FROM payments p JOIN trips t ON t.id=p.trip_id WHERE t.status='cancelled' AND p.status='paid'",
      )
    ).rows;
    for (const item of items) {
      try {
        await transaction(pool, async (c) => {
          const current = (
            await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
              item.id,
            ])
          ).rows[0];
          if (!current || current.status !== "paid") return;
          await stripe.refunds.create(
            {
              payment_intent: current.payment_intent_id,
              metadata: { paymentId: current.id },
            },
            { idempotencyKey: "rayo-cancel-refund-" + current.id },
          );
          const session = await retrieve(current);
          await syncSession(c, current, session);
        });
      } catch {
        await audit({ sub: null }, "payment.refund_retry", item.id);
      }
    }
  }
  return { checkout, list, webhook, reconcile, confirmCash, refundCancelled };
}
