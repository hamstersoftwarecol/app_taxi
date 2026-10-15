"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  LayoutDashboard,
  Route,
  CarFront,
  Users,
  Wallet,
  BarChart3,
  Settings,
  ChevronDown,
  Search,
  Bell,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Clock,
  MoreHorizontal,
  Download,
  MapPin,
  Navigation,
  Star,
  Check,
  X,
  Menu,
  HelpCircle,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  CalendarDays,
  Radio,
  CheckCircle2,
  ChevronRight,
  Mail,
} from "lucide-react";
import CityMap from "./CityMap";
import OperationsReview from "./OperationsReview";
import OperationsConsole from "./OperationsConsole";
import BookingDialog from "./BookingDialog";
import {
  api,
  subscribe,
  money,
  statusLabels,
  categoryLabels,
  type Trip,
  type Driver,
  type Location,
} from "../lib/api";
const navigation = [
  { id: "overview", label: "Vista general", icon: LayoutDashboard },
  { id: "trips", label: "Viajes", icon: Route },
  { id: "drivers", label: "Conductores", icon: CarFront },
  { id: "passengers", label: "Pasajeros", icon: Users },
  { id: "earnings", label: "Ingresos", icon: Wallet },
  { id: "reports", label: "Reportes", icon: BarChart3 },
  { id: "operations", label: "Operación", icon: Radio },
];
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
export default function Dashboard() {
  const [payments, setPayments] = useState<any[]>([]);
  const [account, setAccount] = useState({ name: "", email: "" });
  const [page, setPage] = useState("overview"),
    [trips, setTrips] = useState<Trip[]>([]),
    [drivers, setDrivers] = useState<Driver[]>([]),
    [locations, setLocations] = useState<Location[]>([]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [live, setLive] = useState(false),
    [trackingLive, setTrackingLive] = useState(false),
    [booking, setBooking] = useState(false),
    [toast, setToast] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [mapFilter, setMapFilter] = useState("all"),
    [selected, setSelected] = useState<Trip | null>(null),
    [selectedDriver, setSelectedDriver] = useState<Driver | null>(null),
    [notifications, setNotifications] = useState(false),
    [profile, setProfile] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [help, setHelp] = useState(false),
    [period, setPeriod] = useState("today"),
    [signedOut, setSignedOut] = useState(false);
  const [operationName, setOperationName] = useState("Rayo"),
    [target, setTarget] = useState("20"),
    [actionBusy, setActionBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const detailRef = useRef<HTMLDialogElement>(null);
  const notify = (message: string) => setToast(message);
  const reload = useCallback(async () => {
    const [t, d, l, p] = await Promise.all([
      api<Trip[]>("/trips"),
      api<Driver[]>("/drivers"),
      api<Location[]>("/locations"),
      api<any[]>("/payments"),
    ]);
    setTrips(t);
    setDrivers(d);
    setLocations(l);
    setPayments(p);
    setError("");
  }, []);
  const connect = useCallback(async () => {
    setError("");
    const session = await api<{ role: string; name: string; email: string }>(
      "/me",
    );
    if (session.role !== "admin")
      throw new Error("Esta cuenta no tiene acceso al panel.");
    setAccount(session);
    const prefs = await api<{ operationName?: string; target?: string }>(
      "/preferences",
    );
    setOperationName(prefs.operationName || "Rayo");
    setTarget(prefs.target || "20");
    await reload();
    setReady(true);
    setSignedOut(false);
  }, [reload]);
  useEffect(() => {
    connect().catch(() => setSignedOut(true));
  }, [connect]);
  useEffect(() => {
    if (!ready) return;
    const c = new AbortController();
    subscribe(
      "/events",
      () => reload().catch((e) => setError(e.message)),
      c.signal,
      setLive,
    );
    subscribe("/locations/events", setLocations, c.signal, setTrackingLive);
    const timer = setInterval(
      () => reload().catch(() => setLive(false)),
      15000,
    );
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [ready, reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (selected) {
      detailRef.current?.showModal();
      setDetailError("");
    }
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const latest = trips.find((trip) => trip.id === selected.id);
    if (
      latest &&
      (latest.status !== selected.status ||
        latest.driverId !== selected.driverId)
    ) {
      setSelected(latest);
    }
  }, [trips, selected]);
  const go = (id: string) => {
    setPage(id);
    setFilter("all");
    setQuery("");
    setSidebar(false);
    setNotifications(false);
  };
  const today = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const isToday = (value: string) =>
    new Date(value).toLocaleDateString("en-CA", {
      timeZone: "America/Bogota",
    }) ===
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const periodTrips = trips.filter(
    (t) => period === "all" || isToday(t.createdAt),
  );
  const active = trips.filter((t) =>
    ["accepted", "in_progress"].includes(t.status),
  );
  const pending = trips.filter((t) => t.status === "requested");
  const available = drivers.filter((d) => d.status === "available");
  const completed = periodTrips.filter((t) => t.status === "completed");
  const confirmedPayments = payments.filter(
    (p) =>
      ["paid", "cash_confirmed", "partially_refunded"].includes(p.status) &&
      periodTrips.some((t) => t.id === p.tripId),
  );
  const income = confirmedPayments.reduce(
    (sum, p) => sum + p.amount - Number(p.refundedAmount || 0) / 100,
    0,
  );
  const filtered = periodTrips.filter(
    (t) =>
      (filter === "all" ||
        (filter === "active"
          ? ["accepted", "in_progress"].includes(t.status)
          : t.status === filter)) &&
      [t.passenger, t.id, t.origin, t.destination].some((s) =>
        s.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const passengers = useMemo(
    () =>
      Object.values(
        trips.reduce(
          (
            acc: Record<string, { name: string; trips: number; total: number }>,
            t,
          ) => {
            const p = acc[t.passenger] || {
              name: t.passenger,
              trips: 0,
              total: 0,
            };
            p.trips++;
            p.total += t.status === "completed" ? t.fare : 0;
            acc[t.passenger] = p;
            return acc;
          },
          {},
        ),
      ),
    [trips],
  );
  const hourly = Array.from({ length: 24 }, (_, hour) =>
    confirmedPayments
      .filter(
        (p) =>
          Number(
            new Intl.DateTimeFormat("en-GB", {
              hour: "2-digit",
              hourCycle: "h23",
              timeZone: "America/Bogota",
            }).format(new Date(p.createdAt)),
          ) === hour,
      )
      .reduce(
        (sum, p) => sum + p.amount - Number(p.refundedAmount || 0) / 100,
        0,
      ),
  );
  const maxHourly = Math.max(...hourly, 1);
  function exportCSV() {
    const rows = [
      ["ID", "Pasajero", "Origen", "Destino", "Estado", "Tarifa COP", "Fecha"],
      ...filtered.map((t) => [
        t.id,
        t.passenger,
        t.origin,
        t.destination,
        statusLabels[t.status],
        String(t.fare),
        t.createdAt,
      ]),
    ];
    const safe = (v: string) =>
      '"' + (/^[=+@\-]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"';
    const blob = new Blob(
      ["\ufeff" + rows.map((row) => row.map(safe).join(";")).join("\n")],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rayo-viajes.csv";
    a.click();
    URL.revokeObjectURL(url);
    notify("Reporte descargado con los filtros actuales.");
  }
  async function transition(status: string, driverId?: string) {
    if (!selected) return;
    setActionBusy(true);
    setDetailError("");
    try {
      const t = await api<Trip>("/trips/" + selected.id, "PATCH", {
        status,
        driverId,
      });
      setSelected(t);
      await reload();
      notify("Viaje actualizado: " + statusLabels[status].toLowerCase());
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function toggleDriver(d: Driver) {
    setActionBusy(true);
    try {
      await api("/drivers/" + d.id, "PATCH", {
        status: d.status === "available" ? "offline" : "available",
      });
      await reload();
      notify("Disponibilidad actualizada.");
      setSelectedDriver(null);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  const navLabel =
    navigation.find((n) => n.id === page)?.label || "Configuración";
  function table(limit?: number) {
    const rows = limit ? filtered.slice(0, limit) : filtered;
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pasajero / ID</th>
              <th>Recorrido</th>
              <th>Conductor</th>
              <th>Estado</th>
              <th>Tarifa</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const driver = drivers.find((d) => d.id === t.driverId);
              return (
                <tr key={t.id}>
                  <td>
                    <div className="person-cell">
                      <span className={"avatar color-" + (i % 4)}>
                        {initials(t.passenger)}
                      </span>
                      <div>
                        <strong>{t.passenger}</strong>
                        <small>#{t.id}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="route-cell">
                      <span>
                        <i className="origin-dot" />
                        {t.origin}
                      </span>
                      <span>
                        <i className="destination-dot" />
                        {t.destination}
                      </span>
                    </div>
                  </td>
                  <td>
                    {driver ? (
                      <div className="driver-cell">
                        <strong>{driver.name}</strong>
                        <small>{driver.plate}</small>
                      </div>
                    ) : (
                      <span className="muted">Sin asignar</span>
                    )}
                  </td>
                  <td>
                    <span className={"status " + t.status}>
                      <i />
                      {statusLabels[t.status]}
                    </span>
                  </td>
                  <td className="fare">
                    {money(t.fare)}
                    <small>{t.payment}</small>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={"Gestionar viaje de " + t.passenger}
                      onClick={() => setSelected(t)}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <Route size={32} />
            <h3>No encontramos viajes</h3>
            <p>Prueba con otro filtro o crea una nueva reserva.</p>
            <button
              className="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>
    );
  }
  function earningsChart() {
    return (
      <div className="earnings-chart">
        <div className="chart-grid">
          <span>{money(maxHourly)}</span>
          <span>{money(maxHourly / 2)}</span>
          <span>$ 0</span>
        </div>
        <div className="bar-chart">
          {hourly.map((v, i) => (
            <div key={i} className="bar-col">
              <div
                className={v ? "bar has-value" : "bar"}
                style={{
                  height: `${v ? Math.max(8, (v / maxHourly) * 100) : 3}%`,
                }}
                title={`${i}:00 · ${money(v)}`}
              >
                <span>{money(v)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="chart-times">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </div>
    );
  }
  if (signedOut)
    return (
      <div className="login-screen">
        <div className="brand">
          <span className="brand-icon">
            <Zap fill="currentColor" />
          </span>
          rayo<span className="brand-period">.</span>
        </div>
        <h1>La ciudad te espera.</h1>
        <p>Accede a tu centro de operaciones.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            setActionBusy(true);
            try {
              await api("/login", "POST", {
                email: fields.get("email"),
                password: fields.get("password"),
              });
              await connect();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setActionBusy(false);
            }
          }}
        >
          <label>
            Correo electrónico
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button primary" disabled={actionBusy}>
            {actionBusy ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
        <a href="/auth/forgot">Recuperar contraseña</a>
        {error && <p className="error">{error}</p>}
      </div>
    );
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Cerrar menú"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
          className="brand"
        >
          <span className="brand-icon">
            <Zap size={25} fill="currentColor" />
          </span>
          rayo<span className="brand-period">.</span>
        </a>
        <button className="workspace" onClick={() => go("settings")}>
          <span className="workspace-icon">RB</span>
          <span>
            <strong>{operationName}</strong>
            <small>Centro de operaciones</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">PRINCIPAL</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (page === n.id ? "active" : "")}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "trips" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-bottom">
          <div className="support-card">
            <div className="support-icon">
              <Zap size={20} />
            </div>
            <strong>Contigo en cada viaje.</strong>
            <p>Tu operación, siempre en buenas manos.</p>
            <button onClick={() => setHelp(true)}>
              Centro de ayuda <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => go("settings")}
          >
            <Settings size={19} />
            Configuración
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <HelpCircle size={19} />
            Ayuda y soporte
            <ArrowUpRight size={15} />
          </button>
          <div className="sidebar-footer">
            <span className="live-dot" />
            Centro de operaciones <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menú"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>Administración</span>
            <ChevronRight size={14} />
            <strong>{navLabel}</strong>
          </div>
          <div className="top-actions">
            <label className="global-search">
              <Search size={17} />
              <input
                aria-label="Buscar viajes"
                placeholder="Buscar un viaje…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage("trips");
                }}
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="popover-anchor">
              <button
                className={
                  "icon-button notification-button " +
                  (notifications ? "pressed" : "")
                }
                aria-label="Notificaciones"
                onClick={() => {
                  setNotifications(!notifications);
                  setProfile(false);
                }}
              >
                <Bell size={20} />
                {pending.length > 0 && <i />}
              </button>
              {notifications && (
                <div className="popover notifications">
                  <strong>Tu operación, al día</strong>
                  <p>
                    {pending.length
                      ? `${pending.length} reservas esperan un conductor.`
                      : "No hay reservas pendientes."}
                  </p>
                  <button
                    className="text-link"
                    onClick={() => {
                      go("trips");
                      setFilter("requested");
                    }}
                  >
                    Ver reservas <ArrowRight size={15} />
                  </button>
                  <small>Las novedades se actualizan en tiempo real.</small>
                </div>
              )}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor">
              <button
                className="profile"
                onClick={() => {
                  setProfile(!profile);
                  setNotifications(false);
                }}
              >
                <span className="avatar admin-avatar">
                  {initials(account.name)}
                </span>
                <span>
                  <strong>{account.name}</strong>
                  <small>Administrador</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <div className="popover profile-popover">
                  <strong>{account.email}</strong>
                  <button
                    onClick={() => {
                      go("settings");
                      setProfile(false);
                    }}
                  >
                    <Settings size={16} />
                    Preferencias
                  </button>
                  <button
                    onClick={async () => {
                      await api("/logout", "POST");
                      setReady(false);
                      setSignedOut(true);
                    }}
                  >
                    <LogOut size={16} />
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="sun-dot" /> TU CIUDAD, EN MOVIMIENTO
              </div>
              <h1>
                {page === "overview"
                  ? "Cada viaje cuenta."
                  : page === "trips"
                    ? "Un destino. Mil posibilidades."
                    : page === "drivers"
                      ? "El motor de tu operación."
                      : page === "passengers"
                        ? "Personas que confían."
                        : page === "earnings"
                          ? "El resultado de moverte."
                          : page === "reports"
                            ? "Los datos marcan el camino."
                            : "A tu manera."}
              </h1>
              <p>
                {page === "overview"
                  ? "Todo lo que necesitas para llevar tu operación más lejos."
                  : page === "trips"
                    ? "Gestiona cada reserva, desde la recogida hasta el destino."
                    : page === "drivers"
                      ? "Conoce a tu equipo y gestiona su disponibilidad."
                      : page === "passengers"
                        ? "Una visión de los pasajeros de tu operación."
                        : page === "earnings"
                          ? "Cobros confirmados y valores de los viajes, por separado."
                          : page === "reports"
                            ? "Convierte los viajes de tu operación en información útil."
                            : "Personaliza tu centro de operaciones."}
              </p>
            </div>
            <div className="heading-actions">
              <label className="period-select">
                <CalendarDays size={16} />
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  aria-label="Período"
                >
                  <option value="today">
                    Hoy, {today.split(" de ").slice(0, 2).join(" ")}
                  </option>
                  <option value="all">Todo el historial</option>
                </select>
                <ChevronDown size={14} />
              </label>
              <button
                className="button primary"
                onClick={() => setBooking(true)}
                disabled={!ready}
              >
                <Plus size={18} />
                Nuevo viaje
              </button>
            </div>
          </div>
          {error && (
            <div className="connection-error" role="alert">
              {error}
              <button
                onClick={() => connect().catch((e) => setError(e.message))}
              >
                <RefreshCw size={15} /> Reintentar
              </button>
              <button
                className="icon-button"
                aria-label="Cerrar aviso"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!ready && !error && (
            <div className="loading-state">
              <span className="loader" />
              Conectando con tu operación…
            </div>
          )}
          {ready && (
            <>
              {(page === "overview" || page === "earnings") && (
                <div className="stats-grid">
                  {[
                    {
                      label:
                        "Viajes " +
                        (period === "today" ? "de hoy" : "registrados"),
                      value: periodTrips.length,
                      icon: Route,
                      caption: `${completed.length} completados`,
                      color: "yellow",
                    },
                    {
                      label: "Viajes en curso",
                      value: active.length,
                      icon: Navigation,
                      caption: `${pending.length} esperando asignación`,
                      color: "blue",
                    },
                    {
                      label: "Conductores disponibles",
                      value: available.length,
                      icon: CarFront,
                      caption: `de ${drivers.length} conductores registrados`,
                      color: "green",
                    },
                    {
                      label:
                        "Ingresos " +
                        (period === "today" ? "de hoy" : "registrados"),
                      value: money(income),
                      icon: Wallet,
                      caption: "Cobros confirmados",
                      color: "purple",
                    },
                  ].map((s) => (
                    <section className="stat-card" key={s.label}>
                      <div className="stat-top">
                        <span>{s.label}</span>
                        <span className={"stat-icon " + s.color}>
                          <s.icon size={20} />
                        </span>
                      </div>
                      <strong className="stat-value">{s.value}</strong>
                      <div className="stat-caption">
                        <span className="tiny-indicator" />
                        {s.caption}
                        <ArrowUpRight size={13} />
                      </div>
                    </section>
                  ))}
                </div>
              )}
              {page === "overview" && (
                <div className="overview-grid">
                  <section className="card map-card">
                    <div className="card-heading">
                      <div>
                        <h2>
                          La ciudad en vivo{" "}
                          <span
                            className={
                              "live-badge " +
                              (live && trackingLive ? "" : "disconnected")
                            }
                          >
                            <i />
                            {live && trackingLive ? "En vivo" : "Reconectando"}
                          </span>
                        </h2>
                        <p>Un vistazo a lo que está pasando ahora.</p>
                      </div>
                      <div className="segmented small">
                        <button
                          className={mapFilter === "all" ? "selected" : ""}
                          onClick={() => setMapFilter("all")}
                        >
                          Todos
                        </button>
                        <button
                          className={
                            mapFilter === "available" ? "selected" : ""
                          }
                          onClick={() => setMapFilter("available")}
                        >
                          Disponibles
                        </button>
                        <button
                          className={mapFilter === "busy" ? "selected" : ""}
                          onClick={() => setMapFilter("busy")}
                        >
                          En viaje
                        </button>
                      </div>
                    </div>
                    <CityMap
                      drivers={drivers.filter(
                        (d) => mapFilter === "all" || d.status === mapFilter,
                      )}
                      locations={locations}
                      onDriver={(id) =>
                        setSelectedDriver(
                          drivers.find((d) => d.id === id) || null,
                        )
                      }
                    />
                    <div className="map-footer">
                      <span>
                        <Radio size={15} />
                        {
                          drivers.filter((d) => d.status !== "offline").length
                        }{" "}
                        conductores conectados
                      </span>
                      <button
                        className="text-link"
                        onClick={() => go("drivers")}
                      >
                        Ver conductores <ArrowRight size={15} />
                      </button>
                    </div>
                  </section>
                  <div className="overview-right">
                    <section className="card income-card">
                      <div className="card-heading">
                        <h2>Ingresos</h2>
                        <span className="subtle-label">
                          {period === "today" ? "Hoy" : "Historial"}
                        </span>
                      </div>
                      <div className="income-value">
                        {money(income)} <span>COP</span>
                      </div>
                      <div className="income-sub">
                        <span className="green-dot" />
                        {confirmedPayments.length} pagos confirmados
                      </div>
                      {earningsChart()}
                      <div className="chart-footnote">
                        Cobros por hora · zona horaria de Bogotá.
                      </div>
                      <button
                        className="card-link"
                        onClick={() => go("earnings")}
                      >
                        Ver detalle de ingresos <ArrowUpRight size={16} />
                      </button>
                    </section>
                    <section className="card operation-card">
                      <div className="card-heading">
                        <h2>
                          {period === "today"
                            ? "Así vamos hoy"
                            : "Así va tu operación"}
                        </h2>
                        <span className="icon-light">
                          <BarChart3 size={18} />
                        </span>
                      </div>
                      <div className="progress-title">
                        <strong>
                          {completed.length}
                          <span> / {target} viajes</span>
                        </strong>
                        <span>
                          {Math.min(
                            100,
                            Math.round(
                              (completed.length / Number(target)) * 100,
                            ),
                          )}
                          %
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          style={{
                            width:
                              Math.min(
                                100,
                                (completed.length / Number(target)) * 100,
                              ) + "%",
                          }}
                        />
                      </div>
                      <p>Cada destino nos acerca a la meta.</p>
                      <div className="status-summary">
                        <span>
                          <i className="available-dot" />
                          Completados <b>{completed.length}</b>
                        </span>
                        <span>
                          <i className="busy-dot" />
                          En curso <b>{active.length}</b>
                        </span>
                        <span>
                          <i className="cancelled-dot" />
                          Cancelados{" "}
                          <b>
                            {
                              periodTrips.filter(
                                (t) => t.status === "cancelled",
                              ).length
                            }
                          </b>
                        </span>
                      </div>
                    </section>
                  </div>
                </div>
              )}
              {(page === "overview" || page === "trips") && (
                <section className="card trips-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        {page === "overview"
                          ? "Últimos viajes"
                          : "Todos los viajes"}{" "}
                        <span className="count-badge">
                          {periodTrips.length}
                        </span>
                      </h2>
                      <p>Cada recorrido, bajo control.</p>
                    </div>
                    {page === "overview" ? (
                      <button className="text-link" onClick={() => go("trips")}>
                        Ver todos los viajes <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button className="button" onClick={exportCSV}>
                        <Download size={16} />
                        Exportar
                      </button>
                    )}
                  </div>
                  <div className="table-toolbar">
                    <div className="table-tabs">
                      {[
                        { id: "all", label: "Todos" },
                        { id: "active", label: "En curso" },
                        { id: "completed", label: "Completados" },
                        { id: "requested", label: "Por asignar" },
                        { id: "cancelled", label: "Cancelados" },
                      ].map((f) => (
                        <button
                          key={f.id}
                          className={filter === f.id ? "active" : ""}
                          onClick={() => setFilter(f.id)}
                        >
                          {f.label}
                          {f.id === "all" && <span>{periodTrips.length}</span>}
                        </button>
                      ))}
                    </div>
                    <label className="table-search">
                      <Search size={16} />
                      <input
                        value={query}
                        aria-label="Filtrar viajes"
                        placeholder="Buscar pasajero o viaje"
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  {table(page === "overview" ? 5 : undefined)}
                  <div className="table-footer">
                    <span>
                      Mostrando{" "}
                      {page === "overview"
                        ? Math.min(5, filtered.length)
                        : filtered.length}{" "}
                      de {filtered.length} viajes
                    </span>
                    <span>Tarifas en pesos colombianos (COP)</span>
                  </div>
                </section>
              )}
              {page === "drivers" && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Tu equipo al volante{" "}
                        <span className="count-badge">{drivers.length}</span>
                      </h2>
                      <p>
                        {available.length} disponibles ·{" "}
                        {drivers.filter((d) => d.status === "busy").length} en
                        viaje
                      </p>
                    </div>
                    <label className="table-search">
                      <Search size={16} />
                      <input
                        aria-label="Buscar conductor"
                        placeholder="Nombre o placa"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="driver-grid">
                    {drivers
                      .filter((d) =>
                        [d.name, d.plate].some((v) =>
                          v.toLowerCase().includes(query.toLowerCase()),
                        ),
                      )
                      .map((d, i) => (
                        <button
                          key={d.id}
                          className="driver-card"
                          onClick={() => setSelectedDriver(d)}
                        >
                          <div className="driver-card-top">
                            <span className={"avatar large color-" + (i % 4)}>
                              {initials(d.name)}
                            </span>
                            <span
                              className={
                                "status " +
                                (d.status === "available"
                                  ? "completed"
                                  : d.status === "busy"
                                    ? "in_progress"
                                    : "cancelled")
                              }
                            >
                              {d.status === "available"
                                ? "Disponible"
                                : d.status === "busy"
                                  ? "En viaje"
                                  : "Desconectado"}
                            </span>
                          </div>
                          <h3>{d.name}</h3>
                          <p>{d.vehicle}</p>
                          <div className="driver-card-bottom">
                            <span className="plate">{d.plate}</span>
                            <span>
                              <Star size={14} fill="#e5b326" stroke="#e5b326" />
                              {d.rating.toFixed(1)}
                              <span className="muted"> · {d.trips} viajes</span>
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </section>
              )}
              {page === "passengers" && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Pasajeros{" "}
                        <span className="count-badge">{passengers.length}</span>
                      </h2>
                      <p>Historial de pasajeros de la operación.</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Pasajero</th>
                          <th>Viajes reservados</th>
                          <th>Total completado</th>
                          <th>Historial</th>
                        </tr>
                      </thead>
                      <tbody>
                        {passengers.map((p, i) => (
                          <tr key={p.name}>
                            <td>
                              <div className="person-cell">
                                <span className={"avatar color-" + (i % 4)}>
                                  {initials(p.name)}
                                </span>
                                <strong>{p.name}</strong>
                              </div>
                            </td>
                            <td>{p.trips} viajes</td>
                            <td>{money(p.total)}</td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => {
                                  go("trips");
                                  setPeriod("all");
                                  setQuery(p.name);
                                }}
                              >
                                Ver viajes <ArrowRight size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {page === "earnings" && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>Viajes que suman</h2>
                      <p>
                        Ingresos brutos registrados. Los pagos son de operación.
                      </p>
                    </div>
                    <button className="button" onClick={exportCSV}>
                      <Download size={16} />
                      Exportar viajes
                    </button>
                  </div>
                  <div className="earnings-detail">{earningsChart()}</div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Viaje</th>
                          <th>Pasajero</th>
                          <th>Método</th>
                          <th>Ingreso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completed.map((t) => (
                          <tr key={t.id}>
                            <td>{t.id}</td>
                            <td>{t.passenger}</td>
                            <td>{t.payment}</td>
                            <td>
                              <strong>{money(t.fare)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!completed.length && (
                      <div className="empty-state">
                        Aún no hay viajes completados en este período.
                      </div>
                    )}
                  </div>
                </section>
              )}
              {page === "reports" && (
                <div className="report-grid">
                  <section className="card report-card">
                    <span className="stat-icon yellow">
                      <Route size={25} />
                    </span>
                    <h2>El recorrido de tu operación</h2>
                    <p>
                      Descarga un archivo CSV con pasajeros, destinos, estados y
                      tarifas del período seleccionado.
                    </p>
                    <div className="report-facts">
                      <span>{periodTrips.length} viajes</span>
                      <span>{today}</span>
                    </div>
                    <button className="button primary" onClick={exportCSV}>
                      <Download size={17} />
                      Descargar reporte
                    </button>
                  </section>
                  <section className="card report-card">
                    <span className="stat-icon green">
                      <CheckCircle2 size={25} />
                    </span>
                    <h2>Indicadores de operación</h2>
                    <dl>
                      <div>
                        <dt>Tasa de finalización</dt>
                        <dd>
                          {periodTrips.length
                            ? Math.round(
                                (completed.length / periodTrips.length) * 100,
                              )
                            : 0}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>Valor promedio completado</dt>
                        <dd>
                          {money(
                            completed.length ? income / completed.length : 0,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Disponibilidad de flota</dt>
                        <dd>
                          {drivers.length
                            ? Math.round(
                                (available.length / drivers.length) * 100,
                              )
                            : 0}
                          %
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
              )}
              {page === "drivers" && <OperationsReview />}
              {page === "operations" && (
                <OperationsConsole
                  trips={trips}
                  onChange={() => reload().catch((e) => setError(e.message))}
                />
              )}
              {page === "settings" && (
                <section className="card settings-card">
                  <div className="card-heading">
                    <div>
                      <h2>Tu centro de operaciones</h2>
                      <p>Preferencias de tu cuenta.</p>
                    </div>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      api("/preferences", "PUT", { operationName, target })
                        .then(() => notify("Preferencias guardadas."))
                        .catch((e) => setError(e.message));
                    }}
                  >
                    <label>
                      Nombre de la operación
                      <input
                        value={operationName}
                        onChange={(e) => setOperationName(e.target.value)}
                        maxLength={40}
                        required
                      />
                    </label>
                    <label>
                      Meta diaria de viajes
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={target}
                        required
                        onChange={(e) => setTarget(e.target.value)}
                      />
                    </label>
                    <div className="settings-info">
                      <span>
                        Ciudad <strong>Bogotá, Colombia</strong>
                      </span>
                      <span>
                        Moneda <strong>COP · Peso colombiano</strong>
                      </span>
                      <span>
                        Seguimiento{" "}
                        <strong>Ubicación GPS de conductores conectados</strong>
                      </span>
                      <span>
                        Datos <strong>Persistencia del servidor</strong>
                      </span>
                    </div>
                    <button className="button primary">
                      <Check size={17} />
                      Guardar preferencias
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <Zap size={12} fill="currentColor" /> Rayo. Conectamos personas
              con destinos.
            </span>
            <span>
              <i className={live ? "available-dot" : "cancelled-dot"} />
              {live ? "Servicios conectados" : "Sin conexión en vivo"}
              <span className="footer-separator">·</span>Operación en línea
            </span>
          </footer>
        </main>
      </div>
      {booking && (
        <BookingDialog
          onClose={() => setBooking(false)}
          onCreated={() => {
            reload();
            notify("Reserva creada. Ya puedes asignar un conductor.");
          }}
        />
      )}
      {selected && (
        <dialog
          ref={detailRef}
          className="booking-dialog detail-dialog"
          onCancel={() => setSelected(null)}
        >
          <div className="dialog-top">
            <span className="eyebrow">DETALLE DEL VIAJE</span>
            <button
              className="icon-button"
              aria-label="Cerrar detalle"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
          </div>
          <h2>{selected.passenger}</h2>
          <p className="muted">
            {selected.id} ·{" "}
            {new Date(selected.createdAt).toLocaleString("es-CO", {
              timeZone: "America/Bogota",
            })}
          </p>
          <span className={"status " + selected.status}>
            <i />
            {statusLabels[selected.status]}
          </span>
          <div className="detail-route">
            <span>
              <MapPin size={18} />
              <div>
                <small>Recogida</small>
                <strong>{selected.origin}</strong>
              </div>
            </span>
            <span>
              <Navigation size={18} />
              <div>
                <small>Destino</small>
                <strong>{selected.destination}</strong>
              </div>
            </span>
          </div>
          <div className="detail-facts">
            <span>{categoryLabels[selected.category]}</span>
            <strong>{money(selected.fare)}</strong>
            <span>{selected.payment} · Estado de pago en historial</span>
          </div>
          {selected.driverId && (
            <p className="assigned-driver">
              <CarFront size={18} />
              {drivers.find((d) => d.id === selected.driverId)?.name} ·{" "}
              {drivers.find((d) => d.id === selected.driverId)?.plate}
            </p>
          )}
          {selected.status === "requested" && (
            <form
              className="assign-form"
              onSubmit={(e) => {
                e.preventDefault();
                transition(
                  "accepted",
                  String(new FormData(e.currentTarget).get("driverId")),
                );
              }}
            >
              <label>
                Asignar conductor
                <select name="driverId" required defaultValue="">
                  <option value="" disabled>
                    Selecciona un conductor disponible
                  </option>
                  {drivers
                    .filter(
                      (d) =>
                        d.status === "available" &&
                        d.category === selected.category,
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.plate}
                      </option>
                    ))}
                </select>
              </label>
              {!drivers.some(
                (d) =>
                  d.status === "available" && d.category === selected.category,
              ) && (
                <p className="form-note">
                  No hay conductores disponibles en esta categoría.
                </p>
              )}
              <button
                className="button primary full"
                disabled={
                  actionBusy ||
                  !drivers.some(
                    (d) =>
                      d.status === "available" &&
                      d.category === selected.category,
                  )
                }
              >
                Asignar viaje <ArrowRight size={16} />
              </button>
            </form>
          )}
          {selected.status === "accepted" && (
            <button
              disabled={actionBusy}
              className="button primary full"
              onClick={() => transition("in_progress")}
            >
              Iniciar viaje <Navigation size={17} />
            </button>
          )}
          {selected.status === "in_progress" && (
            <button
              disabled={actionBusy}
              className="button primary full"
              onClick={() => transition("completed")}
            >
              Finalizar viaje <Check size={17} />
            </button>
          )}
          {["requested", "accepted"].includes(selected.status) && (
            <button
              disabled={actionBusy}
              className="button danger full"
              onClick={() => transition("cancelled")}
            >
              Cancelar reserva
            </button>
          )}
          {detailError && (
            <p className="error" role="alert">
              {detailError}
            </p>
          )}
        </dialog>
      )}
      {selectedDriver && (
        <div className="overlay" onClick={() => setSelectedDriver(null)}>
          <section
            className="mini-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle del conductor"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Cerrar conductor"
              onClick={() => setSelectedDriver(null)}
            >
              <X size={20} />
            </button>
            <span className="avatar large color-1">
              {initials(selectedDriver.name)}
            </span>
            <h2>{selectedDriver.name}</h2>
            <p>{selectedDriver.vehicle}</p>
            <div className="driver-modal-facts">
              <span className="plate">{selectedDriver.plate}</span>
              <span>
                <Star size={15} />
                {selectedDriver.rating} · {selectedDriver.trips} viajes
              </span>
            </div>
            <p className="muted">
              {selectedDriver.status === "busy"
                ? "El conductor tiene un viaje activo."
                : selectedDriver.status === "available"
                  ? "Listo para recibir nuevas reservas."
                  : "El conductor está desconectado."}
            </p>
            <button
              className="button primary full"
              disabled={selectedDriver.status === "busy" || actionBusy}
              onClick={() => toggleDriver(selectedDriver)}
            >
              {selectedDriver.status === "available"
                ? "Marcar desconectado"
                : selectedDriver.status === "busy"
                  ? "Viaje en curso"
                  : "Marcar disponible"}
            </button>
            <button
              className="button full"
              onClick={() => {
                const d = selectedDriver;
                go("trips");
                setQuery("");
                setSelectedDriver(null);
                const t = trips.find(
                  (t) =>
                    t.driverId === d.id &&
                    ["accepted", "in_progress"].includes(t.status),
                );
                if (t) setSelected(t);
                else notify("Este conductor no tiene viajes activos.");
              }}
            >
              Ver viaje activo <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      {help && (
        <div className="overlay" onClick={() => setHelp(false)}>
          <section
            className="mini-modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Centro de ayuda"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Cerrar ayuda"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="stat-icon yellow">
              <HelpCircle size={25} />
            </span>
            <h2>Estamos para ayudarte.</h2>
            <p>Prueba tu operación en tres pasos.</p>
            <ol>
              <li>Crea un viaje con origen, destino y categoría.</li>
              <li>Abre el viaje y asigna un conductor disponible.</li>
              <li>Inicia y finaliza el viaje para registrar el ingreso.</li>
            </ol>
            <p className="form-note">
              Las ubicaciones, las tarifas y los pagos pertenecen a una la
              operación. Consulta el estado de tus solicitudes en soporte.
            </p>
            <button
              className="button primary full"
              onClick={() => setHelp(false)}
            >
              Entendido <Check size={16} />
            </button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Cerrar notificación" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
