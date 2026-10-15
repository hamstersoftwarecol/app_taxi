import express from "express";
import helmet from "helmet";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fail } from "../../packages/shared/domain.mjs";
import { errorHandler } from "../common.mjs";
import { telemetry, metrics } from "./telemetry.mjs";
export function createProductionGateway({
  upstreams,
  internalKey,
  pool,
  metricsToken = process.env.METRICS_TOKEN,
  sessionPollMs = 3000,
}) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY_HOPS)
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
  app.use(helmet());
  app.use(telemetry("gateway"));
  const origins = (
    process.env.CORS_ORIGINS ||
    "http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000,http://127.0.0.1:8081"
  ).split(",");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin))
      return res.status(403).json({ error: "Origen no permitido." });
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Vary", "Origin");
    }
    res.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Client-Platform",
    );
    res.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/health", (req, res) =>
    res.json({ status: "ok", mode: "production" }),
  );
  app.get("/ready", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      const integrations = {
        maps: Boolean(
          process.env.MAPBOX_TOKEN &&
          process.env.MAPBOX_PUBLIC_TOKEN &&
          process.env.FARE_RULES_JSON,
        ),
        payments: Boolean(
          process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
        ),
        email: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
        push: process.env.EXPO_PUSH_ENABLED === "true",
      };
      const ready =
        process.env.NODE_ENV !== "production" ||
        Object.values(integrations).every(Boolean);
      res
        .status(ready ? 200 : 503)
        .json({ database: true, integrations, ready });
    } catch {
      res.status(503).json({ database: false, ready: false });
    }
  });
  app.get("/metrics", async (req, res) => {
    if (!metricsToken || req.headers.authorization !== "Bearer " + metricsToken)
      return res.sendStatus(403);
    res.type("text/plain; version=0.0.4").send(await metrics(pool));
  });
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      const r = await fetch(upstreams.ops + "/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-key": internalKey,
          "stripe-signature": req.headers["stripe-signature"] || "",
        },
        body: req.body,
        signal: AbortSignal.timeout(20000),
      });
      res.status(r.status).json(await r.json());
    },
  );
  app.use(express.json({ limit: "24kb" }));
  const publicRoutes = new Set([
    "/register",
    "/login",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/resend-verification",
  ]);
  const tokenFrom = (req) =>
    (req.headers.authorization || "").replace(/^Bearer /, "") ||
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("rayo_session="))
      ?.slice(13) ||
    "";
  async function auth(path, body, ip) {
    const r = await fetch(upstreams.auth + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": internalKey,
        "x-client-ip": ip || "unknown",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    let data;
    try {
      data = await r.json();
    } catch {
      fail("Identidad no disponible.", 503);
    }
    return { r, data };
  }
  app.use("/api", async (req, res) => {
    const path = req.path;
    const ip = req.ip || req.socket.remoteAddress;
    if (publicRoutes.has(path) && req.method === "POST") {
      const { r, data } = await auth(path, req.body, ip);
      if (r.ok && path === "/login")
        res.cookie("rayo_session", data.token, {
          httpOnly: true,
          sameSite: "lax",
          secure:
            process.env.NODE_ENV === "production" ||
            process.env.PUBLIC_APP_URL?.startsWith("https:"),
          maxAge: 28800000,
          path: "/",
        });
      return res.status(r.status).json(
        path === "/login" && r.ok
          ? {
              ...data,
              token:
                req.headers["x-client-platform"] === "web"
                  ? undefined
                  : data.token,
            }
          : data,
      );
    }
    const token = tokenFrom(req);
    const { r: sessionResponse, data: actor } = await auth(
      "/session",
      { token },
      ip,
    );
    if (!sessionResponse.ok)
      return res.status(sessionResponse.status).json(actor);
    if (path === "/me" && req.method === "GET") return res.json(actor);
    if (["/logout", "/logout-all"].includes(path) && req.method === "POST") {
      const { r, data } = await auth(path, { token }, ip);
      res.clearCookie("rayo_session", { path: "/" });
      return res.status(r.status).json(data);
    }
    let base;
    if (
      /^\/(trips(?:\/[^/]+)?|drivers(?:\/[^/]+(?:\/verification)?)?|driver-applications|quotes|events)$/.test(
        path,
      )
    )
      base = upstreams.trips;
    else if (/^\/locations(?:\/events)?$/.test(path)) base = upstreams.tracking;
    else if (
      /^\/(maps\/config|places|preferences|devices|support(?:\/[^/]+)?|payments(?:\/(?:checkout|reconcile|cash))?|reconciliation|audit|outbox(?:\/[^/]+\/retry)?)$/.test(
        path,
      )
    )
      base = upstreams.ops;
    else fail("Ruta no encontrada.", 404);
    const controller = new AbortController();
    let poll, expiration;
    res.on("close", () => {
      controller.abort();
      clearInterval(poll);
      clearTimeout(expiration);
    });
    const isStream = path.endsWith("/events") || path === "/events";
    if (isStream) {
      expiration = setTimeout(
        () => {
          res.end();
          controller.abort();
        },
        Math.max(0, actor.exp * 1000 - Date.now()),
      );
      expiration.unref();
      let checking = false;
      poll = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const { r } = await auth("/session", { token }, ip);
          if (!r.ok) {
            res.end();
            controller.abort();
          }
        } catch {
          res.end();
          controller.abort();
        } finally {
          checking = false;
        }
      }, sessionPollMs);
      poll.unref();
    }
    const r = await fetch(base + req.url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        "x-internal-key": internalKey,
        "x-actor": Buffer.from(JSON.stringify(actor)).toString("base64url"),
      },
      body: ["POST", "PATCH", "PUT", "DELETE"].includes(req.method)
        ? JSON.stringify(req.body)
        : undefined,
      signal: AbortSignal.any([
        controller.signal,
        ...(!isStream ? [AbortSignal.timeout(20000)] : []),
      ]),
    });
    res.status(r.status);
    res.set(
      "Content-Type",
      r.headers.get("content-type") || "application/json",
    );
    if (isStream && r.ok) {
      res.set({
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
    }
    if (r.body) {
      try {
        await pipeline(Readable.fromWeb(r.body), res);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    } else res.end();
  });
  app.use((error, req, res, next) => {
    if (
      ["TypeError", "TimeoutError", "AbortError"].includes(error.name) &&
      !error.status
    )
      error = Object.assign(
        new Error("Servicio temporalmente no disponible."),
        { status: 503 },
      );
    errorHandler(error, req, res, next);
  });
  return { app, close: async () => {} };
}
