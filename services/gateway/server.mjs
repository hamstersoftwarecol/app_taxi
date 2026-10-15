import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { appBase, errorHandler, verify } from "../common.mjs";
import { fail } from "../../packages/shared/domain.mjs";
export function gatewayService({ upstreams, internalKey, secret }) {
  const app = appBase();
  const origins = (
    process.env.CORS_ORIGINS ||
    "http://localhost:3000,http://localhost:8081,http://localhost:19006"
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
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/health", (req, res) => res.json({ status: "ok", mode: "demo" }));
  app.use("/api", async (req, res) => {
    const path = req.path;
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const headers = {
      "content-type": "application/json",
      "x-internal-key": internalKey,
    };
    if (path === "/login" && req.method === "POST") {
      const r = await fetch(upstreams.auth + "/login", {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await r.json();
      if (r.ok)
        res.cookie("rayo_session", data.token, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 28800000,
          path: "/",
        });
      return res.status(r.status).json(data);
    }
    if (path === "/logout" && req.method === "POST") {
      res.clearCookie("rayo_session", { path: "/" });
      return res.json({ ok: true });
    }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("rayo_session="))
      ?.slice(13);
    const token =
      (req.headers.authorization || "").replace(/^Bearer /, "") || cookie || "";
    const actor = verify(token, secret);
    const expiryTimer = setTimeout(
      () => {
        res.end();
        controller.abort();
      },
      Math.max(0, actor.exp * 1000 - Date.now()),
    );
    expiryTimer.unref();
    res.on("close", () => clearTimeout(expiryTimer));
    headers.authorization = "Bearer " + token;
    if (path === "/me") return res.json(actor);
    let base = upstreams.trips;
    let suffix = req.url;
    if (path.startsWith("/locations")) {
      if (path === "/locations/events" && actor.role === "passenger")
        fail("Usa la consulta de ubicación de tu viaje activo.", 403);
      base = upstreams.tracking;
      let ids =
        actor.role === "admin"
          ? "all"
          : actor.role === "driver"
            ? actor.sub
            : "";
      if (actor.role === "passenger") {
        const r = await fetch(upstreams.trips + "/trips", {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) fail("No se pudo verificar el viaje.", 503);
        ids = (await r.json())
          .filter((t) => ["accepted", "in_progress"].includes(t.status))
          .map((t) => t.driverId)
          .join(",");
      }
      suffix = path + "?ids=" + encodeURIComponent(ids);
    } else if (!/^\/(trips(?:\/[^/]+)?|drivers(?:\/[^/]+)?|events)$/.test(path))
      fail("Ruta no encontrada.", 404);
    const r = await fetch(base + suffix, {
      method: req.method,
      headers,
      body: ["POST", "PATCH"].includes(req.method)
        ? JSON.stringify(req.body)
        : undefined,
      signal: controller.signal,
    });
    res.status(r.status);
    const type = r.headers.get("content-type") || "application/json";
    res.set("Content-Type", type);
    if (type.includes("text/event-stream")) {
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
  app.use(errorHandler);
  return { app, close: () => {} };
}
