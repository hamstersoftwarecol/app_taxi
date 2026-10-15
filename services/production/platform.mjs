import Stripe from "stripe";
import { createPool, migrate } from "./db.mjs";
import { createEventBus } from "./events.mjs";
import { createAuthService } from "./auth.mjs";
import { createMobilityService } from "./mobility.mjs";
import { createTrackingService } from "./tracking.mjs";
import { createProductionGateway } from "./gateway.mjs";
import { createMapbox, createSmtpTransport } from "./providers.mjs";
import { createDelivery } from "./outbox.mjs";
import { createPayments } from "./payments.mjs";
import { createAudit, createOperationsService } from "./operations.mjs";
import { listen } from "../common.mjs";
import { telemetry } from "./telemetry.mjs";
export async function createProductionDependencies({
  pool: providedPool,
  routes: providedRoutes,
  stripe: providedStripe,
  transport: providedTransport,
  migrateDatabase = true,
} = {}) {
  const pool = providedPool || createPool();
  if (migrateDatabase) await migrate(pool);
  const bus = await createEventBus(pool);
  const audit = createAudit(pool);
  const routes = providedRoutes || createMapbox();
  const stripe =
    providedStripe ||
    (process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, {
          timeout: 15000,
          maxNetworkRetries: 2,
        })
      : null);
  const transport = providedTransport || createSmtpTransport();
  const delivery = createDelivery({ pool, transport });
  const payments = createPayments({
    pool,
    stripe,
    audit,
    notify: delivery.notify,
  });
  return {
    pool,
    bus,
    audit,
    routes,
    stripe,
    transport,
    delivery,
    payments,
    ownsPool: !providedPool,
  };
}
export function productionService(
  name,
  deps,
  { internalKey, upstreams, sessionPollMs } = {},
) {
  const common = {
    pool: deps.pool,
    internalKey,
    audit: deps.audit,
    bus: deps.bus,
  };
  switch (name) {
    case "auth":
      return createAuthService({ ...common, mailer: deps.delivery.mailer });
    case "trips":
      return createMobilityService({
        ...common,
        routes: deps.routes,
        notify: deps.delivery.notify,
        paymentGuard: async (trip, c) =>
          (
            await c.query(
              "SELECT 1 FROM payments WHERE trip_id=$1 AND status='paid' AND amount=$2 AND currency='cop' FOR SHARE",
              [trip.id, trip.fare],
            )
          ).rowCount === 1,
      });
    case "tracking":
      return createTrackingService(common);
    case "ops":
      return createOperationsService({
        ...common,
        routes: deps.routes,
        payments: deps.payments,
        delivery: deps.delivery,
      });
    case "gateway":
      return createProductionGateway({ ...common, upstreams, sessionPollMs });
    default:
      throw Error("Servicio no válido.");
  }
}
export async function createProductionPlatform({
  pool,
  ports = { auth: 3101, trips: 3102, tracking: 3103, ops: 3104, gateway: 3100 },
  ...options
} = {}) {
  const internalKey = process.env.INTERNAL_KEY;
  if (!internalKey || internalKey.length < 32)
    throw Error("INTERNAL_KEY requiere al menos 32 caracteres aleatorios.");
  const deps = await createProductionDependencies({ pool, ...options });
  const services = {},
    servers = {},
    upstreams = {};
  try {
    for (const name of ["auth", "trips", "tracking", "ops"]) {
      services[name] = await productionService(name, deps, { internalKey });
      services[name].app.use(telemetry(name));
      servers[name] = await listen(services[name].app, ports[name]);
      upstreams[name] = "http://127.0.0.1:" + servers[name].address().port;
    }
    services.gateway = await productionService("gateway", deps, {
      internalKey,
      upstreams,
      sessionPollMs: options.sessionPollMs,
    });
    servers.gateway = await listen(
      services.gateway.app,
      ports.gateway,
      process.env.API_HOST || "127.0.0.1",
    );
  } catch (error) {
    await Promise.all(Object.values(services).map((s) => s.close()));
    for (const s of Object.values(servers)) s.close();
    await deps.bus.close();
    if (deps.ownsPool) await deps.pool.end();
    throw error;
  }
  return {
    url: "http://127.0.0.1:" + servers.gateway.address().port,
    deps,
    async close() {
      await Promise.all(Object.values(services).map((s) => s.close()));
      await Promise.all(
        Object.values(servers).map(
          (s) =>
            new Promise((resolve) => {
              s.close(resolve);
              s.closeAllConnections();
            }),
        ),
      );
      await deps.bus.close();
      deps.transport?.close?.();
      if (deps.ownsPool) await deps.pool.end();
    },
  };
}
export function startWorker(deps) {
  let stopped = false,
    running = false,
    timer;
  let nextReconcile = 0;
  const work = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (let i = 0; i < 20 && !stopped; i++) {
        if (!(await deps.delivery.workOne())) break;
      }
      if (deps.stripe && Date.now() > nextReconcile) {
        nextReconcile = Date.now() + 60000;
        await deps.payments.reconcile();
        await deps.payments.refundCancelled();
      }
      await deps.pool.query(
        "DELETE FROM auth_rate_limits WHERE window_start<now()-interval '1 day'",
      );
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "WORKER_CYCLE_FAILED" }),
      );
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(work, 2000);
    }
  };
  work();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  };
}
