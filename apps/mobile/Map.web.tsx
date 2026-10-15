import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { request } from "./session";
export default function Map({
  points = [],
  route = [],
}: {
  points?: { lat: number; lng: number; label?: string }[];
  route?: number[][];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let map: mapboxgl.Map | undefined,
      cancelled = false;
    request("/maps/config")
      .then((config) => {
        if (cancelled || !host.current) return;
        if (!config.token)
          throw Error("El proveedor de mapas no está configurado.");
        map = new mapboxgl.Map({
          container: host.current,
          accessToken: config.token,
          style: "mapbox://styles/mapbox/light-v11",
          center: points.length ? [points[0].lng, points[0].lat] : [0, 0],
          zoom: points.length ? 13 : 1,
        });
        map.addControl(new mapboxgl.NavigationControl());
        points.forEach((p) =>
          new mapboxgl.Marker().setLngLat([p.lng, p.lat]).addTo(map!),
        );
        map.on("load", () => {
          if (route.length) {
            map!.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: route },
              },
            });
            map!.addLayer({
              id: "route",
              type: "line",
              source: "route",
              paint: { "line-color": "#c59a00", "line-width": 5 },
            });
          }
        });
        map.on("error", () =>
          setError("No pudimos cargar el proveedor de mapas."),
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [JSON.stringify(points), JSON.stringify(route)]);
  return (
    <div style={{ position: "relative" }}>
      <div ref={host} style={{ height: 260, borderRadius: 20 }} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
