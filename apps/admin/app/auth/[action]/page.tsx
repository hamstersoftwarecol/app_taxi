"use client";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
export default function AuthPage() {
  const [action, setAction] = useState(""),
    [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const raw = location.pathname.split("/").pop() || "";
    setAction(
      (
        {
          "verify-email": "verify",
          "reset-password": "reset",
          "forgot-password": "forgot",
        } as Record<string, string>
      )[raw] || raw,
    );
    setToken(new URLSearchParams(location.search).get("token") || "");
  }, []);
  return (
    <main className="login-screen">
      <h1>
        {action === "verify"
          ? "Verifica tu correo"
          : action === "reset"
            ? "Nueva contraseña"
            : "Recupera tu cuenta"}
      </h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const data = new FormData(e.currentTarget);
          try {
            await api(
              action === "verify"
                ? "/verify-email"
                : action === "reset"
                  ? "/reset-password"
                  : "/forgot-password",
              "POST",
              {
                token,
                email: data.get("email"),
                password: data.get("password"),
              },
            );
            setMessage(
              "Solicitud procesada. Revisa tu correo o inicia sesión.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {action === "forgot" ? (
          <label>
            Correo electrónico
            <input name="email" type="email" required />
          </label>
        ) : action === "reset" ? (
          <label>
            Contraseña nueva
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
        ) : (
          <p>Confirma que este correo te pertenece.</p>
        )}
        <button
          className="button primary"
          disabled={
            busy || ((action === "reset" || action === "verify") && !token)
          }
        >
          {busy ? "Procesando…" : "Continuar"}
        </button>
      </form>
      <p role="status">{message}</p>
      <a href="/">Volver a iniciar sesión</a>
    </main>
  );
}
