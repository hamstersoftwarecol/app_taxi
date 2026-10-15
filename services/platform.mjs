import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { authService } from "./auth/server.mjs";
import { tripsService } from "./trips/server.mjs";
import { trackingService } from "./tracking/server.mjs";
import { gatewayService } from "./gateway/server.mjs";
import { listen } from "./common.mjs";
export async function createDemoPlatform({
  dataDir = "data",
  ports = { auth: 3101, trips: 3102, tracking: 3103, gateway: 3100 },
  simulate = true,
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const internalKey =
    process.env.INTERNAL_KEY || randomBytes(32).toString("hex");
  const secret = process.env.SESSION_SECRET || randomBytes(48).toString("hex");
  const common = { internalKey, secret };
  const services = {
    auth: authService({ ...common, path: join(dataDir, "auth.sqlite") }),
    trips: tripsService({ ...common, path: join(dataDir, "trips.sqlite") }),
    tracking: trackingService({
      ...common,
      path: join(dataDir, "tracking.sqlite"),
      simulate,
    }),
  };
  const servers = {};
  const upstreams = {};
  try {
    for (const name of ["auth", "trips", "tracking"]) {
      servers[name] = await listen(services[name].app, ports[name]);
      upstreams[name] = "http://127.0.0.1:" + servers[name].address().port;
    }
    services.gateway = gatewayService({ ...common, upstreams });
    servers.gateway = await listen(
      services.gateway.app,
      ports.gateway,
      process.env.API_HOST || "127.0.0.1",
    );
  } catch (error) {
    for (const s of Object.values(services)) s.close();
    for (const s of Object.values(servers)) s.close();
    throw error;
  }
  return {
    url: "http://127.0.0.1:" + servers.gateway.address().port,
    async close() {
      for (const service of Object.values(services)) service.close();
      await Promise.all(
        Object.values(servers).map(
          (s) =>
            new Promise((resolve) => {
              s.close(resolve);
              s.closeAllConnections();
            }),
        ),
      );
    },
  };
}

export async function createPlatform(options = {}) {
  if (options.mode === "demo" || process.env.RAYO_MODE === "demo")
    return createDemoPlatform(options);
  const { createProductionPlatform } =
    await import("./production/platform.mjs");
  return createProductionPlatform(options);
}
