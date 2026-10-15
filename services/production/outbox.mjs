import { fail } from "../../packages/shared/domain.mjs";
export function createDelivery({
  pool,
  transport,
  from = process.env.SMTP_FROM,
  pushEnabled = process.env.EXPO_PUSH_ENABLED === "true",
  expoAccessToken = process.env.EXPO_ACCESS_TOKEN,
  fetcher = fetch,
}) {
  const assertConfigured = () => {
    if (!transport || !from)
      fail(
        "Configura SMTP para enviar correos de verificación y recuperación.",
        503,
      );
  };
  const mailer = {
    assertConfigured,
    async send(message) {
      assertConfigured();
      await pool.query("INSERT INTO outbox(kind,payload) VALUES('email',$1)", [
        JSON.stringify(message),
      ]);
      return { queued: true };
    },
  };
  async function notify({ userId, title, body, data = {} }) {
    if (!pushEnabled) return;
    const devices = (
      await pool.query(
        "SELECT d.token FROM devices d JOIN auth_sessions s ON s.id=d.session_id WHERE d.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now()",
        [userId],
      )
    ).rows;
    for (const d of devices)
      await pool.query("INSERT INTO outbox(kind,payload) VALUES('push',$1)", [
        JSON.stringify({ token: d.token, userId, title, body, data }),
      ]);
  }
  async function workOne() {
    const claimed = await pool.query(
      "UPDATE outbox SET status='processing',attempts=attempts+1,locked_at=now() WHERE id=(SELECT id FROM outbox WHERE (status='pending' AND available_at<=now()) OR (status='processing' AND locked_at<now()-interval '2 minutes') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
    );
    const job = claimed.rows[0];
    if (!job) return false;
    let skipped = false;
    try {
      if (job.kind === "email") {
        assertConfigured();
        await transport.sendMail({
          from,
          to: job.payload.to,
          subject: job.payload.subject,
          text: job.payload.text,
          messageId: `<rayo-${job.id}@${String(from).match(/@([^> ]+)/)?.[1] || "localhost"}>`,
        });
      } else if (job.kind === "push") {
        const valid = await pool.query(
          "SELECT 1 FROM devices d JOIN auth_sessions s ON s.id=d.session_id WHERE d.token=$1 AND d.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()",
          [job.payload.token, job.payload.userId],
        );
        if (!valid.rowCount) skipped = true;
        if (valid.rowCount) {
          const r = await fetcher("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(expoAccessToken
                ? { authorization: "Bearer " + expoAccessToken }
                : {}),
            },
            body: JSON.stringify({
              to: job.payload.token,
              title: job.payload.title,
              body: job.payload.body,
              data: { ...job.payload.data, notificationId: String(job.id) },
              sound: "default",
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) throw Error("PUSH_HTTP");
          const ticket = (await r.json()).data;
          if (ticket?.status !== "ok") {
            if (ticket?.details?.error === "DeviceNotRegistered")
              await pool.query("DELETE FROM devices WHERE token=$1", [
                job.payload.token,
              ]);
            throw Error("PUSH_TICKET");
          }
          await pool.query(
            "INSERT INTO outbox(kind,payload,available_at) VALUES('push_receipt',$1,now()+interval '15 minutes')",
            [
              JSON.stringify({
                receiptId: ticket.id,
                token: job.payload.token,
              }),
            ],
          );
        }
      } else if (job.kind === "push_receipt") {
        const r = await fetcher("https://exp.host/--/api/v2/push/getReceipts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(expoAccessToken
              ? { authorization: "Bearer " + expoAccessToken }
              : {}),
          },
          body: JSON.stringify({ ids: [job.payload.receiptId] }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw Error("RECEIPT_HTTP");
        const receipt = (await r.json()).data?.[job.payload.receiptId];
        if (!receipt) throw Error("RECEIPT_PENDING");
        if (receipt.status === "error") {
          if (receipt.details?.error === "DeviceNotRegistered")
            await pool.query("DELETE FROM devices WHERE token=$1", [
              job.payload.token,
            ]);
          throw Error("RECEIPT_ERROR");
        }
      }
      await pool.query(
        "UPDATE outbox SET status=$2,payload='{}',completed_at=now(),locked_at=NULL,last_error=NULL WHERE id=$1",
        [job.id, skipped ? "skipped" : "sent"],
      );
    } catch {
      await pool.query(
        "UPDATE outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts))::int),locked_at=NULL,last_error=$2 WHERE id=$1",
        [job.id, job.kind.toUpperCase() + "_DELIVERY_FAILED"],
      );
    }
    return true;
  }
  return { mailer, notify, workOne };
}
