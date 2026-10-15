import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { request, getToken, saveToken } from "./session";
const TASK = "rayo-driver-location";
if (Platform.OS !== "web")
  TaskManager.defineTask(TASK, async ({ data, error }) => {
    if (error) return;
    if (!(await getToken())) {
      await stopTracking();
      return;
    }
    const locations =
      (data as { locations: Location.LocationObject[] })?.locations || [];
    for (const position of locations) {
      try {
        await request("/locations", "POST", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recordedAt: new Date(position.timestamp).toISOString(),
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403) {
          try {
            await stopTracking();
          } finally {
            if (status === 401) await saveToken("");
          }
          return;
        }
      }
    }
  });
export async function startTracking() {
  if (Platform.OS === "web")
    throw Error("El servicio de conductor requiere la aplicación nativa.");
  if ((await Location.requestForegroundPermissionsAsync()).status !== "granted")
    throw Error("Autoriza tu ubicación para conectarte.");
  if ((await Location.requestBackgroundPermissionsAsync()).status !== "granted")
    throw Error(
      "Autoriza ubicación en segundo plano para mantener el servicio conectado.",
    );
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 20,
    timeInterval: 5000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Rayo conectado",
      notificationBody: "Compartiendo tu ubicación durante el servicio.",
    },
  });
}
export async function stopTracking() {
  if (
    Platform.OS !== "web" &&
    (await Location.hasStartedLocationUpdatesAsync(TASK))
  )
    await Location.stopLocationUpdatesAsync(TASK);
}
