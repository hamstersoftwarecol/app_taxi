import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
export const API =
  (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "") + "/api";
let memory = "";
export async function getToken() {
  return Platform.OS === "web"
    ? memory
    : (await SecureStore.getItemAsync("rayo.session")) || "";
}
export async function saveToken(token: string) {
  memory = token;
  if (Platform.OS !== "web") {
    if (token) await SecureStore.setItemAsync("rayo.session", token);
    else await SecureStore.deleteItemAsync("rayo.session");
  }
}
export async function request<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (!process.env.EXPO_PUBLIC_API_URL)
    throw Error("Configura EXPO_PUBLIC_API_URL para conectar con el servicio.");
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(API + path, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new ApiError(
        typeof data?.error === "string"
          ? data.error
          : "No pudimos completar la solicitud.",
        response.status,
      );
      if (response.status === 401 || response.status === 403)
        await authFailureHandler?.(response.status);
      throw error;
    }
    if (data === null && response.status !== 204)
      throw new ApiError(
        "El servicio devolvió una respuesta inválida.",
        response.status,
      );
    return data as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiError("La conexión tardó demasiado. Intenta otra vez.", 0);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export async function storeDevice(token: string) {
  if (Platform.OS !== "web") {
    if (token) await SecureStore.setItemAsync("rayo.device", token);
    else await SecureStore.deleteItemAsync("rayo.device");
  }
}
export async function getDevice() {
  return Platform.OS === "web"
    ? ""
    : (await SecureStore.getItemAsync("rayo.device")) || "";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
let authFailureHandler: ((status: number) => Promise<void>) | undefined;
export function setAuthFailureHandler(
  handler?: (status: number) => Promise<void>,
) {
  authFailureHandler = handler;
}
