export const categories = [
  { id: "mini", name: "Rayo Mini", fare: 12500, seats: 4, eta: 3 },
  { id: "sedan", name: "Rayo Comfort", fare: 18500, seats: 4, eta: 5 },
  { id: "suv", name: "Rayo XL", fare: 26500, seats: 6, eta: 7 },
];
export const labels = {
  requested: "Por asignar",
  accepted: "En camino",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};
export function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function textField(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label}: escribe entre 1 y ${max} caracteres.`);
  return value.trim();
}
export const money = (value) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
