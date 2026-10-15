import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import Map from "./Map";
import {
  getToken,
  saveToken,
  request,
  storeDevice,
  getDevice,
  setAuthFailureHandler,
} from "./session";
import { startTracking, stopTracking } from "./tracking";
type Place = { id: string; label: string; lat: number; lng: number };
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  secret = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        autoCapitalize="none"
        style={s.input}
      />
    </View>
  );
}
export default function App() {
  const [driverProfile, setDriverProfile] = useState<any>(null),
    [user, setUser] = useState<any>(null),
    [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState("passenger"),
    [linkToken, setLinkToken] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("Viajar"),
    [trips, setTrips] = useState<any[]>([]),
    [payments, setPayments] = useState<any[]>([]),
    [positions, setPositions] = useState<any[]>([]),
    [origin, setOrigin] = useState<Place | null>(null),
    [destination, setDestination] = useState<Place | null>(null),
    [search, setSearch] = useState(""),
    [searchTarget, setSearchTarget] = useState("origin"),
    [places, setPlaces] = useState<Place[]>([]),
    [category, setCategory] = useState("mini"),
    [payment, setPayment] = useState("Efectivo"),
    [quote, setQuote] = useState<any>(null),
    [connected, setConnected] = useState(false),
    [plate, setPlate] = useState(""),
    [vehicle, setVehicle] = useState(""),
    [license, setLicense] = useState(""),
    [expires, setExpires] = useState(""),
    [subject, setSubject] = useState(""),
    [message, setMessage] = useState(""),
    [tickets, setTickets] = useState<any[]>([]),
    [prefs, setPrefs] = useState<any>({}),
    [deviceToken, setDeviceToken] = useState("");
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const [t, p, pr, st, locations] = await Promise.all([
      request("/trips"),
      request("/payments"),
      request("/preferences"),
      request("/support"),
      request("/locations"),
    ]);
    setTrips(t);
    setPayments(p);
    setPrefs(pr);
    setTickets(st);
    setPositions(locations);
    if (user?.role === "driver") {
      const drivers = await request("/drivers");
      setDriverProfile(drivers.find((d: any) => d.id === user.sub));
    }
  }
  useEffect(() => {
    setAuthFailureHandler(async (status) => {
      try {
        await stopTracking();
      } finally {
        setConnected(false);
        if (status === 401) {
          await saveToken("");
          setUser(null);
          setTrips([]);
          setPayments([]);
          setError("Tu sesión venció. Inicia sesión otra vez.");
        }
      }
    });
    getDevice().then(setDeviceToken);
    getToken().then((token) => {
      if (token)
        request("/me")
          .then(setUser)
          .catch(async (error) => {
            await stopTracking();
            if (error.status === 401) await saveToken("");
            setError(error.message);
          });
      else stopTracking().catch(() => {});
    });
    function incoming(url: string) {
      const parsed = ExpoLinking.parse(url);
      const rawAction = (parsed.path || "").split("/").pop() || "";
      const action =
        (
          { "verify-email": "verify", "reset-password": "reset" } as Record<
            string,
            string
          >
        )[rawAction] || rawAction;
      if (
        ["payment", "payment-return", "checkout", "payments"].includes(
          action || "",
        ) ||
        ["payment", "payments", "checkout"].includes(parsed.hostname || "") ||
        /^(payments?|checkout)\//.test(parsed.path || "")
      ) {
        refresh().catch((e) => setError(e.message));
      }
      if (action === "verify" || action === "reset") {
        setMode(action);
        setLinkToken(String(parsed.queryParams?.token || ""));
      }
    }
    ExpoLinking.getInitialURL().then((url) => url && incoming(url));
    const sub = ExpoLinking.addEventListener("url", (e) => incoming(e.url));
    return () => {
      sub.remove();
      setAuthFailureHandler(undefined);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      10000,
    );
    return () => clearInterval(timer);
  }, [user]);
  useEffect(() => {
    if (search.trim().length < 3) {
      setPlaces([]);
      return;
    }
    const timer = setTimeout(
      () =>
        request("/places?q=" + encodeURIComponent(search))
          .then(setPlaces)
          .catch((e) => setError(e.message)),
      400,
    );
    return () => clearTimeout(timer);
  }, [search]);
  async function logout() {
    const failures: string[] = [];
    try {
      try {
        await stopTracking();
      } catch {
        failures.push("No pudimos confirmar la detención del GPS.");
      }
      const token = await getToken();
      const device = deviceToken || (await getDevice());
      const results = await Promise.allSettled([
        ...(device ? [request("/devices", "DELETE", { token: device })] : []),
        request("/logout", "POST", { token }),
      ]);
      if (results.some((r) => r.status === "rejected"))
        failures.push(
          "La sesión local se cerró, pero no pudimos confirmar la revocación en el servidor. Vuelve a conectarte para revocar otras sesiones.",
        );
    } finally {
      try {
        await stopTracking();
      } catch {
        failures.push(
          "Revisa los permisos de ubicación del sistema si el GPS sigue activo.",
        );
      }
      const cleanup = await Promise.allSettled([
        saveToken(""),
        storeDevice(""),
      ]);
      if (cleanup.some((r) => r.status === "rejected"))
        failures.push(
          "No pudimos limpiar el almacenamiento seguro del dispositivo.",
        );
      setDeviceToken("");
      setConnected(false);
      setUser(null);
      setTrips([]);
      setPayments([]);
      setPositions([]);
      setTickets([]);
      setDriverProfile(null);
      setQuote(null);
      if (failures.length) setError(failures.join(" "));
      else setNotice("Sesión cerrada.");
    }
  }
  async function auth() {
    if (mode === "login") {
      const result = await request("/login", "POST", { email, password });
      await saveToken(result.token);
      try {
        setUser(await request("/me"));
      } catch (e) {
        await saveToken("");
        throw e;
      }
      setPassword("");
    } else {
      await request(
        mode === "register"
          ? "/register"
          : mode === "forgot"
            ? "/forgot-password"
            : mode === "verify"
              ? "/verify-email"
              : "/reset-password",
        "POST",
        { email, password, name, role, token: linkToken },
      );
      setNotice(
        mode === "register"
          ? "Cuenta creada. Revisa tu correo para verificarla."
          : "Solicitud procesada. Revisa tu correo o inicia sesión.",
      );
    }
  }
  const active =
    trips.find(
      (t) =>
        t.driverId === user?.sub &&
        ["accepted", "in_progress"].includes(t.status),
    ) || trips.find((t) => !["completed", "cancelled"].includes(t.status));
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>
          rayo<Text style={{ color: "#b68a00" }}>.</Text>
        </Text>
        <Text style={s.subtitle}>
          {user ? "Tu ciudad, a tu ritmo." : "Muévete con confianza."}
        </Text>
        {error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {notice && (
          <Text accessibilityLiveRegion="polite" style={s.notice}>
            {notice}
          </Text>
        )}
        {!user ? (
          <View style={s.card}>
            <Text style={s.title}>
              {
                {
                  login: "Bienvenido de nuevo",
                  register: "Crea tu cuenta",
                  forgot: "Recupera tu cuenta",
                  verify: "Verifica tu correo",
                  reset: "Nueva contraseña",
                }[mode]
              }
            </Text>
            {!["verify", "reset"].includes(mode) && (
              <Field
                label="Correo electrónico"
                value={email}
                onChange={setEmail}
              />
            )}
            {["login", "register", "reset"].includes(mode) && (
              <Field
                label="Contraseña"
                value={password}
                onChange={setPassword}
                secret
              />
            )}
            {mode === "register" && (
              <>
                <Field
                  label="Nombre completo"
                  value={name}
                  onChange={setName}
                />
                <View style={s.row}>
                  {["passenger", "driver"].map((r) => (
                    <Button
                      key={r}
                      title={
                        (role === r ? "✓ " : "") +
                        (r === "driver" ? "Conductor" : "Pasajero")
                      }
                      onPress={() => setRole(r)}
                    />
                  ))}
                </View>
              </>
            )}
            {["verify", "reset"].includes(mode) && (
              <Field
                label="Token del correo"
                value={linkToken}
                onChange={setLinkToken}
              />
            )}
            <Button
              title={busy ? "Procesando…" : "Continuar"}
              disabled={busy}
              onPress={() => run(auth)}
            />
            {["login", "register", "forgot"].map((m) => (
              <Button
                key={m}
                title={
                  {
                    login: "Iniciar sesión",
                    register: "Crear cuenta",
                    forgot: "Olvidé mi contraseña",
                  }[m] || m
                }
                onPress={() => setMode(m)}
              />
            ))}
          </View>
        ) : (
          <>
            <View style={s.row}>
              {["Viajar", "Actividad", "Cuenta"].map((t) => (
                <Button key={t} title={t} onPress={() => setTab(t)} />
              ))}
            </View>
            {tab === "Viajar" && (
              <>
                {user.role === "driver" ? (
                  <View style={s.card}>
                    <Text style={s.title}>Tu jornada</Text>
                    <Text>
                      Conéctate para compartir GPS y recibir solicitudes. La
                      ubicación en segundo plano necesita una compilación de
                      desarrollo.
                    </Text>
                    <Button
                      title={
                        connected
                          ? "Desconectarme"
                          : "Conectar y autorizar ubicación"
                      }
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          if (connected) {
                            await stopTracking();
                            await request("/drivers/" + user.sub, "PATCH", {
                              status: "offline",
                            });
                            setConnected(false);
                          } else {
                            await request("/drivers/" + user.sub, "PATCH", {
                              status: "available",
                            });
                            try {
                              await startTracking();
                              setConnected(true);
                            } catch (e) {
                              await request("/drivers/" + user.sub, "PATCH", {
                                status: "offline",
                              });
                              throw e;
                            }
                          }
                        })
                      }
                    />
                  </View>
                ) : (
                  <View style={s.card}>
                    <Text style={s.title}>¿A dónde vamos?</Text>
                    <Button
                      title={"Origen: " + (origin?.label || "Seleccionar")}
                      onPress={() => {
                        setSearchTarget("origin");
                        setSearch("");
                      }}
                    />
                    <Button
                      title={
                        "Destino: " + (destination?.label || "Seleccionar")
                      }
                      onPress={() => {
                        setSearchTarget("destination");
                        setSearch("");
                      }}
                    />
                    <Field
                      label={
                        searchTarget === "origin"
                          ? "Buscar recogida"
                          : "Buscar destino"
                      }
                      value={search}
                      onChange={setSearch}
                    />
                    {places.map((p) => (
                      <Button
                        key={p.id}
                        title={p.label}
                        onPress={() => {
                          searchTarget === "origin"
                            ? setOrigin(p)
                            : setDestination(p);
                          setQuote(null);
                          setSearch("");
                          setPlaces([]);
                        }}
                      />
                    ))}
                    <Map
                      points={[origin, destination].filter(Boolean) as Place[]}
                      route={
                        quote?.geometry?.coordinates ||
                        quote?.geometry ||
                        active?.route ||
                        []
                      }
                    />
                    <View style={s.row}>
                      {["mini", "sedan", "suv"].map((c) => (
                        <Button
                          key={c}
                          title={(category === c ? "✓ " : "") + c}
                          onPress={() => {
                            setCategory(c);
                            setQuote(null);
                          }}
                        />
                      ))}
                    </View>
                    <Button
                      title={"Pago: " + payment}
                      onPress={() =>
                        setPayment(
                          payment === "Efectivo" ? "Tarjeta" : "Efectivo",
                        )
                      }
                    />
                    <Button
                      title="Consultar tarifa real"
                      disabled={busy || !origin || !destination}
                      onPress={() =>
                        run(async () => {
                          setQuote(
                            await request("/quotes", "POST", {
                              origin,
                              destination,
                              category,
                            }),
                          );
                        })
                      }
                    />
                    {quote && (
                      <>
                        <Text style={s.title}>
                          {new Intl.NumberFormat("es-CO", {
                            style: "currency",
                            currency: "COP",
                            maximumFractionDigits: 0,
                          }).format(quote.fare)}
                        </Text>
                        <Text>
                          {(quote.distanceMeters / 1000).toFixed(1)} km ·{" "}
                          {Math.ceil(quote.durationSeconds / 60)} min
                        </Text>
                        <Button
                          title="Confirmar viaje"
                          disabled={busy}
                          onPress={() =>
                            run(async () => {
                              await request("/trips", "POST", {
                                quoteId: quote.quoteId || quote.id,
                                payment,
                              });
                              setQuote(null);
                              await refresh();
                            })
                          }
                        />
                      </>
                    )}
                  </View>
                )}
                {active && (
                  <View style={s.card}>
                    <Text style={s.title}>{active.status}</Text>
                    <Text>
                      {active.origin} → {active.destination}
                    </Text>
                    {user.role !== "driver" && active.payment === "Tarjeta" && (
                      <Button
                        title="Pagar con Stripe"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            const checkout = await request(
                              "/payments/checkout",
                              "POST",
                              { tripId: active.id },
                            );
                            await Linking.openURL(checkout.url);
                          })
                        }
                      />
                    )}
                    <Map
                      points={
                        typeof active.originLat === "number"
                          ? [
                              { lat: active.originLat, lng: active.originLng },
                              ...positions.filter(
                                (p) =>
                                  p.driverId === active.driverId &&
                                  !p.simulated,
                              ),
                            ]
                          : []
                      }
                      route={active.route || []}
                    />
                    {user.role === "driver" &&
                      ["requested", "accepted", "in_progress"].includes(
                        active.status,
                      ) && (
                        <Button
                          title={
                            active.status === "requested"
                              ? "Aceptar"
                              : active.status === "accepted"
                                ? "Iniciar viaje"
                                : "Completar viaje"
                          }
                          disabled={busy}
                          onPress={() =>
                            run(async () => {
                              await request("/trips/" + active.id, "PATCH", {
                                status:
                                  active.status === "requested"
                                    ? "accepted"
                                    : active.status === "accepted"
                                      ? "in_progress"
                                      : "completed",
                              });
                              await refresh();
                            })
                          }
                        />
                      )}
                  </View>
                )}
              </>
            )}
            {tab === "Actividad" && (
              <>
                {trips.map((t) => (
                  <View style={s.card} key={t.id}>
                    <Text style={s.title}>
                      {t.origin} → {t.destination}
                    </Text>
                    <Text>
                      {t.status} · {t.fare} COP
                    </Text>
                    {user.role !== "driver" && t.payment === "Tarjeta" && (
                      <Button
                        title="Pagar en sitio seguro"
                        disabled={busy}
                        onPress={() =>
                          run(async () => {
                            const checkout = await request(
                              "/payments/checkout",
                              "POST",
                              { tripId: t.id },
                            );
                            await Linking.openURL(checkout.url);
                          })
                        }
                      />
                    )}
                    {payments
                      .filter((p) => p.tripId === t.id)
                      .map((p) => (
                        <Text key={p.id}>Pago: {p.status}</Text>
                      ))}
                  </View>
                ))}
              </>
            )}
            {tab === "Cuenta" && (
              <>
                <View style={s.card}>
                  <Text style={s.title}>{user.name}</Text>
                  <Text>{user.email}</Text>
                  <Button
                    title="Autorizar notificaciones"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        if (Platform.OS === "web" || !Device.isDevice)
                          throw Error(
                            "Las notificaciones requieren un dispositivo físico y una compilación de desarrollo.",
                          );
                        if (Platform.OS === "android")
                          await Notifications.setNotificationChannelAsync(
                            "default",
                            {
                              name: "Viajes",
                              importance: Notifications.AndroidImportance.HIGH,
                            },
                          );
                        const permission =
                          await Notifications.requestPermissionsAsync();
                        if (permission.status !== "granted")
                          throw Error("No autorizaste las notificaciones.");
                        const projectId =
                          Constants.expoConfig?.extra?.eas?.projectId ||
                          Constants.easConfig?.projectId;
                        if (!projectId)
                          throw Error(
                            "Configura el projectId de EAS para notificaciones.",
                          );
                        const token = (
                          await Notifications.getExpoPushTokenAsync({
                            projectId,
                          })
                        ).data;
                        await request("/devices", "POST", {
                          token,
                          platform: Platform.OS,
                        });
                        setDeviceToken(token);
                        await storeDevice(token);
                        setNotice("Notificaciones activadas.");
                      })
                    }
                  />
                  <Field
                    label="Idioma preferido"
                    value={prefs.language || "es"}
                    onChange={(language) => setPrefs({ ...prefs, language })}
                  />
                  <Button
                    title="Guardar preferencias"
                    onPress={() =>
                      run(async () => {
                        await request("/preferences", "PUT", prefs);
                        setNotice("Preferencias guardadas.");
                      })
                    }
                  />
                </View>
                {user.role === "driver" && (
                  <View style={s.card}>
                    <Text style={s.title}>Solicita aprobación</Text>
                    <Text>
                      Estado:{" "}
                      {driverProfile?.verificationStatus || "Sin solicitud"}
                    </Text>
                    {driverProfile?.verificationReason && (
                      <Text>{driverProfile.verificationReason}</Text>
                    )}
                    <Field label="Placa" value={plate} onChange={setPlate} />
                    <Field
                      label="Vehículo"
                      value={vehicle}
                      onChange={setVehicle}
                    />
                    <Field
                      label="Número de licencia"
                      value={license}
                      onChange={setLicense}
                    />
                    <Field
                      label="Vencimiento AAAA-MM-DD"
                      value={expires}
                      onChange={setExpires}
                    />
                    <View style={s.row}>
                      {["mini", "sedan", "suv"].map((c) => (
                        <Button
                          key={c}
                          title={c}
                          onPress={() => setCategory(c)}
                        />
                      ))}
                    </View>
                    <Button
                      title="Enviar solicitud"
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          await request("/driver-applications", "POST", {
                            plate,
                            vehicle,
                            category,
                            licenseNumber: license,
                            licenseExpiresAt: expires,
                          });
                          setNotice(
                            "Solicitud enviada. Espera la revisión del equipo.",
                          );
                        })
                      }
                    />
                  </View>
                )}
                <View style={s.card}>
                  <Text style={s.title}>Estamos para ayudarte</Text>
                  <Field label="Asunto" value={subject} onChange={setSubject} />
                  <Field
                    label="Mensaje"
                    value={message}
                    onChange={setMessage}
                  />
                  <Button
                    title="Enviar a soporte"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await request("/support", "POST", { subject, message });
                        setSubject("");
                        setMessage("");
                        await refresh();
                      })
                    }
                  />
                  {tickets.map((t) => (
                    <View key={t.id}>
                      <Text style={s.label}>
                        {t.subject} · {t.status}
                      </Text>
                      <Text>{t.reply || "Pendiente de respuesta"}</Text>
                    </View>
                  ))}
                </View>
                <Button
                  title="Cerrar sesión"
                  disabled={busy}
                  onPress={() => run(logout)}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f6f0" },
  container: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    padding: 24,
    gap: 20,
    paddingBottom: 48,
  },
  brand: {
    fontSize: 46,
    fontWeight: "900",
    letterSpacing: -3,
    color: "#202820",
  },
  subtitle: { fontSize: 18, color: "#5e675b", marginBottom: 8 },
  card: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: "#e2e5db",
  },
  title: { fontSize: 24, fontWeight: "700", color: "#202820" },
  label: { fontSize: 15, fontWeight: "600", color: "#384335" },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#bdc5b6",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#202820",
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#f4cf3e",
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: { fontWeight: "700", fontSize: 15, color: "#242b22" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  error: {
    color: "#9d2525",
    backgroundColor: "#ffeded",
    padding: 16,
    borderRadius: 12,
  },
  notice: {
    color: "#28512a",
    backgroundColor: "#e5f2df",
    padding: 16,
    borderRadius: 12,
  },
});
