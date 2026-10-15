# Identidad de producción

`createAuthService({pool, internalKey, mailer, audit})` devuelve `{app, close}`. `pool` es `pg.Pool` administrado por el proceso; `close()` no cierra el pool compartido. Se requiere una clave interna no vacía. Todas las rutas son internas y exigen `x-internal-key`. El gateway autenticado puede proporcionar `x-client-ip` para los límites persistentes por IP y correo.

`mailer.send({to, subject, text})` debe aceptar el correo en una cola durable o rechazar. `mailer.assertConfigured()` opcional permite comprobar SMTP antes de buscar cuentas y producir el mismo 503 con correo conocido o desconocido. Producción debe implementarlo. `PUBLIC_APP_URL` requiere HTTPS (localhost permitido para desarrollo). Los enlaces apuntan a `/auth/verify-email?token=...` y `/auth/reset-password?token=...`. Los tokens no aparecen en respuestas ni auditoría.

`audit(actor, action, resource, details={})` es asíncrona. Recibe identificadores de usuario/sesión; nunca contraseñas, tokens ni textos de correo.

Rutas POST: `/register`, `/login`, `/session`, `/logout`, `/logout-all`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`. Registro solo permite passenger/driver y exige confirmar correo antes del login. `/session` devuelve `{sub,name,email,role,emailVerified,exp,sessionId}`; login devuelve `{user,token,expiresAt}`. `exp` son segundos Unix; `expiresAt` es ISO8601.

`bootstrapAdmin({pool,email,name,password})` solo se invoca desde CLI. Devuelve el usuario; es idempotente por correo administrador. Rechaza un correo existente con otro rol y no reemplaza su contraseña. No hay credenciales predeterminadas. Contraseñas: 12–128 caracteres, mayúsculas, minúsculas, número y símbolo; almacenamiento scrypt con sal aleatoria.

Sesiones opacas de 32 bytes aleatorios: solo SHA256 persiste, vencen a las 8 horas y cada introspección consulta revocación en PostgreSQL. Reset invalida todas las sesiones y tokens de recuperación. Verificación vence en 24 horas; recuperación en 30 minutos. Reenvío invalida el token previo. Consumo único y emisión usan transacciones con bloqueo por usuario. Login sincroniza con reset para impedir sesiones con contraseña anterior después de la revocación.

Aplicar `migrations/001_auth.sql` antes de iniciar. Ejecutar `TEST_DATABASE_URL=postgresql://... node --test tests/auth-production.test.mjs`. Sin URL, integración se omite explícitamente. La suite usa PostgreSQL real y comprueba confirmación, reenvío, uso único, recuperación genérica, expiración, revocación individual/global, límites persistentes, bootstrap y carrera de login durante cambio de contraseña.
