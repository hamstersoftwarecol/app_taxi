# Rayo · Plataforma de taxis

Primera versión local aprobada al indicar «proceder». Ciudad inicial Bogotá, idioma español y COP. La referencia aporta la paleta amarilla, la selección de vehículos y el seguimiento.

## Alcance

Panel web con resumen derivado de reservas, viajes filtrables, creación y asignación, conductores, pasajeros, ingresos y configuración local. App Expo para pasajero (reserva, seguimiento, historial) y conductor (aceptar, iniciar, finalizar). Los cambios de viajes y posiciones se difunden en tiempo real. La interfaz distingue datos de demostración y conexión perdida.

## Arquitectura

Monorepo npm. Next.js y React para web, Expo y React Native para Android/iOS. Servicios Node independientes: auth (sesiones y roles), trips (viajes, conductores y tarifas), tracking (posiciones y eventos), gateway (API pública y autenticación). SQLite por servicio para ejecutar sin infraestructura externa; límites HTTP permiten migrar a PostgreSQL. La simulación de ubicación se limita a viajes activos. No se procesan cobros reales ni se envían mensajes externos.

## Contratos y seguridad

API /api: login, me, trips, drivers, locations y eventos SSE. Sesiones firmadas expiran a ocho horas; roles admin, passenger y driver. Cada actor solo consulta/modifica lo autorizado. Servicios internos requieren clave. Validación de campos, transiciones de estado y exclusión de doble asignación. Estados: requested → accepted → in_progress → completed; cancelación desde requested/accepted. Persistencia y asignación en transacciones.

## Diseño

Marca Rayo, amarillo #FFD43B, tinta #171A20, fondo #F6F7F9. Sidebar claro, tarjetas blancas, mapa urbano ilustrativo local y tablas legibles. Adaptación a móvil, foco visible, botones accesibles y formularios con errores. Mapa rotulado como simulación, no cartografía navegable.

## Validación y límites

Pruebas de dominio e integración HTTP para autenticación, permisos, reservas, asignación, estados, persistencia y posiciones. Compilación web y exportación móvil web. Verificación visual del panel y tamaño móvil. Producción requiere GPS nativo de segundo plano, proveedor cartográfico, pagos, notificaciones, recuperación de cuenta, PostgreSQL, HTTPS, infraestructura y builds firmados de tiendas.
