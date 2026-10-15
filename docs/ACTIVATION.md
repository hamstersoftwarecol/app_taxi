# Activación local y conectores

La sesión actual contiene PostgreSQL operativo vacío en 127.0.0.1:55432, Mailpit local (SMTP1025/bandeja8025), gateway3100 y panel3000. No existen cuentas predeterminadas. Crea tu administrador mediante `npm run admin:create`, con ADMIN_EMAIL, ADMIN_NAME y un archivo privado ADMIN_PASSWORD_FILE.

Para usar mapas/reservas: configura ambos tokens de Mapbox y FARE_RULES_JSON en `.env`; reinicia `npm run dev`. Para pagos, configura claves Stripe de prueba y un webhook firmado. Para push, configura EAS/APNs/FCM y crea un development build. No introduzcas secretos en el chat ni los subas a Git.

El registro público ya funciona con la bandeja Mailpit: los mensajes se capturan localmente y el operador puede abrir el enlace para verificar el correo. No envía a destinatarios externos.

HTTPS público está preparado en deploy, pero no activado porque se eligió solo local. Antes de distribuir: probar GPS y push en dispositivos, firma de builds, reembolsos y conciliación con la cuenta Stripe de prueba, restauración de backup y alertas. Revisar las advertencias pendientes del árbol Expo/React Native. No afirmar una activación de proveedor o despliegue hasta ejecutarla con las cuentas y el destino del operador.

## Referencias de proveedores utilizadas

- [Mapbox Directions](https://docs.mapbox.com/api/navigation/directions/)
- [Stripe Webhooks](https://docs.stripe.com/webhooks)
- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
- [Expo Push receipts](https://docs.expo.dev/push-notifications/sending-notifications/)
- [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html)

El conjunto Docker también está validado en este equipo: panel http://localhost:8080 y Mailpit http://localhost:8026, con base independiente. Véase deployment-production.md. Las pruebas físicas pendientes se detallan en DEVICE-TESTS.md; los 15 avisos restantes, en DEPENDENCIES.md.
