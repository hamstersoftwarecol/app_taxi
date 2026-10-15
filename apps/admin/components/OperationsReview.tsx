"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
export default function OperationsReview() {
  const [applications, setApplications] = useState<any[]>([]),
    [tickets, setTickets] = useState<any[]>([]),
    [error, setError] = useState("");
  const load = () =>
    Promise.all([api<any[]>("/driver-applications"), api<any[]>("/support")])
      .then(([a, t]) => {
        setApplications(a);
        setTickets(t);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2>Verificaciones y soporte</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {applications.map((a) => (
        <form
          key={a.id}
          style={{ padding: "16px 0" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            try {
              await api(
                "/drivers/" +
                  (a.driverId || a.userId || a.id) +
                  "/verification",
                "PATCH",
                { status: data.get("status"), reason: data.get("reason") },
              );
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <strong>
            {a.name || a.driverId} · {a.plate} · {a.status}
          </strong>
          <p>
            {a.vehicle} · Licencia {a.licenseNumber} · Vence{" "}
            {a.licenseExpiresAt}
          </p>
          <label>
            Decisión
            <select name="status">
              <option value="approved">Aprobar</option>
              <option value="rejected">Rechazar</option>
            </select>
          </label>
          <label>
            Motivo
            <input name="reason" required />
          </label>
          <button className="button primary">Guardar revisión</button>
        </form>
      ))}
      {!applications.length && <p>Sin solicitudes de conductores.</p>}
      {tickets.map((t) => (
        <form
          key={t.id}
          style={{ padding: "16px 0" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            try {
              await api("/support/" + t.id, "PATCH", {
                status: fields.get("status"),
                reply: fields.get("reply"),
              });
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <strong>
            {t.subject} · {t.status}
          </strong>
          <p>{t.message}</p>
          <label>
            Respuesta
            <textarea name="reply" defaultValue={t.reply || ""} required />
          </label>
          <label>
            Estado
            <select name="status">
              <option value="resolved">Resuelto</option>
              <option value="open">Abierto</option>
            </select>
          </label>
          <button className="button primary">Responder</button>
        </form>
      ))}
    </section>
  );
}
