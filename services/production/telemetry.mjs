import { randomUUID } from "node:crypto";
const counters = new Map();
export function telemetry(service) {
  return (req, res, next) => {
    const start = performance.now();
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.on("finish", () => {
      const key = JSON.stringify({
        service,
        method: req.method,
        status: res.statusCode,
      });
      const value = counters.get(key) || { count: 0, seconds: 0 };
      value.count++;
      value.seconds += (performance.now() - start) / 1000;
      counters.set(key, value);
      if (process.env.LOG_REQUESTS === "true")
        process.stdout.write(
          JSON.stringify({
            level: "info",
            requestId,
            service,
            method: req.method,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - start),
          }) + "\n",
        );
    });
    next();
  };
}
export async function metrics(pool) {
  let up = 0,
    pending = 0,
    failed = 0;
  try {
    await pool.query("SELECT 1");
    up = 1;
    const rows = (
      await pool.query(
        "SELECT status,count(*)::integer AS count FROM outbox WHERE status IN ('pending','failed') GROUP BY status",
      )
    ).rows;
    pending = rows.find((r) => r.status === "pending")?.count || 0;
    failed = rows.find((r) => r.status === "failed")?.count || 0;
  } catch {}
  const lines = [
    "# TYPE rayo_http_requests_total counter",
    "# TYPE rayo_http_request_seconds_sum counter",
  ];
  for (const [key, v] of counters) {
    const labels = Object.entries(JSON.parse(key))
      .map(([k, value]) => `${k}=${JSON.stringify(String(value))}`)
      .join(",");
    lines.push(
      `rayo_http_requests_total{${labels}} ${v.count}`,
      `rayo_http_request_seconds_sum{${labels}} ${v.seconds}`,
    );
  }
  lines.push(
    "# TYPE rayo_database_up gauge",
    `rayo_database_up ${up}`,
    "# TYPE rayo_outbox_pending gauge",
    `rayo_outbox_pending ${pending}`,
    "# TYPE rayo_outbox_failed gauge",
    `rayo_outbox_failed ${failed}`,
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
  );
  return lines.join("\n") + "\n";
}
