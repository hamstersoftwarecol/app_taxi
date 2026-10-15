import nodemailer from "nodemailer";
import { fail } from "../../packages/shared/domain.mjs";
function coords(point) {
  if (
    !point ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    fail("Selecciona un punto válido en el mapa.");
  return `${point.lng},${point.lat}`;
}
export function createMapbox({
  token = process.env.MAPBOX_TOKEN,
  publicToken = process.env.MAPBOX_PUBLIC_TOKEN,
  fares = process.env.FARE_RULES_JSON,
  fetcher = fetch,
} = {}) {
  async function get(url) {
    if (!token) fail("Cartografía sin configurar. Define MAPBOX_TOKEN.", 503);
    const r = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) fail("El proveedor cartográfico no está disponible.", 503);
    return r.json();
  }
  return {
    config() {
      if (!publicToken?.startsWith("pk."))
        fail("Define un token público de Mapbox restringido al dominio.", 503);
      return { provider: "mapbox", token: publicToken };
    },
    async places(query) {
      if (
        typeof query !== "string" ||
        query.trim().length < 3 ||
        query.length > 160
      )
        fail("Escribe al menos 3 caracteres para buscar.");
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.search = new URLSearchParams({
        q: query,
        access_token: token || "",
        country: "co",
        language: "es",
        limit: "5",
        proximity: "-74.0721,4.7110",
      });
      const data = await get(url);
      return (data.features || []).map((f) => ({
        id: f.id,
        label:
          f.properties.full_address ||
          [f.properties.name, f.properties.place_formatted]
            .filter(Boolean)
            .join(", "),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      }));
    },
    async quote({ origin, destination, category }) {
      const path = coords(origin) + ";" + coords(destination);
      let rule;
      try {
        rule = JSON.parse(fares || "{}")[category];
      } catch {
        fail("Configuración de tarifas no válida.", 503);
      }
      if (
        !rule ||
        !["base", "perKm", "perMinute", "minimum"].every(
          (k) => Number.isFinite(rule[k]) && rule[k] >= 0,
        )
      )
        fail("La tarifa de esta categoría no está configurada.", 503);
      const url = new URL(
        "https://api.mapbox.com/directions/v5/mapbox/driving/" + path,
      );
      url.search = new URLSearchParams({
        access_token: token || "",
        geometries: "geojson",
        overview: "full",
        alternatives: "false",
        language: "es",
      });
      const data = await get(url);
      const route = data.routes?.[0];
      if (
        !route ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration) ||
        route.distance <= 0 ||
        route.distance > Number(process.env.MAX_TRIP_METERS || 150000) ||
        !Array.isArray(route.geometry?.coordinates)
      )
        fail("No encontramos una ruta dentro del área de servicio.", 422);
      return {
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        geometry: route.geometry.coordinates,
        fare: Math.max(
          rule.minimum,
          Math.ceil(
            rule.base +
              (route.distance / 1000) * rule.perKm +
              (route.duration / 60) * rule.perMinute,
          ),
        ),
      };
    },
  };
}
export function createSmtpTransport(config = process.env) {
  if (!config.SMTP_HOST || !config.SMTP_FROM) return null;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT || 587),
    secure: config.SMTP_TLS === "true",
    requireTLS: config.SMTP_REQUIRE_TLS !== "false",
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
      : undefined,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
}
