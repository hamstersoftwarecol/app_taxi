# Pruebas pendientes en dispositivos

Estado al 14 de octubre de 2026: la generación de los proyectos Android/iOS con Expo prebuild terminó correctamente en una copia local temporal. Se comprobó la presencia de permisos Android de ubicación en segundo plano y servicio de ubicación, y el modo location de iOS. Esto no equivale a compilar o probar las aplicaciones.

El equipo tiene Command Line Tools, pero no Xcode completo, simuladores iOS, Android SDK ni adb. No hay evidencia de dispositivos físicos conectados. Para completar la validación se necesitan un iPhone y un Android, sus herramientas de compilación o builds EAS firmados y las credenciales APNs/FCM del propietario.

## Preparación

1. Configurar EAS_PROJECT_ID, credenciales APNs/FCM y las variables indicadas en ACTIVATION.md. No guardar claves en Git.
2. Instalar development builds Android/iOS; Expo Go no sirve para comprobar ubicación en segundo plano.
3. Configurar EXPO_PUBLIC_API_URL con una dirección alcanzable desde ambos teléfonos. localhost del teléfono apunta al teléfono, no al servidor del equipo. Para pruebas externas usar HTTPS y el dominio del operador cuando se autorice ese despliegue.
4. Crear cuentas de prueba verificadas, un pasajero y un conductor, y aprobar la licencia del conductor desde el panel.

## Casos de aceptación

| Caso                            | Resultado esperado                                                 | Android   | iOS       |
| ------------------------------- | ------------------------------------------------------------------ | --------- | --------- |
| Registro y correo               | Verificación de un solo uso, sin acceso previo                     | Pendiente | Pendiente |
| Recuperación                    | Enlace vigente funciona una vez; sesiones anteriores se revocan    | Pendiente | Pendiente |
| GPS denegado                    | Explica el permiso y permite reintentar sin iniciar tracking       | Pendiente | Pendiente |
| Conductor conectado             | Publica coordenadas reales con hora y precisión                    | Pendiente | Pendiente |
| Segundo plano                   | Sigue el viaje con pantalla bloqueada y app en segundo plano       | Pendiente | Pendiente |
| Permiso revocado/ahorro batería | Estado y error visibles; no se muestran posiciones simuladas       | Pendiente | Pendiente |
| Desconexión y logout            | Detiene tarea GPS y retira registro push de la sesión              | Pendiente | Pendiente |
| Privacidad                      | Pasajero solo ve conductor de su viaje activo                      | Pendiente | Pendiente |
| Push                            | Aceptación explícita, entrega, recibo y token inválido gestionados | Pendiente | Pendiente |
| Mapas                           | Origen/destino, ruta y cotización provienen de Mapbox              | Pendiente | Pendiente |
| Stripe de prueba                | Pago/cancelación, webhook, conciliación y devolución correctos     | Pendiente | Pendiente |
| Reapertura                      | Restauración de sesión vigente y rechazo de sesión revocada        | Pendiente | Pendiente |

Registrar versión del sistema, modelo, build, hora y evidencia de cada caso. Probar terminación forzada y reinicio por separado: la continuidad depende de las restricciones del sistema y no debe darse por comprobada con una prueba solo en primer plano.
