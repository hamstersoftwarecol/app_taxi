import {
  createProductionDependencies,
  productionService,
  startWorker,
} from "./platform.mjs";
import { listen } from "../common.mjs";
const name = process.env.SERVICE;
if (!["auth", "trips", "tracking", "ops", "gateway", "worker"].includes(name))
  throw Error("SERVICE debe ser auth, trips, tracking, ops, gateway o worker.");
const internalKey = process.env.INTERNAL_KEY;
if (!internalKey || internalKey.length < 32)
  throw Error("INTERNAL_KEY segura es obligatoria.");
if (
  process.env.NODE_ENV === "production" &&
  !process.env.PUBLIC_APP_URL?.startsWith("https://")
)
  throw Error("PUBLIC_APP_URL HTTPS es obligatoria en producción.");
const deps = await createProductionDependencies({
  migrateDatabase: process.env.AUTO_MIGRATE === "true",
});
let service, server, stopWorker;
if (name === "worker") stopWorker = startWorker(deps);
else {
  service = await productionService(name, deps, {
    internalKey,
    upstreams: {
      auth: process.env.AUTH_URL || "http://127.0.0.1:3101",
      trips: process.env.TRIPS_URL || "http://127.0.0.1:3102",
      tracking: process.env.TRACKING_URL || "http://127.0.0.1:3103",
      ops: process.env.OPS_URL || "http://127.0.0.1:3104",
    },
  });
  server = await listen(
    service.app,
    Number(process.env.PORT) ||
      { auth: 3101, trips: 3102, tracking: 3103, ops: 3104, gateway: 3100 }[
        name
      ],
    process.env.SERVICE_HOST || "127.0.0.1",
  );
}
console.log("Rayo " + name + " iniciado · PostgreSQL · sin datos demo");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await stopWorker?.();
    await service?.close();
    if (server)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    await deps.bus.close();
    deps.transport?.close?.();
    await deps.pool.end();
    process.exit(0);
  });
