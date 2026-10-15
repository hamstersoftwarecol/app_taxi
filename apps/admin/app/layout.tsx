import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Rayo · Tu ciudad en movimiento",
  description:
    "Centro de operaciones de Rayo. Reservas, conductores y seguimiento de viajes.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
