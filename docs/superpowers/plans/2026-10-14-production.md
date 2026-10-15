# Implementación operativa de Rayo

**Especificación:** ../specs/2026-10-14-production.md
**Ejecución:** identidad, movilidad y clientes en paralelo con propiedad de archivos; raíz integra proveedores, operaciones, gateway, despliegue y pruebas.

- [x] PostgreSQL, migraciones y eventos: services/production/{db,events,http}.mjs y migrations/*.sql.
- [x] Identidad: services/production/auth.mjs; registro, verificación, recuperación y sesiones revocables.
- [x] Movilidad/tracking: cotizaciones, licencias, aprobaciones y concurrencia real.
- [x] Integraciones: Mapbox, Stripe Checkout, firma e idempotencia, conciliación.
- [x] Operaciones: outbox SMTP/Expo, preferencias, soporte, auditoría y métricas.
- [x] Gateway: introspección, permisos, protección de streams y rutas públicas limitadas.
- [x] Clientes: login real, búsqueda de lugares, mapas/rutas, permisos GPS/push y pagos.
- [x] Despliegue: contenedores separados, PostgreSQL, Caddy HTTPS, monitoreo y backups.
- [x] Integración: suite PostgreSQL, contratos, builds, revisión y documentación de activación.

Implementación y validación local completadas. La activación de proveedores, los builds nativos y la ejecución de contenedores siguen pendientes según docs/ACTIVATION.md y docs/VALIDATION.md.
