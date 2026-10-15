export type Trip = {
  id: string;
  passengerId: string;
  passenger: string;
  origin: string;
  destination: string;
  category: string;
  fare: number;
  payment: string;
  status: string;
  driverId: string | null;
  createdAt: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  route?: [number, number][];
};
export type Driver = {
  id: string;
  name: string;
  plate: string;
  vehicle: string;
  category: string;
  rating: number;
  status: string;
  trips: number;
};
export type Location = {
  driverId: string;
  lat: number;
  lng: number;
  updatedAt: string;
  simulated: number;
};
export const statusLabels: Record<string, string> = {
  requested: "Por asignar",
  accepted: "En camino",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};
export const categoryLabels: Record<string, string> = {
  mini: "Rayo Mini",
  sedan: "Rayo Comfort",
  suv: "Rayo XL",
};
export const money = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Client-Platform": "web" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({
    error: "El servicio no está disponible. Intenta otra vez.",
  }));
  if (!r.ok)
    throw new Error(data.error || "No pudimos conectar. Intenta otra vez.");
  return data;
}
export async function subscribe(
  path: string,
  onData: (value: any) => void,
  signal: AbortSignal,
  onState: (live: boolean) => void,
) {
  while (!signal.aborted) {
    try {
      const res = await fetch("/api" + path, {
        credentials: "include",
        signal,
      });
      if (!res.ok || !res.body) throw Error("stream");
      onState(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (event.startsWith("data: ")) onData(JSON.parse(event.slice(6)));
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    onState(false);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
