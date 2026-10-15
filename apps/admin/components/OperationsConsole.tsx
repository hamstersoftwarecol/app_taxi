"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check, Wallet, ShieldCheck, Mail } from "lucide-react";
import { api, money, type Trip } from "../lib/api";
type Payment = {
  id: string;
  tripId: string;
  amount: number;
  currency: string;
  status: string;
  refundedAmount: string;
  providerFee: string | null;
  reconciledAt: string | null;
};
const labels: Record<string, string> = {
  pending: "Pendiente",
  paid: "Confirmado",
  failed: "Fallido",
  refunded: "Reembolsado",
  partially_refunded: "Reembolso parcial",
  cash_confirmed: "Efectivo conciliado",
};
export default function OperationsConsole({
  trips,
  onChange,
}: {
  trips: Trip[];
  onChange: () => void;
}) {
  const [payments, setPayments] = useState<Payment[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [outbox, setOutbox] = useState<any[]>([]),
    [runs, setRuns] = useState<any[]>([]),
    [tab, setTab] = useState("payments"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [p, a, o, r] = await Promise.all([
      api<Payment[]>("/payments"),
      api<any[]>("/audit"),
      api<any[]>("/outbox"),
      api<any[]>("/reconciliation"),
    ]);
    setPayments(p);
    setAudit(a);
    setOutbox(o);
    setRuns(r);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      onChange();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>Control de operación</h2>
          <p>Pagos verificados, auditoría y entregas de comunicaciones.</p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => action(load, "Información actualizada.")}
        >
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      <div className="table-toolbar">
        <div className="table-tabs">
          {[
            { id: "payments", name: "Pagos", icon: Wallet },
            { id: "audit", name: "Auditoría", icon: ShieldCheck },
            { id: "outbox", name: "Comunicaciones", icon: Mail },
          ].map((t) => (
            <button
              className={tab === t.id ? "active" : ""}
              key={t.id}
              onClick={() => setTab(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-note" role="status" style={{ padding: "0 22px" }}>
          {notice}
        </p>
      )}
      {tab === "payments" && (
        <>
          <div className="card-heading">
            <p>
              La confirmación del viaje y la del pago son estados diferentes.
              Las comisiones se muestran en COP.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                action(
                  () => api("/payments/reconcile", "POST", {}),
                  "Conciliación terminada. Revisa discrepancias en el registro.",
                )
              }
            >
              <RefreshCw size={16} />
              Conciliar con Stripe
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Viaje</th>
                  <th>Importe</th>
                  <th>Estado del pago</th>
                  <th>Comisión</th>
                  <th>Última conciliación</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.tripId}</td>
                    <td>{money(p.amount)}</td>
                    <td>
                      {labels[p.status] || p.status}
                      {Number(p.refundedAmount) > 0 && (
                        <small>
                          {" "}
                          · {money(Number(p.refundedAmount) / 100)} devuelto
                        </small>
                      )}
                    </td>
                    <td>
                      {p.providerFee === null
                        ? "—"
                        : money(Number(p.providerFee) / 100)}
                    </td>
                    <td>
                      {p.reconciledAt
                        ? new Date(p.reconciledAt).toLocaleString("es-CO")
                        : "Pendiente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payments.length && (
              <p className="empty-state">Todavía no hay cobros registrados.</p>
            )}
          </div>
          <div className="card-heading">
            <h2>Cobrar viajes con tarjeta</h2>
          </div>
          <div className="table-scroll">
            <table>
              <tbody>
                {trips
                  .filter(
                    (t) =>
                      t.payment === "Tarjeta" &&
                      ["requested", "accepted"].includes(t.status) &&
                      !payments.some(
                        (p) =>
                          p.tripId === t.id &&
                          ["paid", "refunded", "partially_refunded"].includes(
                            p.status,
                          ),
                      ),
                  )
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.passenger}</td>
                      <td>{money(t.fare)}</td>
                      <td>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              const result = await api<{ url: string }>(
                                "/payments/checkout",
                                "POST",
                                { tripId: t.id },
                              );
                              window.location.assign(result.url);
                            }, "Abriendo Stripe…")
                          }
                        >
                          Abrir cobro en Stripe
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="card-heading">
            <h2>Confirmar efectivo recibido</h2>
          </div>
          <div className="table-scroll">
            <table>
              <tbody>
                {trips
                  .filter(
                    (t) =>
                      t.status === "completed" &&
                      t.payment === "Efectivo" &&
                      !payments.some(
                        (p) =>
                          p.tripId === t.id && p.status === "cash_confirmed",
                      ),
                  )
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.passenger}</td>
                      <td>{money(t.fare)}</td>
                      <td>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            action(
                              () =>
                                api("/payments/cash", "POST", { tripId: t.id }),
                              "Recepción de efectivo registrada en auditoría.",
                            )
                          }
                        >
                          <Check size={15} />
                          Registrar recibido
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="card-heading">
            <h2>Últimas conciliaciones</h2>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Pagos revisados</th>
                  <th>Discrepancias</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString("es-CO")}</td>
                    <td>{r.processed}</td>
                    <td>{r.mismatches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "audit" && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Actor</th>
                <th>Acción</th>
                <th>Recurso</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString("es-CO")}</td>
                  <td>{a.actor_id || "Sistema"}</td>
                  <td>{a.action}</td>
                  <td>{a.resource}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!audit.length && (
            <p className="empty-state">Sin eventos registrados.</p>
          )}
        </div>
      )}
      {tab === "outbox" && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Intentos</th>
                <th>Último resultado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {outbox.map((o) => (
                <tr key={o.id}>
                  <td>{o.kind}</td>
                  <td>{o.status}</td>
                  <td>{o.attempts}</td>
                  <td>{o.last_error || "—"}</td>
                  <td>
                    {o.status === "failed" && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => api("/outbox/" + o.id + "/retry", "POST", {}),
                            "Mensaje encolado para reintento.",
                          )
                        }
                      >
                        Reintentar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!outbox.length && (
            <p className="empty-state">Sin comunicaciones pendientes.</p>
          )}
        </div>
      )}
    </section>
  );
}
