"use client";
import { useEffect, useRef, useState } from "react";
import { api, money } from "../lib/api";
type Place = { id: string; label: string; lat: number; lng: number };
export default function BookingDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [origin, setOrigin] = useState<Place | null>(null),
    [destination, setDestination] = useState<Place | null>(null),
    [search, setSearch] = useState(""),
    [target, setTarget] = useState("origin"),
    [places, setPlaces] = useState<Place[]>([]),
    [category, setCategory] = useState("mini"),
    [quote, setQuote] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);
  useEffect(() => {
    if (search.length < 3) {
      setPlaces([]);
      return;
    }
    const t = setTimeout(
      () =>
        api<Place[]>("/places?q=" + encodeURIComponent(search))
          .then(setPlaces)
          .catch((e) => setError(e.message)),
      350,
    );
    return () => clearTimeout(t);
  }, [search]);
  return (
    <dialog ref={ref} className="booking-dialog" onCancel={onClose}>
      <button className="icon-button" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      <h2>Un nuevo destino.</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            if (!quote) {
              setQuote(
                await api("/quotes", "POST", { origin, destination, category }),
              );
            } else {
              await api("/trips", "POST", {
                quoteId: quote.quoteId || quote.id,
                passenger: data.get("passenger"),
                payment: data.get("payment"),
              });
              onCreated();
              onClose();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Pasajero
          <input name="passenger" required />
        </label>
        <button
          type="button"
          className="button"
          onClick={() => setTarget("origin")}
        >
          Origen: {origin?.label || "Seleccionar"}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => setTarget("destination")}
        >
          Destino: {destination?.label || "Seleccionar"}
        </button>
        <label>
          Buscar {target === "origin" ? "origen" : "destino"}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {places.map((p) => (
          <button
            type="button"
            className="button"
            key={p.id}
            onClick={() => {
              target === "origin" ? setOrigin(p) : setDestination(p);
              setSearch("");
              setQuote(null);
            }}
          >
            {p.label}
          </button>
        ))}
        <label>
          Categoría
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setQuote(null);
            }}
          >
            <option value="mini">Mini</option>
            <option value="sedan">Comfort</option>
            <option value="suv">XL</option>
          </select>
        </label>
        <label>
          Pago
          <select name="payment">
            <option>Efectivo</option>
            <option>Tarjeta</option>
          </select>
        </label>
        {quote && (
          <p>
            {money(quote.fare)} · {(quote.distanceMeters / 1000).toFixed(1)} km
            · {Math.ceil(quote.durationSeconds / 60)} min
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !origin || !destination}
        >
          {busy
            ? "Procesando…"
            : quote
              ? "Confirmar reserva"
              : "Consultar tarifa"}
        </button>
      </form>
    </dialog>
  );
}
