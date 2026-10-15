# Clientes para producción

Admin usa `/api` y cookies HttpOnly del servidor. El formulario autentica credenciales introducidas por el usuario; `/me` determina identidad y rol. No hay login de demostración. Recuperación y verificación viven en `/auth/reset?token=…`, `/auth/verify?token=…` y `/auth/forgot`. También se reconocen los enlaces emitidos por auth `/auth/verify-email?token=…` y `/auth/reset-password?token=…`, incluyendo deep links móviles equivalentes.

Móvil requiere `EXPO_PUBLIC_API_URL` (origen HTTPS del API, sin `/api`). La sesión se guarda en Expo SecureStore en iOS/Android y solo memoria en web. Los enlaces `rayo://auth/reset?token=…` y `rayo://auth/verify?token=…` abren formularios correspondientes. Registro exige verificación por correo del servidor.

Mapbox se obtiene de `/maps/config`; el token es público con restricciones de URL y permisos de lectura. Sin configuración se muestra el error del proveedor, sin mapas inventados. Búsqueda usa `/places`, cotizaciones `/quotes` y reservas un `quoteId`. iOS y Android muestran cartografía web Mapbox GL JS en un WebView nativo (`react-native-webview`), con el mismo token público `/maps/config`; no requieren claves ni servicios Google Maps. El HTML tiene scripts fijos de `api.mapbox.com`, coordenadas JSON escapadas, política CSP y navegación limitada a `about:blank`; los recursos cartográficos Mapbox se cargan dentro del mapa. No hay tarifas fijas ni posiciones simuladas.

Conductores solicitan aprobación con placa, vehículo, categoría y licencia; el panel permite aprobar o rechazar con motivo. Conectar solicita explícitamente permisos foreground y background, inicia una tarea global Expo Location y sube coordenadas, precisión y fecha al API. Desconectar o cerrar sesión detiene la tarea. Background location requiere una **development build**, no Expo Go; los permisos y servicios se incluyen en app.json. Validar segundo plano en dispositivos físicos y ambos sistemas operativos, incluidos reinicio, revocación de permisos y ahorro de batería.

Las notificaciones se solicitan únicamente al pulsar Autorizar notificaciones. Requieren dispositivo físico, development build, credenciales APNs/FCM y `expo.extra.eas.projectId` del proyecto EAS (inyectado por `app.config.ts` desde `EAS_PROJECT_ID` o `EXPO_PUBLIC_EAS_PROJECT_ID`, sin ID fijo); el token se registra con `/devices` y se elimina al salir.

Pagos abren la URL de Stripe Checkout devuelta por el servidor; el cliente nunca captura números de tarjeta. El historial muestra el estado persistido del pago. Preferencias y soporte se guardan en API por usuario.

Fuentes de integración: [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
