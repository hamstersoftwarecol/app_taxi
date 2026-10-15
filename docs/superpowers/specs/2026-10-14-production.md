# Rayo: transición operativa

Solicitud: sustituir la demo por infraestructura y flujos para operación real. Proveedores aprobados por el usuario: Mapbox, Stripe Checkout, Expo Push, SMTP y despliegue Docker con dominio propio. La activación externa depende de las cuentas, claves y dominio del operador; no se inventarán confirmaciones, ubicaciones ni pagos.

## Arquitectura

Servicios HTTP de identidad, movilidad, tracking, operaciones y gateway. PostgreSQL como fuente de verdad, migraciones versionadas y procesos separados. Sesiones opacas almacenadas como hashes; introspección central en cada petición y control periódico en SSE para revocación. El modo predeterminado es operativo, sin seeds ni auto-login. La demo SQLite queda disponible únicamente con RAYO_MODE=demo para pruebas históricas.

## Operación

Registro con verificación de email, recuperación single-use y revocación de todas las sesiones. Conductores presentan matrícula, licencia y vencimiento; un administrador aprueba y habilita disponibilidad. Rutas y presupuestos calculados en servidor; cotización con vencimiento y un único uso. Exclusión de doble asignación con bloqueos e índice PostgreSQL. GPS nativo solicitado explícitamente, con permisos y servicio de segundo plano; protección contra posiciones antiguas.

Stripe Checkout aloja la captura de tarjeta; importe y propietario se derivan del viaje. Webhook de cuerpo crudo con firma verificada, deduplicación, conciliación programable y registro de discrepancias. Correo/push mediante outbox persistente, reintentos y recibos Expo. Preferencias y tickets de soporte persistidos por usuario; respuestas de soporte y auditoría visibles solo para administración.

Eventos entre réplicas mediante LISTEN/NOTIFY; los clientes vuelven a leer datos autorizados y se resincronizan periódicamente tras desconexión. NOTIFY no sustituye persistencia. Auditoría sin tokens/contraseñas, métricas Prometheus, readiness y liveness. Caddy termina HTTPS y solo expone frontend/gateway; PostgreSQL y servicios internos aislados. Copias de seguridad y procedimientos de recuperación documentados.

## Validación

Pruebas reales contra PostgreSQL local, carreras de asignación, permiso por actor, expiración/revocación y tokens single-use. Pruebas de pagos con servidor Stripe de prueba controlado y firmas reales del SDK; nunca cargar tarjetas ni hacer cobros reales. Compilación web, TypeScript móvil y exportación web. GPS background y push requieren dispositivos y builds firmados; HTTPS público requiere dominio/DNS/servidor, y las integraciones reales sus claves.
