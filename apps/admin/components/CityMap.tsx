"use client";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { api, type Driver, type Location } from "../lib/api";
export default function CityMap({
  drivers,
  locations,
  onDriver,
}: {
  drivers: Driver[];
  locations: Location[];
  onDriver: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<mapboxgl.Map | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    api<{ token: string }>("/maps/config")
      .then((config) => {
        if (disposed || !host.current) return;
        if (!config.token)
          throw Error("El proveedor de mapas no está configurado.");
        const m = new mapboxgl.Map({
          container: host.current,
          accessToken: config.token,
          style: "mapbox://styles/mapbox/light-v11",
          center: [0, 0],
          zoom: 1,
        });
        map.current = m;
        m.addControl(new mapboxgl.NavigationControl());
        m.on("load", () => setLoaded(true));
        m.on("error", () =>
          setError(
            "No pudimos cargar el mapa. Revisa la configuración del proveedor.",
          ),
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !map.current) return;
    const m = map.current;
    const markers = locations
      .filter((l) => !l.simulated)
      .map((l) => {
        const d = drivers.find((d) => d.id === l.driverId);
        const button = document.createElement("button");
        button.textContent = "Taxi";
        button.className = "button primary";
        button.setAttribute("aria-label", d?.name || "Conductor");
        button.onclick = () => onDriver(l.driverId);
        return new mapboxgl.Marker({ element: button })
          .setLngLat([l.lng, l.lat])
          .addTo(m);
      });
    if (locations.length) {
      const bounds = new mapboxgl.LngLatBounds();
      locations
        .filter((l) => !l.simulated)
        .forEach((l) => bounds.extend([l.lng, l.lat]));
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 65, maxZoom: 15 });
    }
    return () => markers.forEach((x) => x.remove());
  }, [loaded, locations, drivers, onDriver]);
  return (
    <div className="city-map">
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {error && (
        <p
          role="alert"
          className="error"
          style={{ position: "relative", background: "white", padding: 20 }}
        >
          {error}
        </p>
      )}
      {!locations.length && (
        <div className="map-city">Sin ubicaciones GPS recibidas</div>
      )}
    </div>
  );
}
