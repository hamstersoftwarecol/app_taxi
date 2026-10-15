import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { authService } from "./auth/server.mjs";
import { tripsService } from "./trips/server.mjs";
import { trackingService } from "./tracking/server.mjs";
import { gatewayService } from "./gateway/server.mjs";
import { listen } from "./common.mjs";
const name = process.env.SERVICE;
const factories = {
  auth: authService,
  trips: tripsService,
  tracking: trackingService,
  gateway: gatewayService,
};
if (!factories[name])
  throw Error("SERVICE debe ser auth, trips, tracking o gateway.");
if (!process.env.SESSION_SECRET || !process.env.INTERNAL_KEY)
  throw Error(
    "Define SESSION_SECRET e INTERNAL_KEY antes de ejecutar servicios independientes.",
  );
const dataDir = process.env.DATA_DIR || "data";
mkdirSync(dataDir, { recursive: true });
const service = factories[name]({
  path: join(dataDir, name + ".sqlite"),
  internalKey: process.env.INTERNAL_KEY,
  secret: process.env.SESSION_SECRET,
  simulate: process.env.SIMULATE_LOCATIONS !== "false",
  upstreams: {
    auth: process.env.AUTH_URL || "http://127.0.0.1:3101",
    trips: process.env.TRIPS_URL || "http://127.0.0.1:3102",
    tracking: process.env.TRACKING_URL || "http://127.0.0.1:3103",
  },
});
const server = await listen(
  service.app,
  Number(process.env.PORT) ||
    { auth: 3101, trips: 3102, tracking: 3103, gateway: 3100 }[name],
  process.env.SERVICE_HOST || "127.0.0.1",
);
console.log("Rayo " + name + " escuchando en " + server.address().port);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    service.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
